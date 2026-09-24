export const POST_STATUSES = ['open', 'under_review', 'planned', 'in_progress', 'done', 'closed'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** Statuses shown as roadmap columns, in order. */
export const ROADMAP_STATUSES = ['planned', 'in_progress', 'done'] as const satisfies readonly PostStatus[];

export const MODERATION_STATES = ['pending', 'approved', 'declined'] as const;
export type Moderation = (typeof MODERATION_STATES)[number];

export type PostSort = 'top' | 'new' | 'trending';
export type VoteValue = 1 | -1 | 0;

export interface Author {
  id: string;
  name: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
}

export interface Category {
  id: string;
  name: string;
  color: string | null;
  sort: number;
}

export interface Attachment {
  id: string;
  url: string;
  mime: string;
  width: number | null;
  height: number | null;
  bytes: number;
}

export interface Post {
  id: string;
  title: string;
  body: string;
  status: PostStatus;
  moderation: Moderation;
  declineReason: string | null;
  category: Category | null;
  author: Author;
  score: number;
  upvotes: number;
  downvotes: number;
  commentCount: number;
  /** The requesting user's vote on this post. */
  myVote: VoteValue;
  /** True when the requesting user authored the post. */
  isMine: boolean;
  mergedIntoId: string | null;
  attachments: Attachment[];
  createdAt: number;
  updatedAt: number;
  statusChangedAt: number | null;
}

export interface Comment {
  id: string;
  postId: string;
  body: string;
  isOfficial: boolean;
  author: Author;
  attachments: Attachment[];
  createdAt: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Server-enforced per-project settings. */
export interface ProjectSettings {
  autoApprove: boolean;
  inAppAdmin: boolean;
  publicBoard: boolean;
  allowAnonymous: boolean;
  allowAttachments: boolean;
  allowComments: boolean;
  allowDownvotes: boolean;
  roadmapEnabled: boolean;
  notifySubmitter: boolean;
  adminEmail: string | null;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  autoApprove: false,
  inAppAdmin: false,
  publicBoard: false,
  allowAnonymous: true,
  allowAttachments: true,
  allowComments: true,
  allowDownvotes: true,
  roadmapEnabled: true,
  notifySubmitter: true,
  adminEmail: null,
};

/** What the widget may render for the current viewer, resolved by the server. */
export interface BoardConfig {
  project: { id: string; name: string; slug: string };
  categories: Category[];
  features: {
    submit: boolean;
    vote: boolean;
    downvote: boolean;
    comments: boolean;
    attachments: boolean;
    roadmap: boolean;
    updates: boolean;
  };
  viewer: {
    identified: boolean;
    anonymous: boolean;
    isAdmin: boolean;
  };
  limits: {
    titleMax: number;
    bodyMax: number;
    commentMax: number;
    attachmentMaxBytes: number;
    attachmentsPerPost: number;
    attachmentMimeTypes: string[];
    titleMin: number;
  };
}

/** Server-side limits, shared by the worker and the in-memory adapter. */
export const BOARD_LIMITS: BoardConfig['limits'] = {
  titleMax: 120,
  bodyMax: 5000,
  commentMax: 2000,
  attachmentMaxBytes: 5 * 1024 * 1024,
  attachmentsPerPost: 4,
  attachmentMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic'],
  titleMin: 3,
};

export type ClientFeatures = Partial<BoardConfig['features']> & { admin?: boolean };

export interface ListPostsParams {
  sort?: PostSort;
  status?: PostStatus | PostStatus[];
  categoryId?: string;
  q?: string;
  cursor?: string | null;
  limit?: number;
  /** Only posts authored by the viewer. */
  mine?: boolean;
}

export interface CreatePostInput {
  title: string;
  body: string;
  categoryId?: string | null;
  attachmentIds?: string[];
}

export interface CreateCommentInput {
  body: string;
  attachmentIds?: string[];
}

export interface RoadmapColumn {
  status: PostStatus;
  posts: Post[];
}

export interface UpdateItem {
  post: Post;
  kind: 'approved' | 'declined' | 'status' | 'official_reply';
  at: number;
}

export interface Updates {
  unseen: number;
  items: UpdateItem[];
}

/** Anything FormData can carry: a web Blob/File, or a React Native `{ uri, name, type }` descriptor. */
export type UploadFile = Blob | { uri: string; name: string; type: string };

export interface AdminPostPatch {
  status?: PostStatus;
  categoryId?: string | null;
  title?: string;
  body?: string;
}

export interface WebhookConfig {
  id: string;
  url: string;
  events: FeedbackEventType[];
  secret: string;
  createdAt: number;
}

export const FEEDBACK_EVENT_TYPES = [
  'post.created',
  'post.approved',
  'post.declined',
  'post.status_changed',
  'post.merged',
  'post.deleted',
  'comment.created',
] as const;
export type FeedbackEventType = (typeof FEEDBACK_EVENT_TYPES)[number];

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  publicKey: string;
  settings: ProjectSettings;
  pendingCount: number;
  createdAt: number;
}

export interface ProjectSecrets {
  publicKey: string;
  signingSecret: string;
  /** Only returned when created or rotated; stored hashed server-side. */
  secretKey?: string;
}

export class FeedbackApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    /** For `invalid_input`: which field failed, and why. */
    readonly field?: string,
    readonly reason?: 'required' | 'not_string' | 'too_short' | 'too_long' | 'not_array' | 'too_many',
  ) {
    super(message ?? code);
    this.name = 'FeedbackApiError';
  }
}
