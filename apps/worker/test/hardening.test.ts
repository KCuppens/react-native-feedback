import type { Post, Updates } from '@kobecuppens/feedback-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventMessage } from '../src/env';
import { handleEventBatch, processEvent } from '../src/events';
import { runMaintenance } from '../src/maintenance';
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
const admin = () => ({ Authorization: `Bearer ${h.project.secretKey}` });
const createPost = async (who: Parameters<Harness['as']>[0], title = 'Dark mode please', extra: Record<string, unknown> = {}) =>
  json<Post>(h.request('/v1/posts', { method: 'POST', headers: await h.as(who), json: { title, ...extra } }), 201);
const approve = (id: string) => json<Post>(h.request(`/v1/admin/posts/${id}/approve`, { method: 'POST', headers: admin() }));
const vote = async (who: Parameters<Harness['as']>[0], id: string, value: number) =>
  h.request(`/v1/posts/${id}/vote`, { method: 'POST', headers: await h.as(who), json: { value } });

describe('tenant isolation', () => {
  it("one project's admin credentials cannot touch another project's posts", async () => {
    const other = await h.addProject('proj_2', 'other');
    const foreign = await json<Post>(
      h.request('/v1/posts', { method: 'POST', headers: await other.as({ user: 'zed' }), json: { title: 'Their idea' } }),
      201,
    );
    const login = await h.request('/v1/dashboard/login', { method: 'POST', json: { password: 'correct horse battery staple' } });
    const cookie = login.headers.get('Set-Cookie')!.split(';')[0]!;

    for (const headers of [admin(), { Cookie: cookie, 'X-Feedback-Project': h.project.id }]) {
      expect((await h.request(`/v1/admin/posts/${foreign.id}/approve`, { method: 'POST', headers })).status).toBe(404);
      expect((await h.request(`/v1/admin/posts/${foreign.id}`, { method: 'PATCH', headers, json: { status: 'done' } })).status).toBe(404);
      expect((await h.request(`/v1/admin/posts/${foreign.id}`, { method: 'DELETE', headers })).status).toBe(404);
    }
    const mine = await createPost({ user: 'alice' });
    const merge = await h.request(`/v1/admin/posts/${mine.id}/merge`, { method: 'POST', headers: admin(), json: { intoId: foreign.id } });
    expect(merge.status).toBe(404);
    const row = h.db.prepare('SELECT moderation, status FROM posts WHERE id = ?').get(foreign.id);
    expect(row).toEqual({ moderation: 'pending', status: 'open' });
  });
});

describe('input edge cases', () => {
  it('treats a blank categoryId as no category', async () => {
    const post = await createPost({ user: 'alice' }, 'Blank category', { categoryId: '  ' });
    expect(post.category).toBeNull();
    const patched = await json<Post>(
      h.request(`/v1/admin/posts/${post.id}`, { method: 'PATCH', headers: admin(), json: { categoryId: '' } }),
    );
    expect(patched.category).toBeNull();
  });

  it('returns the in-app admin’s own vote and ownership from admin actions', async () => {
    h.setSettings({ inAppAdmin: true });
    const boss = await h.as({ user: 'boss', isAdmin: true });
    const post = await json<Post>(h.request('/v1/posts', { method: 'POST', headers: boss, json: { title: 'Admin idea' } }), 201);
    const updated = await json<Post>(
      h.request(`/v1/admin/posts/${post.id}`, { method: 'PATCH', headers: boss, json: { status: 'planned' } }),
    );
    expect(updated).toMatchObject({ myVote: 1, isMine: true, status: 'planned' });
  });
});

