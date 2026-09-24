import { verifyWebhook } from '@kobecuppens/feedback-core/server';
import type { BoardConfig, Comment, Page, Post, Updates, WebhookConfig } from '@kobecuppens/feedback-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(() => vi.unstubAllGlobals());

const json = async <T>(res: Response | Promise<Response>, status = 200): Promise<T> => {
  const r = await res;
  const body = await r.text();
  expect(r.status, body).toBe(status);
  return (body ? JSON.parse(body) : undefined) as T;
};

const admin = () => ({ Authorization: `Bearer ${h.project.secretKey}` });

async function createPost(who: Parameters<Harness['as']>[0], title = 'Dark mode please', extra: Record<string, unknown> = {}) {
  return json<Post>(h.request('/v1/posts', { method: 'POST', headers: await h.as(who), json: { title, body: 'It hurts my eyes', ...extra } }), 201);
}

async function approve(id: string) {
  return json<Post>(h.request(`/v1/admin/posts/${id}/approve`, { method: 'POST', headers: admin() }));
}

describe('identity', () => {
  it('requires a project key', async () => {
    expect((await h.request('/v1/config')).status).toBe(401);
    const res = await h.request('/v1/config', { headers: { 'X-Feedback-Key': 'pk_nope' } });
    expect(await res.json()).toMatchObject({ error: 'invalid_project_key' });
  });

  it('rejects forged and expired user tokens', async () => {
    const headers = await h.as({ user: 'u1' });
    const forged = { ...headers, 'X-Feedback-User': headers['X-Feedback-User']!.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')) };
    expect(await (await h.request('/v1/config', { headers: forged })).json()).toMatchObject({ error: 'invalid_user_token' });

    const { signFeedbackUser } = await import('@kobecuppens/feedback-core/server');
    const old = await signFeedbackUser({ id: 'u1' }, h.project.signingSecret, Date.now() - 2 * 86_400_000);
    const res = await h.request('/v1/config', { headers: { ...headers, 'X-Feedback-User': old } });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'user_token_expired' });
  });

  it('reports features per viewer', async () => {
    const readOnly = await json<BoardConfig>(h.request('/v1/config', { headers: { 'X-Feedback-Key': h.project.publicKey } }));
    expect(readOnly.features).toMatchObject({ submit: false, vote: false, roadmap: true });
    expect(readOnly.project).toMatchObject({ name: 'Demo App', slug: 'demo' });

    const anon = await json<BoardConfig>(h.request('/v1/config', { headers: await h.as({ anon: 'device-1234' }) }));
    expect(anon.features.submit).toBe(true);
    expect(anon.viewer).toEqual({ identified: true, anonymous: true, isAdmin: false });

    h.setSettings({ allowAnonymous: false, allowDownvotes: false });
    const blocked = await json<BoardConfig>(h.request('/v1/config', { headers: await h.as({ anon: 'device-1234' }) }));
    expect(blocked.features.submit).toBe(false);
    const signed = await json<BoardConfig>(h.request('/v1/config', { headers: await h.as({ user: 'u1' }) }));
    expect(signed.features).toMatchObject({ submit: true, downvote: false });
  });

  it('blocks anonymous posting when the project disallows it', async () => {
    h.setSettings({ allowAnonymous: false });
    const res = await h.request('/v1/posts', { method: 'POST', headers: await h.as({ anon: 'device-1234' }), json: { title: 'Hello there' } });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'identity_required' });
  });
});

