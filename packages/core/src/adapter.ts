import type {
  AdminPostPatch,
  Attachment,
  BoardConfig,
  Comment,
  CreateCommentInput,
  CreatePostInput,
  ListPostsParams,
  Page,
  Post,
  RoadmapColumn,
  Updates,
  UploadFile,
  VoteValue,
} from './types';

/**
 * Everything the board UI needs from a backend. The hosted adapter talks to the
 * feedback Worker; apps can implement this to plug in their own backend.
 */
export interface FeedbackAdapter {
  getConfig(): Promise<BoardConfig>;
  listPosts(params: ListPostsParams): Promise<Page<Post>>;
  getPost(id: string): Promise<Post>;
  createPost(input: CreatePostInput): Promise<Post>;
  vote(postId: string, value: VoteValue): Promise<Post>;
  listComments(postId: string, cursor?: string | null): Promise<Page<Comment>>;
  createComment(postId: string, input: CreateCommentInput): Promise<Comment>;
  upload(file: UploadFile): Promise<Attachment>;
  getRoadmap(): Promise<RoadmapColumn[]>;
  getUpdates(): Promise<Updates>;
  markUpdatesSeen(): Promise<void>;

  /** In-app admin; only called when `config.viewer.isAdmin` is true. */
  admin?: FeedbackAdminAdapter;

  /**
   * Called when the adapter starts acting as a different user (sign in, sign out,
   * account switch), so cached data from the previous user can be dropped.
   * Returns an unsubscribe function.
   */
  subscribeIdentity?(listener: () => void): () => void;
}

export interface FeedbackAdminAdapter {
  listQueue(cursor?: string | null): Promise<Page<Post>>;
  approve(postId: string): Promise<Post>;
  decline(postId: string, reason?: string | null): Promise<Post>;
  updatePost(postId: string, patch: AdminPostPatch): Promise<Post>;
  deletePost(postId: string): Promise<void>;
  merge(postId: string, intoId: string): Promise<Post>;
  deleteComment(postId: string, commentId: string): Promise<void>;
}
