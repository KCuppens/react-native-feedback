import { nextVote, type Post, type PostSort } from '@kobecuppens/feedback-core';
import { useConfig, useFeatures, usePosts, useVote } from '@kobecuppens/feedback-core/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Chip, EmptyState, ErrorState, Loading, PostCard } from '../components';
import { useUI } from '../ui';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export interface FeedbackListProps {
  onOpenPost: (post: Post) => void;
  onNewPost?: () => void;
  initialSort?: PostSort;
  hideToolbar?: boolean;
}

const SORTS: PostSort[] = ['top', 'trending', 'new'];

export function FeedbackList({ onOpenPost, onNewPost, initialSort = 'top', hideToolbar }: FeedbackListProps) {
  const { slot, strings } = useUI();
  const features = useFeatures();
  const { data: config } = useConfig();
  const [sort, setSort] = useState<PostSort>(initialSort);
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);
  const query = usePosts({ sort, categoryId, q: q || undefined });
  const vote = useVote();
  const posts = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const sentinel = useRef<HTMLDivElement>(null);
  // Cards are memoized on data, so give them callbacks that always reach the latest handlers.
  const handlers = useRef({ onOpenPost, mutate: vote.mutate });
  handlers.current = { onOpenPost, mutate: vote.mutate };

  // Infinite scroll where IntersectionObserver exists; a button otherwise. The observer is
  // rebuilt only when a page finishes loading (its initial callback then loads the next one
  // if the sentinel is still in view), not on every render or keystroke.
  const paging = useRef(query);
  paging.current = query;
  const { hasNextPage, isFetchingNextPage } = query;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || isFetchingNextPage || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      const q = paging.current;
      if (entries.some((e) => e.isIntersecting) && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage]);

  return (
    <>
      {!hideToolbar && (
        <div {...slot('toolbar')} role="search">
          <input
            type="search"
            {...slot('searchInput')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={strings.list.searchPlaceholder}
            aria-label={strings.list.searchPlaceholder}
          />
          <div {...slot('chipRow')}>
            {SORTS.map((s) => (
              <Chip key={s} label={strings.sort[s]} active={sort === s} onClick={() => setSort(s)} />
            ))}
          </div>
          {config && config.categories.length > 0 && (
            <div {...slot('chipRow')}>
              <Chip label={strings.list.allCategories} active={!categoryId} onClick={() => setCategoryId(undefined)} />
              {config.categories.map((cat) => (
                <Chip key={cat.id} label={cat.name} active={categoryId === cat.id} onClick={() => setCategoryId(cat.id)} />
              ))}
            </div>
          )}
        </div>
      )}
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : posts.length === 0 ? (
        <EmptyState message={q || categoryId ? strings.list.emptySearch : strings.list.empty} />
      ) : (
        <ul {...slot('list')}>
          {posts.map((post) => (
            <li key={post.id}>
              <PostCard
                post={post}
                onOpen={() => handlers.current.onOpenPost(post)}
                onVote={(v) => handlers.current.mutate({ post, value: nextVote(post.myVote, v) })}
                canVote={!!features?.vote}
                canDownvote={!!features?.downvote}
              />
            </li>
          ))}
          {query.hasNextPage && (
            <li>
              <div ref={sentinel} />
              <Button
                label={strings.list.loadMore}
                variant="secondary"
                loading={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              />
            </li>
          )}
        </ul>
      )}
      {onNewPost && features?.submit && (
        <button type="button" {...slot('button', 'fab')} onClick={onNewPost}>
          ＋ {strings.list.newPost}
        </button>
      )}
    </>
  );
}