describe('moderation and visibility', () => {
  it('keeps pending posts private to their author until approved', async () => {
    const post = await createPost({ user: 'alice', name: 'Alice' });
    expect(post).toMatchObject({ moderation: 'pending', isMine: true, myVote: 1, score: 1, upvotes: 1 });
    expect(post.author.name).toBe('Alice');

    const aliceList = await json<Page<Post>>(h.request('/v1/posts', { headers: await h.as({ user: 'alice' }) }));
    expect(aliceList.items.map((p) => p.id)).toEqual([post.id]);
    const bobList = await json<Page<Post>>(h.request('/v1/posts', { headers: await h.as({ user: 'bob' }) }));
    expect(bobList.items).toEqual([]);
    expect((await h.request(`/v1/posts/${post.id}`, { headers: await h.as({ user: 'bob' }) })).status).toBe(404);

    await approve(post.id);
    const after = await json<Page<Post>>(h.request('/v1/posts', { headers: await h.as({ user: 'bob' }) }));
    expect(after.items).toHaveLength(1);
    expect(after.items[0]).toMatchObject({ isMine: false, myVote: 0 });
  });

  it('auto-approves when configured', async () => {
    h.setSettings({ autoApprove: true });
    expect((await createPost({ user: 'alice' })).moderation).toBe('approved');
  });

  it('shows declined posts with a reason to the author only', async () => {
    const post = await createPost({ user: 'alice', email: 'alice@example.com' });
    await json(h.request(`/v1/admin/posts/${post.id}/decline`, { method: 'POST', headers: admin(), json: { reason: 'Duplicate' } }));
    const mine = await json<Post>(h.request(`/v1/posts/${post.id}`, { headers: await h.as({ user: 'alice' }) }));
    expect(mine).toMatchObject({ moderation: 'declined', declineReason: 'Duplicate' });
    expect((await h.request(`/v1/posts/${post.id}`, { headers: await h.as({ user: 'bob' }) })).status).toBe(404);
    expect(h.emails.at(-1)).toMatchObject({ to: 'alice@example.com', subject: expect.stringContaining('declined') });
  });

  it('emails the admin about new posts awaiting review', async () => {
    await createPost({ user: 'alice' });
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0]).toMatchObject({ to: 'owner@example.com', subject: expect.stringContaining('Dark mode please') });
    h.setSettings({ adminEmail: 'team@app.io' });
    await createPost({ user: 'alice' }, 'Second idea');
    expect(h.emails[1]!.to).toBe('team@app.io');
  });

  it('sends no email when FEATURE_EMAIL is off', async () => {
    h = await createHarness({ FEATURE_EMAIL: 'false' });
    await createPost({ user: 'alice' });
    expect(h.emails).toHaveLength(0);
  });

  it('validates input and rate-limits posting', async () => {
    const headers = await h.as({ user: 'alice' });
    expect((await h.request('/v1/posts', { method: 'POST', headers, json: { title: 'x' } })).status).toBe(400);
    expect((await h.request('/v1/posts', { method: 'POST', headers, json: { title: 'Fine title', categoryId: 'nope' } })).status).toBe(400);
    for (let i = 0; i < 10; i++) await createPost({ user: 'alice' }, `Idea number ${i}`);
    const res = await h.request('/v1/posts', { method: 'POST', headers, json: { title: 'One too many' } });
    expect(res.status).toBe(429);
  });
});

