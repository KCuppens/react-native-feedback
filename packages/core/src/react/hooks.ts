import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
import type {
  AdminPostPatch,
  BoardConfig,
  Comment,
  CreateCommentInput,
  CreatePostInput,
  ListPostsParams,
  Page,
  Post,
  RoadmapColumn,
  Updates,
  UploadFile,
  VoteValue,
} from '../types';
import { applyVote } from '../vote';
import { useFeedbackContext } from './context';
import { feedbackKeys } from './keys';

export { feedbackKeys };

export function useConfig() {
  const { adapter, scope } = useFeedbackContext();
  return useQuery({ queryKey: feedbackKeys.config(scope), queryFn: () => adapter.getConfig(), staleTime: 5 * 60_000 });
}

export type EffectiveFeatures = BoardConfig['features'] & { admin: boolean };

/** Server features AND client `features` prop: the client can only switch things off. */
export function useFeatures(): EffectiveFeatures | undefined {
  const { clientFeatures } = useFeedbackContext();
  const { data } = useConfig();
  return useMemo(() => {
    if (!data) return undefined;
    const f = data.features;
    const c = clientFeatures;
    return {
      submit: f.submit && c.submit !== false,
      vote: f.vote && c.vote !== false,
      downvote: f.vote && f.downvote && c.downvote !== false && c.vote !== false,
      comments: f.comments && c.comments !== false,
      attachments: f.attachments && c.attachments !== false,
      roadmap: f.roadmap && c.roadmap !== false,
      updates: f.updates && c.updates !== false,
      admin: data.viewer.isAdmin && c.admin !== false,
    };
  }, [data, clientFeatures]);
}

export function usePosts(params: ListPostsParams = {}) {
  const { adapter, scope } = useFeedbackContext();
  return useInfiniteQuery({
    queryKey: feedbackKeys.posts(scope, params),
    queryFn: ({ pageParam }) => adapter.listPosts({ ...params, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function usePost(id: string | null | undefined, initial?: Post) {
  const { adapter, scope } = useFeedbackContext();
  return useQuery({
    queryKey: feedbackKeys.post(scope, id ?? ''),
    queryFn: () => adapter.getPost(id!),
    enabled: !!id,
    initialData: initial,
    // Treat list data as a placeholder that should be refreshed on open.
    initialDataUpdatedAt: initial ? 0 : undefined,
  });
}

/** Replace a post everywhere it is cached (lists, detail, roadmap, queue). */
export function updateCachedPost(client: QueryClient, scope: string, postId: string, update: (post: Post) => Post) {
  const mapPage = (page: Page<Post>): Page<Post> => ({
    ...page,
    items: page.items.map((p) => (p.id === postId ? update(p) : p)),
  });
  for (const queryKey of [feedbackKeys.postsPrefix(scope), feedbackKeys.queue(scope)]) {
    client.setQueriesData<InfiniteData<Page<Post>>>({ queryKey }, (data) => (data ? { ...data, pages: data.pages.map(mapPage) } : data));
  }
  client.setQueryData<Post>(feedbackKeys.post(scope, postId), (post) => (post ? update(post) : post));
  client.setQueryData<RoadmapColumn[]>(feedbackKeys.roadmap(scope), (cols) =>
    cols?.map((col) => ({ ...col, posts: col.posts.map((p) => (p.id === postId ? update(p) : p)) })),
  );
}

/**
 * Refetch lists after a change that can move posts around (a new post, a moderation
 * decision). Infinite queries refetch every loaded page one after another, so trim them to
 * their first page first: one request instead of one per page scrolled.
 */
function refetchFromFirstPage(client: QueryClient, queryKey: readonly unknown[]) {
  client.setQueriesData<InfiniteData<Page<Post>>>({ queryKey }, (data) =>
    data && data.pages.length > 1 ? { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) } : data,
  );
  void client.invalidateQueries({ queryKey });
}

export function useVote() {
  const { adapter, scope, onEvent } = useFeedbackContext();
  const client = useQueryClient();
  // Rapid taps send overlapping requests; only the newest one per post may touch the cache.
  const latest = useRef(new Map<string, number>());
  const isLatest = (postId: string, seq: number) => latest.current.get(postId) === seq;
  return useMutation({
    mutationFn: ({ post, value }: { post: Post; value: VoteValue }) => adapter.vote(post.id, value),
    onMutate: async ({ post, value }) => {
      const seq = (latest.current.get(post.id) ?? 0) + 1;
      latest.current.set(post.id, seq);
      // Only the queries updateCachedPost writes to, so unrelated fetches keep going.
      await Promise.all(
        [feedbackKeys.postsPrefix(scope), feedbackKeys.queue(scope), feedbackKeys.post(scope, post.id), feedbackKeys.roadmap(scope)].map(
          (queryKey) => client.cancelQueries({ queryKey }),
        ),
      );
      updateCachedPost(client, scope, post.id, (p) => applyVote(p, value));
      return { seq };
    },
    // `post` is the pre-vote snapshot the caller passed in.
    onError: (error, { post }, ctx) => {
      if (ctx && isLatest(post.id, ctx.seq)) {
        // The snapshot may itself be an earlier tap's optimistic state: restore it for now,
        // then refetch the server's copy.
        updateCachedPost(client, scope, post.id, () => post);
        void client.invalidateQueries({ queryKey: feedbackKeys.post(scope, post.id) });
        void client.invalidateQueries({ queryKey: feedbackKeys.postsPrefix(scope) });
      }
      onEvent({ type: 'error', error });
    },
    onSuccess: (saved, _vars, ctx) => {
      if (isLatest(saved.id, ctx.seq)) updateCachedPost(client, scope, saved.id, () => saved);
      onEvent({ type: 'voted', post: saved });
    },
  });
}

export function useCreatePost() {
  const { adapter, scope, onEvent } = useFeedbackContext();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePostInput) => adapter.createPost(input),
    onSuccess: (post) => {
      client.setQueryData(feedbackKeys.post(scope, post.id), post);
      refetchFromFirstPage(client, feedbackKeys.postsPrefix(scope));
      refetchFromFirstPage(client, feedbackKeys.queue(scope));
      onEvent({ type: 'post_created', post });
    },
    onError: (error) => onEvent({ type: 'error', error }),
  });
}

export function useUpload() {
  const { adapter, onEvent } = useFeedbackContext();
  return useMutation({
    mutationFn: (file: UploadFile) => adapter.upload(file),
    onError: (error) => onEvent({ type: 'error', error }),
  });
}

export function useComments(postId: string | null | undefined) {
  const { adapter, scope } = useFeedbackContext();
  return useInfiniteQuery({
    queryKey: feedbackKeys.comments(scope, postId ?? ''),
    queryFn: ({ pageParam }) => adapter.listComments(postId!, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!postId,
  });
}

export function useCreateComment(postId: string) {
  const { adapter, scope, onEvent } = useFeedbackContext();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCommentInput) => adapter.createComment(postId, input),
    onSuccess: (comment: Comment) => {
      const key = feedbackKeys.comments(scope, postId);
      const data = client.getQueryData<InfiniteData<Page<Comment>>>(key);
      const last = data?.pages[data.pages.length - 1];
      if (data && last && last.nextCursor === null) {
        // Comments are oldest-first: with everything loaded, the new one goes at the end.
        client.setQueryData<InfiniteData<Page<Comment>>>(key, {
          ...data,
          pages: [...data.pages.slice(0, -1), { ...last, items: [...last.items, comment] }],
        });
      } else {
        // Unloaded pages will contain it; appending now would show it twice.
        void client.invalidateQueries({ queryKey: key });
      }
      updateCachedPost(client, scope, postId, (p) => ({ ...p, commentCount: p.commentCount + 1 }));
      onEvent({ type: 'comment_created', postId });
    },
    onError: (error) => onEvent({ type: 'error', error }),
  });
}

