import {
  boardFeatures,
  ROADMAP_STATUSES,
  type BoardConfig,
  type Category,
  type RoadmapColumn,
  type UpdateItem,
  type Updates,
} from '@kobecuppens/feedback-core';
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../env';
import { getViewer, isInAppAdmin, projectAuth, requireViewer } from '../auth';
import { dispatchEvent, prepareEvent } from '../events';
import {
  claimAttachments,
  commentFromResults,
  commentWriteBatch,
  getPost,
  getPostsByIds,
  listComments,
  listPosts,
  listFilters,
  postFromResults,
  postQueries,
  publicPost,
  recountVotes,
  type PostRecord,
} from '../posts';
import { LIMITS } from '../projects';
import {
  assertCategory,
  clientIp,
  ctxOf,
  fail,
  fileUrl,
  newId,
  now,
  originOf,
  overAnyRateLimit,
  parseCursor,
  parseLimit,
  readJson,
  str,
  stringArray,
  type RateLimit,
} from '../util';

export const publicRoutes = new Hono<AppEnv>();

// Explicit paths: a '*' middleware here would also match sibling /v1/* routers once mounted.
for (const path of ['/config', '/posts', '/posts/*', '/uploads', '/roadmap', '/me/*']) {
  publicRoutes.use(path, projectAuth);
}

export async function loadCategories(c: Context<AppEnv>): Promise<Category[]> {
  const { results } = await c.env.DB.prepare('SELECT id, name, color, sort FROM categories WHERE project_id = ? ORDER BY sort, name')
    .bind(c.get('project').id)
    .all<Category>();
  return results;
}

publicRoutes.get('/config', async (c) => {
  const project = c.get('project');
  const identity = c.get('identity');
  const config: BoardConfig = {
    project: { id: project.id, name: project.name, slug: project.slug },
    categories: await loadCategories(c),
    features: boardFeatures(project.settings, !!identity),
    viewer: { identified: !!identity, anonymous: identity?.anonymous ?? false, isAdmin: isInAppAdmin(c) },
    limits: {
      titleMax: LIMITS.titleMax,
      bodyMax: LIMITS.bodyMax,
      commentMax: LIMITS.commentMax,
      attachmentMaxBytes: LIMITS.attachmentMaxBytes,
      attachmentsPerPost: LIMITS.attachmentsPerPost,
      attachmentMimeTypes: [...LIMITS.attachmentMimeTypes],
      titleMin: LIMITS.titleMin,
    },
  };
  return c.json(config);
});

publicRoutes.get('/posts', async (c) => {
  const viewer = await getViewer(c);
  const page = await listPosts(c.env, originOf(c), {
    projectId: c.get('project').id,
    viewerId: viewer?.id ?? null,
    visibility: { kind: 'approvedOrOwn' },
    ...listFilters((name) => c.req.query(name)),
    mine: c.req.query('mine') === '1',
    limit: parseLimit(c.req.query('limit')),
  });
  return c.json({ items: page.items.map(publicPost), nextCursor: page.nextCursor });
});

/** Load a post the viewer is allowed to see, or 404. */
async function visiblePost(c: Context<AppEnv>, postId: string, viewerId: string | null): Promise<PostRecord> {
  const post = await getPost(c.env, originOf(c), c.get('project').id, postId, viewerId);
  if (!post) fail(404, 'post_not_found');
  if (post.moderation !== 'approved' && !post.isMine && !isInAppAdmin(c)) fail(404, 'post_not_found');
  return post;
}

publicRoutes.get('/posts/:id', async (c) => {
  const viewer = await getViewer(c);
  return c.json(publicPost(await visiblePost(c, c.req.param('id'), viewer?.id ?? null)));
});

const rateLimited = () => fail(429, 'rate_limited', 'Slow down a little and try again later.');

const HOUR = 3_600_000;
const ROADMAP_COLUMN_SIZE = 50;
const PER_USER_PER_HOUR = { post: LIMITS.postsPerHour, comment: LIMITS.commentsPerHour, upload: LIMITS.uploadsPerHour, vote: null };

/**
 * Hourly write caps, counted atomically so parallel requests cannot slip past.
 * Anonymous ids are chosen by the client, so their writes are also capped per IP.
 */