describe('voting', () => {
  it('toggles, switches and keeps counters consistent', async () => {
    const post = await createPost({ user: 'alice' });
    await approve(post.id);
    const bob = await h.as({ user: 'bob' });
    const vote = (value: number) => json<Post>(h.request(`/v1/posts/${post.id}/vote`, { method: 'POST', headers: bob, json: { value } }));

    expect(await vote(1)).toMatchObject({ upvotes: 2, downvotes: 0, score: 2, myVote: 1 });
    expect(await vote(1)).toMatchObject({ upvotes: 2, score: 2 });
    expect(await vote(-1)).toMatchObject({ upvotes: 1, downvotes: 1, score: 0, myVote: -1 });
    expect(await vote(0)).toMatchObject({ upvotes: 1, downvotes: 0, score: 1, myVote: 0 });
  });

  it('rejects votes on pending posts and disabled downvotes', async () => {
    const post = await createPost({ user: 'alice' });
    const bob = await h.as({ user: 'bob' });
    // Pending posts are invisible to others.
    expect((await h.request(`/v1/posts/${post.id}/vote`, { method: 'POST', headers: bob, json: { value: 1 } })).status).toBe(404);
    const alice = await h.as({ user: 'alice' });
    expect((await h.request(`/v1/posts/${post.id}/vote`, { method: 'POST', headers: alice, json: { value: 1 } })).status).toBe(409);

    await approve(post.id);
    h.setSettings({ allowDownvotes: false });
    const res = await h.request(`/v1/posts/${post.id}/vote`, { method: 'POST', headers: bob, json: { value: -1 } });
    expect(res.status).toBe(403);
    expect((await h.request(`/v1/posts/${post.id}/vote`, { method: 'POST', headers: bob, json: { value: 2 } })).status).toBe(400);
  });

  it('sorts by top and new', async () => {
    h.setSettings({ autoApprove: true });
    const a = await createPost({ user: 'alice' }, 'First idea');
    const b = await createPost({ user: 'bob' }, 'Second idea');
    await h.request(`/v1/posts/${a.id}/vote`, { method: 'POST', headers: await h.as({ user: 'carol' }), json: { value: 1 } });
    const top = await json<Page<Post>>(h.request('/v1/posts?sort=top', { headers: await h.as({}) }));
    expect(top.items.map((p) => p.id)).toEqual([a.id, b.id]);
    h.db.prepare('UPDATE posts SET created_at = created_at + 1000 WHERE id = ?').run(b.id);
    const latest = await json<Page<Post>>(h.request('/v1/posts?sort=new', { headers: await h.as({}) }));
    expect(latest.items[0]!.id).toBe(b.id);
    const search = await json<Page<Post>>(h.request('/v1/posts?q=second', { headers: await h.as({}) }));
    expect(search.items.map((p) => p.id)).toEqual([b.id]);
  });

  it('paginates with cursors', async () => {
    h.setSettings({ autoApprove: true });
    for (let i = 0; i < 5; i++) await createPost({ user: `u${i}` }, `Idea ${i} here`);
    const first = await json<Page<Post>>(h.request('/v1/posts?limit=3', { headers: await h.as({}) }));
    expect(first.items).toHaveLength(3);
    const second = await json<Page<Post>>(h.request(`/v1/posts?limit=3&cursor=${first.nextCursor}`, { headers: await h.as({}) }));
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
  });
});

