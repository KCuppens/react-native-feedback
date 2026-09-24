import type { Post } from '@kobecuppens/feedback-core';
import { useAdminQueue, useModeration } from '@kobecuppens/feedback-core/react';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { Button, EmptyState, ErrorState, InlineError, Loading } from '../components';
import { useUI } from '../ui';

export interface FeedbackAdminQueueProps {
  onOpenPost: (post: Post) => void;
}

/** Pending posts with approve/decline. Only renders for in-app admins. */
export function FeedbackAdminQueue({ onOpenPost }: FeedbackAdminQueueProps) {
  const { styles, strings } = useUI();
  const query = useAdminQueue();
  const posts = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.listContent}
      data={posts}
      keyExtractor={(p) => p.id}
      ListEmptyComponent={<EmptyState message={strings.admin.queueEmpty} />}
      renderItem={({ item }) => <QueueItem post={item} onOpen={() => onOpenPost(item)} />}
      onEndReached={() => {
        if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
      }}
    />
  );
}

function QueueItem({ post, onOpen }: { post: Post; onOpen: () => void }) {
  const { styles, strings, theme } = useUI();
  const moderation = useModeration();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const failed = [moderation.approve, moderation.decline].find((mutation) => mutation.isError);
  return (
    <View style={[styles.card, { flexDirection: 'column' }]}>
      <InlineError error={failed?.error} />
      <Pressable accessibilityRole="button" onPress={onOpen} style={{ gap: theme.spacing.xs }}>
        <Text style={styles.cardTitle}>{post.title}</Text>
        {post.body ? (
          <Text style={styles.cardExcerpt} numberOfLines={4}>
            {post.body}
          </Text>
        ) : null}
        <Text style={styles.cardMetaText}>{strings.post.by(post.author.name ?? strings.post.anonymous)}</Text>
      </Pressable>
      {declining ? (
        <View style={{ gap: theme.spacing.sm }}>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder={strings.admin.declineReasonPlaceholder}
            placeholderTextColor={theme.colors.textMuted}
            style={styles.input}
            accessibilityLabel={strings.admin.declineReasonPlaceholder}
          />
          <View style={styles.adminRow}>
            <Button
              label={strings.admin.confirmDecline}
              variant="danger"
              loading={moderation.decline.isPending}
              onPress={() => moderation.decline.mutate({ id: post.id, reason: reason.trim() || null })}
            />
            <Button label={strings.admin.cancel} variant="secondary" onPress={() => setDeclining(false)} />
          </View>
        </View>
      ) : (
        <View style={styles.adminRow}>
          <Button
            label={strings.admin.approve}
            onPress={() => moderation.approve.mutate(post.id)}
            loading={moderation.approve.isPending && moderation.approve.variables === post.id}
          />
          <Button label={strings.admin.decline} variant="secondary" onPress={() => setDeclining(true)} />
        </View>
      )}
    </View>
  );
}
