import { hmacHex, verifyFeedbackUser } from '@kobecuppens/feedback-core/server';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { AppEnv, EndUserRow, Env, Identity, Project } from './env';
import { findProjectById, findProjectByPublicKey, findProjectBySecretHash } from './projects';
import { assertSameOrigin, fail, flag, newId, now, sha256Hex, timingSafeEqualString } from './util';

export const SESSION_COOKIE = 'fb_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const ANON_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Resolve the project (`X-Feedback-Key`) and the caller's identity for public endpoints. */
export const projectAuth = createMiddleware<AppEnv>(async (c, next) => {
  const key = c.req.header('X-Feedback-Key') ?? c.req.query('key');
  if (!key) fail(401, 'missing_project_key');
  const project = await findProjectByPublicKey(c.env, key);
  if (!project) fail(401, 'invalid_project_key');
  c.set('project', project);
  c.set('identity', await resolveIdentity(c, project));
  c.set('viewer', undefined);
  await next();
});

async function resolveIdentity(c: Context<AppEnv>, project: Project): Promise<Identity | null> {
  const token = c.req.header('X-Feedback-User');
  if (token) {
    const result = await verifyFeedbackUser(token, project.signingSecret);
    if (!result.ok) {
      // Reads fall back to a signed-out view so a stale token (e.g. a ?user= link) still shows the
      // board; writes fail so clients with getUserToken refresh and retry.
      if (result.reason === 'expired' && c.req.method === 'GET') return null;
      fail(401, result.reason === 'expired' ? 'user_token_expired' : 'invalid_user_token');
    }
    const { claims } = result;
    // `anon:` and `system:` are internal external_id namespaces (anonymous devices, the Team author).
    if (/^(anon|system):/.test(claims.id)) fail(401, 'invalid_user_token', 'User ids may not start with anon: or system:');
    return {
      externalId: claims.id,
      anonymous: false,
      name: claims.name ?? null,
      email: claims.email ?? null,
      avatarUrl: claims.avatarUrl ?? null,
      claimsAdmin: claims.isAdmin === true,
    };
  }
  const anon = c.req.header('X-Feedback-Anon');
  if (anon && project.settings.allowAnonymous) {
    if (!ANON_ID.test(anon)) fail(400, 'invalid_anonymous_id');
    return { externalId: `anon:${anon}`, anonymous: true, name: null, email: null, avatarUrl: null, claimsAdmin: false };
  }
  return null;
}

/** In-app admin: a signed user with `isAdmin` on a project that allows it. */
export function isInAppAdmin(c: Context<AppEnv>): boolean {
  const identity = c.get('identity');
  return !!identity && identity.claimsAdmin && c.get('project').settings.inAppAdmin;
}

/** Look up the caller's end-user row without creating it (cheap path for reads). */
export async function getViewer(c: Context<AppEnv>): Promise<EndUserRow | null> {
  const cached = c.get('viewer');
  if (cached !== undefined) return cached;
  const identity = c.get('identity');
  const row = identity
    ? await c.env.DB.prepare('SELECT * FROM end_users WHERE project_id = ? AND external_id = ?')
        .bind(c.get('project').id, identity.externalId)
        .first<EndUserRow>()
    : null;
  c.set('viewer', row);
  return row;
}

/** Create or refresh the caller's end-user row. Fails when the caller is unidentified. */
export async function requireViewer(c: Context<AppEnv>): Promise<EndUserRow> {
  const identity = c.get('identity');
  if (!identity) fail(401, 'identity_required', 'Sign in, or enable anonymous feedback for this project.');
  const existing = await getViewer(c);
  const isAdmin = identity.claimsAdmin ? 1 : 0;
  if (existing) {
    const changed =
      !identity.anonymous &&
      (existing.name !== identity.name ||
        existing.email !== identity.email ||
        existing.avatar_url !== identity.avatarUrl ||
        existing.is_admin !== isAdmin);
    if (!changed) return existing;
    await c.env.DB.prepare('UPDATE end_users SET name = ?, email = ?, avatar_url = ?, is_admin = ? WHERE id = ?')
      .bind(identity.name, identity.email, identity.avatarUrl, isAdmin, existing.id)
      .run();
    const updated = { ...existing, name: identity.name, email: identity.email, avatar_url: identity.avatarUrl, is_admin: isAdmin };
    c.set('viewer', updated);
    return updated;
  }
  const row: EndUserRow = {
    id: newId(),
    project_id: c.get('project').id,
    external_id: identity.externalId,
    is_anonymous: identity.anonymous ? 1 : 0,
    name: identity.name,
    email: identity.email,
    avatar_url: identity.avatarUrl,
    is_admin: isAdmin,
    last_seen_updates_at: null,
    created_at: now(),
  };
  // ON CONFLICT covers two concurrent first requests from the same user.
  const saved = await c.env.DB.prepare(
    `INSERT INTO end_users (id, project_id, external_id, is_anonymous, name, email, avatar_url, is_admin, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (project_id, external_id) DO UPDATE SET name = excluded.name
     RETURNING *`,
  )
    .bind(row.id, row.project_id, row.external_id, row.is_anonymous, row.name, row.email, row.avatar_url, row.is_admin, row.created_at)
    .first<EndUserRow>();
  c.set('viewer', saved ?? row);
  return saved ?? row;
}