describe('admin surfaces and flags', () => {
  it('disables the admin API key when FEATURE_ADMIN_API is off', async () => {
    h = await createHarness({ FEATURE_ADMIN_API: 'false' });
    expect((await h.request('/v1/admin/queue', { headers: admin() })).status).toBe(404);
  });

  it('requires inAppAdmin for admin claims, and never lets moderators change settings', async () => {
    const post = await createPost({ user: 'alice' });
    const boss = await h.as({ user: 'boss', isAdmin: true });
    expect((await h.request('/v1/admin/queue', { headers: boss })).status).toBe(403);
    expect((await json<BoardConfig>(h.request('/v1/config', { headers: boss }))).viewer.isAdmin).toBe(false);

    h.setSettings({ inAppAdmin: true });
    expect((await json<BoardConfig>(h.request('/v1/config', { headers: boss }))).viewer.isAdmin).toBe(true);
    const queue = await json<Page<Post>>(h.request('/v1/admin/queue', { headers: boss }));
    expect(queue.items.map((p) => p.id)).toEqual([post.id]);
    await json(h.request(`/v1/admin/posts/${post.id}/approve`, { method: 'POST', headers: boss }));

    const res = await h.request('/v1/admin/settings', { method: 'PATCH', headers: boss, json: { autoApprove: true } });
    expect(res.status).toBe(403);
    const other = await h.as({ user: 'mallory' });
    expect((await h.request('/v1/admin/queue', { headers: other })).status).toBe(403);
  });

  it('validates settings patches', async () => {
    const ok = await json<{ autoApprove: boolean }>(
      h.request('/v1/admin/settings', { method: 'PATCH', headers: admin(), json: { autoApprove: true, adminEmail: 'a@b.co' } }),
    );
    expect(ok).toMatchObject({ autoApprove: true, adminEmail: 'a@b.co' });
    expect((await h.request('/v1/admin/settings', { method: 'PATCH', headers: admin(), json: { isGod: true } })).status).toBe(400);
    expect((await h.request('/v1/admin/settings', { method: 'PATCH', headers: admin(), json: { autoApprove: 'yes' } })).status).toBe(400);
  });

  it('gates the dashboard and SPAs behind their flags', async () => {
    h = await createHarness({ FEATURE_DASHBOARD: 'false', FEATURE_PUBLIC_BOARD: 'false' });
    expect((await h.request('/v1/dashboard/login', { method: 'POST', json: { password: 'x' } })).status).toBe(404);
    expect((await h.request('/admin/')).status).toBe(404);
    expect((await h.request('/p/demo')).status).toBe(404);
    expect((await h.request('/v1/public/projects/demo')).status).toBe(404);
  });

  it('logs into the dashboard and manages projects with the session cookie', async () => {
    expect((await h.request('/v1/dashboard/login', { method: 'POST', json: { password: 'wrong password!' } })).status).toBe(401);
    const login = await h.request('/v1/dashboard/login', { method: 'POST', json: { password: 'correct horse battery staple' } });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('Set-Cookie')!.split(';')[0]!;
    expect(login.headers.get('Set-Cookie')).toMatch(/HttpOnly/);

    const created = await json<{ id: string; slug: string; secrets: { secretKey: string } }>(
      h.request('/v1/dashboard/projects', { method: 'POST', headers: { Cookie: cookie }, json: { name: 'Café App' } }),
      201,
    );
    expect(created.slug).toBe('cafe-app');
    expect(created.secrets.secretKey).toMatch(/^sk_/);
    const list = await json<{ id: string; pendingCount: number }[]>(h.request('/v1/dashboard/projects', { headers: { Cookie: cookie } }));
    expect(list).toHaveLength(2);

    await createPost({ user: 'alice' });
    const queue = await json<Page<Post>>(h.request('/v1/admin/queue', { headers: { Cookie: cookie, 'X-Feedback-Project': h.project.id } }));
    expect(queue.items).toHaveLength(1);
    // The session alone, without a project header, grants nothing.
    expect((await h.request('/v1/admin/queue', { headers: { Cookie: cookie } })).status).toBe(401);
    expect((await h.request('/v1/dashboard/projects')).status).toBe(401);

    const rotated = await json<{ secretKey: string }>(
      h.request(`/v1/dashboard/projects/${h.project.id}/rotate`, { method: 'POST', headers: { Cookie: cookie }, json: { key: 'secret' } }),
    );
    expect((await h.request('/v1/admin/queue', { headers: admin() })).status).toBe(401);
    expect((await h.request('/v1/admin/queue', { headers: { Authorization: `Bearer ${rotated.secretKey}` } })).status).toBe(200);
  });

  it('serves the public board config only when enabled for the project', async () => {
    expect((await h.request('/v1/public/projects/demo')).status).toBe(404);
    h.setSettings({ publicBoard: true });
    expect(await json(h.request('/v1/public/projects/demo'))).toEqual({ name: 'Demo App', slug: 'demo', publicKey: h.project.publicKey });
  });

  it('merges duplicates and carries votes over', async () => {
    h.setSettings({ autoApprove: true });
    const target = await createPost({ user: 'alice' }, 'Dark mode');
    const dupe = await createPost({ user: 'bob' }, 'Night theme');
    await h.request(`/v1/posts/${dupe.id}/vote`, { method: 'POST', headers: await h.as({ user: 'carol' }), json: { value: 1 } });
    const merged = await json<Post>(h.request(`/v1/admin/posts/${dupe.id}/merge`, { method: 'POST', headers: admin(), json: { intoId: target.id } }));
    expect(merged.upvotes).toBe(3);
    const list = await json<Page<Post>>(h.request('/v1/posts', { headers: await h.as({}) }));
    expect(list.items.map((p) => p.id)).toEqual([target.id]);
    const old = await json<Post>(h.request(`/v1/posts/${dupe.id}`, { headers: await h.as({}) }));
    expect(old).toMatchObject({ mergedIntoId: target.id, status: 'closed' });
  });

  it('manages categories and filters by them', async () => {
    h.setSettings({ autoApprove: true });
    const bug = await json<{ id: string }>(h.request('/v1/admin/categories', { method: 'POST', headers: admin(), json: { name: 'Bug', color: '#f00' } }), 201);
    await createPost({ user: 'alice' }, 'Crash on launch', { categoryId: bug.id });
    await createPost({ user: 'alice' }, 'Dark mode');
    const config = await json<BoardConfig>(h.request('/v1/config', { headers: await h.as({}) }));
    expect(config.categories).toEqual([{ id: bug.id, name: 'Bug', color: '#f00', sort: 0 }]);
    const bugs = await json<Page<Post>>(h.request(`/v1/posts?category=${bug.id}`, { headers: await h.as({}) }));
    expect(bugs.items.map((p) => p.title)).toEqual(['Crash on launch']);
    await h.request(`/v1/admin/categories/${bug.id}`, { method: 'DELETE', headers: admin() });
    const all = await json<Page<Post>>(h.request('/v1/posts', { headers: await h.as({}) }));
    expect(all.items.every((p) => p.category === null)).toBe(true);
  });
});

