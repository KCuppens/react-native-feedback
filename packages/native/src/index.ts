export { FeedbackBoard, FeedbackProvider, type BoardTab, type FeedbackBoardProps, type FeedbackProviderProps } from './FeedbackBoard';
export { FeedbackErrorBoundary } from './ErrorBoundary';
export { FeedbackList, type FeedbackListProps } from './screens/FeedbackList';
export { FeedbackDetail, type FeedbackDetailProps } from './screens/FeedbackDetail';
export { FeedbackSubmit, type FeedbackSubmitProps } from './screens/FeedbackSubmit';
export { FeedbackRoadmap, type FeedbackRoadmapProps } from './screens/FeedbackRoadmap';
export { FeedbackUpdates, FeedbackUpdatesBadge, type FeedbackUpdatesProps } from './screens/FeedbackUpdates';
export { FeedbackAdminQueue, type FeedbackAdminQueueProps } from './screens/FeedbackAdminQueue';
export { Avatar, Button, CategoryPill, Chip, EmptyState, Header, Loading, PostCard, StatusPill, VoteControl } from './components';
export { SLOT_NAMES, type FeedbackStyles, type SlotName, type SlotStyle } from './styles';
export {
  useUI,
  type AvatarProps,
  type ButtonProps,
  type EmptyStateProps,
  type FeedbackComponents,
  type HeaderProps,
  type PickedImage,
  type PickImage,
  type PostCardProps,
  type StatusPillProps,
  type VoteControlProps,
} from './ui';

// Headless API, theme and i18n re-exported so apps need a single import.
export * from '@kobecuppens/feedback-core';
export {
  useAdminQueue,
  useComments,
  useConfig,
  useCreateComment,
  useCreatePost,
  useFeatures,
  useFeedbackContext,
  useMarkUpdatesSeen,
  useModeration,
  usePost,
  usePosts,
  useRoadmap,
  useUpdates,
  useUpload,
  useVote,
  type FeedbackUIEvent,
} from '@kobecuppens/feedback-core/react';
