import { describeError, formatRelativeTime, type Post } from '@kobecuppens/feedback-core';
import { memo, type CSSProperties } from 'react';
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

/** Visually hidden but read by screen readers; inline so it also works with `unstyled`. */
export const srOnly: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export function tint(color: string | null | undefined): string | undefined {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? `${color}22` : undefined;
}

export function Button(props: ButtonProps) {
  const { components, slot } = useUI();
  if (components.Button) return <components.Button {...props} />;
  const variant = props.variant ?? 'primary';
  return (
    <button
      type={props.type ?? 'button'}
      {...slot(variant === 'primary' ? 'button' : variant === 'danger' ? 'buttonDanger' : 'buttonSecondary')}
      // Busy is aria-disabled, not disabled: a disabled button drops focus to <body>, and a
      // keyboard user would stay there if the request then fails. preventDefault also stops
      // a busy submit button from submitting its form again.
      onClick={props.loading ? (e) => e.preventDefault() : props.onClick}
      disabled={props.disabled}
      aria-disabled={props.loading || undefined}
      aria-busy={props.loading || undefined}
    >
      {props.loading ? <Spinner label={props.label} /> : props.label}
    </button>
  );
}

function Spinner({ label }: { label: string }) {
  const { slot } = useUI();
  return <span {...slot('spinner')} role="status" aria-label={label} />;
}

/** A failed action's localized message, announced to screen readers. */
export function InlineError({ error }: { error: unknown }) {
  const { slot, strings } = useUI();
  if (!error) return null;
  return (
    <p {...slot('errorText')} role="alert">
      {describeError(strings, error)}
    </p>
  );
}

export function StatusPill(props: StatusPillProps) {
  const { components, slot, theme } = useUI();
  if (components.StatusPill) return <components.StatusPill {...props} />;
  const color = theme.colors.status[props.status];
  const s = slot('statusPill');
  return (
    <span className={s.className} style={{ color, background: tint(color), ...s.style }} data-status={props.status}>
      {props.label}
    </span>
  );
}

export function CategoryPill({ name, color }: { name: string; color: string | null }) {
  const { slot } = useUI();
  const s = slot('categoryPill');
  return (
    <span className={s.className} style={{ ...(color ? { color, background: tint(color) } : null), ...s.style }}>
      {name}
    </span>
  );
}

export function VoteControl(props: VoteControlProps) {
  const { components, slot, strings } = useUI();
  if (components.VoteControl) return <components.VoteControl {...props} />;
  const { post, onVote, disabled, showDownvote } = props;
  const arrow = (value: 1 | -1) => {
    const active = post.myVote === value;
    return (
      <button
        type="button"
        {...slot('voteButton', active && 'voteButtonActive')}
        aria-label={value === 1 ? strings.post.upvote : strings.post.downvote}
        aria-pressed={active}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onVote(value);
        }}
      >
        {value === 1 ? '▲' : '▼'}
      </button>
    );
  };
  return (
    <div {...slot('voteBox')}>
      {arrow(1)}
      <span {...slot('voteCount')}>
        <span aria-hidden="true">{post.score}</span>
        <span style={srOnly}>{strings.post.votes(post.score)}</span>
      </span>
      {showDownvote && arrow(-1)}
    </div>
  );
}

export function Avatar(props: AvatarProps) {
  const { components, slot } = useUI();
  if (components.Avatar) return <components.Avatar {...props} />;
  return (
    <span {...slot('avatar')} aria-hidden="true">
      {props.src ? <img src={props.src} alt="" /> : (props.name ?? '?').trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

export function EmptyState(props: EmptyStateProps) {
  const { components, slot } = useUI();
  if (components.EmptyState) return <components.EmptyState {...props} />;
  return (
    <div {...slot('empty')}>
      <p style={{ margin: 0 }}>{props.message}</p>
      {props.action && <Button label={props.action.label} onClick={props.action.onClick} variant="secondary" />}
    </div>
  );
}

export function Loading() {
  const { components, slot, strings } = useUI();
  if (components.Loading) return <components.Loading />;
  return (
    <div {...slot('loading')}>
      <Spinner label={strings.common.loading} />
    </div>
  );
}

export function ErrorState({ error, onRetry, message }: { error: unknown; onRetry?: () => void; message?: string }) {
  const { strings } = useUI();
  return (
    <EmptyState
      message={message ?? describeError(strings, error)}
      action={onRetry ? { label: strings.errors.retry, onClick: onRetry } : undefined}
    />
  );
}

export function Header(props: HeaderProps) {
  const { components, slot, strings, hideHeader } = useUI();
  if (hideHeader) return null;
  if (components.Header) return <components.Header {...props} />;
  return (
    <div {...slot('header')}>
      {props.onBack && (
        <button type="button" {...slot('backButton')} onClick={props.onBack}>
          ‹ {strings.post.back}
        </button>
      )}
      {/* Focus target for the board's navigation (see BoardNavigator). */}
      <h2 {...slot('headerTitle')} tabIndex={-1} data-fb-screen-title>
        {props.title}
      </h2>
      {props.right}
    </div>
  );
}

export function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  const { slot } = useUI();
  return (
    <button type="button" {...slot('chip', active && 'chipActive')} aria-pressed={active} onClick={onClick}>
      {label}
    </button>
  );
}

export function PostStatusPill({ post }: { post: Post }) {
  const { strings } = useUI();
  if (post.moderation === 'pending') return <StatusPill status="pending" label={strings.moderation.pending} />;
  if (post.moderation === 'declined') return <StatusPill status="declined" label={strings.moderation.declined} />;
  return <StatusPill status={post.status} label={strings.status[post.status]} />;
}

/**
 * The title is the card's link (a real heading containing a button, so heading
 * navigation works); CSS stretches its hit area over the whole card. Memoized on data:
 * lists pass callbacks that delegate to the latest handlers.
 */
export const PostCard = memo(
  function PostCard(props: PostCardProps) {
    const { components, slot, strings } = useUI();
    if (components.PostCard) return <components.PostCard {...props} />;
    const { post } = props;
    return (
      <article {...slot('card', post.moderation !== 'approved' && 'cardPending')}>
        <VoteControl
          post={post}
          onVote={props.onVote}
          disabled={!props.canVote || post.moderation !== 'approved'}
          showDownvote={props.canDownvote}
        />
        <div {...slot('cardBody')}>
          <h3 {...slot('cardTitle')}>
            <button type="button" {...slot('cardLink')} onClick={props.onOpen}>
              {post.title}
            </button>
          </h3>
          {post.body && <p {...slot('cardExcerpt')}>{post.body}</p>}
          <span {...slot('cardMeta')}>
            <PostStatusPill post={post} />
            {post.category && <CategoryPill name={post.category.name} color={post.category.color} />}
            <span {...slot('cardMetaText')}>
              {strings.post.comments(post.commentCount)} · {formatRelativeTime(strings, post.createdAt)}
            </span>
          </span>
        </div>
      </article>
    );
  },
  (a, b) => a.post === b.post && a.canVote === b.canVote && a.canDownvote === b.canDownvote,
);