describe('comments, roadmap and updates', () => {
  it('threads comments, marks official replies and surfaces updates', async () => {
    const post = await createPost({ user: 'alice', email: 'alice@example.com' });
    await approve(post.id);
    const bob = await h.as({ user: 'bob', name: 'Bob' });
    await json<Comment>(h.request(`/v1/posts/${post.id}/comments`, { method: 'POST', headers: bob, json: { body: '+1 from me' } }), 201);
    const reply = await json<Comment>(
      h.request(`/v1/admin/posts/${post.id}/comments`, { method: 'POST', headers: admin(), json: { body: 'On it!' } }),
      201,
    );
    expect(reply).toMatchObject({ isOfficial: true, author: { isAdmin: true } });

    const comments = await json<Page<Comment>>(h.request(`/v1/posts/${post.id}/comments`, { headers: bob }));
    expect(comments.items.map((c) => c.body)).toEqual(['+1 from me', 'On it!']);
    expect((await json<Post>(h.request(`/v1/posts/${post.id}`, { headers: bob }))).commentCount).toBe(2);

    await json(h.request(`/v1/admin/posts/${post.id}`, { method: 'PATCH', headers: admin(), json: { status: 'planned' } }));
    expect(h.emails.at(-1)).toMatchObject({ to: 'alice@example.com', subject: expect.stringContaining('Planned') });

    const alice = await h.as({ user: 'alice' });
    const updates = await json<Updates>(h.request('/v1/me/updates', { headers: alice }));
    expect(updates.items.map((i) => i.kind).sort()).toEqual(['approved', 'official_reply', 'status']);
    expect(updates.unseen).toBe(3);
    // Bob upvoted nothing and wrote nothing, so he sees nothing.
    expect((await json<Updates>(h.request('/v1/me/updates', { headers: bob }))).items).toEqual([]);

    expect((await h.request('/v1/me/updates/seen', { method: 'POST', headers: alice })).status).toBe(204);
    expect((await json<Updates>(h.request('/v1/me/updates', { headers: alice }))).unseen).toBe(0);

    const roadmap = await json<{ status: string; posts: Post[] }[]>(h.request('/v1/roadmap', { headers: bob }));
    expect(roadmap.map((c) => c.status)).toEqual(['planned', 'in_progress', 'done']);
    expect(roadmap[0]!.posts.map((p) => p.id)).toEqual([post.id]);

    await h.request(`/v1/admin/posts/${post.id}/comments/${reply.id}`, { method: 'DELETE', headers: admin() });
    expect((await json<Page<Comment>>(h.request(`/v1/posts/${post.id}/comments`, { headers: bob }))).items).toHaveLength(1);
  });

  it('honours comment and roadmap switches', async () => {
    h.setSettings({ autoApprove: true, allowComments: false, roadmapEnabled: false });
    const post = await createPost({ user: 'alice' });
    const res = await h.request(`/v1/posts/${post.id}/comments`, { method: 'POST', headers: await h.as({ user: 'bob' }), json: { body: 'hi' } });
    expect(res.status).toBe(403);
    expect((await h.request('/v1/roadmap', { headers: await h.as({}) })).status).toBe(404);
  });
});