async function limitWrites(c: Context<AppEnv>, viewerId: string, action: keyof typeof PER_USER_PER_HOUR) {
  const limits: RateLimit[] = [];
  const perUser = PER_USER_PER_HOUR[action];
  if (perUser !== null) limits.push({ key: `user:${viewerId}:${action}`, max: perUser, windowMs: HOUR });
  if (c.get('identity')?.anonymous) {
    const key = `anon:${c.get('project').id}:${action}:${clientIp(c.req)}`;
    limits.push({ key, max: LIMITS.anonymousPerIpPerHour[action], windowMs: HOUR });
  }
  if (await overAnyRateLimit(c.env, limits)) rateLimited();
}

publicRoutes.post('/posts', async (c) => {
  const project = c.get('project');
  const viewer = await requireViewer(c);
  const body = await readJson(c.req.raw);
  const title = str(body, 'title', { min: LIMITS.titleMin, max: LIMITS.titleMax })!;
  const text = str(body, 'body', { max: LIMITS.bodyMax, optional: true }) ?? '';
  // `||` so a blank string means "no category" instead of failing the foreign key.
  const categoryId = str(body, 'categoryId', { max: LIMITS.idMax, optional: true, nullable: true }) || null;
  const attachmentIds = stringArray(body, 'attachmentIds', LIMITS.attachmentsPerPost);
  if (attachmentIds.length && !project.settings.allowAttachments) fail(403, 'attachments_disabled');

  // An invalid request is refused before it counts against the rate limit.
  if (categoryId) await assertCategory(c, categoryId);
  const admin = isInAppAdmin(c);

  const id = newId();
  const ts = now();
  const moderation = project.settings.autoApprove || admin ? 'approved' : 'pending';
  // Independent: the rate limit and the read-only attachment ownership check.
  const [, claim] = await Promise.all([
    admin ? undefined : limitWrites(c, viewer.id, 'post'),
    claimAttachments(c.env, project.id, viewer.id, attachmentIds, { postId: id }),
  ]);
  const event = prepareEvent(c.env, { projectId: project.id, type: 'post.created', postId: id, actorId: viewer.id, origin: originOf(c) });
  // The read-back rides on the write batch: one D1 round trip for the whole submit.
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO posts (id, project_id, author_id, title, body, category_id, moderation, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, project.id, viewer.id, title, text, categoryId, moderation, ts, ts),
    // Authors automatically support their own idea.
    c.env.DB.prepare('INSERT INTO votes (post_id, user_id, value, created_at) VALUES (?, ?, 1, ?)').bind(id, viewer.id, ts),
    recountVotes(c.env, id),
    ...(claim ? [claim] : []),
    event.statement,
    ...postQueries(c.env, project.id, id, viewer.id),
  ]);
  await dispatchEvent(c.env, ctxOf(c), event.id);
  return c.json(publicPost(postFromResults(originOf(c), viewer.id, results)!), 201);
});

publicRoutes.post('/posts/:id/vote', async (c) => {
  const project = c.get('project');
  const body = await readJson(c.req.raw);
  const value = body.value;
  if (value !== 1 && value !== -1 && value !== 0) fail(400, 'invalid_input', 'value must be 1, -1 or 0');
  if (value === -1 && !project.settings.allowDownvotes) fail(403, 'downvotes_disabled');
  const viewer = await requireViewer(c);
  const [post] = await Promise.all([visiblePost(c, c.req.param('id'), viewer.id), limitWrites(c, viewer.id, 'vote')]);
  if (post.moderation !== 'approved' || post.mergedIntoId) fail(409, 'post_not_votable');

  const results = await c.env.DB.batch([
    value === 0
      ? c.env.DB.prepare('DELETE FROM votes WHERE post_id = ? AND user_id = ?').bind(post.id, viewer.id)
      : c.env.DB.prepare(
          `INSERT INTO votes (post_id, user_id, value, created_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (post_id, user_id) DO UPDATE SET value = excluded.value`,
        ).bind(post.id, viewer.id, value, now()),
    recountVotes(c.env, post.id),
    c.env.DB.prepare('SELECT score, upvotes, downvotes FROM posts WHERE id = ?').bind(post.id),
  ]);
  // Only the counters changed, so answer from the batch instead of re-reading the post.
  const counts = results[2]!.results[0] as { score: number; upvotes: number; downvotes: number };
  return c.json(publicPost({ ...post, ...counts, myVote: value }));
});