/** The shared "Team" author used for official replies from the dashboard or admin API. */
async function teamAuthor(env: Env, projectId: string): Promise<EndUserRow> {
  const saved = await env.DB.prepare(
    `INSERT INTO end_users (id, project_id, external_id, is_anonymous, name, is_admin, created_at)
     VALUES (?, ?, 'system:team', 0, NULL, 1, ?)
     ON CONFLICT (project_id, external_id) DO UPDATE SET is_admin = 1
     RETURNING *`,
  )
    .bind(newId(), projectId, now())
    .first<EndUserRow>();
  return saved!;
}

// ---------------------------------------------------------------------------
// Admin: secret key, dashboard session, or in-app admin.

/**
 * Changes whenever ADMIN_PASSWORD does, so a new password ends every existing session.
 * Keyed with SESSION_SECRET: the claim is readable in the cookie, and a plain hash would let
 * anyone holding a cookie test password guesses offline.
 */
// Fixed for an isolate's lifetime unless the secrets change, so compute it once per pair.
let pwvCache: { secret: string; password: string; value: Promise<string> } | null = null;

function passwordVersion(env: Env): Promise<string> {
  const secret = sessionSecret(env);
  const password = env.ADMIN_PASSWORD ?? '';
  if (pwvCache?.secret !== secret || pwvCache.password !== password) {
    pwvCache = { secret, password, value: hmacHex(secret, `pwv:${password}`).then((hex) => hex.slice(0, 16)) };
  }
  return pwvCache.value;
}

/**
 * The superadmin session cookie: `v1.<issued-at seconds>.<password version>.<HMAC>`, signed
 * with SESSION_SECRET. A dedicated `session:` prefix keeps it apart from other HMACs made
 * with the same secret (the password version).
 */
export async function createSessionCookieValue(env: Env, nowMs = now()): Promise<string> {
  const claims = `v1.${Math.floor(nowMs / 1000)}.${await passwordVersion(env)}`;
  return `${claims}.${await hmacHex(sessionSecret(env), `session:${claims}`)}`;
}

async function verifySessionCookieValue(env: Env, token: string, nowMs = now()): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const [, iat, pwv, signature] = parts as [string, string, string, string];
  const claims = `v1.${iat}.${pwv}`;
  if (!timingSafeEqualString(signature, await hmacHex(sessionSecret(env), `session:${claims}`))) return false;
  const issued = Number(iat);
  if (!Number.isInteger(issued) || nowMs / 1000 - issued > SESSION_TTL_SECONDS || issued > nowMs / 1000 + 60) return false;
  // A changed ADMIN_PASSWORD invalidates every existing session.
  return pwv === (await passwordVersion(env));
}

function sessionSecret(env: Env): string {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) fail(503, 'dashboard_not_configured');
  return env.SESSION_SECRET;
}

async function hasDashboardSession(c: Context<AppEnv>): Promise<boolean> {
  if (!flag(c.env, 'FEATURE_DASHBOARD')) return false;
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return false;
  return verifySessionCookieValue(c.env, token);
}

export const requireDashboard = createMiddleware<AppEnv>(async (c, next) => {
  if (!flag(c.env, 'FEATURE_DASHBOARD')) fail(404, 'not_found');
  if (!(await hasDashboardSession(c))) fail(401, 'unauthorized');
  await next();
});

function asFullAdmin(c: Context<AppEnv>, project: Project) {
  c.set('project', project);
  c.set('identity', null);
  c.set('viewer', undefined);
  c.set('adminLevel', 'full');
}

/**
 * Admin routes accept, in order:
 *  1. `Authorization: Bearer sk_…` (FEATURE_ADMIN_API) → full access to that project.
 *  2. Dashboard session + `X-Feedback-Project` (FEATURE_DASHBOARD) → full access.
 *  3. `X-Feedback-Key` + signed user with isAdmin on a project with inAppAdmin → moderator.
 */
export const adminAuth = createMiddleware<AppEnv>(async (c, next) => {
  const bearer = c.req.header('Authorization')?.match(/^Bearer\s+(sk_\S+)$/)?.[1];
  if (bearer) {
    if (!flag(c.env, 'FEATURE_ADMIN_API')) fail(404, 'not_found');
    const project = await findProjectBySecretHash(c.env, await sha256Hex(bearer));
    if (!project) fail(401, 'invalid_secret_key');
    asFullAdmin(c, project);
    return next();
  }

  const projectHeader = c.req.header('X-Feedback-Project');
  if (projectHeader && (await hasDashboardSession(c))) {
    assertSameOrigin(c);
    const project = await findProjectById(c.env, projectHeader);
    if (!project) fail(404, 'project_not_found');
    asFullAdmin(c, project);
    return next();
  }

  if (c.req.header('X-Feedback-Key')) {
    let authorized = false;
    await projectAuth(c, async () => {
      authorized = isInAppAdmin(c);
    });
    if (!authorized) fail(403, 'forbidden');
    c.set('adminLevel', 'moderator');
    return next();
  }

  fail(401, 'unauthorized');
});

export const requireFullAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get('adminLevel') !== 'full') fail(403, 'forbidden', 'Requires the admin API key or the dashboard.');
  await next();
});

/** The author for admin-originated comments: the in-app admin themselves, or the shared Team user. */
export async function adminActor(c: Context<AppEnv>): Promise<EndUserRow> {
  return c.get('adminLevel') === 'moderator' ? requireViewer(c) : teamAuthor(c.env, c.get('project').id);
}
