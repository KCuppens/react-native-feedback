import type { Env } from './env';
import { processEvent } from './events';
import { log } from './util';

const DAY = 86_400_000;
const BATCH = 500;
/** Sweep redeliveries per event before it is dead-lettered (kept in sync with the partial index). */
const MAX_SWEEP_ATTEMPTS = 3;
/** Without a queue each event is delivered inline, so keep the cron's work bounded. */
const INLINE_BATCH = 25;

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
          env.DB.prepare(
            'DELETE FROM events WHERE (processed_at IS NOT NULL AND processed_at < ?1) OR (processed_at IS NULL AND attempts >= ?2 AND created_at < ?1)',
          ).bind(now - 30 * DAY, MAX_SWEEP_ATTEMPTS),
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
      log('error', 'maintenance step failed', { step: name, error: String(error) });
    }
  }
  log('info', 'maintenance', { ...summary, durationMs: Date.now() - started });
}

/** Uploads that were never attached to a post or comment within a day. */
async function deleteUnclaimedUploads(env: Env, before: number): Promise<number> {
  let deleted = 0;
  for (;;) {
    // Delete the rows first, re-checking they are still unclaimed, and only then the files:
    // an upload attached to a post in the meantime keeps both.
    const { results } = await env.DB.prepare(
      `DELETE FROM attachments
       WHERE id IN (SELECT id FROM attachments WHERE post_id IS NULL AND created_at < ?1 LIMIT ?2) AND post_id IS NULL
       RETURNING r2_key`,
    )
      .bind(before, BATCH)
      .all<{ r2_key: string }>();
    if (results.length === 0) return deleted;
    await env.FILES.delete(results.map((r) => r.r2_key));
    deleted += results.length;
    if (results.length < BATCH) return deleted;
  }
}

/**
 * Events whose queue send failed (see dispatchEvent) or whose consumer died before claiming
 * them. With a queue they are re-enqueued, so delivery gets the queue's parallelism, backoff
 * and dead-letter handling instead of running inside the cron's time budget.
 */
async function redeliverStuckEvents(env: Env, before: number): Promise<number> {
  // Count the attempt before redelivering, so an event that keeps failing is given up on
  // (dead-lettered) instead of crowding out newer stuck events every hour.
  const { results } = await env.DB.prepare(
    `UPDATE events SET attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM events WHERE processed_at IS NULL AND attempts < ?1 AND created_at < ?2 ORDER BY created_at LIMIT ?3
     )
     RETURNING id, attempts, type, project_id`,
  )
    .bind(MAX_SWEEP_ATTEMPTS, before, env.EVENTS ? BATCH : INLINE_BATCH)
    .all<{ id: string; attempts: number; type: string; project_id: string }>();
  for (const row of results) {
    if (row.attempts === MAX_SWEEP_ATTEMPTS) {
      log('warn', 'event dead-lettered after final sweep attempt', { eventId: row.id, type: row.type, projectId: row.project_id });
    }
  }
  if (env.EVENTS) {
    for (let i = 0; i < results.length; i += 100) {
      await env.EVENTS.sendBatch(results.slice(i, i + 100).map(({ id }) => ({ body: { eventId: id } })));
    }
    return results.length;
  }
  for (const { id } of results) {
    try {
      await processEvent(env, id);
    } catch (error) {
      log('error', 'event redelivery failed', { eventId: id, error: String(error) });
    }
  }
  return results.length;
}
