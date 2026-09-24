import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(() => vi.restoreAllMocks());

/** Swallow the worker's JSON log lines and return them parsed, for assertions. */
function captureLogs(): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = [];
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void lines.push(JSON.parse(String(args[0]))));
  }
  return lines;
}

/**
 * Run `race` once, right before the route's write batch executes (after its reads). The
 * write batch is the one that records an outbox event; returns a check that it did run.
 */
function beforeWriteBatch(race: () => void): () => boolean {
  const DB = h.env.DB;
  let fired = false;
  h.env.DB = new Proxy(DB, {
    get(target, prop) {
      if (prop !== 'batch') return Reflect.get(target, prop);
      return (stmts: D1PreparedStatement[]) => {
        if (!stmts.some((stmt) => /INSERT INTO events/.test((stmt as unknown as { sql: string }).sql))) return target.batch(stmts);
        h.env.DB = DB;
        fired = true;
        race();
        return target.batch(stmts);
      };
    },
  });
  return () => fired;
}

describe('moderation races and outbox sweep', () => {
  it('records a decline once and edits the reason silently afterwards', async () => {
    const post = await h.createPost({ user: 'alice', email: 'a@x.io' }, 'Nope');
    h.emails.length = 0;
    const decline = (reason: string) =>
      h.request(`/v1/admin/posts/${post.id}/decline`, { method: 'POST', headers: h.admin(), json: { reason } });
    await Promise.all([decline('Duplicate'), decline('Duplicate')]);
    expect(h.eventCount('post.declined')).toBe(1);
    expect(h.emails).toHaveLength(1);

    await decline('Out of scope');
    expect(h.eventCount('post.declined')).toBe(1);
    expect(h.db.prepare('SELECT decline_reason FROM posts WHERE id = ?').get(post.id)).toEqual({ decline_reason: 'Out of scope' });
  });

  it('refuses to merge into a post deleted after the checks', async () => {
    h.setSettings({ autoApprove: true });
    const a = await h.createPost({ user: 'alice' }, 'Post A');
    const b = await h.createPost({ user: 'bob' }, 'Post B');
    // Delete the target between the route's read and its batch.
    const raced = beforeWriteBatch(() => h.db.prepare('DELETE FROM posts WHERE id = ?').run(b.id));
    const res = await h.request(`/v1/admin/posts/${a.id}/merge`, { method: 'POST', headers: h.admin(), json: { intoId: b.id } });
    expect(raced()).toBe(true);
    expect(res.status).toBe(409);
    expect(h.db.prepare('SELECT merged_into_id FROM posts WHERE id = ?').get(a.id)).toEqual({ merged_into_id: null });
    expect(h.eventCount('post.merged')).toBe(0);
  });

  it('deletes duplicates merged in after the delete route read them', async () => {
    h.setSettings({ autoApprove: true });
    const target = await h.createPost({ user: 'alice' }, 'Target');
    const late = await h.createPost({ user: 'bob' }, 'Late duplicate');
    const raced = beforeWriteBatch(() => h.db.prepare('UPDATE posts SET merged_into_id = ? WHERE id = ?').run(target.id, late.id));
    const res = await h.request(`/v1/admin/posts/${target.id}`, { method: 'DELETE', headers: h.admin() });
    expect(raced()).toBe(true);
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
    const target = await h.createPost({ user: 'alice' }, 'Target');
    const late = await h.createPost({ user: 'bob' }, 'Late duplicate');
    const raced = beforeWriteBatch(() => h.db.prepare('UPDATE posts SET merged_into_id = ? WHERE id = ?').run(target.id, late.id));
    const remove = () => h.request(`/v1/admin/posts/${target.id}`, { method: 'DELETE', headers: h.admin() });
    const statuses = (await Promise.all([remove(), remove()])).map((r) => r.status);
    expect(raced()).toBe(true);
    expect(statuses.filter((s) => s === 204).length).toBeGreaterThanOrEqual(1);
    const events = h.db.prepare("SELECT payload FROM events WHERE type = 'post.deleted'").all() as { payload: string }[];
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]!.payload).mergedIds).toEqual([late.id]);
  });

  it('reports dead-lettered and failed re-enqueues in the maintenance summary', async () => {
    const { runMaintenance } = await import('../src/maintenance');
    const logs = captureLogs();
    h.db
      .prepare("INSERT INTO events (id, project_id, type, payload, created_at, attempts) VALUES ('dead', ?, 'post.created', '{}', 0, 3)")
      .run(h.project.id);
    await runMaintenance({ ...h.env, EVENTS: undefined });
    expect(logs.find((l) => l.msg === 'maintenance')).toMatchObject({ redelivered: 0, deadLettered: 1, redeliveryFailed: 0 });
  });

  it('counts failed inline redeliveries in the maintenance summary', async () => {
    const { runMaintenance } = await import('../src/maintenance');
    const logs = captureLogs();
    // An unreadable payload makes the inline delivery fail.
    h.db
      .prepare("INSERT INTO events (id, project_id, type, payload, created_at) VALUES ('e1', ?, 'post.created', 'not json', 0)")
      .run(h.project.id);
    await runMaintenance({ ...h.env, EVENTS: undefined });
    expect(logs.find((l) => l.msg === 'maintenance')).toMatchObject({ redelivered: 0, redeliveryFailed: 1 });
  });
});
