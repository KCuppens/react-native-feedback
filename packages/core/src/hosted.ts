import type { FeedbackAdapter, FeedbackAdminAdapter } from './adapter';
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
import { parseResponse, toQuery } from './http';

/** Default hosted API. Override per app with `baseUrl`. */
export const DEFAULT_API_URL = 'https://feedback-api.kobecuppens.workers.dev';

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
}

export interface HostedAdapterOptions {
  /** Public project key (`pk_…`). */
  projectKey: string;
  baseUrl?: string;
  /** Signed user token from your server (see `signFeedbackUser`). */
  userToken?: string | null;
  /**
   * Returns the current user token. Called while no token is known (so a later
   * sign-in is picked up) and after an expired-token response. Return null for
   * anonymous; a thrown error fails that request only.
   */
  getUserToken?: () => Promise<string | null>;
  /** Where the anonymous device id is persisted. Defaults to memory. */
  storage?: KeyValueStorage;
  fetch?: typeof fetch;
  /** Abort requests after this many ms (default 20s) so a stalled connection cannot spin forever. */
  timeoutMs?: number;
}

/** AbortSignal.timeout is missing on older Hermes, so build it by hand (and clear it when done). */
function timeoutSignal(ms: number): { signal?: AbortSignal; clear: () => void } {
  if (typeof AbortController === 'undefined') return { clear: () => {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

const ANON_KEY = 'rnf:anon-id';

function randomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Hermes without crypto: good enough for an anonymous device id.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

export function createHostedAdapter(options: HostedAdapterOptions): FeedbackAdapter {
  const baseUrl = (options.baseUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const storage = options.storage ?? memoryStorage();
  let userToken = options.userToken ?? null;
  let pendingToken: Promise<string | null> | null = null;
  let anonId: Promise<string> | null = null;

  // Concurrent requests share one in-flight call; it is cleared once settled so a
  // failure or a null (signed out) result never sticks.
  const refreshToken = () =>
    (pendingToken ??= Promise.resolve()
      .then(() => options.getUserToken?.() ?? null)
      .then((token) => {
        userToken = token;
        return token;
      })
      .finally(() => {
        pendingToken = null;
      }));

  const getAnonId = () =>
    (anonId ??= (async () => {
      // Storage is best-effort: if it fails, the id just lasts for this session.
      const existing = await Promise.resolve(storage.getItem(ANON_KEY)).catch(() => null);
      if (existing) return existing;
      const id = randomId();
      await Promise.resolve(storage.setItem(ANON_KEY, id)).catch(() => undefined);
      return id;
    })());

  async function identityHeaders(): Promise<Record<string, string>> {
    if (!userToken && options.getUserToken) await refreshToken();
    if (userToken) return { 'X-Feedback-User': userToken };
    return { 'X-Feedback-Anon': await getAnonId() };
  }

  async function request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
    const headers: Record<string, string> = {
      'X-Feedback-Key': options.projectKey,
      ...(await identityHeaders()),
    };
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const timeout = timeoutSignal(options.timeoutMs ?? 20_000);
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}${path}`, { method, headers, body: payload, signal: timeout.signal });
    } finally {
      timeout.clear();
    }
    if (res.status === 401 && !retried && options.getUserToken) {
      const err = await res.clone().json().catch(() => ({})) as { error?: string };
      if (err.error === 'user_token_expired') {
        userToken = null;
        await refreshToken();
        return request<T>(method, path, body, true);
      }
    }
    return parseResponse<T>(res);
  }

  const admin: FeedbackAdminAdapter = {
    listQueue: (cursor) => request('GET', `/v1/admin/queue${toQuery({ cursor })}`),
    approve: (id) => request('POST', `/v1/admin/posts/${id}/approve`),
    decline: (id, reason) => request('POST', `/v1/admin/posts/${id}/decline`, { reason: reason ?? null }),
    updatePost: (id, patch: AdminPostPatch) => request('PATCH', `/v1/admin/posts/${id}`, patch),
    deletePost: (id) => request('DELETE', `/v1/admin/posts/${id}`),
    merge: (id, intoId) => request('POST', `/v1/admin/posts/${id}/merge`, { intoId }),
    deleteComment: (postId, commentId) => request('DELETE', `/v1/admin/posts/${postId}/comments/${commentId}`),
  };

  return {
    getConfig: () => request<BoardConfig>('GET', '/v1/config'),
    listPosts: (p: ListPostsParams) =>
      request<Page<Post>>(
        'GET',
        `/v1/posts${toQuery({
          sort: p.sort,
          status: p.status,
          category: p.categoryId,
          q: p.q,
          cursor: p.cursor,
          limit: p.limit,
          mine: p.mine ? 1 : undefined,
        })}`,
      ),
    getPost: (id) => request<Post>('GET', `/v1/posts/${id}`),
    createPost: (input: CreatePostInput) => request<Post>('POST', '/v1/posts', input),
    vote: (postId, value: VoteValue) => request<Post>('POST', `/v1/posts/${postId}/vote`, { value }),
    listComments: (postId, cursor) =>
      request<Page<Comment>>('GET', `/v1/posts/${postId}/comments${toQuery({ cursor })}`),
    createComment: (postId, input: CreateCommentInput) =>
      request<Comment>('POST', `/v1/posts/${postId}/comments`, input),
    upload: (file: UploadFile) => {
      const form = new FormData();
      // RN's FormData accepts { uri, name, type }; the DOM typing does not know that.
      form.append('file', file as Blob, 'name' in file ? file.name : 'upload');
      return request<Attachment>('POST', '/v1/uploads', form);
    },
    getRoadmap: () => request<RoadmapColumn[]>('GET', '/v1/roadmap'),
    getUpdates: () => request<Updates>('GET', '/v1/me/updates'),
    markUpdatesSeen: () => request<void>('POST', '/v1/me/updates/seen'),
    admin,
  };
}
