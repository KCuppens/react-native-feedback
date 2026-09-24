import { FEEDBACK_EVENT_TYPES, MODERATION_STATES, POST_STATUSES, type Moderation, type PostStatus } from '@kobecuppens/feedback-core';
import { Hono, type Context } from 'hono';
import type { AppEnv, WebhookRow } from '../env';
import { adminActor, adminAuth, getViewer, requireFullAdmin } from '../auth';
import { dispatchEvent, prepareEvent, toWebhookConfig, type PendingEvent } from '../events';
import {
  attachmentKeysQuery,
  commentFromResults,
  commentWriteBatch,
  getPost,
  listComments,
  listPosts,
  listFilters,
  postFromResults,
  postQueries,
  publicPost,
  recountComments,
  recountVotes,
  type PostRecord,
} from '../posts';
import { LIMITS, patchSettings, validateSettingsPatch } from '../projects';
import {
  assertCategory,
  ctxOf,
  deleteFilesInBackground,
  fail,
  newId,
  now,
  originOf,
  parseCursor,
  parseLimit,
  randomToken,
  readJson,
  str,
} from '../util';
import { loadCategories } from './public';

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use('*', adminAuth);

/**
 * The in-app admin's own user id (their vote and ownership come back with each post, and
 * events record them as the actor); null for the dashboard and the admin API.
 */
async function moderatorId(c: Context<AppEnv>): Promise<string | null> {
  return c.get('adminLevel') === 'moderator' ? ((await getViewer(c))?.id ?? null) : null;
}

async function loadPost(c: Context<AppEnv>, id: string): Promise<PostRecord> {
  // In-app admins get their own vote/ownership back, since the widget caches this response.
  const viewerId = await moderatorId(c);
  const post = await getPost(c.env, originOf(c), c.get('project').id, id, viewerId);
  if (!post) fail(404, 'post_not_found');
  return post;
}

/**
 * Run a write batch with the post's read-back appended, so the response costs no extra
 * D1 round trip. `results` keeps the write statements' results at their usual indexes.
 */
async function writeAndReload(c: Context<AppEnv>, statements: D1PreparedStatement[], postId: string) {
  const viewerId = await moderatorId(c);
  const results = await c.env.DB.batch([...statements, ...postQueries(c.env, c.get('project').id, postId, viewerId)]);
  const post = postFromResults(originOf(c), viewerId, results);
  return { results, post: post && publicPost(post) };
}

/** A post that was just updated is gone only if it was deleted concurrently. */
function found<T>(post: T | null): T {
  if (!post) fail(404, 'post_not_found');
  return post;
}

/** Batched right after a guarded UPDATE: the event is only recorded if that statement changed a row. */
const PREVIOUS_CHANGED = { sql: 'changes() > 0', params: [] };

/** An outbox row for an admin action; batch its statement with the change, then dispatch. */
async function adminEvent(
  c: Context<AppEnv>,
  type: (typeof FEEDBACK_EVENT_TYPES)[number],
  postId: string,
  data?: Record<string, unknown>,
  onlyIf?: { sql: string; params: (string | number)[] },
): Promise<PendingEvent> {
  const actorId = await moderatorId(c);
  return prepareEvent(c.env, { projectId: c.get('project').id, type, postId, actorId, data, origin: originOf(c) }, onlyIf);
}

const dispatch = (c: Context<AppEnv>, event: PendingEvent) => dispatchEvent(c.env, ctxOf(c), event.id);

adminRoutes.get('/posts', async (c) => {
  const raw = c.req.query('moderation');
  const moderation: Moderation | 'all' = (MODERATION_STATES as readonly string[]).includes(raw ?? '') ? (raw as Moderation) : 'all';
  const page = await listPosts(c.env, originOf(c), {
    projectId: c.get('project').id,
    viewerId: null,
    visibility: { kind: 'byModeration', moderation },
    ...listFilters((name) => c.req.query(name)),
    includeMerged: c.req.query('merged') === '1',
    limit: parseLimit(c.req.query('limit'), 50, 100),
  });
  return c.json({ items: page.items.map(publicPost), nextCursor: page.nextCursor });
});

