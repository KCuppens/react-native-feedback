import { DEFAULT_PROJECT_SETTINGS } from '@kobecuppens/feedback-core';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { AppEnv, ProjectRow } from '../env';
import { createSessionCookieValue, requireDashboard, SESSION_COOKIE, SESSION_TTL_SECONDS } from '../auth';
import { findProjectById, forgetProject, LIMITS, slugify, toProject, toSummary } from '../projects';
import {
  clientIp,
  deleteFilesInBackground,
  fail,
  flag,
  generateProjectKeys,
  newId,
  now,
  overRateLimit,
  readJson,
  sha256Hex,
  str,
  timingSafeEqualString,
} from '../util';

export const dashboardRoutes = new Hono<AppEnv>();

dashboardRoutes.use('*', async (c, next) => {
  if (!flag(c.env, 'FEATURE_DASHBOARD')) fail(404, 'not_found');
  // Defence in depth next to SameSite=Strict: refuse state changes posted from another origin.
  const origin = c.req.header('Origin');
  if (c.req.method !== 'GET' && origin && origin !== new URL(c.req.url).origin) fail(403, 'forbidden');
  await next();
});

dashboardRoutes.post('/login', async (c) => {
  const expected = c.env.ADMIN_PASSWORD;
  if (!expected || expected.length < 12) fail(503, 'dashboard_not_configured', 'Set ADMIN_PASSWORD (12+ chars).');
  // Every attempt counts, so parallel guesses cannot dodge the per-attempt delay below.
  if (await overRateLimit(c.env, `login:${clientIp(c.req)}`, LIMITS.loginAttempts, LIMITS.loginWindowMs)) {
    fail(429, 'rate_limited', 'Too many sign-in attempts. Try again later.');
  }
  const body = await readJson(c.req.raw);
  const password = typeof body.password === 'string' ? body.password : '';
  // Compare digests so the comparison time never depends on the password length.
  const ok = timingSafeEqualString(await sha256Hex(password), await sha256Hex(expected));
  if (!ok) {
    await new Promise((r) => setTimeout(r, 750));
    fail(401, 'invalid_password');
  }
  setCookie(c, SESSION_COOKIE, await createSessionCookieValue(c.env), {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return c.json({ ok: true });
});

dashboardRoutes.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.body(null, 204);
});

dashboardRoutes.use('/me', requireDashboard);
dashboardRoutes.use('/projects', requireDashboard);
dashboardRoutes.use('/projects/*', requireDashboard);

dashboardRoutes.get('/me', (c) => c.json({ ok: true }));

dashboardRoutes.get('/projects', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, (SELECT COUNT(*) FROM posts WHERE project_id = p.id AND moderation = 'pending') AS pending_count
     FROM projects p ORDER BY p.created_at`,
  ).all<ProjectRow & { pending_count: number }>();
  return c.json(results.map((row) => toSummary(toProject(row), row.pending_count)));
});

dashboardRoutes.post('/projects', async (c) => {
  const body = await readJson(c.req.raw);
  const name = str(body, 'name', { min: 1, max: 80 })!;
  const slug = slugify(str(body, 'slug', { max: 48, optional: true }) || name);
  const taken = await c.env.DB.prepare('SELECT 1 FROM projects WHERE slug = ?').bind(slug).first();
  if (taken) fail(409, 'slug_taken');
  const keys = generateProjectKeys();
  const id = newId();
  const ts = now();
  await c.env.DB.prepare(
    `INSERT INTO projects (id, slug, name, public_key, signing_secret, secret_key_hash, settings, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, slug, name, keys.publicKey, keys.signingSecret, await sha256Hex(keys.secretKey), JSON.stringify(DEFAULT_PROJECT_SETTINGS), ts)
    .run();
  const project = (await findProjectById(c.env, id))!;
  return c.json({ ...toSummary(project, 0), secrets: keys }, 201);
});

dashboardRoutes.patch('/projects/:id', async (c) => {
  const project = await findProjectById(c.env, c.req.param('id'));
  if (!project) fail(404, 'project_not_found');
  const body = await readJson(c.req.raw);
  const name = str(body, 'name', { min: 1, max: 80, optional: true }) ?? project.name;
  const rawSlug = str(body, 'slug', { min: 1, max: 48, optional: true });
  const slug = rawSlug ? slugify(rawSlug) : project.slug;
  if (slug !== project.slug) {
    const taken = await c.env.DB.prepare('SELECT 1 FROM projects WHERE slug = ?').bind(slug).first();
    if (taken) fail(409, 'slug_taken');
  }
  await c.env.DB.prepare('UPDATE projects SET name = ?, slug = ? WHERE id = ?').bind(name, slug, project.id).run();
  forgetProject(project.id);
  const pending = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM posts WHERE project_id = ? AND moderation = 'pending'")
    .bind(project.id)
    .first<{ n: number }>();
  return c.json(toSummary({ ...project, name, slug }, pending?.n ?? 0));
});

dashboardRoutes.delete('/projects/:id', async (c) => {
  const id = c.req.param('id');
  const { results } = await c.env.DB.prepare('SELECT r2_key FROM attachments WHERE project_id = ?').bind(id).all<{ r2_key: string }>();
  const res = await c.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
  if (!res.meta.changes) fail(404, 'project_not_found');
  forgetProject(id);
  deleteFilesInBackground(
    c,
    results.map((r) => r.r2_key),
    `project ${id}`,
  );
  return c.body(null, 204);
});

dashboardRoutes.get('/projects/:id/secrets', async (c) => {
  const project = await findProjectById(c.env, c.req.param('id'));
  if (!project) fail(404, 'project_not_found');
  return c.json({ publicKey: project.publicKey, signingSecret: project.signingSecret });
});

dashboardRoutes.post('/projects/:id/rotate', async (c) => {
  const project = await findProjectById(c.env, c.req.param('id'));
  if (!project) fail(404, 'project_not_found');
  const body = await readJson(c.req.raw);
  const fresh = generateProjectKeys();
  forgetProject(project.id);
  const result: { publicKey: string; signingSecret: string; secretKey?: string } = {
    publicKey: project.publicKey,
    signingSecret: project.signingSecret,
  };
  if (body.key === 'public') {
    await c.env.DB.prepare('UPDATE projects SET public_key = ? WHERE id = ?').bind(fresh.publicKey, project.id).run();
    result.publicKey = fresh.publicKey;
  } else if (body.key === 'signing') {
    await c.env.DB.prepare('UPDATE projects SET signing_secret = ? WHERE id = ?').bind(fresh.signingSecret, project.id).run();
    result.signingSecret = fresh.signingSecret;
  } else if (body.key === 'secret') {
    await c.env.DB.prepare('UPDATE projects SET secret_key_hash = ? WHERE id = ?')
      .bind(await sha256Hex(fresh.secretKey), project.id)
      .run();
    result.secretKey = fresh.secretKey;
  } else {
    fail(400, 'invalid_input', 'key must be public, signing or secret');
  }
  return c.json(result);
});
