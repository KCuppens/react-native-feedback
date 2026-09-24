import { createAdminClient, FeedbackApiError } from '@kobecuppens/feedback-core';
import { QueryClient } from '@tanstack/react-query';

/** Same-origin: the worker serves this app, so the session cookie rides along. */
export const api = createAdminClient({ baseUrl: window.location.origin });

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
  return e instanceof Error ? e.message : 'Something went wrong';
}
