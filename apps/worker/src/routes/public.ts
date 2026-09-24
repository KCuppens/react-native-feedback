import {
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
import { emitEvent } from '../events';
import {
  claimAttachments,
  fileUrl,
  getComment,
  getPost,
  getPostsByIds,
  listComments,
  listPosts,
  parseSort,
  parseStatuses,
  publicPost,
  recountComments,
  recountVotes,
  type PostRecord,
} from '../posts';
import { LIMITS } from '../projects';
import {
  assertCategory,
  clientIp,
  ctxOf,
  fail,
  newId,
  now,
  originOf,
  overRateLimit,
  parseCursor,
  parseLimit,
  readJson,
  str,
  stringArray,
} from '../util';

export const publicRoutes = new Hono<AppEnv>();


// Explicit paths: a '*' middleware here would also match sibling /v1/* routers once mounted.
for (const path of ['/config', '/posts', '/posts/*', '/uploads', '/roadmap', '/me/*']) {
  publicRoutes.use(path, projectAuth);
}

export async function loadCategories(c: Context<AppEnv>): Promise<Category[]> {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, color, sort FROM categories WHERE project_id = ? ORDER BY sort, name',
  )
    .bind(c.get('project').id)
    .all<Category>();
  return results;
}

publicRoutes.get('/config', async (c) => {
  const project = c.get('project');
  const s = project.settings;
  const identity = c.get('identity');
  const config: BoardConfig = {
    project: { id: project.id, name: project.name, slug: project.slug },
    categories: await loadCategories(c),
    features: {
      submit: !!identity,
      vote: !!identity,
      downvote: !!identity && s.allowDownvotes,
      comments: s.allowComments,
      attachments: !!identity && s.allowAttachments,
      roadmap: s.roadmapEnabled,
      updates: !!identity,
    },
    viewer: { identified: !!identity, anonymous: identity?.anonymous ?? false, isAdmin: isInAppAdmin(c) },
    limits: {
      titleMax: LIMITS.titleMax,
      bodyMax: LIMITS.bodyMax,
      commentMax: LIMITS.commentMax,
      attachmentMaxBytes: LIMITS.attachmentMaxBytes,
      attachmentsPerPost: LIMITS.attachmentsPerPost,
      attachmentMimeTypes: [...LIMITS.attachmentMimeTypes],
    },
  };
  return c.json(config);
});