adminRoutes.get('/queue', async (c) => {
  const page = await listPosts(c.env, originOf(c), {
    projectId: c.get('project').id,
    viewerId: null,
    visibility: { kind: 'byModeration', moderation: 'pending' },
    sort: 'new',
    offset: parseCursor(c.req.query('cursor')),
    limit: parseLimit(c.req.query('limit'), 50, 100),
  });
  return c.json({ items: page.items.map(publicPost), nextCursor: page.nextCursor });
});

adminRoutes.get('/posts/:id', async (c) => c.json(publicPost(await loadPost(c, c.req.param('id')))));

adminRoutes.post('/posts/:id/approve', async (c) => {
  const post = await loadPost(c, c.req.param('id'));
  if (post.moderation === 'approved') return c.json(publicPost(post));
  const ts = now();
  // Guarded so two concurrent approvals record (and email) the change once.
  const event = await adminEvent(c, 'post.approved', post.id, undefined, PREVIOUS_CHANGED);
  const { results, post: updated } = await writeAndReload(
    c,
    [
      c.env.DB.prepare(
        "UPDATE posts SET moderation = 'approved', decline_reason = NULL, moderated_at = ?, updated_at = ? WHERE id = ? AND moderation != 'approved'",
      ).bind(ts, ts, post.id),
      event.statement,
    ],
    post.id,
  );
  if (results[0]?.meta.changes) await dispatch(c, event);
  return c.json(found(updated));
});

adminRoutes.post('/posts/:id/decline', async (c) => {
  const post = await loadPost(c, c.req.param('id'));
  const body = await readJson(c.req.raw);
  const reason = str(body, 'reason', { max: LIMITS.declineReasonMax, optional: true, nullable: true }) || null;
  const ts = now();
  // Editing the reason of an already declined post is silent; only the transition to
  // declined records an event, so duplicate declines email the author once.
  const event = await adminEvent(c, 'post.declined', post.id, { reason }, PREVIOUS_CHANGED);
  const { results, post: updated } = await writeAndReload(
    c,
    [
      c.env.DB.prepare("UPDATE posts SET decline_reason = ?, updated_at = ? WHERE id = ? AND moderation = 'declined'").bind(
        reason,
        ts,
        post.id,
      ),
      c.env.DB.prepare(
        "UPDATE posts SET moderation = 'declined', decline_reason = ?, moderated_at = ?, updated_at = ? WHERE id = ? AND moderation != 'declined'",
      ).bind(reason, ts, ts, post.id),
      event.statement,
    ],
    post.id,
  );
  if (results[1]?.meta.changes) await dispatch(c, event);
  return c.json(found(updated));
});