describe('merged and declined guards', () => {
  it('rejects votes on merged posts', async () => {
    h.setSettings({ autoApprove: true });
    const target = await createPost({ user: 'alice' }, 'Target');
    const dupe = await createPost({ user: 'bob' }, 'Dupe');
    await h.request(`/v1/admin/posts/${dupe.id}/merge`, { method: 'POST', headers: admin(), json: { intoId: target.id } });
    expect((await vote({ user: 'carol' }, dupe.id, 1)).status).toBe(409);
  });

  it('blocks comments on declined posts except from in-app admins', async () => {
    h.setSettings({ inAppAdmin: true });
    const post = await createPost({ user: 'alice' });
    await h.request(`/v1/admin/posts/${post.id}/decline`, { method: 'POST', headers: admin(), json: { reason: 'No' } });
    const byAuthor = await h.request(`/v1/posts/${post.id}/comments`, {
      method: 'POST',
      headers: await h.as({ user: 'alice' }),
      json: { body: 'Why?' },
    });
    expect(byAuthor.status).toBe(409);
    const byAdmin = await json<{ isOfficial: boolean }>(
      h.request(`/v1/posts/${post.id}/comments`, {
        method: 'POST',
        headers: await h.as({ user: 'boss', isAdmin: true }),
        json: { body: 'Duplicate.' },
      }),
      201,
    );
    expect(byAdmin.isOfficial).toBe(true);
  });

  it('counts a voter on both posts once after a merge, and repoints merge chains', async () => {
    h.setSettings({ autoApprove: true });
    const a = await createPost({ user: 'alice' }, 'Post A');
    const b = await createPost({ user: 'bob' }, 'Post B');
    const c = await createPost({ user: 'dan' }, 'Post C');
    await vote({ user: 'carol' }, a.id, 1);
    await vote({ user: 'carol' }, b.id, 1);
    await h.request(`/v1/admin/posts/${c.id}/merge`, { method: 'POST', headers: admin(), json: { intoId: b.id } });
    const merged = await json<Post>(
      h.request(`/v1/admin/posts/${b.id}/merge`, { method: 'POST', headers: admin(), json: { intoId: a.id } }),
    );
    // alice, bob, carol (once) and dan.
    expect(merged.upvotes).toBe(4);
    const chained = await json<Post>(h.request(`/v1/admin/posts/${c.id}`, { headers: admin() }));
    expect(chained.mergedIntoId).toBe(a.id);
  });
});

describe('notifications', () => {
  it('delivers each event at most once, even when processed again', async () => {
    const post = await createPost({ user: 'alice', email: 'alice@x.io' });
    await approve(post.id);
    const sent = h.emails.length;
    const { id } = h.db.prepare("SELECT id FROM events WHERE type = 'post.approved'").get() as { id: string };
    await processEvent(h.env, id);
    expect(h.emails).toHaveLength(sent);
  });

  it('retries queue messages whose processing throws', async () => {
    const broken = {
      ...h.env,
      DB: {
        prepare: () => {
          throw new Error('db down');
        },
      } as unknown as D1Database,
    };
    const message = { body: { eventId: 'e1' }, ack: vi.fn(), retry: vi.fn() };
    await handleEventBatch({ messages: [message] } as unknown as MessageBatch<EventMessage>, broken);
    expect(message.retry).toHaveBeenCalled();
    expect(message.ack).not.toHaveBeenCalled();
  });

  it('skips submitter emails when disabled, self-inflicted, or the post is still pending', async () => {
    const pending = await createPost({ user: 'alice', email: 'alice@x.io' });
    h.emails.length = 0;
    await h.request(`/v1/admin/posts/${pending.id}`, { method: 'PATCH', headers: admin(), json: { status: 'planned' } });
    expect(h.emails).toHaveLength(0);

    h.setSettings({ inAppAdmin: true });
    const boss = await h.as({ user: 'boss', isAdmin: true, email: 'boss@x.io' });
    const own = await json<Post>(h.request('/v1/posts', { method: 'POST', headers: boss, json: { title: 'Mine' } }), 201);
    await h.request(`/v1/admin/posts/${own.id}`, { method: 'PATCH', headers: boss, json: { status: 'done' } });
    expect(h.emails).toHaveLength(0);

    await approve(pending.id);
    h.emails.length = 0;
    h.setSettings({ notifySubmitter: false });
    await h.request(`/v1/admin/posts/${pending.id}`, { method: 'PATCH', headers: admin(), json: { status: 'done' } });
    expect(h.emails).toHaveLength(0);
  });

  it('does not fail the request when the queue is down', async () => {
    h = await createHarness({
      EVENTS: {
        send: async () => {
          throw new Error('queue down');
        },
      } as unknown as Queue<EventMessage>,
    });
    const post = await createPost({ user: 'alice' });
    expect(post.moderation).toBe('pending');
    const row = h.db.prepare('SELECT processed_at FROM events WHERE post_id = ?').get(post.id) as { processed_at: number | null };
    expect(row.processed_at).toBeNull();
  });

  it('shows voters status updates only', async () => {
    const post = await createPost({ user: 'alice' });
    await approve(post.id);
    await vote({ user: 'bob' }, post.id, 1);
    await h.request(`/v1/admin/posts/${post.id}/comments`, { method: 'POST', headers: admin(), json: { body: 'Soon' } });
    await h.request(`/v1/admin/posts/${post.id}`, { method: 'PATCH', headers: admin(), json: { status: 'planned' } });
    const updates = await json<Updates>(h.request('/v1/me/updates', { headers: await h.as({ user: 'bob' }) }));
    expect(updates.items.map((i) => i.kind)).toEqual(['status']);
  });
});

