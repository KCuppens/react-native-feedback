import { FeedbackApiError } from './types';

/** `?a=1&b=x,y`, skipping empty values. Arrays become comma lists. */
export function toQuery(params: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    q.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** Parse a JSON response, throwing FeedbackApiError for non-2xx statuses. */
export async function parseResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    // e.g. an HTML error page from a proxy: keep the status, not a SyntaxError.
    if (!res.ok) throw new FeedbackApiError(res.status, 'request_failed');
    throw new FeedbackApiError(res.status, 'invalid_response', 'The server returned something that is not JSON.');
  }
  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; message?: string; field?: string; reason?: FeedbackApiError['reason'] };
    throw new FeedbackApiError(res.status, err.error ?? 'request_failed', err.message, err.field, err.reason);
  }
  return data as T;
}
