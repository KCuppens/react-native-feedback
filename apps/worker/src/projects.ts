import {
  BOARD_LIMITS,
  DEFAULT_PROJECT_SETTINGS,
  locales,
  type ProjectSettings,
  type ProjectSummary,
  type PublicBoardAppearance,
} from '@kobecuppens/feedback-core';
import type { Env, Project, ProjectRow } from './env';
import { SLUG_MAX } from './keys.mjs';
import { fail } from './util';

export { slugify } from './keys.mjs';

export const LIMITS = {
  ...BOARD_LIMITS,
  declineReasonMax: 500,
  /** Ids arrive in bodies (categoryId, intoId); nothing we issue is longer. */
  idMax: 64,
  categoryNameMax: 40,
  categoryColorMax: 32,
  projectNameMax: 80,
  slugMax: SLUG_MAX,
  /** Bounds each event's delivery fan-out (see handleEventBatch). */
  webhooksPerProject: 10,
  postsPerHour: 10,
  commentsPerHour: 30,
  uploadsPerHour: 30,
  /** Anonymous ids are client-chosen, so anonymous writes are also capped per IP. */
  anonymousPerIpPerHour: { post: 10, comment: 30, upload: 30, vote: 200 },
  loginAttempts: 10,
  loginWindowMs: 15 * 60_000,
} as const;

const BOOLEAN_SETTINGS = [
  'autoApprove',
  'inAppAdmin',
  'publicBoard',
  'allowAnonymous',
  'allowAttachments',
  'allowComments',
  'allowDownvotes',
  'roadmapEnabled',
  'notifySubmitter',
] as const satisfies readonly (keyof ProjectSettings)[];

function parseSettings(raw: string): ProjectSettings {
  let stored: Partial<ProjectSettings> = {};
  try {
    stored = JSON.parse(raw) as Partial<ProjectSettings>;
  } catch {
    // Corrupt settings fall back to defaults rather than taking the board down.
  }
  return { ...DEFAULT_PROJECT_SETTINGS, ...stored };
}

const APPEARANCE_LIMITS = { cssMax: 20_000, themeMax: 8_000, urlMax: 500 } as const;
const GOOGLE_FONTS = 'https://fonts.googleapis.com/css2?';

function appearanceUrl(value: unknown, field: string, prefix = 'https://'): string {
  if (typeof value !== 'string' || !value.startsWith(prefix) || value.length > APPEARANCE_LIMITS.urlMax) {
    fail(400, 'invalid_input', `appearance.${field} must be a URL starting with ${prefix}`);
  }
  try {
    new URL(value);
  } catch {
    fail(400, 'invalid_input', `appearance.${field} must be a URL starting with ${prefix}`);
  }
  return value;
}

/** Theme tokens are plain data: nested objects of strings and numbers only. */
function isThemeData(value: unknown, depth = 0): boolean {
  if (typeof value === 'string' || typeof value === 'number') return true;
  if (depth > 3 || !value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((v) => isThemeData(v, depth + 1));
}

/**
 * The public board's branding. Only project admins set it, and it only reaches the public
 * page; still, keep it to plain data with https URLs, and the fonts link to Google Fonts
 * (the only font host the page's CSP allows).
 */
function validateAppearance(value: unknown): PublicBoardAppearance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'invalid_input', 'appearance must be an object or null');
  const out: PublicBoardAppearance = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined || v === null || v === '') continue;
    if (key === 'colorScheme') {
      if (v !== 'light' && v !== 'dark' && v !== 'system')
        fail(400, 'invalid_input', 'appearance.colorScheme must be light, dark or system');
      out.colorScheme = v;
    } else if (key === 'theme') {
      if (typeof v !== 'object' || Array.isArray(v) || !isThemeData(v) || JSON.stringify(v).length > APPEARANCE_LIMITS.themeMax) {
        fail(400, 'invalid_input', 'appearance.theme must be theme tokens (strings and numbers)');
      }
      out.theme = v as PublicBoardAppearance['theme'];
    } else if (key === 'css') {
      if (typeof v !== 'string' || v.length > APPEARANCE_LIMITS.cssMax)
        fail(400, 'invalid_input', `appearance.css must be text up to ${APPEARANCE_LIMITS.cssMax} characters`);
      // Kept inside a <style> element: it must not be able to close it.
      if (/<\/style/i.test(v)) fail(400, 'invalid_input', 'appearance.css must not contain </style>');
      out.css = v;
    } else if (key === 'fontsUrl') {
      out.fontsUrl = appearanceUrl(v, key, GOOGLE_FONTS);
    } else if (key === 'logoUrl' || key === 'homeUrl') {
      out[key] = appearanceUrl(v, key);
    } else {
      fail(400, 'invalid_input', `unknown appearance setting ${key}`);
    }
  }
  return out;
}

