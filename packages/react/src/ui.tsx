import { useFeedbackContext, useStableValue } from '@kobecuppens/feedback-core/react';
import type { FeedbackStrings, FeedbackTheme, Post, PostStatus } from '@kobecuppens/feedback-core';
import { createContext, useContext, useMemo, type ComponentType, type CSSProperties, type ReactNode } from 'react';

export const SLOT_NAMES = [
  'root',
  'header',
  'headerTitle',
  'backButton',
  'tabBar',
  'tab',
  'tabActive',
  'tabBadge',
  'toolbar',
  'searchInput',
  'chipRow',
  'chip',
  'chipActive',
  'list',
  'card',
  'cardPending',
  'cardBody',
  'cardTitle',
  'cardLink',
  'cardExcerpt',
  'cardMeta',
  'cardMetaText',
  'voteBox',
  'voteButton',
  'voteButtonActive',
  'voteCount',
  'statusPill',
  'categoryPill',
  'moderationBanner',
  'button',
  'buttonSecondary',
  'buttonDanger',
  'fab',
  'form',
  'inputLabel',
  'input',
  'textarea',
  'helperText',
  'errorText',
  'detail',
  'detailTitle',
  'detailBody',
  'attachmentRow',
  'attachmentImage',
  'sectionTitle',
  'commentList',
  'commentItem',
  'commentOfficial',
  'commentHeader',
  'commentAuthor',
  'commentTime',
  'commentBody',
  'officialBadge',
  'composer',
  'composerInput',
  'avatar',
  'empty',
  'loading',
  'spinner',
  'roadmap',
  'roadmapColumn',
  'roadmapColumnHeader',
  'roadmapCount',
  'roadmapCard',
  'roadmapCardTitle',
  'updateItem',
  'updateKind',
  'updateTitle',
  'adminBar',
  'adminRow',
] as const;

export type SlotName = (typeof SLOT_NAMES)[number];
export type FeedbackClassNames = Partial<Record<SlotName, string>>;
export type FeedbackStyles = Partial<Record<SlotName, CSSProperties>>;

export interface PostCardProps {
  post: Post;
  onOpen: () => void;
  onVote: (value: 1 | -1) => void;
  canVote: boolean;
  canDownvote: boolean;
}
export interface VoteControlProps {
  post: Post;
  onVote: (value: 1 | -1) => void;
  disabled: boolean;
  showDownvote: boolean;
}
export interface StatusPillProps {
  status: PostStatus | 'pending' | 'declined';
  label: string;
}
export interface EmptyStateProps {
  message: string;
  action?: { label: string; onClick: () => void };
}
export interface ButtonProps {
  label: string;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit';
}
export interface HeaderProps {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
}
export interface AvatarProps {
  name: string | null;
  src: string | null;
}

export interface FeedbackComponents {
  PostCard?: ComponentType<PostCardProps>;
  VoteControl?: ComponentType<VoteControlProps>;
  StatusPill?: ComponentType<StatusPillProps>;
  EmptyState?: ComponentType<EmptyStateProps>;
  Button?: ComponentType<ButtonProps>;
  Header?: ComponentType<HeaderProps>;
  Avatar?: ComponentType<AvatarProps>;
  Loading?: ComponentType;
}

export interface DomUIOptions {
  /** Extra class names per slot (Tailwind, CSS modules, …). */
  classNames?: FeedbackClassNames;
  /** Inline style overrides per slot. */
  styles?: FeedbackStyles;
  components?: FeedbackComponents;
  /** Drop the built-in `fb-*` classes and stylesheet entirely; style from scratch. */
  unstyled?: boolean;
  hideHeader?: boolean;
}

interface DomUIValue extends Required<Omit<DomUIOptions, 'classNames' | 'styles' | 'components'>> {
  classNames: FeedbackClassNames;
  styles: FeedbackStyles;
  components: FeedbackComponents;
}

const DomUIContext = createContext<DomUIValue | null>(null);

export function DomUIProvider({ options, children }: { options: DomUIOptions; children: ReactNode }) {
  // Inline objects are the common case; compare by content so cards stay memoized.
  const classNames = useStableValue(options.classNames);
  const styles = useStableValue(options.styles);
  const components = useStableValue(options.components);
  const value = useMemo<DomUIValue>(
    () => ({
      classNames: classNames ?? {},
      styles: styles ?? {},
      components: components ?? {},
      unstyled: !!options.unstyled,
      hideHeader: !!options.hideHeader,
    }),
    [classNames, styles, components, options.unstyled, options.hideHeader],
  );
  return <DomUIContext.Provider value={value}>{children}</DomUIContext.Provider>;
}

export interface UI extends DomUIValue {
  theme: FeedbackTheme;
  strings: FeedbackStrings;
  /** `{ className, style }` for one or more slots (later slots are modifiers, e.g. 'tab', 'tabActive'). */
  slot: (...names: (SlotName | false | null | undefined)[]) => { className: string | undefined; style: CSSProperties | undefined };
}

const EMPTY: DomUIValue = { classNames: {}, styles: {}, components: {}, unstyled: false, hideHeader: false };

export function useUI(): UI {
  const ctx = useContext(DomUIContext) ?? EMPTY;
  const { theme, strings } = useFeedbackContext();
  return useMemo(() => {
    const slot: UI['slot'] = (...names) => {
      const classes: string[] = [];
      let style: CSSProperties | undefined;
      for (const name of names) {
        if (!name) continue;
        if (!ctx.unstyled) classes.push(`fb-${name}`);
        const extra = ctx.classNames[name];
        if (extra) classes.push(extra);
        const s = ctx.styles[name];
        if (s) style = { ...style, ...s };
      }
      return { className: classes.length ? classes.join(' ') : undefined, style };
    };
    return { ...ctx, theme, strings, slot };
  }, [ctx, theme, strings]);
}
