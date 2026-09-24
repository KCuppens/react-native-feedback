import type {
  Attachment,
  Comment,
  Moderation,
  Page,
  Post,
  PostSort,
  PostStatus,
  VoteValue,
} from '@kobecuppens/feedback-core';
import { POST_STATUSES } from '@kobecuppens/feedback-core';
import type { Env } from './env';
import { fail, placeholders } from './util';

interface PostRow {
  id: string;
  project_id: string;
  author_id: string;
  title: string;
  body: string;
  category_id: string | null;
  status: PostStatus;
  moderation: Moderation;
  decline_reason: string | null;
  merged_into_id: string | null;
  score: number;
  upvotes: number;
  downvotes: number;
  comment_count: number;
  created_at: number;
  updated_at: number;
  status_changed_at: number | null;
  moderated_at: number | null;
  last_official_reply_at: number | null;
  author_name: string | null;
  author_avatar: string | null;
  author_is_admin: number;
  category_name: string | null;
  category_color: string | null;
  category_sort: number | null;
  my_vote: number;
}

export type PostRecord = Post & {
  projectId: string;
  authorId: string;
  moderatedAt: number | null;
  lastOfficialReplyAt: number | null;
};

interface AttachmentRow {
  id: string;
  post_id: string | null;
  comment_id: string | null;
  mime: string;
  width: number | null;
  height: number | null;
  bytes: number;
}

const POST_SELECT = `
SELECT p.*,
  a.name AS author_name, a.avatar_url AS author_avatar, a.is_admin AS author_is_admin,
  c.name AS category_name, c.color AS category_color, c.sort AS category_sort,
  COALESCE(v.value, 0) AS my_vote
FROM posts p
JOIN end_users a ON a.id = p.author_id
LEFT JOIN categories c ON c.id = p.category_id
LEFT JOIN votes v ON v.post_id = p.id AND v.user_id = ?`;

export function fileUrl(origin: string, id: string): string {
  return `${origin}/v1/files/${id}`;
}

function toAttachment(origin: string, row: AttachmentRow): Attachment {
  return { id: row.id, url: fileUrl(origin, row.id), mime: row.mime, width: row.width, height: row.height, bytes: row.bytes };
}

function groupAttachments(origin: string, rows: AttachmentRow[], key: (row: AttachmentRow) => string): Map<string, Attachment[]> {
  const grouped = new Map<string, Attachment[]>();
  for (const row of rows) {
    const k = key(row);
    grouped.set(k, [...(grouped.get(k) ?? []), toAttachment(origin, row)]);
  }
  return grouped;
}

function toPost(row: PostRow, viewerId: string | null, attachments: Attachment[]): PostRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    authorId: row.author_id,
    title: row.title,
    body: row.body,
    status: row.status,
    moderation: row.moderation,
    declineReason: row.decline_reason,
    category: row.category_id
      ? { id: row.category_id, name: row.category_name ?? '', color: row.category_color, sort: row.category_sort ?? 0 }
      : null,
    author: {
      id: row.author_id,
      name: row.author_name,
      avatarUrl: row.author_avatar,
      isAdmin: row.author_is_admin === 1,
    },
    score: row.score,
    upvotes: row.upvotes,
    downvotes: row.downvotes,
    commentCount: row.comment_count,
    myVote: (row.my_vote as VoteValue) ?? 0,
    isMine: viewerId !== null && row.author_id === viewerId,
    mergedIntoId: row.merged_into_id,
    attachments,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    statusChangedAt: row.status_changed_at,
    moderatedAt: row.moderated_at,
    lastOfficialReplyAt: row.last_official_reply_at,
  };
}

/** Strip server-only fields before sending a post to clients. */
export function publicPost(post: PostRecord): Post {
  const { projectId: _p, authorId: _a, moderatedAt: _m, lastOfficialReplyAt: _o, ...rest } = post;
  return rest;
}

async function hydrate(env: Env, origin: string, rows: PostRow[], viewerId: string | null): Promise<PostRecord[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const { results } = await env.DB.prepare(
    `SELECT id, post_id, comment_id, mime, width, height, bytes FROM attachments WHERE post_id IN (SELECT value FROM json_each(?)) AND comment_id IS NULL ORDER BY created_at`,
  )
    .bind(JSON.stringify(ids))
    .all<AttachmentRow>();
  const byPost = groupAttachments(origin, results, (row) => row.post_id!);
  return rows.map((r) => toPost(r, viewerId, byPost.get(r.id) ?? []));
}