publicRoutes.get('/posts', async (c) => {
  const viewer = await getViewer(c);
  const page = await listPosts(c.env, originOf(c), {
    projectId: c.get('project').id,
    viewerId: viewer?.id ?? null,
    visibility: { kind: 'public' },
    sort: parseSort(c.req.query('sort')),
    statuses: parseStatuses(c.req.query('status')),
    categoryId: c.req.query('category') || undefined,
    q: c.req.query('q')?.trim().slice(0, 100) || undefined,
    mine: c.req.query('mine') === '1',
    offset: parseCursor(c.req.query('cursor')),
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

async function enforceRate(c: Context<AppEnv>, sql: string, userId: string, max: number) {
  const row = await c.env.DB.prepare(sql).bind(userId, now() - 3_600_000).first<{ n: number }>();
  if ((row?.n ?? 0) >= max) rateLimited();
}

/** Anonymous ids are chosen by the client, so their writes are also capped per IP. */
async function limitAnonymous(c: Context<AppEnv>, action: keyof typeof LIMITS.anonymousPerIpPerHour) {
  if (!c.get('identity')?.anonymous) return;
  const key = `anon:${c.get('project').id}:${action}:${clientIp(c.req)}`;
  if (await overRateLimit(c.env, key, LIMITS.anonymousPerIpPerHour[action], 3_600_000)) rateLimited();
}

publicRoutes.post('/posts', async (c) => {
  const project = c.get('project');
  const viewer = await requireViewer(c);
  const body = await readJson(c.req.raw);
  const title = str(body, 'title', { min: LIMITS.titleMin, max: LIMITS.titleMax })!;
  const text = str(body, 'body', { max: LIMITS.bodyMax, optional: true }) ?? '';
  // `||` so a blank string means "no category" instead of failing the foreign key.
  const categoryId = str(body, 'categoryId', { max: 64, optional: true, nullable: true }) || null;
  const attachmentIds = stringArray(body, 'attachmentIds', LIMITS.attachmentsPerPost);
  if (attachmentIds.length && !project.settings.allowAttachments) fail(403, 'attachments_disabled');

  if (categoryId) await assertCategory(c, categoryId);
  const admin = isInAppAdmin(c);
  if (!admin) {
    await enforceRate(c, 'SELECT COUNT(*) AS n FROM posts WHERE author_id = ? AND created_at > ?', viewer.id, LIMITS.postsPerHour);
    await limitAnonymous(c, 'post');
  }

  const id = newId();
  const ts = now();
  const moderation = project.settings.autoApprove || admin ? 'approved' : 'pending';
  const claim = await claimAttachments(c.env, project.id, viewer.id, attachmentIds, { postId: id });
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO posts (id, project_id, author_id, title, body, category_id, moderation, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, project.id, viewer.id, title, text, categoryId, moderation, ts, ts),
    // Authors automatically support their own idea.
    c.env.DB.prepare('INSERT INTO votes (post_id, user_id, value, created_at) VALUES (?, ?, 1, ?)').bind(id, viewer.id, ts),
    recountVotes(c.env, id),
    ...(claim ? [claim] : []),
  ]);

  await emitEvent(c.env, ctxOf(c), { projectId: project.id, type: 'post.created', postId: id, actorId: viewer.id, origin: originOf(c) });
  const post = await getPost(c.env, originOf(c), project.id, id, viewer.id);
  return c.json(publicPost(post!), 201);
});

publicRoutes.post('/posts/:id/vote', async (c) => {
  const project = c.get('project');
  const body = await readJson(c.req.raw);
  const value = body.value;
  if (value !== 1 && value !== -1 && value !== 0) fail(400, 'invalid_input', 'value must be 1, -1 or 0');
  if (value === -1 && !project.settings.allowDownvotes) fail(403, 'downvotes_disabled');
  const viewer = await requireViewer(c);
  const post = await visiblePost(c, c.req.param('id'), viewer.id);
  if (post.moderation !== 'approved' || post.mergedIntoId) fail(409, 'post_not_votable');
  await limitAnonymous(c, 'vote');

  await c.env.DB.batch([
    value === 0
      ? c.env.DB.prepare('DELETE FROM votes WHERE post_id = ? AND user_id = ?').bind(post.id, viewer.id)
      : c.env.DB.prepare(
          `INSERT INTO votes (post_id, user_id, value, created_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (post_id, user_id) DO UPDATE SET value = excluded.value`,
        ).bind(post.id, viewer.id, value, now()),
    recountVotes(c.env, post.id),
  ]);
  const updated = await getPost(c.env, originOf(c), project.id, post.id, viewer.id);
  return c.json(publicPost(updated!));
});

publicRoutes.get('/posts/:id/comments', async (c) => {
  const viewer = await getViewer(c);
  const post = await visiblePost(c, c.req.param('id'), viewer?.id ?? null);
  return c.json(await listComments(c.env, originOf(c), post.id, parseCursor(c.req.query('cursor')), parseLimit(c.req.query('limit'), 50, 100)));
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
  if (!admin) {
    await enforceRate(
      c,
      'SELECT COUNT(*) AS n FROM comments WHERE author_id = ? AND created_at > ?',
      viewer.id,
      LIMITS.commentsPerHour,
    );
    await limitAnonymous(c, 'comment');
  }

  const id = newId();
  const ts = now();
  const claim = await claimAttachments(c.env, project.id, viewer.id, attachmentIds, { postId: post.id, commentId: id });
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO comments (id, post_id, author_id, body, is_official, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
      id,
      post.id,
      viewer.id,
      text,
      admin ? 1 : 0,
      ts,
    ),
    ...(claim ? [claim] : []),
    recountComments(c.env, post.id),
    ...(admin
      ? [c.env.DB.prepare('UPDATE posts SET last_official_reply_at = ? WHERE id = ?').bind(ts, post.id)]
      : []),
  ]);
  await emitEvent(c.env, ctxOf(c), {
    projectId: project.id,
    type: 'comment.created',
    postId: post.id,
    actorId: viewer.id,
    data: { commentId: id, body: text, isOfficial: admin },
    origin: originOf(c),
  });
  return c.json(await getComment(c.env, originOf(c), id), 201);
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
  try {
    return await new Response(new Blob(chunks), { headers: { 'Content-Type': req.headers.get('Content-Type') ?? '' } }).formData();
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
  const form = await readFormWithLimit(c.req.raw, maxBody);
  // FormData.get is typed as string-only in workers-types; at runtime file parts are File objects.
  const file = form.get('file') as unknown as File | string | null;
  if (!file || typeof file === 'string') fail(400, 'missing_file');
  if (!(LIMITS.attachmentMimeTypes as readonly string[]).includes(file.type)) fail(415, 'unsupported_type');
  if (file.size > LIMITS.attachmentMaxBytes) fail(413, 'file_too_large');
  await enforceRate(c, 'SELECT COUNT(*) AS n FROM attachments WHERE uploader_id = ? AND created_at > ?', viewer.id, LIMITS.uploadsPerHour);
  await limitAnonymous(c, 'upload');

  const id = newId();
  const key = `${project.id}/${id}`;
  await c.env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
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
  // One query for all columns, split and capped per column here.
  const { items } = await listPosts(c.env, originOf(c), {
    projectId: c.get('project').id,
    viewerId: viewer?.id ?? null,
    visibility: { kind: 'admin', moderation: 'approved' },
    sort: 'top',
    statuses: [...ROADMAP_STATUSES],
    offset: 0,
    limit: 500,
  });
  const columns: RoadmapColumn[] = ROADMAP_STATUSES.map((status) => {
    const posts = items.filter((p) => p.status === status);
    // Done shows what shipped most recently; the others rank by votes.
    if (status === 'done') posts.sort((a, b) => (b.statusChangedAt ?? 0) - (a.statusChangedAt ?? 0));
    return { status, posts: posts.slice(0, 50).map(publicPost) };
  });
  return c.json(columns);
});

publicRoutes.get('/me/updates', async (c) => {
  const viewer = await getViewer(c);
  if (!viewer) return c.json({ unseen: 0, items: [] } satisfies Updates);
  const since = now() - 90 * 86_400_000;
  // Posts the viewer wrote or voted on that changed recently.
  const { results } = await c.env.DB.prepare(
    `SELECT id FROM posts
     WHERE project_id = ?3 AND merged_into_id IS NULL
       AND (author_id = ?1 OR id IN (SELECT post_id FROM votes WHERE user_id = ?1))
       AND (status_changed_at > ?2 OR moderated_at > ?2 OR last_official_reply_at > ?2)
     ORDER BY MAX(COALESCE(status_changed_at, 0), COALESCE(moderated_at, 0), COALESCE(last_official_reply_at, 0)) DESC
     LIMIT 50`,
  )
    .bind(viewer.id, since, c.get('project').id)
    .all<{ id: string }>();

  const posts = await getPostsByIds(c.env, originOf(c), c.get('project').id, results.map((r) => r.id), viewer.id);
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