describe('abuse limits', () => {
  it('caps anonymous writes per IP even when the device id changes', async () => {
    h.setSettings({ autoApprove: true });
    const post = await createPost({ user: 'alice' });
    const ip = { 'CF-Connecting-IP': '203.0.113.9' };
    const statuses: number[] = [];
    for (let i = 0; i < 201; i++) {
      const headers = { ...(await h.as({ anon: `device-${String(i).padStart(4, '0')}` })), ...ip };
      statuses.push((await h.request(`/v1/posts/${post.id}/vote`, { method: 'POST', headers, json: { value: 1 } })).status);
    }
    expect(statuses.slice(0, 200).every((s) => s === 200)).toBe(true);
    expect(statuses[200]).toBe(429);
    // A different IP is unaffected; signed users are never IP-limited.
    const elsewhere = { ...(await h.as({ anon: 'device-other' })), 'CF-Connecting-IP': '198.51.100.1' };
    expect((await h.request(`/v1/posts/${post.id}/vote`, { method: 'POST', headers: elsewhere, json: { value: 1 } })).status).toBe(200);
    expect((await vote({ user: 'bob' }, post.id, 1)).status).toBe(200);
  });

  it('locks out dashboard logins after 10 attempts per IP', async () => {
    const attempt = (ip: string) =>
      h.request('/v1/dashboard/login', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': ip },
        json: { password: 'correct horse battery staple' },
      });
    // Nine earlier attempts in this window: the tenth still goes through, the eleventh is refused.
    h.db.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 9)').run('login:203.0.113.7', Date.now());
    expect((await attempt('203.0.113.7')).status).toBe(200);
    expect((await attempt('203.0.113.7')).status).toBe(429);
    expect((await attempt('198.51.100.1')).status).toBe(200);
    // The window resets once it has passed.
    h.db.prepare('UPDATE rate_limits SET window_start = ? WHERE key = ?').run(Date.now() - 16 * 60_000, 'login:203.0.113.7');
    expect((await attempt('203.0.113.7')).status).toBe(200);
  });
});

describe('maintenance', () => {
  it('removes stale unattached uploads, redelivers stuck events and prunes old rows', async () => {
    const alice = await h.as({ user: 'alice' });
    const form = new FormData();
    form.append('file', new File(['x'], 'a.png', { type: 'image/png' }));
    await json(h.request('/v1/uploads', { method: 'POST', headers: alice, body: form }), 201);
    const form2 = new FormData();
    form2.append('file', new File(['y'], 'b.png', { type: 'image/png' }));
    const kept = await json<{ id: string }>(h.request('/v1/uploads', { method: 'POST', headers: alice, body: form2 }), 201);
    await createPost({ user: 'alice' }, 'With image', { attachmentIds: [kept.id] });

    // A stuck event from a failed enqueue, and an old processed one.
    const post = await createPost({ user: 'bob', email: 'bob@x.io' });
    h.db.prepare("UPDATE posts SET moderation = 'approved' WHERE id = ?").run(post.id);
    h.db
      .prepare("INSERT INTO events (id, project_id, type, post_id, payload, created_at) VALUES ('stuck', ?, 'post.approved', ?, ?, ?)")
      .run(h.project.id, post.id, JSON.stringify({ origin: 'https://feedback.test' }), Date.now() - 10 * 60_000);
    h.db.prepare("UPDATE events SET processed_at = 1 WHERE id != 'stuck'").run();
    h.emails.length = 0;

    await runMaintenance(h.env, Date.now() + 25 * 3_600_000);

    const ids = (h.db.prepare('SELECT id FROM attachments').all() as { id: string }[]).map((r) => r.id);
    expect(ids).toEqual([kept.id]);
    expect(h.files.store.size).toBe(1);
    expect(h.emails.map((e) => e.to)).toEqual(['bob@x.io']);
    expect(h.db.prepare('SELECT id FROM events').all()).toEqual([{ id: 'stuck' }]);
  });
});

