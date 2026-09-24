import type {
  AdminPostPatch,
  Category,
  Comment,
  FeedbackEventType,
  ListPostsParams,
  Moderation,
  Page,
  Post,
  ProjectSecrets,
  ProjectSettings,
  ProjectSummary,
  WebhookConfig,
} from './types';
import { parseResponse, timeoutSignal, toQuery as q } from './http';

export interface AdminClientOptions {
  baseUrl: string;
  /**
   * `sk_…` admin API key (scoped to one project). Omit in the dashboard, which
   * authenticates with its session cookie and passes `projectId` per call.
   */
  secretKey?: string;
  fetch?: typeof fetch;
  /** Abort requests after this many ms (default 20s). */
  timeoutMs?: number;
}

export type AdminListParams = ListPostsParams & { moderation?: Moderation | 'all' };

/**
 * Typed client for `/v1/admin/*` and `/v1/dashboard/*`. Usable from Node,
 * Workers and browsers (the dashboard uses it with cookies).
 */
export function createAdminClient(options: AdminClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function request<T>(method: string, path: string, body?: unknown, projectId?: string): Promise<T> {
    const headers: Record<string, string> = {};
    if (options.secretKey) headers.Authorization = `Bearer ${options.secretKey}`;
    if (projectId) headers['X-Feedback-Project'] = projectId;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    // Cast: Workers' RequestInit typing has no `credentials`, browsers need it for the dashboard cookie.
    const init = {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: options.secretKey ? 'omit' : 'include',
    } as RequestInit;
    const timeout = timeoutSignal(options.timeoutMs ?? 20_000);
    try {
      return await parseResponse<T>(await doFetch(`${baseUrl}${path}`, { ...init, signal: timeout.signal }));
    } finally {
      timeout.clear();
    }
  }

  /** Everything scoped to a single project. `projectId` is ignored with a secret key. */
  const project = (projectId?: string) => {
    const call = <T>(method: string, path: string, body?: unknown) => request<T>(method, path, body, projectId);
    return {
      listPosts: (p: AdminListParams = {}) =>
        call<Page<Post>>(
          'GET',
          `/v1/admin/posts${q({ sort: p.sort, status: p.status, category: p.categoryId, q: p.q, cursor: p.cursor, limit: p.limit, moderation: p.moderation })}`,
        ),
      getPost: (id: string) => call<Post>('GET', `/v1/admin/posts/${id}`),
      listQueue: (cursor?: string | null) => call<Page<Post>>('GET', `/v1/admin/queue${q({ cursor })}`),
      approve: (id: string) => call<Post>('POST', `/v1/admin/posts/${id}/approve`),
      decline: (id: string, reason?: string | null) => call<Post>('POST', `/v1/admin/posts/${id}/decline`, { reason: reason ?? null }),
      updatePost: (id: string, patch: AdminPostPatch) => call<Post>('PATCH', `/v1/admin/posts/${id}`, patch),
      deletePost: (id: string) => call<void>('DELETE', `/v1/admin/posts/${id}`),
      merge: (id: string, intoId: string) => call<Post>('POST', `/v1/admin/posts/${id}/merge`, { intoId }),
      listComments: (postId: string, cursor?: string | null) =>
        call<Page<Comment>>('GET', `/v1/admin/posts/${postId}/comments${q({ cursor })}`),
      reply: (postId: string, body: string) => call<Comment>('POST', `/v1/admin/posts/${postId}/comments`, { body }),
      deleteComment: (postId: string, commentId: string) => call<void>('DELETE', `/v1/admin/posts/${postId}/comments/${commentId}`),
      listCategories: () => call<Category[]>('GET', '/v1/admin/categories'),
      createCategory: (input: { name: string; color?: string | null }) => call<Category>('POST', '/v1/admin/categories', input),
      updateCategory: (id: string, input: { name?: string; color?: string | null; sort?: number }) =>
        call<Category>('PATCH', `/v1/admin/categories/${id}`, input),
      deleteCategory: (id: string) => call<void>('DELETE', `/v1/admin/categories/${id}`),
      listWebhooks: () => call<WebhookConfig[]>('GET', '/v1/admin/webhooks'),
      createWebhook: (input: { url: string; events: FeedbackEventType[] }) => call<WebhookConfig>('POST', '/v1/admin/webhooks', input),
      deleteWebhook: (id: string) => call<void>('DELETE', `/v1/admin/webhooks/${id}`),
      getSettings: () => call<ProjectSettings>('GET', '/v1/admin/settings'),
      updateSettings: (patch: Partial<ProjectSettings>) => call<ProjectSettings>('PATCH', '/v1/admin/settings', patch),
    };
  };

  return {
    project,
    /** Dashboard-only (session cookie). */
    dashboard: {
      login: (password: string) => request<{ ok: true }>('POST', '/v1/dashboard/login', { password }),
      logout: () => request<void>('POST', '/v1/dashboard/logout'),
      me: () => request<{ ok: true }>('GET', '/v1/dashboard/me'),
      listProjects: () => request<ProjectSummary[]>('GET', '/v1/dashboard/projects'),
      createProject: (input: { name: string; slug?: string }) =>
        request<ProjectSummary & { secrets: ProjectSecrets }>('POST', '/v1/dashboard/projects', input),
      updateProject: (id: string, input: { name?: string; slug?: string }) =>
        request<ProjectSummary>('PATCH', `/v1/dashboard/projects/${id}`, input),
      deleteProject: (id: string) => request<void>('DELETE', `/v1/dashboard/projects/${id}`),
      getSecrets: (id: string) => request<ProjectSecrets>('GET', `/v1/dashboard/projects/${id}/secrets`),
      rotateKey: (id: string, key: 'public' | 'signing' | 'secret') =>
        request<ProjectSecrets>('POST', `/v1/dashboard/projects/${id}/rotate`, { key }),
    },
  };
}

export type AdminClient = ReturnType<typeof createAdminClient>;
export type ProjectAdminClient = ReturnType<AdminClient['project']>;