adminRoutes.patch('/posts/:id', async (c) => {
  const post = await loadPost(c, c.req.param('id'));
  const body = await readJson(c.req.raw);
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  const ts = now();

  let newStatus: PostStatus | null = null;
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !(POST_STATUSES as readonly string[]).includes(body.status)) {
      fail(400, 'invalid_input', 'unknown status');
    }
    if (body.status !== post.status) newStatus = body.status as PostStatus;
  }
  if (body.categoryId !== undefined) {
    // A blank string clears the category rather than failing the foreign key.
    const categoryId = str(body, 'categoryId', { max: LIMITS.idMax, nullable: true }) || null;
    if (categoryId) await assertCategory(c, categoryId);
    sets.push('category_id = ?');
    params.push(categoryId);
  }
  const title = str(body, 'title', { min: LIMITS.titleMin, max: LIMITS.titleMax, optional: true });
  if (title !== undefined) {
    sets.push('title = ?');
    params.push(title);
  }
  const text = str(body, 'body', { max: LIMITS.bodyMax, optional: true });
  if (text !== undefined) {
    sets.push('body = ?');
    params.push(text);
  }
  // The status change is its own guarded statement, so concurrent identical changes emit once.
  const event = newStatus ? await adminEvent(c, 'post.status_changed', post.id, { previousStatus: post.status }, PREVIOUS_CHANGED) : null;
  const fieldUpdate = sets.length
    ? c.env.DB.prepare(`UPDATE posts SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...params, ts, post.id)
    : null;
  const statusUpdate = newStatus
    ? c.env.DB.prepare('UPDATE posts SET status = ?, status_changed_at = ?, updated_at = ? WHERE id = ? AND status != ?').bind(
        newStatus,
        ts,
        ts,
        post.id,
        newStatus,
      )
    : null;
  // The event must directly follow the status UPDATE (its guard reads changes()).
  const statements = [fieldUpdate, statusUpdate, event?.statement].filter((s): s is D1PreparedStatement => s != null);
  const { results, post: updated } = await writeAndReload(c, statements, post.id);
  if (event && statusUpdate && results[statements.indexOf(statusUpdate)]?.meta.changes) await dispatch(c, event);
  return c.json(found(updated));
});

adminRoutes.delete('/posts/:id', async (c) => {
  const post = await loadPost(c, c.req.param('id'));
  // Duplicates merged into this post go with it: their votes already live here, and
  // ON DELETE SET NULL would otherwise put them back on the board. The file keys, the
  // duplicates and the event's mergedIds are all resolved inside the batch, so a merge
  // landing meanwhile is included. The event is only recorded while the post still exists,
  // so a concurrent duplicate delete notifies once.
  const event = await adminEvent(
    c,
    'post.deleted',
    post.id,
    { snapshot: publicPost(post), mergedIds: [] },
    {
      sql: 'EXISTS (SELECT 1 FROM posts WHERE id = ?)',
      params: [post.id],
    },
  );
  const [files, , , , deleted] = await c.env.DB.batch([
    attachmentKeysQuery(c.env, post.id),
    event.statement,
    c.env.DB.prepare(
      `UPDATE events SET payload = json_set(payload, '$.mergedIds', json((SELECT json_group_array(id) FROM posts WHERE merged_into_id = ?)))
       WHERE id = ?`,
    ).bind(post.id, event.id),
    c.env.DB.prepare('DELETE FROM posts WHERE merged_into_id = ?').bind(post.id),
    c.env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(post.id),
  ]);
  if (deleted?.meta.changes) await dispatch(c, event);
  const keys = ((files?.results ?? []) as { r2_key: string }[]).map((r) => r.r2_key);
  deleteFilesInBackground(c, keys, `post ${post.id}`);
  return c.body(null, 204);
});

adminRoutes.post('/posts/:id/merge', async (c) => {
  const body = await readJson(c.req.raw);
  const intoId = str(body, 'intoId', { min: 1, max: LIMITS.idMax })!;
  if (intoId === c.req.param('id')) fail(400, 'invalid_input', 'cannot merge a post into itself');
  const [source, target] = await Promise.all([loadPost(c, c.req.param('id')), loadPost(c, intoId)]);
  if (target.mergedIntoId) fail(400, 'invalid_input', 'target is itself merged');
  const ts = now();
  // One transaction. The claim re-checks both sides in SQL (two concurrent merges A→B and
  // B→A would otherwise both pass the checks above and form a cycle; a deleted target fails
  // it too). The event row is only written if the claim changed a row, and every later
  // statement requires that row, so a failure part-way leaves nothing half-merged and a lost
  // race changes nothing.
  const event = await adminEvent(c, 'post.merged', source.id, { intoId: target.id }, PREVIOUS_CHANGED);
  const claimedByUs = { sql: 'EXISTS (SELECT 1 FROM events WHERE id = ?)', params: [event.id] };
  const { results, post: merged } = await writeAndReload(
    c,
    [
      c.env.DB.prepare(
        `UPDATE posts SET merged_into_id = ?1, status = 'closed', status_changed_at = ?2, updated_at = ?2
       WHERE id = ?3 AND merged_into_id IS NULL AND EXISTS (SELECT 1 FROM posts WHERE id = ?1 AND merged_into_id IS NULL)`,
      ).bind(target.id, ts, source.id),
      event.statement,
      // Carry supporters over; users who already voted on the target keep their vote.
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO votes (post_id, user_id, value, created_at)
       SELECT ?, user_id, value, created_at FROM votes WHERE post_id = ? AND ${claimedByUs.sql}`,
      ).bind(target.id, source.id, ...claimedByUs.params),
      recountVotes(c.env, target.id),
      c.env.DB.prepare(`UPDATE posts SET merged_into_id = ? WHERE merged_into_id = ? AND ${claimedByUs.sql}`).bind(
        target.id,
        source.id,
        ...claimedByUs.params,
      ),
    ],
    target.id,
  );
  if (!results[0]?.meta.changes) fail(409, 'merge_conflict', 'One of these posts was merged or deleted in the meantime.');
  await dispatch(c, event);
  return c.json(found(merged));
});