describe('uploads', () => {
  const upload = async (headers: Record<string, string>, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return h.request('/v1/uploads', { method: 'POST', headers, body: form });
  };

  it('stores images, attaches them, serves them and cleans up on delete', async () => {
    const alice = await h.as({ user: 'alice' });
    const res = await upload(alice, new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' }));
    const attachment = await json<{ id: string; url: string }>(res, 201);
    expect(attachment.url).toBe(`https://feedback.test/v1/files/${attachment.id}`);

    const post = await createPost({ user: 'alice' }, 'With screenshot', { attachmentIds: [attachment.id] });
    expect(post.attachments.map((a) => a.id)).toEqual([attachment.id]);

    const file = await h.request(`/v1/files/${attachment.id}`);
    expect(file.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));

    expect(h.files.store.size).toBe(1);
    await h.request(`/v1/admin/posts/${post.id}`, { method: 'DELETE', headers: admin() });
    expect(h.files.store.size).toBe(0);
  });

  it('rejects oversized files, wrong types, and other users’ uploads', async () => {
    const alice = await h.as({ user: 'alice' });
    expect((await upload(alice, new File(['hi'], 'x.txt', { type: 'text/plain' }))).status).toBe(415);
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    expect((await upload(alice, big)).status).toBe(413);

    const bobFile = await json<{ id: string }>(await upload(await h.as({ user: 'bob' }), new File(['x'], 'a.png', { type: 'image/png' })), 201);
    const res = await h.request('/v1/posts', { method: 'POST', headers: alice, json: { title: 'Stealing', attachmentIds: [bobFile.id] } });
    expect(res.status).toBe(400);

    h.setSettings({ allowAttachments: false });
    expect((await upload(alice, new File(['x'], 'a.png', { type: 'image/png' }))).status).toBe(403);
  });
});

describe('webhooks', () => {
  it('delivers signed events to subscribed endpoints', async () => {
    const calls: { url: string; body: string; headers: Headers }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body as string, headers: new Headers(init.headers) });
      return new Response('ok');
    });
    const hook = await json<WebhookConfig>(
      h.request('/v1/admin/webhooks', { method: 'POST', headers: admin(), json: { url: 'https://hooks.test/in', events: ['post.approved'] } }),
      201,
    );
    const post = await createPost({ user: 'alice' });
    expect(calls).toHaveLength(0);
    await approve(post.id);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.headers.get('X-Feedback-Event')).toBe('post.approved');
    expect(await verifyWebhook(hook.secret, call.body, call.headers.get('X-Feedback-Signature')!)).toBe(true);
    expect(JSON.parse(call.body)).toMatchObject({ type: 'post.approved', data: { post: { id: post.id, moderation: 'approved' } } });

    expect((await h.request('/v1/admin/webhooks', { method: 'POST', headers: admin(), json: { url: 'https://x.test', events: ['nope'] } })).status).toBe(400);
  });
});
