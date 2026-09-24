// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryAdapter, type ClientFeatures, type FeedbackAdapter, type MemoryAdapterOptions } from '../src';
import {
  feedbackKeys,
  FeedbackProvider,
  useAdminQueue,
  useComments,
  useCreateComment,
  useCreatePost,
  useFeatures,
  useFeedbackContext,
  useFeedbackStrings,
  useFeedbackTheme,
  useHasFeedbackProvider,
  useMarkUpdatesSeen,
  useModeration,
  usePost,
  usePosts,
  useRoadmap,
  useUpdates,
  useUpload,
  useVote,
} from '../src/react';

function setup(
  options: MemoryAdapterOptions = {},
  props: { features?: ClientFeatures; onEvent?: () => void; adapter?: FeedbackAdapter } = {},
) {
  const adapter = props.adapter ?? createMemoryAdapter(options);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onEvent = props.onEvent ?? vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <FeedbackProvider adapter={adapter} features={props.features} onEvent={onEvent} queryClient={queryClient} locale="nl">
      {children}
    </FeedbackProvider>
  );
  return { adapter, queryClient, onEvent, wrapper };
}

const seeded = (): MemoryAdapterOptions => ({
  posts: [
    { id: 'p1', title: 'Dark mode', score: 3, upvotes: 3, status: 'planned' },
    { id: 'p2', title: 'Widgets', score: 1, upvotes: 1 },
  ],
});

describe('FeedbackProvider', () => {
  it('requires a project key or an adapter', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => null, { wrapper: ({ children }) => <FeedbackProvider>{children}</FeedbackProvider> })).toThrow(
      'pass either `projectKey` or a custom `adapter`',
    );
  });

  it('exposes theme, strings and provider presence; hooks throw outside it', () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => ({ theme: useFeedbackTheme(), strings: useFeedbackStrings(), has: useHasFeedbackProvider() }), {
      wrapper,
    });
    expect(result.current.strings.tabs.roadmap).toBe('Roadmap');
    expect(result.current.strings.sort.top).toBe('Populair');
    expect(result.current.theme.colorScheme).toBe('light');
    expect(result.current.has).toBe(true);

    expect(renderHook(() => useHasFeedbackProvider()).result.current).toBe(false);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useFeedbackContext())).toThrow('inside <FeedbackProvider>');
  });

  it('builds a hosted adapter from a project key, scoped by user', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <FeedbackProvider projectKey="pk_1" userToken="tok" baseUrl="https://api.test">
        {children}
      </FeedbackProvider>
    );
    const { result } = renderHook(() => useFeedbackContext(), { wrapper });
    expect(result.current.scope).toBe('pk_1|tok');
    expect(typeof result.current.adapter.listPosts).toBe('function');
  });
});

describe('useFeatures', () => {
  it('lets the client hide features but never enable what the server disabled', async () => {
    const { wrapper } = setup(
      { settings: { allowDownvotes: false, inAppAdmin: true }, viewer: { id: 'boss', isAdmin: true } },
      {
        features: { roadmap: false, downvote: true, admin: true },
      },
    );
    const { result } = renderHook(() => useFeatures(), { wrapper });
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current).toMatchObject({ roadmap: false, downvote: false, vote: true, admin: true, comments: true });
  });

  it('turns downvotes off with votes, and admin off on request', async () => {
    const { wrapper } = setup(
      { settings: { inAppAdmin: true }, viewer: { id: 'boss', isAdmin: true } },
      { features: { vote: false, admin: false } },
    );
    const { result } = renderHook(() => useFeatures(), { wrapper });
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current).toMatchObject({ vote: false, downvote: false, admin: false });
  });
});