adminRoutes.get('/posts/:id/comments', async (c) => {
  const post = await loadPost(c, c.req.param('id'));
  return c.json(
    await listComments(c.env, originOf(c), post.id, parseCursor(c.req.query('cursor')), parseLimit(c.req.query('limit'), 100, 200)),
  );
});

adminRoutes.post('/posts/:id/comments', async (c) => {
  const post = await loadPost(c, c.req.param('id'));
  const body = await readJson(c.req.raw);
  const text = str(body, 'body', { min: 1, max: LIMITS.commentMax })!;
  const actor = await adminActor(c);
  const id = newId();
  const ts = now();
  const event = await adminEvent(c, 'comment.created', post.id, { commentId: id, body: text, isOfficial: true });
  const results = await c.env.DB.batch(
    commentWriteBatch(c.env, {
      id,
      postId: post.id,
      authorId: actor.id,
      body: text,
      official: true,
      ts,
      claim: null,
      event: event.statement,
    }),
  );
  await dispatch(c, event);
  return c.json(commentFromResults(originOf(c), results), 201);
});

adminRoutes.delete('/posts/:id/comments/:commentId', async (c) => {
  const post = await loadPost(c, c.req.param('id'));
  const result = await c.env.DB.batch([
    c.env.DB.prepare('UPDATE comments SET deleted_at = ? WHERE id = ? AND post_id = ? AND deleted_at IS NULL').bind(
      now(),
      c.req.param('commentId'),
      post.id,
    ),
    recountComments(c.env, post.id),
  ]);
  if (!result[0]?.meta.changes) fail(404, 'comment_not_found');
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// Project configuration: secret key or dashboard only.

const config = new Hono<AppEnv>();
for (const path of ['/categories', '/categories/*', '/webhooks', '/webhooks/*', '/settings']) {
  config.use(path, requireFullAdmin);
}

config.get('/categories', async (c) => c.json(await loadCategories(c)));

config.post('/categories', async (c) => {
  const body = await readJson(c.req.raw);
  const name = str(body, 'name', { min: 1, max: LIMITS.categoryNameMax })!;
  const color = str(body, 'color', { max: LIMITS.categoryColorMax, optional: true, nullable: true }) ?? null;
  const max = await c.env.DB.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM categories WHERE project_id = ?')
    .bind(c.get('project').id)
    .first<{ m: number }>();
  const category = { id: newId(), name, color, sort: (max?.m ?? -1) + 1 };
  await c.env.DB.prepare('INSERT INTO categories (id, project_id, name, color, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(category.id, c.get('project').id, name, color, category.sort, now())
    .run();
  return c.json(category, 201);
});

config.patch('/categories/:id', async (c) => {
  const body = await readJson(c.req.raw);
  const name = str(body, 'name', { min: 1, max: LIMITS.categoryNameMax, optional: true });
  const color = str(body, 'color', { max: LIMITS.categoryColorMax, optional: true, nullable: true });
  const sort = body.sort;
  if (sort !== undefined && (typeof sort !== 'number' || !Number.isInteger(sort))) fail(400, 'invalid_input', 'sort must be an integer');
  const existing = await c.env.DB.prepare('SELECT id, name, color, sort FROM categories WHERE id = ? AND project_id = ?')
    .bind(c.req.param('id'), c.get('project').id)
    .first<{ id: string; name: string; color: string | null; sort: number }>();
  if (!existing) fail(404, 'category_not_found');
  const next = {
    ...existing,
    ...(name !== undefined ? { name: name! } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(sort !== undefined ? { sort: sort as number } : {}),
  };
  await c.env.DB.prepare('UPDATE categories SET name = ?, color = ?, sort = ? WHERE id = ?')
    .bind(next.name, next.color, next.sort, existing.id)
    .run();
  return c.json(next);
});

config.delete('/categories/:id', async (c) => {
  const res = await c.env.DB.prepare('DELETE FROM categories WHERE id = ? AND project_id = ?')
    .bind(c.req.param('id'), c.get('project').id)
    .run();
  if (!res.meta.changes) fail(404, 'category_not_found');
  return c.body(null, 204);
});

config.get('/webhooks', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM webhooks WHERE project_id = ? ORDER BY created_at')
    .bind(c.get('project').id)
    .all<WebhookRow>();
  return c.json(results.map(toWebhookConfig));
});

config.post('/webhooks', async (c) => {
  const body = await readJson(c.req.raw);
  const url = str(body, 'url', { min: 8, max: 2000 })!;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail(400, 'invalid_input', 'url must be a valid URL');
  }
  if (parsed.protocol !== 'https:' && c.env.ENVIRONMENT === 'production') fail(400, 'invalid_input', 'webhook url must be https');
  const events = body.events;
  if (!Array.isArray(events) || events.length === 0 || events.some((e) => !(FEEDBACK_EVENT_TYPES as readonly unknown[]).includes(e))) {
    fail(400, 'invalid_input', `events must be a non-empty subset of ${FEEDBACK_EVENT_TYPES.join(', ')}`);
  }
  const row = {
    id: newId(),
    url,
    secret: `whsec_${randomToken(32)}`,
    events: JSON.stringify([...new Set(events)]),
    created_at: now(),
  };
  // The count check is part of the insert, so concurrent creates cannot overshoot the cap.
  const inserted = await c.env.DB.prepare(
    `INSERT INTO webhooks (id, project_id, url, secret, events, created_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE (SELECT COUNT(*) FROM webhooks WHERE project_id = ?2) < ?7`,
  )
    .bind(row.id, c.get('project').id, row.url, row.secret, row.events, row.created_at, LIMITS.webhooksPerProject)
    .run();
  if (!inserted.meta.changes) {
    fail(400, 'too_many_webhooks', `A project can have at most ${LIMITS.webhooksPerProject} webhooks. Remove one first.`);
  }
  return c.json(toWebhookConfig(row), 201);
});

config.delete('/webhooks/:id', async (c) => {
  const res = await c.env.DB.prepare('DELETE FROM webhooks WHERE id = ? AND project_id = ?')
    .bind(c.req.param('id'), c.get('project').id)
    .run();
  if (!res.meta.changes) fail(404, 'webhook_not_found');
  return c.body(null, 204);
});

config.get('/settings', (c) => c.json(c.get('project').settings));

config.patch('/settings', async (c) => {
  const patch = validateSettingsPatch(await readJson(c.req.raw));
  return c.json(await patchSettings(c.env, c.get('project').id, patch));
});

adminRoutes.route('/', config);
