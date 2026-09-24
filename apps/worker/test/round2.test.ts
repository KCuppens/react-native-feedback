import type { Post } from '@kobecuppens/feedback-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});

const admin = () => ({ Authorization: `Bearer ${h.project.secretKey}` });
const eventCount = (type: string) => (h.db.prepare('SELECT COUNT(*) AS n FROM events WHERE type = ?').get(type) as { n: number }).n;

describe('concurrency guards, edge purges and dead-lettering', () => {
  it('records concurrent duplicate approvals once', async () => {
    const post = (await (
      await h.request('/v1/posts', { method: 'POST', headers: await h.as({ user: 'alice', email: 'a@x.io' }), json: { title: 'Twice' } })
    ).json()) as Post;
    h.emails.length = 0;
    const approve = () => h.request(`/v1/admin/posts/${post.id}/approve`, { method: 'POST', headers: admin() });
    const statuses = (await Promise.all([approve(), approve()])).map((r) => r.status);
    expect(statuses).toEqual([200, 200]);
    expect(eventCount('post.approved')).toBe(1);
    expect(h.emails).toHaveLength(1);
  });

  it('records concurrent identical status changes once', async () => {
    h.setSettings({ autoApprove: true });
    const post = (await (
      await h.request('/v1/posts', { method: 'POST', headers: await h.as({ user: 'alice' }), json: { title: 'Plan me' } })
    ).json()) as Post;
    const plan = () =>
      h.request(`/v1/admin/posts/${post.id}`, { method: 'PATCH', headers: admin(), json: { status: 'planned', title: 'Plan me now' } });
    await Promise.all([plan(), plan()]);
    expect(eventCount('post.status_changed')).toBe(1);
    const row = h.db.prepare('SELECT status, title FROM posts WHERE id = ?').get(post.id);
    expect(row).toEqual({ status: 'planned', title: 'Plan me now' });
  });

  it('refuses cross-origin writes on cookie-authenticated admin routes', async () => {
    const login = await h.request('/v1/dashboard/login', { method: 'POST', json: { password: 'correct horse battery staple' } });
    const cookie = login.headers.get('Set-Cookie')!.split(';')[0]!;
    const headers = { Cookie: cookie, 'X-Feedback-Project': h.project.id };
    const evil = await h.request('/v1/admin/webhooks', {
      method: 'POST',
      headers: { ...headers, Origin: 'https://evil.test' },
      json: { url: 'https://evil.test/hook', events: ['post.created'] },
    });
    expect(evil.status).toBe(403);
    // Reads, and the secret-key API (no cookie), are unaffected.
    expect((await h.request('/v1/admin/webhooks', { headers: { ...headers, Origin: 'https://evil.test' } })).status).toBe(200);
    expect(
      (
        await h.request('/v1/admin/categories', {
          method: 'POST',
          headers: { ...admin(), Origin: 'https://some-server.test' },
          json: { name: 'Bug' },
        })
      ).status,
    ).toBe(201);
  });

  it('keeps edge copies short-lived and purges them when files are deleted', async () => {
    const store = new Map<string, Response>();
    const edge = {
      match: async (req: Request) => store.get(req.url)?.clone(),
      put: async (req: Request, res: Response) => void store.set(req.url, res),
      delete: async (url: string) => store.delete(url),
    };
    const original = (globalThis as { caches?: unknown }).caches;
    (globalThis as { caches?: unknown }).caches = { default: edge };
    const waits: Promise<unknown>[] = [];
    try {
      const form = new FormData();
      form.append('file', new File(['img'], 'a.png', { type: 'image/png' }));
      const alice = await h.as({ user: 'alice' });
      const up = (await (await h.request('/v1/uploads', { method: 'POST', headers: alice, body: form })).json()) as { id: string };
      const post = (await (
        await h.request('/v1/posts', { method: 'POST', headers: alice, json: { title: 'With image', attachmentIds: [up.id] } })
      ).json()) as Post;
      const first = await h.request(`/v1/files/${up.id}`);
      expect(first.headers.get('Cache-Control')).toBe('public, max-age=86400');
      const url = `https://feedback.test/v1/files/${up.id}`;
      expect(store.get(url)?.headers.get('Cache-Control')).toBe('public, max-age=3600');

      const { app } = await import('../src/index');
      await app.request(`https://feedback.test/v1/admin/posts/${post.id}`, { method: 'DELETE', headers: admin() }, h.env, {
        waitUntil: (p: Promise<unknown>) => waits.push(p),
        passThroughOnException: () => {},
      } as unknown as ExecutionContext);
      await Promise.all(waits);
      expect(store.has(url)).toBe(false);
    } finally {
      (globalThis as { caches?: unknown }).caches = original;
    }
  });

  it('never deletes an upload that was claimed while the cleanup ran', async () => {
    const { runMaintenance } = await import('../src/maintenance');
    h.db.prepare("INSERT INTO end_users (id, project_id, external_id, created_at) VALUES ('u', ?, 'u', 0)").run(h.project.id);
    h.db
      .prepare("INSERT INTO posts (id, project_id, author_id, title, created_at, updated_at) VALUES ('p', ?, 'u', 'Post', 0, 0)")
      .run(h.project.id);
    h.db
      .prepare(
        "INSERT INTO attachments (id, project_id, uploader_id, post_id, r2_key, mime, bytes, created_at) VALUES ('a', ?, 'u', 'p', 'k', 'image/png', 1, 0)",
      )
      .run(h.project.id);
    h.files.store.set('k', { body: new ArrayBuffer(1) });
    await runMaintenance(h.env, Date.now() + 2 * 86_400_000);
    expect(h.files.store.has('k')).toBe(true);
    expect(h.db.prepare('SELECT id FROM attachments').all()).toEqual([{ id: 'a' }]);
  });

  it('dead-letters an event after three failed sweep redeliveries', async () => {
    const { runMaintenance } = await import('../src/maintenance');
    h.db
      .prepare(
        "INSERT INTO events (id, project_id, type, post_id, payload, created_at) VALUES ('poison', ?, 'post.created', 'gone', '{}', ?)",
      )
      .run(h.project.id, Date.now() - 10 * 60_000);
    // Make every delivery attempt fail by pointing the event at a project that no longer loads.
    const broken = {
      ...h.env,
      DB: new Proxy(h.env.DB, {
        get(target, prop) {
          if (prop !== 'prepare') return Reflect.get(target, prop);
          return (sql: string) => {
            if (sql.startsWith('SELECT * FROM events WHERE id')) throw new Error('boom');
            return target.prepare(sql);
          };
        },
      }),
    };
    for (let i = 0; i < 5; i++) await runMaintenance(broken, Date.now() + i * 3_600_000);
    expect(h.db.prepare("SELECT attempts FROM events WHERE id = 'poison'").get()).toEqual({ attempts: 4 });
    await runMaintenance(h.env, Date.now() + 31 * 86_400_000);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM events WHERE id = 'poison'").get()).toEqual({ n: 0 });
  });

  it('lets a losing concurrent merge change nothing', async () => {
    h.setSettings({ autoApprove: true });
    const make = async (title: string, user: string) =>
      (await (await h.request('/v1/posts', { method: 'POST', headers: await h.as({ user }), json: { title } })).json()) as Post;
    const a = await make('Post A', 'alice');
    const b = await make('Post B', 'bob');
    const merge = (id: string, intoId: string) =>
      h.request(`/v1/admin/posts/${id}/merge`, { method: 'POST', headers: admin(), json: { intoId } });
    await Promise.all([merge(a.id, b.id), merge(b.id, a.id)]);
    expect(eventCount('post.merged')).toBe(1);
    const winner = h.db.prepare('SELECT id, merged_into_id FROM posts WHERE merged_into_id IS NOT NULL').get() as {
      id: string;
      merged_into_id: string;
    };
    // The surviving post holds both supporters; the merged one keeps only its own.
    const votes = (id: string) => (h.db.prepare('SELECT COUNT(*) AS n FROM votes WHERE post_id = ?').get(id) as { n: number }).n;
    expect(votes(winner.merged_into_id)).toBe(2);
    expect(votes(winner.id)).toBe(1);
  });
});
