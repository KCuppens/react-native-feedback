import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv, Env, EventMessage } from './env';
import { handleEventBatch } from './events';
import { runMaintenance } from './maintenance';
import { findProjectBySlug } from './projects';
import { adminRoutes } from './routes/admin';
import { dashboardRoutes } from './routes/dashboard';
import { publicRoutes } from './routes/public';
import { ctxOf, fail, flag, log } from './util';

export const app = new Hono<AppEnv>();

// Correlate client reports with logs: Cloudflare's ray id when present.
app.use('*', async (c, next) => {
  const requestId = c.req.header('cf-ray') ?? crypto.randomUUID();
  c.set('requestId', requestId);
  await next();
  c.header('X-Request-Id', requestId);
});

// Public/admin API is called from any app origin; credentials never ride on CORS
// requests (the dashboard is same-origin), so a wildcard origin is safe here.
app.use('/v1/*', async (c, next) => {
  if (c.req.path.startsWith('/v1/dashboard')) return next();
  c.header('Access-Control-Allow-Origin', '*');
  c.header(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Feedback-Key, X-Feedback-User, X-Feedback-Anon, X-Feedback-Project',
  );
  c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  c.header('Access-Control-Max-Age', '86400');
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});

// Probes D1 so uptime checks catch a missing or misconfigured database, not just a live isolate.
app.get('/v1/health', async (c) => {
  const started = Date.now();
  let db: 'ok' | 'error' = 'ok';
  try {
    await c.env.DB.prepare('SELECT 1').first();
  } catch (error) {
    db = 'error';
    log('error', 'health check db probe failed', { requestId: c.get('requestId'), error: String(error) });
  }
  const ok = db === 'ok';
  return c.json(
    { ok, status: ok ? 'healthy' : 'unhealthy', checks: { db, dbMs: Date.now() - started }, environment: c.env.ENVIRONMENT ?? null },
    ok ? 200 : 503,
  );
});

// Attachments are fetched by <img> tags, which cannot send headers: ids are unguessable UUIDs.
// Content never changes for an id, so the edge cache serves repeat views without D1 or R2.
app.get('/v1/files/:id', async (c) => {
  const edge = typeof caches === 'undefined' ? undefined : (caches as unknown as { default: Cache }).default;
  const cached = await edge?.match(c.req.raw);
  if (cached) return cached;
  const row = await c.env.DB.prepare('SELECT r2_key, mime FROM attachments WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ r2_key: string; mime: string }>();
  if (!row) fail(404, 'not_found');
  const object = await c.env.FILES.get(row.r2_key);
  if (!object) fail(404, 'not_found');
  const headers = {
    'Content-Type': row.mime,
    // A day in browsers; the edge copy below lives an hour, so deleted images stop loading soon.
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
    ...(object.httpEtag ? { ETag: object.httpEtag } : {}),
  };
  if (object.httpEtag && c.req.header('If-None-Match') === object.httpEtag) return new Response(null, { status: 304, headers });
  const res = new Response(object.body, { headers });
  if (edge) {
    const edgeCopy = new Response(res.clone().body, res);
    edgeCopy.headers.set('Cache-Control', 'public, max-age=3600');
    const put = edge.put(c.req.raw, edgeCopy).catch(() => undefined);
    const ctx = ctxOf(c);
    if (ctx) ctx.waitUntil(put);
  }
  return res;
});

app.get('/v1/public/projects/:slug', async (c) => {
  if (!flag(c.env, 'FEATURE_PUBLIC_BOARD')) fail(404, 'not_found');
  const project = await findProjectBySlug(c.env, c.req.param('slug'));
  if (!project?.settings.publicBoard) fail(404, 'not_found');
  return c.json({ name: project.name, slug: project.slug, publicKey: project.publicKey });
});

app.route('/v1/dashboard', dashboardRoutes);
app.route('/v1/admin', adminRoutes);
app.route('/v1', publicRoutes);

// ---------------------------------------------------------------------------
// Static SPAs (Workers Assets, run_worker_first so these flags gate them).

async function serveSpa(c: Context<AppEnv>, prefix: '/admin/' | '/p/') {
  if (!c.env.ASSETS) fail(404, 'not_found');
  const url = new URL(c.req.url);
  let asset = await c.env.ASSETS.fetch(c.req.raw);
  // Client-side routes fall back to the SPA shell.
  if (asset.status === 404) asset = await c.env.ASSETS.fetch(new Request(new URL(prefix, url), c.req.raw));
  const res = new Response(asset.body, asset);
  // The dashboard shows secrets and both pages render user content: lock them down.
  res.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  return res;
}

app.get('/admin', (c) => {
  if (!flag(c.env, 'FEATURE_DASHBOARD')) fail(404, 'not_found');
  return c.redirect('/admin/', 301);
});
app.get('/admin/*', (c) => {
  if (!flag(c.env, 'FEATURE_DASHBOARD')) fail(404, 'not_found');
  return serveSpa(c, '/admin/');
});
app.get('/p/*', (c) => {
  if (!flag(c.env, 'FEATURE_PUBLIC_BOARD')) fail(404, 'not_found');
  return serveSpa(c, '/p/');
});
app.get('/', (c) => (flag(c.env, 'FEATURE_DASHBOARD') ? c.redirect('/admin/') : c.json({ ok: true })));

app.notFound((c) => c.json({ error: 'not_found', message: 'not_found' }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    const res = err.getResponse();
    // Keep CORS headers on errors so browsers can read the JSON body.
    const headers = new Headers(res.headers);
    if (c.req.path.startsWith('/v1/') && !c.req.path.startsWith('/v1/dashboard')) {
      headers.set('Access-Control-Allow-Origin', '*');
    }
    return new Response(res.body, { status: res.status, headers });
  }
  const requestId = c.get('requestId');
  log('error', 'unhandled error', {
    requestId,
    method: c.req.method,
    path: c.req.path,
    projectId: c.get('project')?.id,
    error: String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  return c.json(
    { error: 'internal_error', message: 'Something went wrong', requestId },
    500,
    requestId ? { 'X-Request-Id': requestId } : {},
  );
});

export default {
  fetch: app.fetch,
  queue: (batch: MessageBatch<EventMessage>, env: Env) => handleEventBatch(batch, env),
  scheduled: (_event: ScheduledController, env: Env, ctx: ExecutionContext) => ctx.waitUntil(runMaintenance(env)),
} satisfies ExportedHandler<Env, EventMessage>;
