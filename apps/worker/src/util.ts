import type { InvalidReason } from '@kobecuppens/feedback-core';
import { toHex } from '@kobecuppens/feedback-core/server';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Context } from 'hono';
import type { AppEnv, Env } from './env';

export const newId = () => crypto.randomUUID();

/** One JSON line per event, with a uniform `level` + `msg`, so Workers Logs can filter on fields. */
export function log(level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, msg, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
export const now = () => Date.now();

export { generateProjectKeys, randomToken } from './keys.mjs';

export async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)));
}

/** Throw a JSON error `{ error, message, ...details }`; details carry e.g. `{ field, reason }` for form errors. */
export function fail(
  status: ContentfulStatusCode,
  error: string,
  message?: string,
  details?: { field: string; reason: InvalidReason },
): never {
  throw new HTTPException(status, {
    res: new Response(JSON.stringify({ error, message: message ?? error, ...details }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
}

type FeatureFlag = 'FEATURE_DASHBOARD' | 'FEATURE_ADMIN_API' | 'FEATURE_PUBLIC_BOARD' | 'FEATURE_EMAIL';

export function flag(env: Env, name: FeatureFlag) {
  return env[name]?.toLowerCase() === 'true';
}

/** A switched-off surface does not exist: answer 404, not 403. */
export function requireFlag(env: Env, name: FeatureFlag): void {
  if (!flag(env, name)) fail(404, 'not_found');
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    fail(400, 'invalid_json');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'invalid_json');
  return body as Record<string, unknown>;
}

export function str(
  body: Record<string, unknown>,
  key: string,
  opts: { min?: number; max: number; optional?: boolean; nullable?: boolean },
): string | null | undefined {
  const value = body[key];
  if (value === undefined) {
    if (opts.optional) return undefined;
    fail(400, 'invalid_input', `${key} is required`, { field: key, reason: 'required' });
  }
  if (value === null) {
    if (opts.nullable) return null;
    fail(400, 'invalid_input', `${key} must be a string`, { field: key, reason: 'not_string' });
  }
  if (typeof value !== 'string') fail(400, 'invalid_input', `${key} must be a string`, { field: key, reason: 'not_string' });
  const trimmed = value.trim();
  if (trimmed.length < (opts.min ?? 0)) fail(400, 'invalid_input', `${key} is too short`, { field: key, reason: 'too_short' });
  if (trimmed.length > opts.max) fail(400, 'invalid_input', `${key} is too long`, { field: key, reason: 'too_long' });
  return trimmed;
}

export function stringArray(body: Record<string, unknown>, key: string, max: number): string[] {
  const value = body[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    fail(400, 'invalid_input', `${key} must be an array of strings`, { field: key, reason: 'not_array' });
  }
  if (value.length > max) fail(400, 'invalid_input', `too many ${key}`, { field: key, reason: 'too_many' });
  return [...new Set(value as string[])];
}

export function parseCursor(cursor: string | undefined | null): number {
  if (!cursor) return 0;
  const n = Number.parseInt(cursor, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function parseLimit(raw: string | undefined, fallback = 20, max = 50): number {
  const n = raw ? Number.parseInt(raw, 10) : fallback;
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), max) : fallback;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

export function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(',');
}

export interface RateLimit {
  key: string;
  max: number;
  windowMs: number;
}

/**
 * Count one hit against each fixed window, in one round trip; true when any of them is
 * over its limit. Each counter is a single upsert, so concurrent requests cannot both slip
 * under a limit.
 */
export async function overAnyRateLimit(env: Env, limits: RateLimit[]): Promise<boolean> {
  if (limits.length === 0) return false;
  const ts = Date.now();
  const results = await env.DB.batch(
    limits.map(({ key, windowMs }) =>
      env.DB.prepare(
        `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
         ON CONFLICT (key) DO UPDATE SET
           count = CASE WHEN window_start <= ?3 THEN 1 ELSE count + 1 END,
           window_start = CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END
         RETURNING count`,
      ).bind(key, ts, ts - windowMs),
    ),
  );
  return results.some((result, i) => ((result.results[0] as { count: number } | undefined)?.count ?? 0) > limits[i]!.max);
}

export function clientIp(req: { header(name: string): string | undefined }): string {
  return req.header('CF-Connecting-IP') ?? 'unknown';
}

/** Public origin of the current request, used to build file URLs. */
export const originOf = (c: Context<AppEnv>) => new URL(c.req.url).origin;

/** Public URL of an attachment; the files route and the edge-cache purge both key on it. */
export function fileUrl(origin: string, id: string): string {
  return `${origin}/v1/files/${id}`;
}

/** This colo's Cache API store; undefined outside Workers (tests, local tools). */
export function edgeCache(): Cache | undefined {
  return typeof caches === 'undefined' ? undefined : (caches as unknown as { default: Cache }).default;
}

/** The execution context, or undefined in tests that call app.request without one. */
export function ctxOf(c: Context<AppEnv>): ExecutionContext | undefined {
  try {
    return c.executionCtx as ExecutionContext;
  } catch {
    return undefined;
  }
}

const EDGE_PURGE_MAX = 50;

/**
 * Remove R2 objects without failing the request: the rows are already gone, so a storage
 * hiccup must not turn a successful delete into a 500.
 */
export function deleteFilesInBackground(c: Context<AppEnv>, keys: string[], what: string): void {
  if (keys.length === 0) return;
  const work = (async () => {
    for (let i = 0; i < keys.length; i += 1000) await c.env.FILES.delete(keys.slice(i, i + 1000));
    // Also drop this colo's edge copies (keys are `<projectId>/<attachmentId>`); other colos
    // expire on the short edge TTL set in the files route. Bounded: every purge is a
    // subrequest, and for a large delete (a whole project) the 1h TTL does the job anyway.
    const edge = edgeCache();
    if (edge && keys.length <= EDGE_PURGE_MAX) {
      const origin = originOf(c);
      for (let i = 0; i < keys.length; i += 10) {
        await Promise.all(keys.slice(i, i + 10).map((key) => edge.delete(fileUrl(origin, key.split('/').pop()!))));
      }
    }
  })().catch((error: unknown) => log('error', 'r2 cleanup failed', { what, keys: keys.length, error: String(error) }));
  const ctx = ctxOf(c);
  if (ctx) ctx.waitUntil(work);
}

/** Defence in depth next to SameSite=Strict: refuse cookie-authenticated writes from another origin. */
export function assertSameOrigin(c: Context<AppEnv>): void {
  const origin = c.req.header('Origin');
  if (c.req.method !== 'GET' && origin && origin !== originOf(c)) fail(403, 'forbidden');
}

/** 400 unless the category belongs to the project. */
export async function assertCategory(c: Context<AppEnv>, categoryId: string): Promise<void> {
  const cat = await c.env.DB.prepare('SELECT id FROM categories WHERE id = ? AND project_id = ?')
    .bind(categoryId, c.get('project').id)
    .first();
  if (!cat) fail(400, 'invalid_category');
}

/** Runs at most `max` tasks at once; the rest wait their turn (a tiny p-limit). */
export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

export function createLimiter(max: number): Limiter {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
