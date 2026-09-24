import { beforeEach, describe, expect, it } from 'vitest';
import { createLimiter } from '../src/util';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});

const plan = (sql: string, ...params: (string | number)[]) =>
  (h.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]).map((p) => p.detail).join(' | ');

describe('query limits, indexes, sessions and webhook caps', () => {
  it('dedupes status filters so a long repeated list cannot exceed the parameter cap', async () => {
    const status = Array.from({ length: 150 }, () => 'open').join(',');
    const res = await h.request(`/v1/posts?status=${status}`, { headers: await h.as({ user: 'alice' }) });
    expect(res.status).toBe(200);
  });

  it('never runs more tasks at once than the limit', async () => {
    const limit = createLimiter(3);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 10 }, () =>
        limit(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active--;
        }),
      ),
    );
    expect(peak).toBe(3);
  });

  it('serves the hourly prunes and the delete cascade checks from indexes', () => {
    expect(
      plan('DELETE FROM events WHERE created_at < ?1 AND (processed_at < ?1 OR (processed_at IS NULL AND attempts > 3))', 0),
    ).toContain('events_created');
    expect(plan('DELETE FROM rate_limits WHERE window_start < ?', 0)).toContain('rate_limits_window');
    expect(plan('SELECT 1 FROM comments WHERE author_id = ?', 'u')).toContain('comments_author');
    expect(plan('SELECT 1 FROM attachments WHERE uploader_id = ?', 'u')).toContain('attachments_uploader');
  });

  it('accepts only an untampered, unexpired session signed for the current password', async () => {
    const { createSessionCookieValue, SESSION_TTL_SECONDS } = await import('../src/auth');
    const me = (cookie: string) => h.request('/v1/dashboard/me', { headers: { Cookie: `fb_session=${cookie}` } });
    const good = await createSessionCookieValue(h.env);
    expect((await me(good)).status).toBe(200);

    const [v, iat, pwv, sig] = good.split('.') as [string, string, string, string];
    expect((await me(`${v}.${Number(iat) + 1}.${pwv}.${sig}`)).status).toBe(401);
    expect((await me(`${v}.${iat}.${pwv}.${sig.replace(/.$/, (ch) => (ch === '0' ? '1' : '0'))}`)).status).toBe(401);
    expect((await me('not-a-session')).status).toBe(401);

    const old = await createSessionCookieValue(h.env, Date.now() - (SESSION_TTL_SECONDS + 60) * 1000);
    expect((await me(old)).status).toBe(401);

    h.env.ADMIN_PASSWORD = 'a brand new password';
    expect((await me(good)).status).toBe(401);
  });

  it('caps webhooks per project', async () => {
    const admin = { Authorization: `Bearer ${h.project.secretKey}` };
    const create = () =>
      h.request('/v1/admin/webhooks', { method: 'POST', headers: admin, json: { url: 'https://hooks.test/x', events: ['post.created'] } });
    for (let i = 0; i < 10; i++) expect((await create()).status).toBe(201);
    const res = await create();
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'too_many_webhooks' });
  });

  it('lists updates on posts the viewer wrote or voted on', async () => {
    h.setSettings({ autoApprove: true });
    const alice = await h.as({ user: 'alice' });
    const bob = await h.as({ user: 'bob' });
    const mk = async (title: string, headers: Record<string, string>) =>
      (await (await h.request('/v1/posts', { method: 'POST', headers, json: { title } })).json()) as { id: string };
    const own = await mk('Alice idea', alice);
    const voted = await mk('Bob idea', bob);
    await mk('Unrelated', bob);
    await h.request(`/v1/posts/${voted.id}/vote`, { method: 'POST', headers: alice, json: { value: 1 } });
    const admin = { Authorization: `Bearer ${h.project.secretKey}` };
    for (const id of [own.id, voted.id]) {
      await h.request(`/v1/admin/posts/${id}`, { method: 'PATCH', headers: admin, json: { status: 'planned' } });
    }
    const updates = (await (await h.request('/v1/me/updates', { headers: alice })).json()) as { items: { post: { title: string } }[] };
    expect(new Set(updates.items.map((i) => i.post.title))).toEqual(new Set(['Alice idea', 'Bob idea']));
  });
});