describe('review follow-ups', () => {
  it('deletes duplicates together with the post they were merged into', async () => {
    h.setSettings({ autoApprove: true });
    const target = await createPost({ user: 'alice' }, 'Target');
    const dupe = await createPost({ user: 'bob' }, 'Dupe');
    await h.request(`/v1/admin/posts/${dupe.id}/merge`, { method: 'POST', headers: admin(), json: { intoId: target.id } });
    expect((await h.request(`/v1/admin/posts/${target.id}`, { method: 'DELETE', headers: admin() })).status).toBe(204);
    expect(h.db.prepare('SELECT id FROM posts').all()).toEqual([]);
  });

  it('returns the real pending count after renaming a project', async () => {
    await createPost({ user: 'alice' });
    const login = await h.request('/v1/dashboard/login', { method: 'POST', json: { password: 'correct horse battery staple' } });
    const cookie = login.headers.get('Set-Cookie')!.split(';')[0]!;
    const renamed = await json<{ name: string; pendingCount: number }>(
      h.request(`/v1/dashboard/projects/${h.project.id}`, { method: 'PATCH', headers: { Cookie: cookie }, json: { name: 'Renamed' } }),
    );
    expect(renamed).toMatchObject({ name: 'Renamed', pendingCount: 1 });
  });

  it('ends existing dashboard sessions when the password changes', async () => {
    const login = await h.request('/v1/dashboard/login', { method: 'POST', json: { password: 'correct horse battery staple' } });
    const cookie = login.headers.get('Set-Cookie')!.split(';')[0]!;
    expect((await h.request('/v1/dashboard/me', { headers: { Cookie: cookie } })).status).toBe(200);
    h.env.ADMIN_PASSWORD = 'a brand new password';
    expect((await h.request('/v1/dashboard/me', { headers: { Cookie: cookie } })).status).toBe(401);
  });

  it('stops reading an upload body at the size limit even without Content-Length', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 128 * 1024);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(big);
        controller.close();
      },
    });
    const headers = { ...(await h.as({ user: 'alice' })), 'Content-Type': 'multipart/form-data; boundary=x' };
    const res = await h.request('/v1/uploads', { method: 'POST', headers, body: stream, duplex: 'half' } as RequestInit);
    expect(res.status).toBe(413);
  });

  it('orders the done column by when posts shipped', async () => {
    h.setSettings({ autoApprove: true });
    const first = await createPost({ user: 'alice' }, 'Shipped first');
    const second = await createPost({ user: 'bob' }, 'Shipped second');
    await vote({ user: 'carol' }, first.id, 1);
    await h.request(`/v1/admin/posts/${first.id}`, { method: 'PATCH', headers: admin(), json: { status: 'done' } });
    await h.request(`/v1/admin/posts/${second.id}`, { method: 'PATCH', headers: admin(), json: { status: 'done' } });
    h.db.prepare('UPDATE posts SET status_changed_at = status_changed_at + 1000 WHERE id = ?').run(second.id);
    const roadmap = await json<{ status: string; posts: Post[] }[]>(h.request('/v1/roadmap', { headers: await h.as({}) }));
    expect(roadmap.find((col) => col.status === 'done')!.posts.map((p) => p.title)).toEqual(['Shipped second', 'Shipped first']);
  });
});
