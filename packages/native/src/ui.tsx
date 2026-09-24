import { useFeedbackContext, useStableValue } from '@kobecuppens/feedback-core/react';
import type { FeedbackStrings, FeedbackTheme, Post, PostStatus, UploadFile } from '@kobecuppens/feedback-core';
import { createContext, useContext, useMemo, type ComponentType, type ReactNode } from 'react';
import { makeBaseStyles, mergeStyles, type FeedbackStyles, type SlotName, type SlotStyle } from './styles';

export interface PickedImage {
  file: UploadFile;
  /** Local URI for the preview thumbnail. */
  previewUri: string;
}

/** Return null when the user cancels. */
export type PickImage = () => Promise<PickedImage | null>;

export interface PostCardProps {
  post: Post;
  onPress: () => void;
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
  action?: { label: string; onPress: () => void };
}
export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
}
export interface HeaderProps {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
}
export interface AvatarProps {
  name: string | null;
  uri: string | null;
}

/** Replace any building block with your own component. */
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

export interface NativeUIOptions {
  styles?: FeedbackStyles;
  components?: FeedbackComponents;
  pickImage?: PickImage;
  /** Hide the internal header (e.g. when your navigator already shows one). */
  hideHeader?: boolean;
}

interface NativeUIValue {
  styles: Record<SlotName, SlotStyle>;
  components: FeedbackComponents;
  pickImage?: PickImage;
  hideHeader: boolean;
}

const NativeUIContext = createContext<NativeUIValue | null>(null);

export function NativeUIProvider({ options, children }: { options: NativeUIOptions; children: ReactNode }) {
  const { theme } = useFeedbackContext();
  const base = useMemo(() => makeBaseStyles(theme), [theme]);
  // Inline objects are the common case; compare by content so the style table and cards stay stable.
  const styleOverrides = useStableValue(options.styles);
  const components = useStableValue(options.components);
  const styles = useMemo(() => mergeStyles(base, styleOverrides), [base, styleOverrides]);
  const value = useMemo(
    () => ({ styles, components: components ?? {}, pickImage: options.pickImage, hideHeader: !!options.hideHeader }),
    [styles, components, options.pickImage, options.hideHeader],
  );
  return <NativeUIContext.Provider value={value}>{children}</NativeUIContext.Provider>;
}

export interface UI extends NativeUIValue {
  theme: FeedbackTheme;
  strings: FeedbackStrings;
}

/** Styles, overrides, theme and strings for the current board. */
export function useUI(): UI {
  const ctx = useContext(NativeUIContext);
  const { theme, strings } = useFeedbackContext();
  const fallback = useMemo(() => (ctx ? null : makeBaseStyles(theme)), [ctx, theme]);
  return ctx ? { ...ctx, theme, strings } : { styles: fallback!, components: {}, hideHeader: false, theme, strings };
}
