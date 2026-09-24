import { describe, expect, it, vi } from 'vitest';
import { createAdminClient, FeedbackApiError } from '../src';

type Call = [string, RequestInit];

function recorder(response: () => Response = () => new Response('{}', { status: 200 })) {
  const fetch = vi.fn(async (..._args: Call) => response());
  const call = (i = 0) => {
    const [url, init] = fetch.mock.calls[i]!;
    return { url, method: init.method, headers: init.headers as Record<string, string>, body: init.body, credentials: init.credentials };
  };
  return { fetch: fetch as unknown as typeof globalThis.fetch, call, mock: fetch };
}

describe('createAdminClient', () => {
  it('uses the secret key as a bearer token and never sends cookies with it', async () => {
    const r = recorder();
    const client = createAdminClient({ baseUrl: 'https://api.test/', secretKey: 'sk_1', fetch: r.fetch });
    await client.project().listQueue('20');
    expect(r.call()).toMatchObject({
      url: 'https://api.test/v1/admin/queue?cursor=20',
      method: 'GET',
      headers: { Authorization: 'Bearer sk_1' },
      credentials: 'omit',
      body: undefined,
    });
  });

  it('uses the session cookie and a project header in the dashboard', async () => {
    const r = recorder();
    const client = createAdminClient({ baseUrl: 'https://api.test', fetch: r.fetch });
    await client.project('proj_9').decline('p1', 'Duplicate');
    expect(r.call()).toMatchObject({
      url: 'https://api.test/v1/admin/posts/p1/decline',
      method: 'POST',
      headers: { 'X-Feedback-Project': 'proj_9', 'Content-Type': 'application/json' },
      credentials: 'include',
      body: '{"reason":"Duplicate"}',
    });
    expect(r.call().headers.Authorization).toBeUndefined();
  });

  it('builds list filters into the query string', async () => {
    const r = recorder();
    const admin = createAdminClient({ baseUrl: 'https://api.test', secretKey: 'sk', fetch: r.fetch }).project();
    await admin.listPosts({ moderation: 'pending', status: ['planned', 'done'], categoryId: 'c1', q: 'dark', sort: 'new', limit: 10 });
    expect(r.call().url).toBe('https://api.test/v1/admin/posts?sort=new&status=planned%2Cdone&category=c1&q=dark&limit=10&moderation=pending');
    await admin.listPosts();
    expect(r.call(1).url).toBe('https://api.test/v1/admin/posts');
  });

  it('maps every project call to its route', async () => {
    const r = recorder(() => new Response(null, { status: 204 }));
    const a = createAdminClient({ baseUrl: 'https://x', secretKey: 'sk', fetch: r.fetch }).project();
    const calls: [() => Promise<unknown>, string, string][] = [
      [() => a.getPost('p'), 'GET', '/v1/admin/posts/p'],
      [() => a.approve('p'), 'POST', '/v1/admin/posts/p/approve'],
      [() => a.updatePost('p', { status: 'done' }), 'PATCH', '/v1/admin/posts/p'],
      [() => a.deletePost('p'), 'DELETE', '/v1/admin/posts/p'],
      [() => a.merge('p', 'q'), 'POST', '/v1/admin/posts/p/merge'],
      [() => a.listComments('p'), 'GET', '/v1/admin/posts/p/comments'],
      [() => a.reply('p', 'hi'), 'POST', '/v1/admin/posts/p/comments'],
      [() => a.deleteComment('p', 'c'), 'DELETE', '/v1/admin/posts/p/comments/c'],
      [() => a.listCategories(), 'GET', '/v1/admin/categories'],
      [() => a.createCategory({ name: 'Bug' }), 'POST', '/v1/admin/categories'],
      [() => a.updateCategory('c', { sort: 1 }), 'PATCH', '/v1/admin/categories/c'],
      [() => a.deleteCategory('c'), 'DELETE', '/v1/admin/categories/c'],
      [() => a.listWebhooks(), 'GET', '/v1/admin/webhooks'],
      [() => a.createWebhook({ url: 'https://h', events: ['post.created'] }), 'POST', '/v1/admin/webhooks'],
      [() => a.deleteWebhook('w'), 'DELETE', '/v1/admin/webhooks/w'],
      [() => a.getSettings(), 'GET', '/v1/admin/settings'],
      [() => a.updateSettings({ autoApprove: true }), 'PATCH', '/v1/admin/settings'],
    ];
    for (const [i, [run, method, path]] of calls.entries()) {
      await run();
      expect([r.call(i).method, r.call(i).url]).toEqual([method, `https://x${path}`]);
    }
  });

  it('maps dashboard calls to their routes', async () => {
    const r = recorder(() => new Response(null, { status: 204 }));
    const d = createAdminClient({ baseUrl: 'https://x', fetch: r.fetch }).dashboard;
    const calls: [() => Promise<unknown>, string, string, string?][] = [
      [() => d.login('pw'), 'POST', '/v1/dashboard/login', '{"password":"pw"}'],
      [() => d.logout(), 'POST', '/v1/dashboard/logout'],
      [() => d.me(), 'GET', '/v1/dashboard/me'],
      [() => d.listProjects(), 'GET', '/v1/dashboard/projects'],
      [() => d.createProject({ name: 'App' }), 'POST', '/v1/dashboard/projects', '{"name":"App"}'],
      [() => d.updateProject('p', { slug: 's' }), 'PATCH', '/v1/dashboard/projects/p'],
      [() => d.deleteProject('p'), 'DELETE', '/v1/dashboard/projects/p'],
      [() => d.getSecrets('p'), 'GET', '/v1/dashboard/projects/p/secrets'],
      [() => d.rotateKey('p', 'signing'), 'POST', '/v1/dashboard/projects/p/rotate', '{"key":"signing"}'],
    ];
    for (const [i, [run, method, path, body]] of calls.entries()) {
      await run();
      expect([r.call(i).method, r.call(i).url]).toEqual([method, `https://x${path}`]);
      if (body) expect(r.call(i).body).toBe(body);
    }
  });

  it('throws FeedbackApiError with the server error code', async () => {
    const r = recorder(() => new Response('{"error":"slug_taken","message":"Taken"}', { status: 409 }));
    const client = createAdminClient({ baseUrl: 'https://x', fetch: r.fetch });
    const err = await client.dashboard.createProject({ name: 'Dup' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FeedbackApiError);
    expect(err).toMatchObject({ status: 409, code: 'slug_taken', message: 'Taken' });
  });
});
