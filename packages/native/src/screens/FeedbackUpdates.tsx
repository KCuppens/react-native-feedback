import { formatRelativeTime, type Post, type UpdateItem } from '@kobecuppens/feedback-core';
import { useMarkUpdatesSeen, useUpdates } from '@kobecuppens/feedback-core/react';
import { useEffect } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { EmptyState, ErrorState, Loading } from '../components';
import { useUI } from '../ui';

export interface FeedbackUpdatesProps {
  onOpenPost: (post: Post) => void;
  /** Mark updates as seen when this screen is shown. Default true. */
  markSeen?: boolean;
}

export function FeedbackUpdates({ onOpenPost, markSeen = true }: FeedbackUpdatesProps) {
  const { styles, strings } = useUI();
  const query = useUpdates();
  const seen = useMarkUpdatesSeen();
  const unseen = query.data?.unseen ?? 0;

  // Intentional dependencies: the mutation object changes every render; only a new unseen count should trigger this
  useEffect(() => {
    if (markSeen && unseen > 0 && !seen.isPending) seen.mutate();
  }, [markSeen, unseen]);

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const label = (item: UpdateItem) => {
    switch (item.kind) {
      case 'approved':
        return strings.updates.approved;
      case 'declined':
        return strings.updates.declined;
      case 'official_reply':
        return strings.updates.officialReply;
      case 'status':
        return strings.updates.statusChanged(strings.status[item.post.status]);
    }
  };

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.listContent}
      data={query.data.items}
      keyExtractor={(item) => `${item.post.id}:${item.kind}:${item.at}`}
      ListEmptyComponent={<EmptyState message={strings.updates.empty} />}
      renderItem={({ item }) => (
        <Pressable accessibilityRole="button" onPress={() => onOpenPost(item.post)} style={styles.updateItem}>
          <View style={styles.commentHeader}>
            <Text style={styles.updateKind}>{label(item)}</Text>
            {/* Growing past its text width keeps Android from dropping the last word ("just now"). */}
            <Text style={[styles.commentTime, { flexGrow: 1 }]} numberOfLines={1}>
              {formatRelativeTime(strings, item.at)}
            </Text>
          </View>
          <Text style={styles.updateTitle} numberOfLines={2}>
            {item.post.title}
          </Text>
        </Pressable>
      )}
    />
  );
}

/** Unseen-updates count, e.g. for a tab-bar icon badge. Renders nothing at zero. */
export function FeedbackUpdatesBadge() {
  const { styles } = useUI();
  const { data } = useUpdates();
  if (!data?.unseen) return null;
  return (
    <View style={styles.tabBadge} accessibilityLabel={`${data.unseen}`}>
      <Text style={styles.tabBadgeText}>{data.unseen > 99 ? '99+' : data.unseen}</Text>
    </View>
  );
}