publicRoutes.get('/posts/:id/comments', async (c) => {
  const viewer = await getViewer(c);
  const post = await visiblePost(c, c.req.param('id'), viewer?.id ?? null);
  return c.json(
    await listComments(c.env, originOf(c), post.id, parseCursor(c.req.query('cursor')), parseLimit(c.req.query('limit'), 50, 100)),
  );
});

publicRoutes.post('/posts/:id/comments', async (c) => {
  const project = c.get('project');
  if (!project.settings.allowComments) fail(403, 'comments_disabled');
  const viewer = await requireViewer(c);
  const post = await visiblePost(c, c.req.param('id'), viewer.id);
  const admin = isInAppAdmin(c);
  if (post.moderation === 'declined' && !admin) fail(409, 'post_declined');
  const body = await readJson(c.req.raw);
  const text = str(body, 'body', { min: 1, max: LIMITS.commentMax })!;
  const attachmentIds = stringArray(body, 'attachmentIds', LIMITS.attachmentsPerPost);
  if (attachmentIds.length && !project.settings.allowAttachments) fail(403, 'attachments_disabled');
  if (!admin) await limitWrites(c, viewer.id, 'comment');

  const id = newId();
  const ts = now();
  const event = prepareEvent(c.env, {
    projectId: project.id,
    type: 'comment.created',
    postId: post.id,
    actorId: viewer.id,
    data: { commentId: id, body: text, isOfficial: admin },
    origin: originOf(c),
  });
  const claim = await claimAttachments(c.env, project.id, viewer.id, attachmentIds, { postId: post.id, commentId: id });
  const results = await c.env.DB.batch(
    commentWriteBatch(c.env, { id, postId: post.id, authorId: viewer.id, body: text, official: admin, ts, claim, event: event.statement }),
  );
  await dispatchEvent(c.env, ctxOf(c), event.id);
  return c.json(commentFromResults(originOf(c), results), 201);
});

/** Parse multipart form data, stopping at `maxBytes` even when Content-Length is missing or wrong. */
async function readFormWithLimit(req: Request, maxBytes: number): Promise<FormData> {
  const reader = req.body?.getReader();
  if (!reader) fail(400, 'invalid_form');
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      fail(413, 'file_too_large');
    }
    chunks.push(value);
  }
  // Copy into one Blob and drop the chunk list, so the parse below does not keep both alive.
  const body = new Blob(chunks);
  chunks.length = 0;
  try {
    return await new Response(body, { headers: { 'Content-Type': req.headers.get('Content-Type') ?? '' } }).formData();
  } catch {
    fail(400, 'invalid_form');
  }
}

