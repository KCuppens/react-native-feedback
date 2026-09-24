import { nextVote, type Post, type PostSort } from '@kobecuppens/feedback-core';
import { useConfig, useFeatures, usePosts, useVote } from '@kobecuppens/feedback-core/react';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { Chip, EmptyState, ErrorState, Loading, PostCard } from '../components';
import { useUI } from '../ui';

export interface FeedbackListProps {
  onOpenPost: (post: Post) => void;
  /** Omit to hide the "New idea" button. */
  onNewPost?: () => void;
  initialSort?: PostSort;
  /** Hide search, sort and category filters. */
  hideToolbar?: boolean;
}

const SORTS: PostSort[] = ['top', 'trending', 'new'];

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function FeedbackList({ onOpenPost, onNewPost, initialSort = 'top', hideToolbar }: FeedbackListProps) {
  const { styles, strings, theme } = useUI();
  const features = useFeatures();
  const { data: config } = useConfig();
  const [sort, setSort] = useState<PostSort>(initialSort);
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);

  const query = usePosts({ sort, categoryId, q: q || undefined });
  const vote = useVote();
  const posts = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  const onVote = (post: Post, pressed: 1 | -1) => vote.mutate({ post, value: nextVote(post.myVote, pressed) });

  const toolbar = hideToolbar ? null : (
    <View style={styles.toolbar}>
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder={strings.list.searchPlaceholder}
        placeholderTextColor={theme.colors.textMuted}
        style={styles.searchInput}
        returnKeyType="search"
        autoCorrect={false}
        accessibilityLabel={strings.list.searchPlaceholder}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {SORTS.map((s) => (
          <Chip key={s} label={strings.sort[s]} active={sort === s} onPress={() => setSort(s)} />
        ))}
      </ScrollView>
      {config && config.categories.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Chip label={strings.list.allCategories} active={!categoryId} onPress={() => setCategoryId(undefined)} />
          {config.categories.map((cat) => (
            <Chip key={cat.id} label={cat.name} active={categoryId === cat.id} onPress={() => setCategoryId(cat.id)} />
          ))}
        </ScrollView>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={posts}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={toolbar}
        ListHeaderComponentStyle={{ marginHorizontal: -theme.spacing.lg, marginTop: -theme.spacing.lg }}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            onPress={() => onOpenPost(item)}
            onVote={(v) => onVote(item, v)}
            canVote={!!features?.vote}
            canDownvote={!!features?.downvote}
          />
        )}
        ListEmptyComponent={
          query.isPending ? (
            <Loading />
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <EmptyState message={q || categoryId ? strings.list.emptySearch : strings.list.empty} />
          )
        }
        ListFooterComponent={query.isFetchingNextPage ? <Loading /> : null}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={() => void query.refetch()} tintColor={theme.colors.primary} />
        }
        keyboardShouldPersistTaps="handled"
      />
      {onNewPost && features?.submit && (
        <Pressable accessibilityRole="button" onPress={onNewPost} style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]}>
          <Text style={styles.fabText}>＋ {strings.list.newPost}</Text>
        </Pressable>
      )}
    </View>
  );
}
