import type { Category, Comment, Page, Post, ProjectSettings, WebhookConfig } from '@kobecuppens/feedback-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventMessage } from '../src/env';
import worker from '../src/index';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});

const json = async <T>(res: Response | Promise<Response>, status = 200): Promise<T> => {
  const r = await res;
  const body = await r.text();
  expect(r.status, body).toBe(status);
  return (body ? JSON.parse(body) : undefined) as T;
};
const admin = (extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${h.project.secretKey}`, ...extra });
const createPost = async (user: string, title: string, extra: Record<string, unknown> = {}) =>
  json<Post>(h.request('/v1/posts', { method: 'POST', headers: await h.as({ user }), json: { title, ...extra } }), 201);
async function dashboardCookie(): Promise<string> {
  const login = await h.request('/v1/dashboard/login', { method: 'POST', json: { password: 'correct horse battery staple' } });
  return login.headers.get('Set-Cookie')!.split(';')[0]!;
}

describe('admin post management', () => {
  it('lists every post with moderation, status, search and merged filters', async () => {
    const pending = await createPost('alice', 'Pending idea');
    const approved = await createPost('bob', 'Approved idea');
    const declined = await createPost('carol', 'Declined idea');
    await h.request(`/v1/admin/posts/${approved.id}/approve`, { method: 'POST', headers: admin() });
    await h.request(`/v1/admin/posts/${declined.id}/decline`, { method: 'POST', headers: admin(), json: {} });
    await h.request(`/v1/admin/posts/${approved.id}`, { method: 'PATCH', headers: admin(), json: { status: 'planned' } });

    const titles = async (query: string) =>
      (await json<Page<Post>>(h.request(`/v1/admin/posts${query}`, { headers: admin() }))).items.map((p) => p.title).sort();
    expect(await titles('')).toEqual(['Approved idea', 'Declined idea', 'Pending idea']);
    expect(await titles('?moderation=pending')).toEqual(['Pending idea']);
    expect(await titles('?moderation=declined')).toEqual(['Declined idea']);
    expect(await titles('?moderation=bogus')).toHaveLength(3);
    expect(await titles('?status=planned')).toEqual(['Approved idea']);
    expect(await titles('?q=declined')).toEqual(['Declined idea']);

    await h.request(`/v1/admin/posts/${pending.id}/merge`, { method: 'POST', headers: admin(), json: { intoId: approved.id } });
    expect(await titles('')).toEqual(['Approved idea', 'Declined idea']);
    expect(await titles('?merged=1')).toEqual(['Approved idea', 'Declined idea', 'Pending idea']);
  });

  it('edits title and body, and rejects bad patches', async () => {
    const post = await createPost('alice', 'Typo titel');
    const edited = await json<Post>(
      h.request(`/v1/admin/posts/${post.id}`, { method: 'PATCH', headers: admin(), json: { title: 'Typo title', body: 'Fixed' } }),
    );
    expect(edited).toMatchObject({ title: 'Typo title', body: 'Fixed', status: 'open' });
    // Same status is a no-op, not a status change event.
    await json(h.request(`/v1/admin/posts/${post.id}`, { method: 'PATCH', headers: admin(), json: { status: 'open' } }));
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'post.status_changed'").get()).toEqual({ n: 0 });

    const bad = (patch: Record<string, unknown>) =>
      h.request(`/v1/admin/posts/${post.id}`, { method: 'PATCH', headers: admin(), json: patch });
    expect((await bad({ status: 'shipped' })).status).toBe(400);
    expect((await bad({ status: 3 })).status).toBe(400);
    expect((await bad({ title: 'x' })).status).toBe(400);
    expect((await bad({ categoryId: 'missing' })).status).toBe(400);
    expect((await h.request('/v1/admin/posts/nope', { method: 'PATCH', headers: admin(), json: {} })).status).toBe(404);
  });

  it('rejects merging a post into itself or into an already merged post', async () => {
    const a = await createPost('alice', 'Post A');
    const b = await createPost('bob', 'Post B');
    const c = await createPost('carol', 'Post C');
    const merge = (id: string, intoId: string) =>
      h.request(`/v1/admin/posts/${id}/merge`, { method: 'POST', headers: admin(), json: { intoId } });
    expect((await merge(a.id, a.id)).status).toBe(400);
    expect((await merge(b.id, a.id)).status).toBe(200);
    expect((await merge(c.id, b.id)).status).toBe(400);
  });

  it('lists comments for any post, including pending ones, and 404s deleted comments', async () => {
    const post = await createPost('alice', 'Pending with reply');
    const reply = await json<Comment>(
      h.request(`/v1/admin/posts/${post.id}/comments`, { method: 'POST', headers: admin(), json: { body: 'Looking' } }),
      201,
    );
    const list = await json<Page<Comment>>(h.request(`/v1/admin/posts/${post.id}/comments`, { headers: admin() }));
    expect(list.items.map((c) => c.body)).toEqual(['Looking']);
    const del = () => h.request(`/v1/admin/posts/${post.id}/comments/${reply.id}`, { method: 'DELETE', headers: admin() });
    expect((await del()).status).toBe(204);
    expect((await del()).status).toBe(404);
  });
});

describe('project configuration', () => {
  it('updates categories and validates input', async () => {
    const cat = await json<Category>(h.request('/v1/admin/categories', { method: 'POST', headers: admin(), json: { name: 'Bug' } }), 201);
    const second = await json<Category>(
      h.request('/v1/admin/categories', { method: 'POST', headers: admin(), json: { name: 'Idea' } }),
      201,
    );
    expect([cat.sort, second.sort]).toEqual([0, 1]);

    const patch = (id: string, body: Record<string, unknown>) =>
      h.request(`/v1/admin/categories/${id}`, { method: 'PATCH', headers: admin(), json: body });
    expect(await json<Category>(patch(cat.id, { name: 'Bugs', color: '#ff0000', sort: 5 }))).toEqual({
      id: cat.id,
      name: 'Bugs',
      color: '#ff0000',
      sort: 5,
    });
    expect(await json<Category>(patch(cat.id, { color: null }))).toMatchObject({ name: 'Bugs', color: null, sort: 5 });
    expect((await patch(cat.id, { sort: 1.5 })).status).toBe(400);
    expect((await patch(cat.id, { name: '' })).status).toBe(400);
    expect((await patch('missing', { name: 'X' })).status).toBe(404);
    expect((await h.request('/v1/admin/categories/missing', { method: 'DELETE', headers: admin() })).status).toBe(404);

    const list = await json<Category[]>(h.request('/v1/admin/categories', { headers: admin() }));
    expect(list.map((c) => c.name)).toEqual(['Idea', 'Bugs']);
  });

  it('lists and deletes webhooks, and checks their URL', async () => {
    const create = (url: string) =>
      h.request('/v1/admin/webhooks', { method: 'POST', headers: admin(), json: { url, events: ['post.created', 'post.created'] } });
    const hook = await json<WebhookConfig>(create('http://hooks.test/in'), 201);
    expect(hook.events).toEqual(['post.created']);
    expect(hook.secret).toMatch(/^whsec_/);
    expect((await create('not a url at all')).status).toBe(400);

    expect(await json<WebhookConfig[]>(h.request('/v1/admin/webhooks', { headers: admin() }))).toEqual([hook]);
    const del = () => h.request(`/v1/admin/webhooks/${hook.id}`, { method: 'DELETE', headers: admin() });
    expect((await del()).status).toBe(204);
    expect((await del()).status).toBe(404);
  });

  it('requires https webhooks in production', async () => {
    h = await createHarness({ ENVIRONMENT: 'production' });
    const res = await h.request('/v1/admin/webhooks', {
      method: 'POST',
      headers: admin(),
      json: { url: 'http://hooks.test/in', events: ['post.created'] },
    });
    expect(res.status).toBe(400);
  });

  it('returns current settings', async () => {
    h.setSettings({ autoApprove: true });
    const settings = await json<ProjectSettings>(h.request('/v1/admin/settings', { headers: admin() }));
    expect(settings).toMatchObject({ autoApprove: true, allowAnonymous: true, adminEmail: null });
  });

  it('rejects admin calls with no credentials, a bad key, or an unknown project', async () => {
    expect((await h.request('/v1/admin/queue')).status).toBe(401);
    expect((await h.request('/v1/admin/queue', { headers: { Authorization: 'Bearer sk_wrong' } })).status).toBe(401);
    const cookie = await dashboardCookie();
    expect((await h.request('/v1/admin/queue', { headers: { Cookie: cookie, 'X-Feedback-Project': 'nope' } })).status).toBe(404);
  });
});

describe('dashboard project management', () => {
  it('reads secrets and rotates each key', async () => {
    const cookie = await dashboardCookie();
    const url = `/v1/dashboard/projects/${h.project.id}`;
    expect(await json(h.request(`${url}/secrets`, { headers: { Cookie: cookie } }))).toEqual({
      publicKey: h.project.publicKey,
      signingSecret: h.project.signingSecret,
    });
    const rotate = (key: string) => h.request(`${url}/rotate`, { method: 'POST', headers: { Cookie: cookie }, json: { key } });

    const pub = await json<{ publicKey: string; secretKey?: string }>(rotate('public'));
    expect(pub.publicKey).not.toBe(h.project.publicKey);
    expect(pub.secretKey).toBeUndefined();
    expect((await h.request('/v1/config', { headers: { 'X-Feedback-Key': h.project.publicKey } })).status).toBe(401);
    expect((await h.request('/v1/config', { headers: { 'X-Feedback-Key': pub.publicKey } })).status).toBe(200);

    const signing = await json<{ signingSecret: string }>(rotate('signing'));
    expect(signing.signingSecret).not.toBe(h.project.signingSecret);
    expect((await rotate('everything')).status).toBe(400);
    expect((await h.request('/v1/dashboard/projects/nope/secrets', { headers: { Cookie: cookie } })).status).toBe(404);
    expect(
      (await h.request('/v1/dashboard/projects/nope/rotate', { method: 'POST', headers: { Cookie: cookie }, json: { key: 'public' } }))
        .status,
    ).toBe(404);
  });

  it('renames projects and guards slugs', async () => {
    const cookie = await dashboardCookie();
    await h.addProject('proj_2', 'taken');
    const patch = (body: Record<string, unknown>, id = h.project.id) =>
      h.request(`/v1/dashboard/projects/${id}`, { method: 'PATCH', headers: { Cookie: cookie }, json: body });
    expect(await json(patch({ slug: 'Fresh Slug!' }))).toMatchObject({ slug: 'fresh-slug' });
    expect((await patch({ slug: 'taken' })).status).toBe(409);
    expect((await patch({ name: 'x' }, 'nope')).status).toBe(404);
    const create = await h.request('/v1/dashboard/projects', { method: 'POST', headers: { Cookie: cookie }, json: { name: 'Taken' } });
    expect(create.status).toBe(409);
  });

  it('deletes a project with its posts and uploaded files', async () => {
    const form = new FormData();
    form.append('file', new File(['x'], 'a.png', { type: 'image/png' }));
    await json(h.request('/v1/uploads', { method: 'POST', headers: await h.as({ user: 'alice' }), body: form }), 201);
    await createPost('alice', 'Soon gone');
    expect(h.files.store.size).toBe(1);

    const cookie = await dashboardCookie();
    const del = () => h.request(`/v1/dashboard/projects/${h.project.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
    expect((await del()).status).toBe(204);
    expect(h.files.store.size).toBe(0);
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM posts').get()).toEqual({ n: 0 });
    expect((await del()).status).toBe(404);
  });

  it('logs out by clearing the cookie, and refuses to log in when unconfigured', async () => {
    const logout = await h.request('/v1/dashboard/logout', { method: 'POST' });
    expect(logout.status).toBe(204);
    expect(logout.headers.get('Set-Cookie')).toMatch(/fb_session=;.*Max-Age=0/);

    h = await createHarness({ ADMIN_PASSWORD: 'short' });
    const res = await h.request('/v1/dashboard/login', { method: 'POST', json: { password: 'short' } });
    expect(res.status).toBe(503);
  });
});

