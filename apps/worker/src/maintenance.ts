import type { Env } from './env';
import { processEvent } from './events';

const DAY = 86_400_000;
const BATCH = 500;

/** Hourly cron: clean up after uploads, the event outbox and rate-limit counters. */
export async function runMaintenance(env: Env, now = Date.now()): Promise<void> {
  await deleteUnclaimedUploads(env, now - DAY);
  await redeliverStuckEvents(env, now - 5 * 60_000);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM events WHERE processed_at IS NOT NULL AND processed_at < ?').bind(now - 30 * DAY),
    env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(now - DAY),
  ]);
}

/** Uploads that were never attached to a post or comment within a day. */
async function deleteUnclaimedUploads(env: Env, before: number): Promise<void> {
  for (;;) {
    const { results } = await env.DB.prepare(
      'SELECT id, r2_key FROM attachments WHERE post_id IS NULL AND created_at < ? LIMIT ?',
    )
      .bind(before, BATCH)
      .all<{ id: string; r2_key: string }>();
    if (results.length === 0) return;
    await env.FILES.delete(results.map((r) => r.r2_key));
    await env.DB.batch(results.map((r) => env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(r.id)));
    if (results.length < BATCH) return;
  }
}

/** Events whose queue send failed (see emitEvent) or whose consumer died before claiming them. */
async function redeliverStuckEvents(env: Env, before: number): Promise<void> {
  const { results } = await env.DB.prepare(
    'SELECT id FROM events WHERE processed_at IS NULL AND created_at < ? ORDER BY created_at LIMIT ?',
  )
    .bind(before, BATCH)
    .all<{ id: string }>();
  for (const { id } of results) {
    try {
      await processEvent(env, id);
    } catch (error) {
      console.error('event redelivery failed', id, error);
    }
  }
}
