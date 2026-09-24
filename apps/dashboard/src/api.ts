import { createAdminClient, FeedbackApiError } from '@kobecuppens/feedback-core';
import { QueryClient } from '@tanstack/react-query';

/** Same-origin: the worker serves this app, so the session cookie rides along. */
export const api = createAdminClient({ baseUrl: window.location.origin });

/**
 * Query keys in one place: invalidation matches on these prefixes, so a hand-typed key
 * that drifts would silently stop refreshing. Everything per project sits under `project(id)`.
 */
export const keys = {
  me: ['me'] as const,
  projects: ['projects'] as const,
  project: (projectId: string) => ['p', projectId] as const,
  list: (projectId: string, list: 'queue' | 'posts' | 'kanban') => ['p', projectId, list] as const,
  posts: (projectId: string, params: unknown) => ['p', projectId, 'posts', params] as const,
  post: (projectId: string, postId: string) => ['p', projectId, 'post', postId] as const,
  comments: (projectId: string, postId?: string) =>
    postId ? (['p', projectId, 'comments', postId] as const) : (['p', projectId, 'comments'] as const),
  categories: (projectId: string) => ['p', projectId, 'categories'] as const,
  settings: (projectId: string) => ['p', projectId, 'settings'] as const,
  secrets: (projectId: string) => ['p', projectId, 'secrets'] as const,
  webhooks: (projectId: string) => ['p', projectId, 'webhooks'] as const,
  mergeCandidates: (projectId: string, query?: string) =>
    query === undefined ? (['merge-candidates', projectId] as const) : (['merge-candidates', projectId, query] as const),
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, error) => !(error instanceof FeedbackApiError && error.status < 500) && count < 2,
    },
  },
});

/** The error of whichever of these mutations failed most recently (older failures are stale). */
export function latestError(...mutations: { error: unknown; isError: boolean; submittedAt: number }[]): unknown {
  let latest: { error: unknown; submittedAt: number } | null = null;
  for (const m of mutations) if (m.isError && (!latest || m.submittedAt > latest.submittedAt)) latest = m;
  return latest?.error ?? null;
}

export const isUnauthorized = (e: unknown) => e instanceof FeedbackApiError && e.status === 401;

export function errorText(e: unknown): string {
  if (e instanceof FeedbackApiError) return e.message || e.code;
  // A dropped connection (TypeError) or the client's timeout (AbortError) would otherwise
  // surface the browser's own wording, e.g. "signal is aborted without reason".
  if (e instanceof TypeError || (e instanceof Error && e.name === 'AbortError')) {
    return 'Could not reach the server. Check your connection and retry.';
  }
  return 'Something went wrong';
}
