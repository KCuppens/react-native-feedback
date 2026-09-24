import type { Post } from '@kobecuppens/feedback-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});

const admin = () => ({ Authorization: `Bearer ${h.project.secretKey}` });
const eventCount = (type: string) => (h.db.prepare('SELECT COUNT(*) AS n FROM events WHERE type = ?').get(type) as { n: number }).n;
/** Run `race` once, right before the next D1 batch executes (i.e. after the route's reads). */
function beforeBatch(race: () => void) {
  const DB = h.env.DB;
  h.env.DB = new Proxy(DB, {
    get(target, prop) {
      if (prop !== 'batch') return Reflect.get(target, prop);
      return (stmts: D1PreparedStatement[]) => {
        h.env.DB = DB;
        race();
        return target.batch(stmts);
      };
    },
  });
}
const create = async (title: string, user: string, email?: string) =>
  (await (await h.request('/v1/posts', { method: 'POST', headers: await h.as({ user, email }), json: { title } })).json()) as Post;

describe('bulletproof round 3', () => {
  it('records a decline once and edits the reason silently afterwards', async () => {
    const post = await create('Nope', 'alice', 'a@x.io');
    h.emails.length = 0;
    const decline = (reason: string) =>
      h.request(`/v1/admin/posts/${post.id}/decline`, { method: 'POST', headers: admin(), json: { reason } });
    await Promise.all([decline('Duplicate'), decline('Duplicate')]);
    expect(eventCount('post.declined')).toBe(1);
    expect(h.emails).toHaveLength(1);

    await decline('Out of scope');
    expect(eventCount('post.declined')).toBe(1);
    expect(h.db.prepare('SELECT decline_reason FROM posts WHERE id = ?').get(post.id)).toEqual({ decline_reason: 'Out of scope' });
  });

  it('refuses to merge into a post deleted after the checks', async () => {
    h.setSettings({ autoApprove: true });
    const a = await create('Post A', 'alice');
    const b = await create('Post B', 'bob');
    // Delete the target between the route's read and its batch.
    beforeBatch(() => h.db.prepare('DELETE FROM posts WHERE id = ?').run(b.id));
    const res = await h.request(`/v1/admin/posts/${a.id}/merge`, { method: 'POST', headers: admin(), json: { intoId: b.id } });
    expect(res.status).toBe(409);
    expect(h.db.prepare('SELECT merged_into_id FROM posts WHERE id = ?').get(a.id)).toEqual({ merged_into_id: null });
    expect(eventCount('post.merged')).toBe(0);
  });

  it('deletes duplicates merged in after the delete route read them', async () => {
    h.setSettings({ autoApprove: true });
    const target = await create('Target', 'alice');
    const late = await create('Late duplicate', 'bob');
    beforeBatch(() => h.db.prepare('UPDATE posts SET merged_into_id = ? WHERE id = ?').run(target.id, late.id));
    const res = await h.request(`/v1/admin/posts/${target.id}`, { method: 'DELETE', headers: admin() });
    expect(res.status).toBe(204);
    expect(h.db.prepare('SELECT id FROM posts').all()).toEqual([]);
  });

  it('gives the attempt back when the queue refuses a redelivery', async () => {
    const { runMaintenance } = await import('../src/maintenance');
    h = await createHarness({
      EVENTS: {
        send: async () => {},
        sendBatch: async () => {
          throw new Error('queue down');
        },
      } as unknown as Queue<{ eventId: string }>,
    });
    h.db
      .prepare("INSERT INTO events (id, project_id, type, payload, created_at) VALUES ('e1', ?, 'post.created', '{}', ?)")
      .run(h.project.id, Date.now() - 10 * 60_000);
    for (let i = 0; i < 5; i++) await runMaintenance(h.env, Date.now() + i * 3_600_000);
    expect(h.db.prepare("SELECT attempts FROM events WHERE id = 'e1'").get()).toEqual({ attempts: 0 });
  });

  it('lets the sweep use the partial outbox index', () => {
    const plan = h.db
      .prepare(
        'EXPLAIN QUERY PLAN SELECT id FROM events WHERE processed_at IS NULL AND attempts <= 3 AND created_at < ?1 ORDER BY created_at LIMIT ?2',
      )
      .all(0, 10) as { detail: string }[];
    expect(plan.map((p) => p.detail).join(' ')).toContain('events_unprocessed');
  });
});
