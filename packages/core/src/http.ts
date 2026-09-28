import { FeedbackApiError } from './types';

/** AbortSignal.timeout is missing on older Hermes, so build it by hand (and clear it when done). */
export function timeoutSignal(ms: number): { signal?: AbortSignal; clear: () => void } {
  if (typeof AbortController === 'undefined') return { clear: () => {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/** The part of XMLHttpRequest used here; declared locally because the worker builds without DOM types. */
interface Xhr {
  status: number;
  responseText: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  open(method: string, url: string): void;
  setRequestHeader(key: string, value: string): void;
  send(body: unknown): void;
  abort(): void;
}

const xhrConstructor = () => (globalThis as { XMLHttpRequest?: new () => Xhr }).XMLHttpRequest;

/** Whether this runtime has XMLHttpRequest (React Native and browsers; not Workers or Node). */
export const hasXhr = () => typeof xhrConstructor() === 'function';

/**
 * `fetch` over XMLHttpRequest, for multipart bodies holding React Native `{ uri }` files.
 * Expo replaces the global `fetch` with `expo/fetch`, which cannot read those parts;
 * React Native's own networking (XMLHttpRequest) can. Returns just what `parseResponse` reads.
 */
export function xhrFetch(url: string, init: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const Ctor = xhrConstructor();
    if (!Ctor) return reject(new TypeError('XMLHttpRequest is not available'));
    const xhr = new Ctor();
    const signal = init.signal;
    const onAbort = () => xhr.abort();
    const done = () => signal?.removeEventListener('abort', onAbort);
    xhr.open(init.method ?? 'GET', url);
    for (const [key, value] of Object.entries((init.headers ?? {}) as Record<string, string>)) xhr.setRequestHeader(key, value);
    xhr.onload = () => {
      done();
      const text = xhr.responseText ?? '';
      const response = {
        status: xhr.status,
        ok: xhr.status >= 200 && xhr.status < 300,
        text: async () => text,
        json: async () => JSON.parse(text) as unknown,
        clone: () => response,
      };
      resolve(response as unknown as Response);
    };
    xhr.onerror = () => {
      done();
      reject(new TypeError('Network request failed'));
    };
    // Hermes has no DOMException: an Error named AbortError is what fetch callers check.
    const aborted = () => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    xhr.onabort = () => {
      done();
      reject(aborted());
    };
    if (signal?.aborted) return reject(aborted());
    signal?.addEventListener('abort', onAbort);
    xhr.send(init.body ?? null);
  });
}

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
