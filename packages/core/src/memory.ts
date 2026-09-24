import type { FeedbackAdapter } from './adapter';
import {
  BOARD_LIMITS,
  boardFeatures,
  DEFAULT_PROJECT_SETTINGS,
  FeedbackApiError,
  ROADMAP_STATUSES,
  type Attachment,
  type BoardConfig,
  type Category,
  type Comment,
  type Post,
  type ProjectSettings,
  type UpdateItem,
  type VoteValue,
} from './types';
import { applyVote } from './vote';

export interface MemoryAdapterOptions {
  settings?: Partial<ProjectSettings>;
  categories?: Category[];
  /** Seed posts (moderation defaults to approved). */
  posts?: (Partial<Post> & { title: string })[];
  viewer?: { id: string; name?: string | null; isAdmin?: boolean } | null;
  /** Artificial latency in ms, handy for demos. */
  latency?: number;
}

/**
 * A complete in-memory backend: for tests, Storybook, design reviews and offline
 * demos. Mirrors the hosted API's visibility and moderation rules.
 */
export function createMemoryAdapter(options: MemoryAdapterOptions = {}): FeedbackAdapter & { posts: Post[] } {
  const settings = { ...DEFAULT_PROJECT_SETTINGS, ...options.settings };
  const categories = options.categories ?? [];
  const viewer = options.viewer === undefined ? { id: 'me', name: 'You' } : options.viewer;
  const isAdmin = !!viewer?.isAdmin && settings.inAppAdmin;
  let seq = 0;
  const id = () => `mem_${++seq}`;
  const now = Date.now();
  const wait = <T>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(jsonClone(value)), options.latency ?? 0));

  const posts: Post[] = (options.posts ?? []).map((seed, i) => ({
    id: seed.id ?? id(),
    body: '',
    status: 'open',
    moderation: 'approved',
    declineReason: null,
    category: null,
    author: { id: 'someone', name: 'Someone', avatarUrl: null, isAdmin: false },
    score: 0,
    upvotes: 0,
    downvotes: 0,
    commentCount: 0,
    myVote: 0,
    isMine: false,
    mergedIntoId: null,
    attachments: [],
    createdAt: now - i * 3_600_000,
    updatedAt: now - i * 3_600_000,
    statusChangedAt: null,
    ...seed,
  }));
  const comments = new Map<string, Comment[]>();
  let lastSeenUpdates = 0;
  const uploads = new Map<string, Attachment>();

  const canSee = (p: Post) => p.moderation === 'approved' || p.isMine || isAdmin;
  const visible = (p: Post) => canSee(p) && !p.mergedIntoId;
  const find = (postId: string) => {
    const post = posts.find((p) => p.id === postId);
    if (!post || !canSee(post)) {
      throw new FeedbackApiError(404, 'post_not_found');
    }
    return post;
  };
  const replace = (next: Post) => {
    posts[posts.findIndex((p) => p.id === next.id)] = next;
    return next;
  };
  const requireViewer = () => {
    if (!viewer) throw new FeedbackApiError(401, 'identity_required');
    return viewer;
  };

  const config: BoardConfig = {
    project: { id: 'memory', name: 'Demo', slug: 'demo' },
    categories,
    features: boardFeatures(settings, !!viewer),
    viewer: { identified: !!viewer, anonymous: false, isAdmin },
    limits: BOARD_LIMITS,
  };

  const adapter: FeedbackAdapter & { posts: Post[] } = {
    posts,
    getConfig: () => wait(config),
    listPosts: (params) => {
      const statuses = params.status ? ([] as string[]).concat(params.status) : null;
      const q = params.q?.toLowerCase();
      let list = posts.filter(
        (p) =>
          visible(p) &&
          (p.moderation === 'approved' || p.isMine) &&
          (!statuses || statuses.includes(p.status)) &&
          (!params.categoryId || p.category?.id === params.categoryId) &&
          (!params.mine || p.isMine) &&
          (!q || p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q)),
      );
      list =
        params.sort === 'new'
          ? list.sort((a, b) => b.createdAt - a.createdAt)
          : list.sort((a, b) => b.score - a.score || b.createdAt - a.createdAt);
      const offset = Number(params.cursor ?? 0);
      const limit = params.limit ?? 20;
      const items = list.slice(offset, offset + limit);
      return wait({ items, nextCursor: offset + limit < list.length ? String(offset + limit) : null });
    },
    getPost: async (postId) => wait(find(postId)),
    createPost: async (input) => {
      const who = requireViewer();
      if (input.title.trim().length < BOARD_LIMITS.titleMin)
        throw new FeedbackApiError(400, 'invalid_input', 'title is too short', 'title', 'too_short');
      const ts = Date.now();
      const post: Post = {
        id: id(),
        title: input.title.trim(),
        body: input.body.trim(),
        status: 'open',
        moderation: settings.autoApprove || isAdmin ? 'approved' : 'pending',
        declineReason: null,
        category: categories.find((c) => c.id === input.categoryId) ?? null,
        author: { id: who.id, name: who.name ?? null, avatarUrl: null, isAdmin },
        score: 1,
        upvotes: 1,
        downvotes: 0,
        commentCount: 0,
        myVote: 1,
        isMine: true,
        mergedIntoId: null,
        attachments: (input.attachmentIds ?? []).map((a) => uploads.get(a)).filter((a): a is Attachment => !!a),
        createdAt: ts,
        updatedAt: ts,
        statusChangedAt: null,
      };
      posts.unshift(post);
      return wait(post);
    },
    vote: async (postId, value: VoteValue) => {
      requireViewer();
      const post = find(postId);
      if (post.moderation !== 'approved') throw new FeedbackApiError(409, 'post_not_votable');
      if (value === -1 && !settings.allowDownvotes) throw new FeedbackApiError(403, 'downvotes_disabled');
      return wait(replace(applyVote(post, value)));
    },
    listComments: async (postId) => {
      find(postId);
      return wait({ items: comments.get(postId) ?? [], nextCursor: null });
    },
    createComment: async (postId, input) => {
      const who = requireViewer();
      const post = find(postId);
      if (!settings.allowComments) throw new FeedbackApiError(403, 'comments_disabled');
      const comment: Comment = {
        id: id(),
        postId,
        body: input.body.trim(),
        isOfficial: isAdmin,
        author: { id: who.id, name: who.name ?? null, avatarUrl: null, isAdmin },
        attachments: [],
        createdAt: Date.now(),
      };
      comments.set(postId, [...(comments.get(postId) ?? []), comment]);
      replace({ ...post, commentCount: post.commentCount + 1 });
      return wait(comment);
    },
    upload: async (file) => {
      requireViewer();
      const attachment: Attachment = {
        id: id(),
        url: 'uri' in file ? file.uri : 'about:blank',
        mime: 'type' in file ? file.type : 'image/png',
        width: null,
        height: null,
        bytes: 'size' in file ? file.size : 0,
      };
      uploads.set(attachment.id, attachment);
      return wait(attachment);
    },
    getRoadmap: () =>
      wait(
        ROADMAP_STATUSES.map((status) => ({
          status,
          posts: posts.filter((p) => p.moderation === 'approved' && !p.mergedIntoId && p.status === status),
        })),
      ),
    getUpdates: () => {
      const items: UpdateItem[] = posts
        .filter((p) => p.isMine && p.statusChangedAt)
        .map((post) => ({ post, kind: 'status' as const, at: post.statusChangedAt! }));
      return wait({ unseen: items.filter((i) => i.at > lastSeenUpdates).length, items });
    },
    markUpdatesSeen: () => {
      lastSeenUpdates = Date.now();
      return wait(undefined);
    },
    admin: {
      listQueue: () => wait({ items: posts.filter((p) => p.moderation === 'pending'), nextCursor: null }),
      approve: async (postId) => wait(replace({ ...find(postId), moderation: 'approved', declineReason: null })),
      decline: async (postId, reason) => wait(replace({ ...find(postId), moderation: 'declined', declineReason: reason ?? null })),
      updatePost: async (postId, patch) => {
        const post = find(postId);
        const statusChanged = patch.status && patch.status !== post.status;
        return wait(
          replace({
            ...post,
            ...(patch.title !== undefined ? { title: patch.title } : null),
            ...(patch.body !== undefined ? { body: patch.body } : null),
            ...(patch.status ? { status: patch.status } : null),
            ...(patch.categoryId !== undefined ? { category: categories.find((c) => c.id === patch.categoryId) ?? null } : null),
            ...(statusChanged ? { statusChangedAt: Date.now() } : null),
          }),
        );
      },
      deletePost: async (postId) => {
        posts.splice(posts.indexOf(find(postId)), 1);
        return wait(undefined);
      },
      merge: async (postId, intoId) => {
        replace({ ...find(postId), mergedIntoId: intoId, status: 'closed' });
        return wait(find(intoId));
      },
      deleteComment: async (postId, commentId) => {
        comments.set(
          postId,
          (comments.get(postId) ?? []).filter((c) => c.id !== commentId),
        );
        return wait(undefined);
      },
    },
  };
  return adapter;
}

function jsonClone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}
