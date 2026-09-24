import { BOARD_LIMITS, DEFAULT_PROJECT_SETTINGS, type ProjectSettings, type ProjectSummary } from '@kobecuppens/feedback-core';
import type { Env, Project, ProjectRow } from './env';
import { fail } from './util';

export const LIMITS = {
  ...BOARD_LIMITS,
  titleMin: 3,
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

export async function findProjectByPublicKey(env: Env, key: string): Promise<Project | null> {
  const row = await env.DB.prepare('SELECT * FROM projects WHERE public_key = ?').bind(key).first<ProjectRow>();
  return row ? toProject(row) : null;
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

export async function saveSettings(env: Env, projectId: string, settings: ProjectSettings): Promise<void> {
  await env.DB.prepare('UPDATE projects SET settings = ? WHERE id = ?').bind(JSON.stringify(settings), projectId).run();
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
