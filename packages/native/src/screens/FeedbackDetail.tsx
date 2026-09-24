import { formatRelativeTime, nextVote, POST_STATUSES, type Comment, type Post } from '@kobecuppens/feedback-core';
import {
  useComments,
  useCreateComment,
  useFeatures,
  useFeedbackContext,
  useModeration,
  usePost,
  useVote,
} from '@kobecuppens/feedback-core/react';
import { useEffect, useMemo, useState } from 'react';
import { Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View, type ImageStyle } from 'react-native';
import { Avatar, Button, CategoryPill, Chip, ErrorState, Header, InlineError, Loading, PostStatusPill, VoteControl } from '../components';
import { useUI } from '../ui';

export interface FeedbackDetailProps {
  postId: string;
  /** Show this immediately (e.g. from the list) while the full post loads. */
  initialPost?: Post;
  onBack?: () => void;
  /** Called after an admin deletes the post. */
  onDeleted?: () => void;
}

export function FeedbackDetail({ postId, initialPost, onBack, onDeleted }: FeedbackDetailProps) {
  const { styles, strings, theme } = useUI();
  const { onEvent } = useFeedbackContext();
  const features = useFeatures();
  const query = usePost(postId, initialPost);
  const post = query.data;
  const vote = useVote();

  useEffect(() => {
    if (post) onEvent({ type: 'post_opened', post });
    // Only once per opened post.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id]);

  if (!post) {
    return (
      <View style={styles.container}>
        <Header title="" onBack={onBack} />
        {query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : <Loading />}
      </View>
    );
  }

  const canComment = !!features?.comments && post.moderation !== 'declined' && !post.mergedIntoId;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Header title={post.title} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.detail} keyboardShouldPersistTaps="handled">
        {post.moderation !== 'approved' && (
          <View style={styles.moderationBanner}>
            <Text style={styles.moderationBannerText}>
              {post.moderation === 'pending'
                ? strings.moderation.pending
                : post.declineReason
                  ? strings.moderation.declinedWithReason(post.declineReason)
                  : strings.moderation.declined}
            </Text>
          </View>
        )}
        {post.mergedIntoId && (
          <View style={styles.moderationBanner}>
            <Text style={styles.moderationBannerText}>{strings.post.mergedInto}</Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          <VoteControl
            post={post}
            onVote={(v) => vote.mutate({ post, value: nextVote(post.myVote, v) })}
            disabled={!features?.vote || post.moderation !== 'approved' || !!post.mergedIntoId}
            showDownvote={!!features?.downvote}
          />
          <View style={{ flex: 1, gap: theme.spacing.sm }}>
            <Text style={styles.detailTitle} accessibilityRole="header">
              {post.title}
            </Text>
            <View style={styles.cardMeta}>
              <PostStatusPill post={post} />
              {post.category && <CategoryPill name={post.category.name} color={post.category.color} />}
              <Text style={styles.cardMetaText}>
                {strings.post.by(post.author.name ?? strings.post.anonymous)} · {formatRelativeTime(strings, post.createdAt)}
              </Text>
            </View>
          </View>
        </View>
        {post.body ? <Text style={styles.detailBody}>{post.body}</Text> : null}
        {post.attachments.length > 0 && (
          <View style={styles.attachmentRow} accessibilityLabel={strings.post.attachments}>
            {post.attachments.map((a, i) => (
              <Pressable
                key={a.id}
                onPress={() => Linking.openURL(a.url).catch((error: unknown) => onEvent({ type: 'error', error }))}
                accessibilityRole="imagebutton"
                accessibilityLabel={strings.post.openAttachment(i + 1)}
              >
                <Image source={{ uri: a.url }} style={styles.attachmentImage as ImageStyle} resizeMode="cover" accessibilityIgnoresInvertColors />
              </Pressable>
            ))}
          </View>
        )}
        {features?.admin && <AdminControls post={post} onDeleted={onDeleted ?? onBack} />}
        <Text style={styles.sectionTitle}>{strings.comments.title}</Text>
        <CommentList postId={post.id} />
      </ScrollView>
      {canComment ? <Composer postId={post.id} /> : null}
    </KeyboardAvoidingView>
  );
}

function CommentList({ postId }: { postId: string }) {
  const { strings, styles } = useUI();
  const query = useComments(postId);
  const comments = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (comments.length === 0) return <Text style={styles.helperText}>{strings.comments.empty}</Text>;
  return (
    <View style={{ gap: 8 }}>
      {comments.map((c) => (
        <CommentItem key={c.id} comment={c} />
      ))}
      {query.hasNextPage && (
        <Button label={strings.list.loadMore} variant="secondary" loading={query.isFetchingNextPage} onPress={() => void query.fetchNextPage()} />
      )}
    </View>
  );
}

function CommentItem({ comment }: { comment: Comment }) {
  const { styles, strings } = useUI();
  const name = comment.author.name ?? (comment.isOfficial ? strings.post.official : strings.post.anonymous);
  return (
    <View style={[styles.commentItem, comment.isOfficial && styles.commentOfficial]}>
      <View style={styles.commentHeader}>
        <Avatar name={name} uri={comment.author.avatarUrl} />
        <Text style={styles.commentAuthor}>{name}</Text>
        {comment.isOfficial && (
          <View style={styles.officialBadge}>
            <Text style={styles.officialBadgeText}>{strings.post.official}</Text>
          </View>
        )}
        <Text style={styles.commentTime}>{formatRelativeTime(strings, comment.createdAt)}</Text>
      </View>
      <Text style={styles.commentBody}>{comment.body}</Text>
    </View>
  );
}

function Composer({ postId }: { postId: string }) {
  const { styles, strings, theme } = useUI();
  const create = useCreateComment(postId);
  const [body, setBody] = useState('');
  const send = () => {
    const text = body.trim();
    if (!text) return;
    create.mutate({ body: text }, { onSuccess: () => setBody('') });
  };
  return (
    <View style={styles.composer}>
      <TextInput
        value={body}
        onChangeText={setBody}
        placeholder={strings.comments.placeholder}
        placeholderTextColor={theme.colors.textMuted}
        style={styles.composerInput}
        multiline
        accessibilityLabel={strings.comments.placeholder}
      />
      <View style={{ gap: 4, maxWidth: 160 }}>
        <Button label={strings.comments.send} onPress={send} disabled={!body.trim()} loading={create.isPending} />
        <InlineError error={create.error} />
      </View>
    </View>
  );
}

function AdminControls({ post, onDeleted }: { post: Post; onDeleted?: () => void }) {
  const { styles, strings, theme } = useUI();
  const m = useModeration();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const failed = [m.approve, m.decline, m.update, m.remove].find((mutation) => mutation.isError);

  return (
    <View style={styles.adminBar}>
      <InlineError error={failed?.error} />
      {post.moderation !== 'approved' && (
        <View style={styles.adminRow}>
          <Button label={strings.admin.approve} onPress={() => m.approve.mutate(post.id)} loading={m.approve.isPending} />
          {post.moderation === 'pending' && !declining && (
            <Button label={strings.admin.decline} variant="secondary" onPress={() => setDeclining(true)} />
          )}
        </View>
      )}
      {declining && (
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
              loading={m.decline.isPending}
              onPress={() => m.decline.mutate({ id: post.id, reason: reason.trim() || null }, { onSuccess: () => setDeclining(false) })}
            />
            <Button label={strings.admin.cancel} variant="secondary" onPress={() => setDeclining(false)} />
          </View>
        </View>
      )}
      {post.moderation === 'approved' && (
        <>
          <Text style={styles.inputLabel}>{strings.admin.changeStatus}</Text>
          <View style={styles.adminRow}>
            {POST_STATUSES.map((s) => (
              <Chip key={s} label={strings.status[s]} active={post.status === s} onPress={() => m.update.mutate({ id: post.id, patch: { status: s } })} />
            ))}
          </View>
        </>
      )}
      {confirmDelete ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text style={styles.errorText}>{strings.admin.confirmDelete}</Text>
          <View style={styles.adminRow}>
            <Button
              label={strings.admin.delete}
              variant="danger"
              loading={m.remove.isPending}
              onPress={() => m.remove.mutate(post.id, { onSuccess: () => onDeleted?.() })}
            />
            <Button label={strings.admin.cancel} variant="secondary" onPress={() => setConfirmDelete(false)} />
          </View>
        </View>
      ) : (
        <View style={styles.adminRow}>
          <Button label={strings.admin.delete} variant="secondary" onPress={() => setConfirmDelete(true)} />
        </View>
      )}
    </View>
  );
}