describe('posts and votes', () => {
  it('pages through posts and loads one post', async () => {
    const { wrapper } = setup({ posts: Array.from({ length: 25 }, (_, i) => ({ id: `p${i}`, title: `Idea ${i}`, score: 100 - i })) });
    const { result } = renderHook(() => ({ list: usePosts({ sort: 'top' }), one: usePost('p3') }), { wrapper });
    await waitFor(() => expect(result.current.list.data?.pages).toHaveLength(1));
    expect(result.current.list.hasNextPage).toBe(true);
    await act(() => result.current.list.fetchNextPage());
    await waitFor(() => expect(result.current.list.data!.pages.flatMap((p) => p.items)).toHaveLength(25));
    await waitFor(() => expect(result.current.one.data?.title).toBe('Idea 3'));
  });

  it('refetches only the first page of a scrolled list after creating a post', async () => {
    const { wrapper, adapter } = setup({
      posts: Array.from({ length: 45 }, (_, i) => ({ id: `p${i}`, title: `Idea ${i}`, score: 100 - i })),
    });
    const listPosts = vi.spyOn(adapter, 'listPosts');
    const { result } = renderHook(() => ({ list: usePosts({ sort: 'top' }), create: useCreatePost() }), { wrapper });
    await waitFor(() => expect(result.current.list.data?.pages).toHaveLength(1));
    await act(() => result.current.list.fetchNextPage());
    await act(() => result.current.list.fetchNextPage());
    await waitFor(() => expect(result.current.list.data?.pages).toHaveLength(3));
    listPosts.mockClear();
    await act(() => result.current.create.mutateAsync({ title: 'Fresh idea', body: '' }));
    await waitFor(() => expect(result.current.list.isFetching).toBe(false));
    expect(listPosts).toHaveBeenCalledTimes(1);
    expect(result.current.list.data?.pages).toHaveLength(1);
  });

  it('applies a vote to every cached copy and reports it', async () => {
    const { wrapper, onEvent } = setup(seeded());
    const { result } = renderHook(() => ({ list: usePosts(), one: usePost('p1'), roadmap: useRoadmap(), vote: useVote() }), { wrapper });
    await waitFor(() => expect(result.current.roadmap.data && result.current.one.data && result.current.list.data).toBeTruthy());
    act(() => result.current.vote.mutate({ post: result.current.one.data!, value: 1 }));
    await waitFor(() => expect(result.current.vote.isSuccess).toBe(true));
    expect(result.current.one.data).toMatchObject({ myVote: 1, score: 4 });
    expect(result.current.list.data!.pages[0]!.items.find((p) => p.id === 'p1')).toMatchObject({ score: 4 });
    expect(result.current.roadmap.data![0]!.posts[0]).toMatchObject({ id: 'p1', score: 4 });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'voted' }));
  });

  it('creates posts, uploads and refreshes lists', async () => {
    const { wrapper, onEvent, adapter } = setup(seeded());
    const { result } = renderHook(() => ({ list: usePosts(), create: useCreatePost(), upload: useUpload() }), { wrapper });
    await waitFor(() => expect(result.current.list.data).toBeDefined());
    const file = await act(() => result.current.upload.mutateAsync({ uri: 'file://a.png', name: 'a.png', type: 'image/png' }));
    await act(() => result.current.create.mutateAsync({ title: 'New thing', body: '', attachmentIds: [file.id] }));
    await waitFor(() => expect(result.current.list.data!.pages[0]!.items.some((p) => p.title === 'New thing')).toBe(true));
    expect(adapter.posts[0]!.attachments[0]!.url).toBe('file://a.png');
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'post_created' }));
  });

  it('reports failed creates and uploads through onEvent', async () => {
    const { wrapper, onEvent } = setup({ viewer: null });
    const { result } = renderHook(() => ({ create: useCreatePost(), upload: useUpload() }), { wrapper });
    await act(async () => {
      await result.current.create.mutateAsync({ title: 'Nope', body: '' }).catch(() => {});
      await result.current.upload.mutateAsync({ uri: 'x', name: 'x', type: 'image/png' }).catch(() => {});
    });
    expect(onEvent.mock.calls.filter(([e]) => (e as { type: string }).type === 'error')).toHaveLength(2);
  });
});