describe('worker entry', () => {
  it('answers CORS preflight and health checks, but not for the dashboard API', async () => {
    const preflight = await h.request('/v1/posts', { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('X-Feedback-User');
    expect(await json(h.request('/v1/health'))).toMatchObject({ ok: true, status: 'healthy', checks: { db: 'ok' } });
    const dash = await h.request('/v1/dashboard/me');
    expect(dash.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const err = await h.request('/v1/config');
    expect(err.status).toBe(401);
    expect(err.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('404s unknown files and routes', async () => {
    expect((await h.request('/v1/files/nope')).status).toBe(404);
    h.db.prepare("INSERT INTO end_users (id, project_id, external_id, created_at) VALUES ('u1', ?, 'x', 0)").run(h.project.id);
    h.db
      .prepare(
        "INSERT INTO attachments (id, project_id, uploader_id, r2_key, mime, bytes, created_at) VALUES ('a1', ?, 'u1', 'gone', 'image/png', 1, 0)",
      )
      .run(h.project.id);
    expect((await h.request('/v1/files/a1')).status).toBe(404);
    expect(await json(h.request('/nowhere'), 404)).toEqual({ error: 'not_found', message: 'not_found' });
  });

  it('serves SPAs with a client-side-route fallback, gated by flags', async () => {
    const fetched: string[] = [];
    const ASSETS = {
      fetch: async (req: Request) => {
        const { pathname } = new URL(req.url);
        fetched.push(pathname);
        return pathname === '/admin/' || pathname === '/p/' ? new Response(`shell:${pathname}`) : new Response('missing', { status: 404 });
      },
    } as unknown as Fetcher;
    h = await createHarness({ ASSETS });

    expect(await (await h.request('/admin/projects/1/queue')).text()).toBe('shell:/admin/');
    expect(await (await h.request('/p/demo')).text()).toBe('shell:/p/');
    expect(fetched).toEqual(['/admin/projects/1/queue', '/admin/', '/p/demo', '/p/']);
    const bare = await h.request('/admin');
    expect([bare.status, bare.headers.get('Location')]).toEqual([301, '/admin/']);
    const root = await h.request('/');
    expect(root.headers.get('Location')).toBe('/admin/');

    h = await createHarness({ ASSETS, FEATURE_DASHBOARD: 'false' });
    expect((await h.request('/admin')).status).toBe(404);
    expect(await json(h.request('/'))).toEqual({ ok: true });
    h = await createHarness({ ASSETS: undefined });
    expect((await h.request('/admin/x')).status).toBe(404);
  });

  it('returns a generic 500 for unexpected errors', async () => {
    const broken = {
      ...h.env,
      DB: {
        prepare: () => {
          throw new Error('boom');
        },
      } as unknown as D1Database,
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await worker.fetch(
      new Request('https://feedback.test/v1/config', { headers: { 'X-Feedback-Key': 'pk_x' } }),
      broken,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { requestId: string };
    expect(body).toMatchObject({ error: 'internal_error', message: 'Something went wrong' });
    expect(body.requestId).toBe(res.headers.get('X-Request-Id'));
  });

  it('wires the queue consumer and the hourly cron', async () => {
    const waits: Promise<unknown>[] = [];
    await worker.scheduled({} as ScheduledController, h.env, {
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    } as unknown as ExecutionContext);
    expect(waits).toHaveLength(1);
    await waits[0];

    const message = { body: { eventId: 'missing' }, ack: vi.fn(), retry: vi.fn() };
    await worker.queue({ messages: [message] } as unknown as MessageBatch<EventMessage>, h.env);
    expect(message.ack).toHaveBeenCalled();
  });
});
