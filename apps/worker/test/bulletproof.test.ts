import type { Post, ProjectSettings } from '@kobecuppens/feedback-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});

const admin = () => ({ Authorization: `Bearer ${h.project.secretKey}` });

describe('limits, merges, CSRF, health and edge caching', () => {
  it('serves a roadmap with more posts than D1 allows bound parameters', async () => {
    h.db.prepare("INSERT INTO end_users (id, project_id, external_id, created_at) VALUES ('u', ?, 'u', 0)").run(h.project.id);
    const insert = h.db.prepare(
      "INSERT INTO posts (id, project_id, author_id, title, status, moderation, created_at, updated_at) VALUES (?, ?, 'u', ?, 'planned', 'approved', ?, ?)",
    );
    for (let i = 0; i < 130; i++) insert.run(`p${i}`, h.project.id, `Idea ${i}`, i, i);
    const res = await h.request('/v1/roadmap', { headers: await h.as({}) });
    expect(res.status).toBe(200);
    const [planned] = (await res.json()) as { posts: Post[] }[];
    expect(planned!.posts).toHaveLength(50);
  });

  it('merges concurrent settings patches instead of overwriting them', async () => {
    const patch = (body: Partial<ProjectSettings>) => h.request('/v1/admin/settings', { method: 'PATCH', headers: admin(), json: body });
    await Promise.all([patch({ autoApprove: true }), patch({ allowDownvotes: false })]);
    const settings = (await (await h.request('/v1/admin/settings', { headers: admin() })).json()) as ProjectSettings;
    expect(settings).toMatchObject({ autoApprove: true, allowDownvotes: false });
    const cleared = (await (await patch({ adminEmail: null })).json()) as ProjectSettings;
    expect(cleared.adminEmail).toBeNull();
  });

  it('lets only one of two crossing merges win, so no cycle forms', async () => {
    h.setSettings({ autoApprove: true });
    const make = async (title: string) =>
      (await (await h.request('/v1/posts', { method: 'POST', headers: await h.as({ user: title }), json: { title } })).json()) as Post;
    const a = await make('Post A');
    const b = await make('Post B');
    const merge = (id: string, intoId: string) =>
      h.request(`/v1/admin/posts/${id}/merge`, { method: 'POST', headers: admin(), json: { intoId } });
    const statuses = (await Promise.all([merge(a.id, b.id), merge(b.id, a.id)])).map((r) => r.status).sort();
    // The loser is caught by the pre-check (400) or, in a true race, by the SQL guard (409).
    expect(statuses[0]).toBe(200);
    expect([400, 409]).toContain(statuses[1]);
    const merged = h.db.prepare('SELECT COUNT(*) AS n FROM posts WHERE merged_into_id IS NOT NULL').get() as { n: number };
    expect(merged.n).toBe(1);
  });

  it('reports which field failed validation, and why', async () => {
    const res = await h.request('/v1/posts', { method: 'POST', headers: await h.as({ user: 'alice' }), json: { title: 'x' } });
    expect(await res.json()).toMatchObject({ error: 'invalid_input', field: 'title', reason: 'too_short' });
  });

  it('rate-limits uploads before reading the body', async () => {
    const headers = await h.as({ user: 'alice' });
    // Create the user first so the counter key exists, then exhaust it.
    await h.request('/v1/posts', { method: 'POST', headers, json: { title: 'Make me real' } });
    const { id } = h.db.prepare("SELECT id FROM end_users WHERE external_id = 'alice'").get() as { id: string };
    h.db.prepare('INSERT OR REPLACE INTO rate_limits (key, window_start, count) VALUES (?, ?, 30)').run(`user:${id}:upload`, Date.now());
    const res = await h.request('/v1/uploads', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'multipart/form-data; boundary=x' },
      body: 'not even multipart',
    });
    expect(res.status).toBe(429);
  });

  it('rejects cross-origin dashboard writes and hardens SPA responses', async () => {
    const login = await h.request('/v1/dashboard/login', {
      method: 'POST',
      headers: { Origin: 'https://evil.test' },
      json: { password: 'correct horse battery staple' },
    });
    expect(login.status).toBe(403);
    const sameOrigin = await h.request('/v1/dashboard/login', {
      method: 'POST',
      headers: { Origin: 'https://feedback.test' },
      json: { password: 'correct horse battery staple' },
    });
    expect(sameOrigin.status).toBe(200);

    h = await createHarness({ ASSETS: { fetch: async () => new Response('<html></html>') } as unknown as Fetcher });
    const page = await h.request('/admin/');
    expect(page.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(page.headers.get('X-Frame-Options')).toBe('DENY');
    expect(page.headers.get('X-Request-Id')).toBeTruthy();
  });

  it('reports an unreachable database as unhealthy', async () => {
    h.env.DB = {
      prepare: () => {
        throw new Error('no db');
      },
    } as unknown as D1Database;
    const res = await h.request('/v1/health');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, checks: { db: 'error' } });
  });

  it('re-enqueues stuck events through the queue and backs off retries', async () => {
    const { retryDelaySeconds } = await import('../src/events');
    const { runMaintenance } = await import('../src/maintenance');
    const sent: unknown[] = [];
    h = await createHarness({
      EVENTS: { send: async () => {}, sendBatch: async (msgs: unknown[]) => void sent.push(...msgs) } as unknown as Queue<{
        eventId: string;
      }>,
    });
    h.db
      .prepare("INSERT INTO events (id, project_id, type, payload, created_at) VALUES ('e1', ?, 'post.created', '{}', ?)")
      .run(h.project.id, Date.now() - 10 * 60_000);
    await runMaintenance(h.env);
    expect(sent).toEqual([{ body: { eventId: 'e1' } }]);

    expect(retryDelaySeconds(1)).toBeGreaterThanOrEqual(10);
    expect(retryDelaySeconds(3)).toBeGreaterThanOrEqual(40);
    expect(retryDelaySeconds(20)).toBeLessThan(305);
  });

  it('does not retry a webhook the endpoint rejected with a 4xx', async () => {
    const calls: number[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls.push(1);
      return new Response('nope', { status: 400 });
    }) as typeof fetch;
    try {
      await h.request('/v1/admin/webhooks', {
        method: 'POST',
        headers: admin(),
        json: { url: 'https://hooks.test/in', events: ['post.created'] },
      });
      await h.request('/v1/posts', { method: 'POST', headers: await h.as({ user: 'alice' }), json: { title: 'Webhook me' } });
      expect(calls).toHaveLength(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('reuses project rows within the TTL and evicts them on change', async () => {
    h = await createHarness({ PROJECT_CACHE_SECONDS: '60' });
    const config = async () =>
      ((await (await h.request('/v1/config', { headers: await h.as({}) })).json()) as { project: { name: string } }).project.name;
    expect(await config()).toBe('Demo App');
    h.db.prepare("UPDATE projects SET name = 'Renamed directly' WHERE id = ?").run(h.project.id);
    expect(await config()).toBe('Demo App');
    await h.request('/v1/admin/settings', { method: 'PATCH', headers: admin(), json: { autoApprove: true } });
    expect(await config()).toBe('Renamed directly');
  });

  it('serves attachments from the edge cache and answers conditional requests', async () => {
    const store = new Map<string, Response>();
    const edge = {
      match: async (req: Request) => store.get(req.url)?.clone(),
      put: async (req: Request, res: Response) => void store.set(req.url, res),
    };
    const original = (globalThis as { caches?: unknown }).caches;
    (globalThis as { caches?: unknown }).caches = { default: edge };
    try {
      const form = new FormData();
      form.append('file', new File(['img'], 'a.png', { type: 'image/png' }));
      const up = (await (
        await h.request('/v1/uploads', { method: 'POST', headers: await h.as({ user: 'alice' }), body: form })
      ).json()) as { id: string };
      const first = await h.request(`/v1/files/${up.id}`);
      const etag = first.headers.get('ETag')!;
      expect(etag).toBeTruthy();
      expect(store.size).toBe(1);
      h.files.store.clear(); // the edge copy must be enough now
      expect(await (await h.request(`/v1/files/${up.id}`)).text()).toBe('img');
      store.clear();
      h.files.store.set(`${h.project.id}/${up.id}`, { body: new TextEncoder().encode('img').buffer as ArrayBuffer });
      const conditional = await h.request(`/v1/files/${up.id}`, { headers: { 'If-None-Match': etag } });
      expect(conditional.status).toBe(304);
    } finally {
      (globalThis as { caches?: unknown }).caches = original;
    }
  });
});
