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

export const isUnauthorized = (e: unknown) => e instanceof FeedbackApiError && e.status === 401;

export function errorText(e: unknown): string {
  if (e instanceof FeedbackApiError) return e.message || e.code;
  return e instanceof Error ? e.message : 'Something went wrong';
}