/** Validate a settings patch from the admin API; unknown keys are rejected. */
export function validateSettingsPatch(body: Record<string, unknown>): Partial<ProjectSettings> {
  const patch: Partial<ProjectSettings> = {};
  for (const [key, value] of Object.entries(body)) {
    if ((BOOLEAN_SETTINGS as readonly string[]).includes(key)) {
      if (typeof value !== 'boolean') fail(400, 'invalid_input', `${key} must be a boolean`);
      (patch as Record<string, boolean>)[key] = value;
    } else if (key === 'adminEmail') {
      if (value !== null && (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254)) {
        fail(400, 'invalid_input', 'adminEmail must be an email address or null');
      }
      patch.adminEmail = value as string | null;
    } else if (key === 'appearance') {
      patch.appearance = value === null ? null : validateAppearance(value);
    } else if (key === 'emailLocale') {
      if (typeof value !== 'string' || !Object.keys(locales).includes(value)) {
        fail(400, 'invalid_input', `emailLocale must be one of ${Object.keys(locales).join(', ')}`);
      }
      patch.emailLocale = value;
    } else {
      fail(400, 'invalid_input', `unknown setting ${key}`);
    }
  }
  return patch;
}

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    publicKey: row.public_key,
    signingSecret: row.signing_secret,
    settings: parseSettings(row.settings),
    createdAt: row.created_at,
  };
}

// Every public request resolves its project by public key, so keep recent rows per isolate.
// Changes made in this isolate evict immediately; other isolates see them within the TTL.
const byPublicKey = new Map<string, { project: Project; expires: number }>();
const MAX_CACHED_PROJECTS = 1000;

function projectCacheMs(env: Env): number {
  const seconds = Number(env.PROJECT_CACHE_SECONDS ?? 30);
  // Capped: a rotated key or revoked setting stays valid in other isolates for at most this long.
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) * 1000 : 0;
}

/** Drop a project from this isolate's cache after changing it. */
export function forgetProject(projectId: string): void {
  for (const [key, entry] of byPublicKey) if (entry.project.id === projectId) byPublicKey.delete(key);
}

export async function findProjectByPublicKey(env: Env, key: string): Promise<Project | null> {
  const ttl = projectCacheMs(env);
  const hit = ttl ? byPublicKey.get(key) : undefined;
  if (hit && hit.expires > Date.now()) return hit.project;
  const row = await env.DB.prepare('SELECT * FROM projects WHERE public_key = ?').bind(key).first<ProjectRow>();
  const project = row ? toProject(row) : null;
  if (project && ttl) {
    if (byPublicKey.size >= MAX_CACHED_PROJECTS) byPublicKey.clear();
    byPublicKey.set(key, { project, expires: Date.now() + ttl });
  }
  return project;
}

export async function findProjectBySecretHash(env: Env, hash: string): Promise<Project | null> {
  const row = await env.DB.prepare('SELECT * FROM projects WHERE secret_key_hash = ?').bind(hash).first<ProjectRow>();
  return row ? toProject(row) : null;
}

export async function findProjectById(env: Env, id: string): Promise<Project | null> {
  const row = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<ProjectRow>();
  return row ? toProject(row) : null;
}

export async function findProjectBySlug(env: Env, slug: string): Promise<Project | null> {
  const row = await env.DB.prepare('SELECT * FROM projects WHERE slug = ?').bind(slug).first<ProjectRow>();
  return row ? toProject(row) : null;
}

/**
 * Merge a patch into the stored settings in SQL, so concurrent toggles cannot
 * overwrite each other with a stale copy. `null` values remove the key (json_patch),
 * which parseSettings turns back into the default.
 */
export async function patchSettings(env: Env, projectId: string, patch: Partial<ProjectSettings>): Promise<ProjectSettings> {
  const row = await env.DB.prepare('UPDATE projects SET settings = json_patch(settings, ?) WHERE id = ? RETURNING settings')
    .bind(JSON.stringify(patch), projectId)
    .first<{ settings: string }>();
  // After the write, so a concurrent request cannot re-cache the old row.
  forgetProject(projectId);
  return parseSettings(row?.settings ?? '{}');
}

export function toSummary(project: Project, pendingCount: number): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    publicKey: project.publicKey,
    settings: project.settings,
    pendingCount,
    createdAt: project.createdAt,
  };
}
