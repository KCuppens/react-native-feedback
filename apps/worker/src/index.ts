import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv, Env, EventMessage } from './env';
import { handleEventBatch } from './events';
import { runMaintenance } from './maintenance';
import { findProjectBySlug } from './projects';
import { adminRoutes } from './routes/admin';
import { dashboardRoutes } from './routes/dashboard';
import { publicRoutes } from './routes/public';
import { fail, flag } from './util';

export const app = new Hono<AppEnv>();

// Public/admin API is called from any app origin; credentials never ride on CORS
// requests (the dashboard is same-origin), so a wildcard origin is safe here.
app.use('/v1/*', async (c, next) => {
  if (c.req.path.startsWith('/v1/dashboard')) return next();
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Feedback-Key, X-Feedback-User, X-Feedback-Anon, X-Feedback-Project');
  c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  c.header('Access-Control-Max-Age', '86400');
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});

app.get('/v1/health', (c) => c.json({ ok: true }));

// Attachments are fetched by <img> tags, which cannot send headers: ids are unguessable UUIDs.
app.get('/v1/files/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT r2_key, mime FROM attachments WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ r2_key: string; mime: string }>();
  if (!row) fail(404, 'not_found');
  const object = await c.env.FILES.get(row.r2_key);
  if (!object) fail(404, 'not_found');
  return new Response(object.body, {
    headers: {
      'Content-Type': row.mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
    },
  });
});

app.get('/v1/public/projects/:slug', async (c) => {
  if (!flag(c.env, 'FEATURE_PUBLIC_BOARD')) fail(404, 'not_found');
  const project = await findProjectBySlug(c.env, c.req.param('slug'));
  if (!project || !project.settings.publicBoard) fail(404, 'not_found');
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
  const asset = await c.env.ASSETS.fetch(c.req.raw);
  if (asset.status !== 404) return asset;
  // Client-side routes fall back to the SPA shell.
  return c.env.ASSETS.fetch(new Request(new URL(prefix, url), c.req.raw));
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
  console.error('unhandled error', err);
  return c.json({ error: 'internal_error', message: 'Something went wrong' }, 500);
});

export default {
  fetch: app.fetch,
  queue: (batch: MessageBatch<EventMessage>, env: Env) => handleEventBatch(batch, env),
  scheduled: (_event: ScheduledController, env: Env, ctx: ExecutionContext) => ctx.waitUntil(runMaintenance(env)),
} satisfies ExportedHandler<Env, EventMessage>;
