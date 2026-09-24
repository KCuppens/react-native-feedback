import type { ListPostsParams } from '../types';

/** Every query key the board uses, all under one root per adapter/user scope. */
const root = (scope: string) => ['rnf', scope] as const;
export const feedbackKeys = {
  all: root,
  config: (scope: string) => [...root(scope), 'config'] as const,
  posts: (scope: string, params?: ListPostsParams) => [...root(scope), 'posts', params ?? {}] as const,
  postsPrefix: (scope: string) => [...root(scope), 'posts'] as const,
  post: (scope: string, id: string) => [...root(scope), 'post', id] as const,
  comments: (scope: string, postId: string) => [...root(scope), 'comments', postId] as const,
  roadmap: (scope: string) => [...root(scope), 'roadmap'] as const,
  updates: (scope: string) => [...root(scope), 'updates'] as const,
  queue: (scope: string) => [...root(scope), 'queue'] as const,
};