export async function getPost(
  env: Env,
  origin: string,
  projectId: string,
  postId: string,
  viewerId: string | null,
): Promise<PostRecord | null> {
  const row = await env.DB.prepare(`${POST_SELECT} WHERE p.id = ? AND p.project_id = ?`)
    .bind(viewerId ?? '', postId, projectId)
    .first<PostRow>();
  if (!row) return null;
  const [post] = await hydrate(env, origin, [row], viewerId);
  return post!;
}

export async function getPostsByIds(
  env: Env,
  origin: string,
  projectId: string,
  ids: string[],
  viewerId: string | null,
): Promise<PostRecord[]> {
  if (ids.length === 0) return [];
  const { results } = await env.DB.prepare(`${POST_SELECT} WHERE p.project_id = ? AND p.id IN (SELECT value FROM json_each(?))`)
    .bind(viewerId ?? '', projectId, JSON.stringify(ids))
    .all<PostRow>();
  const byId = new Map((await hydrate(env, origin, results, viewerId)).map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter((p): p is PostRecord => !!p);
}

export interface PostQuery {
  projectId: string;
  viewerId: string | null;
  /** `approvedOrOwn`: public boards (approved posts plus the viewer's own). `byModeration`: an explicit moderation filter. */
  visibility: { kind: 'approvedOrOwn' } | { kind: 'byModeration'; moderation: Moderation | 'all' };
  sort: PostSort;
  statuses?: PostStatus[];
  categoryId?: string;
  q?: string;
  mine?: boolean;
  includeMerged?: boolean;
  offset: number;
  limit: number;
}

export function parseStatuses(raw: string | undefined): PostStatus[] | undefined {
  if (!raw) return undefined;
  const list = raw.split(',').filter((s): s is PostStatus => (POST_STATUSES as readonly string[]).includes(s));
  return list.length ? list : undefined;
}

export function parseSort(raw: string | undefined): PostSort {
  return raw === 'new' || raw === 'trending' ? raw : 'top';
}

export async function listPosts(env: Env, origin: string, query: PostQuery): Promise<Page<PostRecord>> {
  const where: string[] = ['p.project_id = ?'];
  const params: (string | number)[] = [query.projectId];

  if (query.visibility.kind === 'approvedOrOwn') {
    where.push("(p.moderation = 'approved' OR p.author_id = ?)");
    params.push(query.viewerId ?? '');
  } else if (query.visibility.moderation !== 'all') {
    where.push('p.moderation = ?');
    params.push(query.visibility.moderation);
  }
  if (!query.includeMerged) where.push('p.merged_into_id IS NULL');
  if (query.statuses?.length) {
    where.push(`p.status IN (${placeholders(query.statuses.length)})`);
    params.push(...query.statuses);
  }
  if (query.categoryId) {
    where.push('p.category_id = ?');
    params.push(query.categoryId);
  }
  if (query.mine) {
    where.push('p.author_id = ?');
    params.push(query.viewerId ?? '');
  }
  if (query.q) {
    const like = `%${query.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push("(p.title LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }

  let order: string;
  const orderParams: number[] = [];
  if (query.sort === 'new') order = 'p.created_at DESC';
  else if (query.sort === 'trending') {
    // Hacker-News-style decay without pow(): engagement per hour of age, softened.
    order = '(p.score + p.comment_count + 1) * 1.0 / ((? - p.created_at) / 3600000.0 + 2) DESC, p.created_at DESC';
    orderParams.push(Date.now());
  } else order = 'p.score DESC, p.created_at DESC';

  const sql = `${POST_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`;
  const { results } = await env.DB.prepare(sql)
    .bind(query.viewerId ?? '', ...params, ...orderParams, query.limit + 1, query.offset)
    .all<PostRow>();
  const hasMore = results.length > query.limit;
  const items = await hydrate(env, origin, results.slice(0, query.limit), query.viewerId);
  return { items, nextCursor: hasMore ? String(query.offset + query.limit) : null };
}

/** Recompute cached vote counters from the votes table (idempotent, race-safe). */
export function recountVotes(env: Env, postId: string): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE posts SET
       upvotes = (SELECT COUNT(*) FROM votes WHERE post_id = ?1 AND value = 1),
       downvotes = (SELECT COUNT(*) FROM votes WHERE post_id = ?1 AND value = -1),
       score = (SELECT COALESCE(SUM(value), 0) FROM votes WHERE post_id = ?1)
     WHERE id = ?1`,
  ).bind(postId);
}

export function recountComments(env: Env, postId: string): D1PreparedStatement {
  return env.DB.prepare(
    'UPDATE posts SET comment_count = (SELECT COUNT(*) FROM comments WHERE post_id = ?1 AND deleted_at IS NULL) WHERE id = ?1',
  ).bind(postId);
}

// ---------------------------------------------------------------------------
// Comments

interface CommentRow {
  id: string;
  post_id: string;
  body: string;
  is_official: number;
  created_at: number;
  author_id: string;
  author_name: string | null;
  author_avatar: string | null;
  author_is_admin: number;
}

const COMMENT_SELECT = `
SELECT cm.id, cm.post_id, cm.body, cm.is_official, cm.created_at, cm.author_id,
  a.name AS author_name, a.avatar_url AS author_avatar, a.is_admin AS author_is_admin
FROM comments cm JOIN end_users a ON a.id = cm.author_id`;

async function hydrateComments(env: Env, origin: string, rows: CommentRow[]): Promise<Comment[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const { results } = await env.DB.prepare(
    `SELECT id, post_id, comment_id, mime, width, height, bytes FROM attachments WHERE comment_id IN (SELECT value FROM json_each(?)) ORDER BY created_at`,
  )
    .bind(JSON.stringify(ids))
    .all<AttachmentRow>();
  const byComment = groupAttachments(origin, results, (row) => row.comment_id!);
  return rows.map((r) => ({
    id: r.id,
    postId: r.post_id,
    body: r.body,
    isOfficial: r.is_official === 1,
    author: { id: r.author_id, name: r.author_name, avatarUrl: r.author_avatar, isAdmin: r.author_is_admin === 1 },
    attachments: byComment.get(r.id) ?? [],
    createdAt: r.created_at,
  }));
}

export async function listComments(
  env: Env,
  origin: string,
  postId: string,
  offset: number,
  limit: number,
): Promise<Page<Comment>> {
  const { results } = await env.DB.prepare(
    `${COMMENT_SELECT} WHERE cm.post_id = ? AND cm.deleted_at IS NULL ORDER BY cm.created_at ASC, cm.id ASC LIMIT ? OFFSET ?`,
  )
    .bind(postId, limit + 1, offset)
    .all<CommentRow>();
  const hasMore = results.length > limit;
  return {
    items: await hydrateComments(env, origin, results.slice(0, limit)),
    nextCursor: hasMore ? String(offset + limit) : null,
  };
}

export async function getComment(env: Env, origin: string, commentId: string): Promise<Comment | null> {
  const row = await env.DB.prepare(`${COMMENT_SELECT} WHERE cm.id = ?`).bind(commentId).first<CommentRow>();
  if (!row) return null;
  const [comment] = await hydrateComments(env, origin, [row]);
  return comment!;
}

/**
 * Claim uploaded attachments for a post or comment. Only the uploader's own,
 * still-unattached files in this project can be claimed.
 */
export async function claimAttachments(
  env: Env,
  projectId: string,
  uploaderId: string,
  ids: string[],
  target: { postId: string; commentId?: string },
): Promise<D1PreparedStatement | null> {
  if (ids.length === 0) return null;
  const { results } = await env.DB.prepare(
    `SELECT id FROM attachments WHERE id IN (${placeholders(ids.length)}) AND project_id = ? AND uploader_id = ? AND post_id IS NULL AND comment_id IS NULL`,
  )
    .bind(...ids, projectId, uploaderId)
    .all<{ id: string }>();
  if (results.length !== ids.length) fail(400, 'invalid_attachments');
  return env.DB.prepare(
    `UPDATE attachments SET post_id = ?, comment_id = ?
     WHERE id IN (${placeholders(ids.length)}) AND project_id = ? AND uploader_id = ? AND post_id IS NULL AND comment_id IS NULL`,
  ).bind(target.postId, target.commentId ?? null, ...ids, projectId, uploaderId);
}

/** R2 keys for everything attached to a post or its comments (for cleanup on delete). */
export async function attachmentKeysForPost(env: Env, postId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    'SELECT r2_key FROM attachments WHERE post_id = ? OR comment_id IN (SELECT id FROM comments WHERE post_id = ?)',
  )
    .bind(postId, postId)
    .all<{ r2_key: string }>();
  return results.map((r) => r.r2_key);
}