export function useRoadmap(enabled = true) {
  const { adapter, scope } = useFeedbackContext();
  return useQuery({ queryKey: feedbackKeys.roadmap(scope), queryFn: () => adapter.getRoadmap(), enabled });
}

export function useUpdates(enabled = true) {
  const { adapter, scope } = useFeedbackContext();
  return useQuery({
    queryKey: feedbackKeys.updates(scope),
    queryFn: () => adapter.getUpdates(),
    enabled,
    refetchInterval: 5 * 60_000,
  });
}

export function useMarkUpdatesSeen() {
  const { adapter, scope } = useFeedbackContext();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => adapter.markUpdatesSeen(),
    onSuccess: () => client.setQueryData<Updates>(feedbackKeys.updates(scope), (data) => (data ? { ...data, unseen: 0 } : data)),
  });
}

export function useAdminQueue(enabled = true) {
  const { adapter, scope } = useFeedbackContext();
  return useInfiniteQuery({
    queryKey: feedbackKeys.queue(scope),
    queryFn: ({ pageParam }) => {
      if (!adapter.admin) throw new Error('This adapter has no admin support');
      return adapter.admin.listQueue(pageParam);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: enabled && !!adapter.admin,
  });
}

/** In-app moderation actions. Only usable when `useFeatures().admin` is true. */
export function useModeration() {
  const { adapter, scope, onEvent } = useFeedbackContext();
  const client = useQueryClient();
  const admin = adapter.admin;

  const refresh = (post?: Post) => {
    if (post) updateCachedPost(client, scope, post.id, () => post);
    refetchFromFirstPage(client, feedbackKeys.postsPrefix(scope));
    refetchFromFirstPage(client, feedbackKeys.queue(scope));
    void client.invalidateQueries({ queryKey: feedbackKeys.roadmap(scope) });
  };
  const need = () => {
    if (!admin) throw new Error('This adapter has no admin support');
    return admin;
  };
  const onError = (error: unknown) => onEvent({ type: 'error', error });

  return {
    approve: useMutation({ mutationFn: (id: string) => need().approve(id), onSuccess: refresh, onError }),
    decline: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason?: string | null }) => need().decline(id, reason),
      onSuccess: refresh,
      onError,
    }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: AdminPostPatch }) => need().updatePost(id, patch),
      onSuccess: refresh,
      onError,
    }),
    remove: useMutation({
      mutationFn: (id: string) => need().deletePost(id),
      onSuccess: (_void, id) => {
        client.removeQueries({ queryKey: feedbackKeys.post(scope, id) });
        refresh();
      },
      onError,
    }),
    merge: useMutation({
      mutationFn: ({ id, intoId }: { id: string; intoId: string }) => need().merge(id, intoId),
      onSuccess: refresh,
      onError,
    }),
  };
}