describe('comments', () => {
  it('appends a new comment when every page is loaded and bumps the count', async () => {
    const { wrapper, onEvent } = setup(seeded());
    const { result } = renderHook(() => ({ comments: useComments('p1'), post: usePost('p1'), create: useCreateComment('p1') }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.comments.data && result.current.post.data).toBeTruthy());
    await act(() => result.current.create.mutateAsync({ body: 'First' }));
    await waitFor(() => expect(result.current.comments.data!.pages[0]!.items.map((c) => c.body)).toEqual(['First']));
    expect(result.current.post.data!.commentCount).toBe(1);
    expect(onEvent).toHaveBeenCalledWith({ type: 'comment_created', postId: 'p1' });
  });

  it('refetches instead of appending when more pages remain', async () => {
    const { wrapper, queryClient, adapter } = setup(seeded());
    const { result } = renderHook(
      () => ({ comments: useComments('p1'), create: useCreateComment('p1'), scope: useFeedbackContext().scope }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.comments.data).toBeDefined());
    // Pretend the server said there is another page.
    queryClient.setQueryData(feedbackKeys.comments(result.current.scope, 'p1'), {
      pages: [{ items: [], nextCursor: '50' }],
      pageParams: [null],
    });
    const list = vi.spyOn(adapter, 'listComments');
    await act(() => result.current.create.mutateAsync({ body: 'Later' }));
    await waitFor(() => expect(list).toHaveBeenCalled());
    await waitFor(() => expect(result.current.comments.data!.pages.flatMap((p) => p.items).map((c) => c.body)).toEqual(['Later']));
  });
});

describe('updates', () => {
  it('loads updates and clears the unseen count', async () => {
    const { wrapper } = setup({ posts: [{ title: 'Mine', isMine: true, statusChangedAt: Date.now() }] });
    const { result } = renderHook(() => ({ updates: useUpdates(), seen: useMarkUpdatesSeen() }), { wrapper });
    await waitFor(() => expect(result.current.updates.data?.unseen).toBe(1));
    await act(() => result.current.seen.mutateAsync());
    await waitFor(() => expect(result.current.updates.data!.unseen).toBe(0));
  });
});

describe('moderation', () => {
  const adminSetup = () =>
    setup({
      settings: { inAppAdmin: true },
      viewer: { id: 'boss', isAdmin: true },
      posts: [
        { id: 'q1', title: 'Pending one', moderation: 'pending' },
        { id: 'q2', title: 'Pending two', moderation: 'pending' },
        { id: 'a1', title: 'Live', status: 'open' },
        { id: 'a2', title: 'Duplicate' },
      ],
    });

  it('approves, declines, updates, merges and deletes, keeping the queue fresh', async () => {
    const { wrapper, adapter } = adminSetup();
    const { result } = renderHook(() => ({ queue: useAdminQueue(), m: useModeration(), live: usePost('a1') }), { wrapper });
    await waitFor(() => expect(result.current.queue.data?.pages[0]?.items).toHaveLength(2));

    await act(() => result.current.m.approve.mutateAsync('q1'));
    await act(() => result.current.m.decline.mutateAsync({ id: 'q2', reason: 'Spam' }));
    await waitFor(() => expect(result.current.queue.data!.pages[0]!.items).toHaveLength(0));
    expect(adapter.posts.find((p) => p.id === 'q2')).toMatchObject({ moderation: 'declined', declineReason: 'Spam' });

    await act(() => result.current.m.update.mutateAsync({ id: 'a1', patch: { status: 'in_progress' } }));
    await waitFor(() => expect(result.current.live.data?.status).toBe('in_progress'));
    await act(() => result.current.m.merge.mutateAsync({ id: 'a2', intoId: 'a1' }));
    expect(adapter.posts.find((p) => p.id === 'a2')!.mergedIntoId).toBe('a1');
    await act(() => result.current.m.remove.mutateAsync('q1'));
    expect(adapter.posts.some((p) => p.id === 'q1')).toBe(false);
  });

  it('fails clearly when the adapter has no admin support', async () => {
    const base = createMemoryAdapter();
    const { admin: _admin, ...adapter } = base;
    const { wrapper, onEvent } = setup({}, { adapter: adapter as FeedbackAdapter });
    const { result } = renderHook(() => ({ queue: useAdminQueue(), m: useModeration() }), { wrapper });
    expect(result.current.queue.fetchStatus).toBe('idle');
    await act(async () => {
      await result.current.m.approve.mutateAsync('x').catch(() => {});
    });
    await waitFor(() => expect(result.current.m.approve.error?.message).toBe('This adapter has no admin support'));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });
});

describe('identity changes', () => {
  it('drops cached data when the adapter switches user', async () => {
    const adapter = createMemoryAdapter(seeded());
    let notify = () => {};
    adapter.subscribeIdentity = (listener) => {
      notify = listener;
      return () => {};
    };
    const list = vi.spyOn(adapter, 'listPosts');
    const { wrapper } = setup({}, { adapter });
    const { result } = renderHook(() => usePosts(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(list).toHaveBeenCalledTimes(1);
    act(() => notify());
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });
});
