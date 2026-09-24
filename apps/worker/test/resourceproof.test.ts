import { beforeEach, describe, expect, it } from 'vitest';
import { createLimiter } from '../src/util';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});

const plan = (sql: string, ...params: (string | number)[]) =>
  (h.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]).map((p) => p.detail).join(' | ');

describe('resourceproof', () => {
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
    expect(plan('DELETE FROM events WHERE created_at < ?1 AND (processed_at < ?1 OR (processed_at IS NULL AND attempts > 3))', 0)).toContain(
      'events_created',
    );
    expect(plan('DELETE FROM rate_limits WHERE window_start < ?', 0)).toContain('rate_limits_window');
    expect(plan('SELECT 1 FROM comments WHERE author_id = ?', 'u')).toContain('comments_author');
    expect(plan('SELECT 1 FROM attachments WHERE uploader_id = ?', 'u')).toContain('attachments_uploader');
  });
});
