import type { Env } from './env';
import { processEvent } from './events';

const DAY = 86_400_000;
const BATCH = 500;

/**
 * Hourly cron: redeliver stuck events, then clean up uploads, the event outbox and
 * rate-limit counters. Each step is isolated so one failure cannot block the others.
 */
export async function runMaintenance(env: Env, now = Date.now()): Promise<void> {
  const started = Date.now();
  const summary: Record<string, number | string> = {};
  const steps: [string, () => Promise<number>][] = [
    ['redelivered', () => redeliverStuckEvents(env, now - 5 * 60_000)],
    ['deletedUploads', () => deleteUnclaimedUploads(env, now - DAY)],
    [
      'pruned',
      async () => {
        const [events, limits] = await env.DB.batch([
          env.DB.prepare('DELETE FROM events WHERE processed_at IS NOT NULL AND processed_at < ?').bind(now - 30 * DAY),
          env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(now - DAY),
        ]);
        return (events?.meta.changes ?? 0) + (limits?.meta.changes ?? 0);
      },
    ],
  ];
  for (const [name, run] of steps) {
    try {
      summary[name] = await run();
    } catch (error) {
      summary[name] = 'failed';
      console.error(JSON.stringify({ msg: 'maintenance step failed', step: name, error: String(error) }));
    }
  }
  console.log(JSON.stringify({ msg: 'maintenance', ...summary, durationMs: Date.now() - started }));
}

/** Uploads that were never attached to a post or comment within a day. */
async function deleteUnclaimedUploads(env: Env, before: number): Promise<number> {
  let deleted = 0;
  for (;;) {
    const { results } = await env.DB.prepare(
      'SELECT id, r2_key FROM attachments WHERE post_id IS NULL AND created_at < ? LIMIT ?',
    )
      .bind(before, BATCH)
      .all<{ id: string; r2_key: string }>();
    if (results.length === 0) return deleted;
    await env.FILES.delete(results.map((r) => r.r2_key));
    await env.DB.batch(results.map((r) => env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(r.id)));
    deleted += results.length;
    if (results.length < BATCH) return deleted;
  }
}

/** Events whose queue send failed (see emitEvent) or whose consumer died before claiming them. */
async function redeliverStuckEvents(env: Env, before: number): Promise<number> {
  const { results } = await env.DB.prepare(
    'SELECT id FROM events WHERE processed_at IS NULL AND created_at < ? ORDER BY created_at LIMIT ?',
  )
    .bind(before, BATCH)
    .all<{ id: string }>();
  for (const { id } of results) {
    try {
      await processEvent(env, id);
    } catch (error) {
      console.error(JSON.stringify({ msg: 'event redelivery failed', eventId: id, error: String(error) }));
    }
  }
  return results.length;
}
