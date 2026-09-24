import { FEEDBACK_EVENT_TYPES, POST_STATUSES, type Moderation, type PostStatus } from '@kobecuppens/feedback-core';
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../env';
import { adminActor, adminAuth, getViewer, requireFullAdmin } from '../auth';
import { dispatchEvent, prepareEvent, toWebhookConfig, type PendingEvent } from '../events';
import {
  attachmentKeysForPost,
  getComment,
  getPost,
  listComments,
  listPosts,
  parseSort,
  parseStatuses,
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

async function loadPost(c: Context<AppEnv>, id: string): Promise<PostRecord> {
  // In-app admins get their own vote/ownership back, since the widget caches this response.
  const viewer = c.get('adminLevel') === 'moderator' ? await getViewer(c) : null;
  const post = await getPost(c.env, originOf(c), c.get('project').id, id, viewer?.id ?? null);
  if (!post) fail(404, 'post_not_found');
  return post;
}

const reload = async (c: Context<AppEnv>, id: string) => publicPost(await loadPost(c, id));

/** An outbox row for an admin action; batch its statement with the change, then dispatch. */
async function adminEvent(
  c: Context<AppEnv>,
  type: (typeof FEEDBACK_EVENT_TYPES)[number],
  postId: string,
  data?: Record<string, unknown>,
  onlyIf?: { sql: string; params: (string | number)[] },
): Promise<PendingEvent> {
  const actor = c.get('adminLevel') === 'moderator' ? await getViewer(c) : null;
  return prepareEvent(
    c.env,
    { projectId: c.get('project').id, type, postId, actorId: actor?.id ?? null, data, origin: originOf(c) },
    onlyIf,
  );
}

const dispatch = (c: Context<AppEnv>, event: PendingEvent) => dispatchEvent(c.env, ctxOf(c), event.id);

adminRoutes.get('/posts', async (c) => {
  const raw = c.req.query('moderation');
  const moderation: Moderation | 'all' = raw === 'pending' || raw === 'approved' || raw === 'declined' ? raw : 'all';
  const page = await listPosts(c.env, originOf(c), {
    projectId: c.get('project').id,
    viewerId: null,
    visibility: { kind: 'byModeration', moderation },
    sort: parseSort(c.req.query('sort')),
    statuses: parseStatuses(c.req.query('status')),
    categoryId: c.req.query('category') || undefined,
    q: c.req.query('q')?.trim().slice(0, 100) || undefined,
    includeMerged: c.req.query('merged') === '1',
    offset: parseCursor(c.req.query('cursor')),
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

adminRoutes.get('/posts/:id', async (c) => c.json(await reload(c, c.req.param('id'))));

adminRoutes.post('/posts/:id/approve', async (c) => {
  const post = await loadPost(c, c.req.param('id'));
  if (post.moderation === 'approved') return c.json(publicPost(post));
  const ts = now();
  // Guarded so two concurrent approvals record (and email) the change once.
  const event = await adminEvent(c, 'post.approved', post.id, undefined, {
    sql: "EXISTS (SELECT 1 FROM posts WHERE id = ? AND moderation = 'approved' AND moderated_at = ?)",
    params: [post.id, ts],
  });
  const [approved] = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE posts SET moderation = 'approved', decline_reason = NULL, moderated_at = ?, updated_at = ? WHERE id = ? AND moderation != 'approved'",
    ).bind(ts, ts, post.id),
    event.statement,
  ]);
  if (approved?.meta.changes) await dispatch(c, event);
  return c.json(await reload(c, post.id));
});

adminRoutes.post('/posts/:id/decline', async (c) => {
  const post = await loadPost(c, c.req.param('id'));
  const body = await readJson(c.req.raw);
  const reason = str(body, 'reason', { max: LIMITS.declineReasonMax, optional: true, nullable: true }) || null;
  const ts = now();
  const event = await adminEvent(c, 'post.declined', post.id, { reason });
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE posts SET moderation = 'declined', decline_reason = ?, moderated_at = ?, updated_at = ? WHERE id = ?").bind(
      reason,
      ts,
      ts,
      post.id,
    ),
    event.statement,
  ]);
  await dispatch(c, event);
  return c.json(await reload(c, post.id));
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
    const categoryId = str(body, 'categoryId', { max: 64, nullable: true }) || null;
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
  const event = newStatus
    ? await adminEvent(
        c,
        'post.status_changed',
        post.id,
        { previousStatus: post.status },
        { sql: 'EXISTS (SELECT 1 FROM posts WHERE id = ? AND status = ? AND status_changed_at = ?)', params: [post.id, newStatus, ts] },
      )
    : null;
  const statements = [
    ...(sets.length
      ? [c.env.DB.prepare(`UPDATE posts SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...params, ts, post.id)]
      : []),
    ...(newStatus && event
      ? [
          c.env.DB.prepare('UPDATE posts SET status = ?, status_changed_at = ?, updated_at = ? WHERE id = ? AND status != ?').bind(
            newStatus,
            ts,
            ts,
            post.id,
            newStatus,
          ),
          event.statement,
        ]
      : []),
  ];
  if (statements.length) {
    const results = await c.env.DB.batch(statements);
    const statusResult = results[sets.length ? 1 : 0];
    if (event && statusResult?.meta.changes) await dispatch(c, event);
  }
  return c.json(await reload(c, post.id));
});

adminRoutes.delete('/posts/:id', async (c) => {
  const post = await loadPost(c, c.req.param('id'));
  // Duplicates merged into this post go with it: their votes already live here, and
  // ON DELETE SET NULL would otherwise put them back on the board.
  const { results: merged } = await c.env.DB.prepare('SELECT id FROM posts WHERE merged_into_id = ?').bind(post.id).all<{ id: string }>();
  const ids = [post.id, ...merged.map((m) => m.id)];
  const keys = (await Promise.all(ids.map((id) => attachmentKeysForPost(c.env, id)))).flat();
  const event = await adminEvent(c, 'post.deleted', post.id, { snapshot: publicPost(post), mergedIds: ids.slice(1) });
  await c.env.DB.batch([...ids.map((id) => c.env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id)), event.statement]);
  await dispatch(c, event);
  deleteFilesInBackground(c, keys, `post ${post.id}`);
  return c.body(null, 204);
});

adminRoutes.post('/posts/:id/merge', async (c) => {
  const source = await loadPost(c, c.req.param('id'));
  const body = await readJson(c.req.raw);
  const intoId = str(body, 'intoId', { min: 1, max: 64 })!;
  if (intoId === source.id) fail(400, 'invalid_input', 'cannot merge a post into itself');
  const target = await loadPost(c, intoId);
  if (target.mergedIntoId) fail(400, 'invalid_input', 'target is itself merged');
  const ts = now();
  // One transaction. The claim re-checks both sides in SQL (two concurrent merges A→B and
  // B→A would otherwise both pass the checks above and form a cycle), and every later
  // statement only acts if this request's claim took effect, so a failure part-way leaves
  // nothing half-merged and a lost race changes nothing.
  const claimedByUs = {
    sql: 'EXISTS (SELECT 1 FROM posts WHERE id = ? AND merged_into_id = ? AND updated_at = ?)',
    params: [source.id, target.id, ts],
  };
  const event = await adminEvent(c, 'post.merged', source.id, { intoId: target.id }, claimedByUs);
  const [claim] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE posts SET merged_into_id = ?1, status = 'closed', status_changed_at = ?2, updated_at = ?2
       WHERE id = ?3 AND merged_into_id IS NULL AND (SELECT merged_into_id FROM posts WHERE id = ?1) IS NULL`,
    ).bind(target.id, ts, source.id),
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
    event.statement,
  ]);
  if (!claim?.meta.changes) fail(409, 'merge_conflict', 'One of these posts was merged in the meantime.');
  await dispatch(c, event);
  return c.json(await reload(c, target.id));
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
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO comments (id, post_id, author_id, body, is_official, created_at) VALUES (?, ?, ?, ?, 1, ?)').bind(
      id,
      post.id,
      actor.id,
      text,
      ts,
    ),
    recountComments(c.env, post.id),
    c.env.DB.prepare('UPDATE posts SET last_official_reply_at = ? WHERE id = ?').bind(ts, post.id),
    event.statement,
  ]);
  await dispatch(c, event);
  return c.json(await getComment(c.env, originOf(c), id), 201);
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
  const name = str(body, 'name', { min: 1, max: 40 })!;
  const color = str(body, 'color', { max: 32, optional: true, nullable: true }) ?? null;
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
  const name = str(body, 'name', { min: 1, max: 40, optional: true });
  const color = str(body, 'color', { max: 32, optional: true, nullable: true });
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
    .all<{ id: string; url: string; secret: string; events: string; created_at: number }>();
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
  await c.env.DB.prepare('INSERT INTO webhooks (id, project_id, url, secret, events, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(row.id, c.get('project').id, row.url, row.secret, row.events, row.created_at)
    .run();
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
