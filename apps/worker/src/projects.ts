import { BOARD_LIMITS, DEFAULT_PROJECT_SETTINGS, type ProjectSettings, type ProjectSummary } from '@kobecuppens/feedback-core';
import type { Env, Project, ProjectRow } from './env';
import { fail } from './util';

export const LIMITS = {
  ...BOARD_LIMITS,
  declineReasonMax: 500,
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

export function parseSettings(raw: string): ProjectSettings {
  let stored: Partial<ProjectSettings> = {};
  try {
    stored = JSON.parse(raw) as Partial<ProjectSettings>;
  } catch {
    // Corrupt settings fall back to defaults rather than taking the board down.
  }
  return { ...DEFAULT_PROJECT_SETTINGS, ...stored };
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
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
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
  forgetProject(projectId);
  const row = await env.DB.prepare('UPDATE projects SET settings = json_patch(settings, ?) WHERE id = ? RETURNING settings')
    .bind(JSON.stringify(patch), projectId)
    .first<{ settings: string }>();
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

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'project'
  );
}
