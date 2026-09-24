import { formatRelativeTime, type Post, type PostStatus } from '@kobecuppens/feedback-core';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import {
  useUI,
  type AvatarProps,
  type ButtonProps,
  type EmptyStateProps,
  type HeaderProps,
  type PostCardProps,
  type StatusPillProps,
  type VoteControlProps,
} from './ui';

/** Translucent background for a status/category colour; non-hex colours fall back to the neutral surface. */
export function tint(color: string | null | undefined, fallback: string): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? `${color}22` : fallback;
}

export function Button(props: ButtonProps) {
  const { components, styles, theme } = useUI();
  if (components.Button) return <components.Button {...props} />;
  const variant = props.variant ?? 'primary';
  const box = variant === 'primary' ? styles.button : variant === 'danger' ? styles.buttonDanger : styles.buttonSecondary;
  const label = variant === 'primary' ? styles.buttonText : variant === 'danger' ? styles.buttonDangerText : styles.buttonSecondaryText;
  const disabled = props.disabled || props.loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ disabled: !!disabled, busy: !!props.loading }}
      disabled={disabled}
      onPress={props.onPress}
      style={({ pressed }) => [box, disabled && styles.buttonDisabled, pressed && { opacity: 0.8 }]}
    >
      {props.loading ? (
        <ActivityIndicator color={variant === 'secondary' ? theme.colors.text : theme.colors.onPrimary} />
      ) : (
        <Text style={label}>{props.label}</Text>
      )}
    </Pressable>
  );
}

export function StatusPill(props: StatusPillProps) {
  const { components, styles, theme } = useUI();
  if (components.StatusPill) return <components.StatusPill {...props} />;
  const color = theme.colors.status[props.status];
  return (
    <View style={[styles.statusPill, { backgroundColor: tint(color, theme.colors.surfaceAlt) }]}>
      <Text style={[styles.statusPillText, { color }]}>{props.label}</Text>
    </View>
  );
}

export function CategoryPill({ name, color }: { name: string; color: string | null }) {
  const { styles, theme } = useUI();
  return (
    <View style={[styles.categoryPill, color ? { backgroundColor: tint(color, theme.colors.surfaceAlt) } : null]}>
      <Text style={[styles.categoryPillText, color ? { color } : null]}>{name}</Text>
    </View>
  );
}

export function VoteControl(props: VoteControlProps) {
  const { components, styles, strings } = useUI();
  if (components.VoteControl) return <components.VoteControl {...props} />;
  const { post, onVote, disabled, showDownvote } = props;
  const arrow = (value: 1 | -1) => {
    const active = post.myVote === value;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={value === 1 ? strings.post.upvote : strings.post.downvote}
        accessibilityState={{ selected: active, disabled }}
        disabled={disabled}
        onPress={() => onVote(value)}
        hitSlop={6}
        style={[styles.voteButton, active && styles.voteButtonActive, disabled && styles.buttonDisabled]}
      >
        <Text style={[styles.voteArrow, active && styles.voteArrowActive]}>{value === 1 ? '▲' : '▼'}</Text>
      </Pressable>
    );
  };
  return (
    <View style={styles.voteBox}>
      {arrow(1)}
      <Text style={styles.voteCount} accessibilityLabel={strings.post.votes(post.score)}>
        {post.score}
      </Text>
      {showDownvote && arrow(-1)}
    </View>
  );
}

export function Avatar(props: AvatarProps) {
  const { components, styles } = useUI();
  if (components.Avatar) return <components.Avatar {...props} />;
  return (
    <View style={styles.avatar}>
      {props.uri ? (
        <Image source={{ uri: props.uri }} style={{ width: '100%', height: '100%' }} accessibilityIgnoresInvertColors />
      ) : (
        <Text style={styles.avatarText}>{(props.name ?? '?').trim().charAt(0).toUpperCase() || '?'}</Text>
      )}
    </View>
  );
}

export function EmptyState(props: EmptyStateProps) {
  const { components, styles } = useUI();
  if (components.EmptyState) return <components.EmptyState {...props} />;
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{props.message}</Text>
      {props.action && <Button label={props.action.label} onPress={props.action.onPress} variant="secondary" />}
    </View>
  );
}

export function Loading() {
  const { components, styles, theme } = useUI();
  if (components.Loading) return <components.Loading />;
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={theme.colors.primary} />
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { strings } = useUI();
  const offline = error instanceof TypeError; // fetch network failures
  return (
    <EmptyState
      message={offline ? strings.errors.network : strings.errors.generic}
      action={onRetry ? { label: strings.errors.retry, onPress: onRetry } : undefined}
    />
  );
}

export function Header(props: HeaderProps) {
  const { components, styles, strings, hideHeader } = useUI();
  if (hideHeader) return null;
  if (components.Header) return <components.Header {...props} />;
  return (
    <View style={styles.header}>
      {props.onBack && (
        <Pressable accessibilityRole="button" accessibilityLabel={strings.post.back} onPress={props.onBack} style={styles.backButton} hitSlop={8}>
          <Text style={styles.backButtonText}>‹ {strings.post.back}</Text>
        </Pressable>
      )}
      <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">
        {props.title}
      </Text>
      {props.right}
    </View>
  );
}

export function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { styles } = useUI();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

/** Moderation state for the author's own posts, otherwise the public status. */
export function PostStatusPill({ post }: { post: Post }) {
  const { strings } = useUI();
  if (post.moderation === 'pending') return <StatusPill status="pending" label={strings.moderation.pending} />;
  if (post.moderation === 'declined') return <StatusPill status="declined" label={strings.moderation.declined} />;
  return <StatusPill status={post.status} label={strings.status[post.status as PostStatus]} />;
}

export function PostCard(props: PostCardProps) {
  const { components, styles, strings } = useUI();
  if (components.PostCard) return <components.PostCard {...props} />;
  const { post } = props;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={post.title}
      onPress={props.onPress}
      style={({ pressed }) => [styles.card, post.moderation !== 'approved' && styles.cardPending, pressed && { opacity: 0.85 }]}
    >
      <VoteControl
        post={post}
        onVote={props.onVote}
        disabled={!props.canVote || post.moderation !== 'approved'}
        showDownvote={props.canDownvote}
      />
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {post.title}
        </Text>
        {post.body ? (
          <Text style={styles.cardExcerpt} numberOfLines={2}>
            {post.body}
          </Text>
        ) : null}
        <View style={styles.cardMeta}>
          <PostStatusPill post={post} />
          {post.category && <CategoryPill name={post.category.name} color={post.category.color} />}
          <Text style={styles.cardMetaText}>
            {strings.post.comments(post.commentCount)} · {formatRelativeTime(strings, post.createdAt)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
