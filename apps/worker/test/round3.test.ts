import type { Post } from '@kobecuppens/feedback-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});

const admin = () => ({ Authorization: `Bearer ${h.project.secretKey}` });
const eventCount = (type: string) => (h.db.prepare('SELECT COUNT(*) AS n FROM events WHERE type = ?').get(type) as { n: number }).n;
/**
 * Run `race` once, right before the route's write batch executes (i.e. after its reads).
 * Single-post reads are 2-statement batches too (see postQueries), so those are skipped.
 */
function beforeBatch(race: () => void) {
  const DB = h.env.DB;
  h.env.DB = new Proxy(DB, {
    get(target, prop) {
      if (prop !== 'batch') return Reflect.get(target, prop);
      return (stmts: D1PreparedStatement[]) => {
        if (stmts.length <= 2) return target.batch(stmts);
        h.env.DB = DB;
        race();
        return target.batch(stmts);
      };
    },
  });
}
const create = async (title: string, user: string, email?: string) =>
  (await (await h.request('/v1/posts', { method: 'POST', headers: await h.as({ user, email }), json: { title } })).json()) as Post;

describe('moderation races and outbox sweep', () => {
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

  it('records one post.deleted event for concurrent deletes, listing late merges', async () => {
    h.setSettings({ autoApprove: true });
    const target = await create('Target', 'alice');
    const late = await create('Late duplicate', 'bob');
    beforeBatch(() => h.db.prepare('UPDATE posts SET merged_into_id = ? WHERE id = ?').run(target.id, late.id));
    const remove = () => h.request(`/v1/admin/posts/${target.id}`, { method: 'DELETE', headers: admin() });
    const statuses = (await Promise.all([remove(), remove()])).map((r) => r.status);
    expect(statuses.filter((s) => s === 204).length).toBeGreaterThanOrEqual(1);
    const events = h.db.prepare("SELECT payload FROM events WHERE type = 'post.deleted'").all() as { payload: string }[];
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]!.payload).mergedIds).toEqual([late.id]);
  });

  it('reports dead-lettered and failed re-enqueues in the maintenance summary', async () => {
    const { runMaintenance } = await import('../src/maintenance');
    const logs: string[] = [];
    const info = console.log;
    const error = console.error;
    console.log = (line: string) => void logs.push(line);
    console.error = (line: string) => void logs.push(line);
    try {
      h.db
        .prepare("INSERT INTO events (id, project_id, type, payload, created_at, attempts) VALUES ('dead', ?, 'post.created', '{}', 0, 3)")
        .run(h.project.id);
      await runMaintenance({ ...h.env, EVENTS: undefined });
    } finally {
      console.log = info;
      console.error = error;
    }
    const summary = logs.map((l) => JSON.parse(l)).find((l) => l.msg === 'maintenance');
    expect(summary).toMatchObject({ redelivered: 0, deadLettered: 1, redeliveryFailed: 0 });
  });

  it('counts failed inline redeliveries in the maintenance summary', async () => {
    const { runMaintenance } = await import('../src/maintenance');
    const logs: string[] = [];
    const spies = (['log', 'error', 'warn'] as const).map((level) => {
      const original = console[level];
      console[level] = (line: string) => void logs.push(line);
      return () => (console[level] = original);
    });
    try {
      h.db
        .prepare("INSERT INTO events (id, project_id, type, payload, created_at) VALUES ('e1', ?, 'post.created', '{}', 0)")
        .run(h.project.id);
      const broken = {
        ...h.env,
        EVENTS: undefined,
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
      await runMaintenance(broken);
    } finally {
      for (const restore of spies) restore();
    }
    const summary = logs.map((l) => JSON.parse(l)).find((l) => l.msg === 'maintenance');
    expect(summary).toMatchObject({ redelivered: 0, redeliveryFailed: 1 });
  });
});