publicRoutes.post('/uploads', async (c) => {
  const project = c.get('project');
  if (!project.settings.allowAttachments) fail(403, 'attachments_disabled');
  const viewer = await requireViewer(c);
  const maxBody = LIMITS.attachmentMaxBytes + 64 * 1024;
  if (Number(c.req.header('Content-Length') ?? 0) > maxBody) fail(413, 'file_too_large');
  // Before reading the body, so callers over the limit cannot make the Worker buffer 5 MB each time.
  await limitWrites(c, viewer.id, 'upload');
  const form = await readFormWithLimit(c.req.raw, maxBody);
  // FormData.get is typed as string-only in workers-types; at runtime file parts are File objects.
  const file = form.get('file') as unknown as File | string | null;
  if (!file || typeof file === 'string') fail(400, 'missing_file');
  if (!(LIMITS.attachmentMimeTypes as readonly string[]).includes(file.type)) fail(415, 'unsupported_type');
  if (file.size > LIMITS.attachmentMaxBytes) fail(413, 'file_too_large');

  const id = newId();
  const key = `${project.id}/${id}`;
  // R2 takes the File (a Blob) as is: no extra in-memory copy of up to 5 MB per upload.
  await c.env.FILES.put(key, file, { httpMetadata: { contentType: file.type } });
  await c.env.DB.prepare(
    'INSERT INTO attachments (id, project_id, uploader_id, r2_key, mime, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, project.id, viewer.id, key, file.type, file.size, now())
    .run();
  return c.json({ id, url: fileUrl(originOf(c), id), mime: file.type, width: null, height: null, bytes: file.size }, 201);
});

publicRoutes.get('/roadmap', async (c) => {
  if (!c.get('project').settings.roadmapEnabled) fail(404, 'roadmap_disabled');
  const viewer = await getViewer(c);
  // Rank inside each column in SQL so only the posts that are shown get loaded and hydrated.
  // Done shows what shipped most recently; the other columns rank by votes.
  const { results } = await c.env.DB.prepare(
    `WITH ranked AS (
       SELECT id, status, ROW_NUMBER() OVER (
         PARTITION BY status
         ORDER BY CASE WHEN status = 'done' THEN -COALESCE(status_changed_at, 0) ELSE -score END, created_at DESC
       ) AS rn
       FROM posts
       WHERE project_id = ? AND moderation = 'approved' AND merged_into_id IS NULL AND status IN (SELECT value FROM json_each(?))
     )
     SELECT id, status FROM ranked WHERE rn <= ? ORDER BY status, rn`,
  )
    .bind(c.get('project').id, JSON.stringify(ROADMAP_STATUSES), ROADMAP_COLUMN_SIZE)
    .all<{ id: string; status: string }>();
  const posts = await getPostsByIds(
    c.env,
    originOf(c),
    c.get('project').id,
    results.map((r) => r.id),
    viewer?.id ?? null,
  );
  const columns: RoadmapColumn[] = ROADMAP_STATUSES.map((status) => ({
    status,
    posts: posts.filter((p) => p.status === status).map(publicPost),
  }));
  return c.json(columns);
});

publicRoutes.get('/me/updates', async (c) => {
  const viewer = await getViewer(c);
  if (!viewer) return c.json({ unseen: 0, items: [] } satisfies Updates);
  const since = now() - 90 * 86_400_000;
  // Posts the viewer wrote or voted on that changed recently. Driven from the viewer's own
  // (small) set via posts_author and votes_user, not a scan of every post in the project.
  const { results } = await c.env.DB.prepare(
    `WITH mine AS (
       SELECT id FROM posts WHERE author_id = ?1
       UNION
       SELECT post_id FROM votes WHERE user_id = ?1
     )
     SELECT p.id FROM mine JOIN posts p ON p.id = mine.id
     WHERE p.project_id = ?3 AND p.merged_into_id IS NULL
       AND (p.status_changed_at > ?2 OR p.moderated_at > ?2 OR p.last_official_reply_at > ?2)
     ORDER BY MAX(COALESCE(p.status_changed_at, 0), COALESCE(p.moderated_at, 0), COALESCE(p.last_official_reply_at, 0)) DESC
     LIMIT 50`,
  )
    .bind(viewer.id, since, c.get('project').id)
    .all<{ id: string }>();

  const posts = await getPostsByIds(
    c.env,
    originOf(c),
    c.get('project').id,
    results.map((r) => r.id),
    viewer.id,
  );
  const items: UpdateItem[] = [];
  for (const post of posts) {
    const pub = publicPost(post);
    if (post.isMine && post.moderatedAt && post.moderatedAt > since) {
      items.push({ post: pub, kind: post.moderation === 'declined' ? 'declined' : 'approved', at: post.moderatedAt });
    }
    if (post.moderation === 'approved' && post.statusChangedAt && post.statusChangedAt > since) {
      items.push({ post: pub, kind: 'status', at: post.statusChangedAt });
    }
    if (post.isMine && post.lastOfficialReplyAt && post.lastOfficialReplyAt > since) {
      items.push({ post: pub, kind: 'official_reply', at: post.lastOfficialReplyAt });
    }
  }
  items.sort((a, b) => b.at - a.at);
  // Before the first 'seen', count everything since signup, including the same millisecond.
  const seen = viewer.last_seen_updates_at ?? viewer.created_at - 1;
  return c.json({ unseen: items.filter((i) => i.at > seen).length, items } satisfies Updates);
});

publicRoutes.post('/me/updates/seen', async (c) => {
  const viewer = await requireViewer(c);
  await c.env.DB.prepare('UPDATE end_users SET last_seen_updates_at = ? WHERE id = ?').bind(now(), viewer.id).run();
  return c.body(null, 204);
});
