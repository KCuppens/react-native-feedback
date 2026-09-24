import type {
  AdminPostPatch,
  Category,
  Comment,
  FeedbackEventType,
  ListPostsParams,
  Page,
  Post,
  ProjectSecrets,
  ProjectSettings,
  ProjectSummary,
  WebhookConfig,
} from './types';
import { parseResponse, toQuery as q } from './http';

export interface AdminClientOptions {
  baseUrl: string;
  /**
   * `sk_…` admin API key (scoped to one project). Omit in the dashboard, which
   * authenticates with its session cookie and passes `projectId` per call.
   */
  secretKey?: string;
  fetch?: typeof fetch;
}

export type AdminListParams = ListPostsParams & { moderation?: 'pending' | 'approved' | 'declined' | 'all' };

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
    return parseResponse<T>(await doFetch(`${baseUrl}${path}`, init));
  }

  /** Everything scoped to a single project. `projectId` is ignored with a secret key. */
  const project = (projectId?: string) => ({
    listPosts: (p: AdminListParams = {}) =>
      request<Page<Post>>(
        'GET',
        `/v1/admin/posts${q({ sort: p.sort, status: p.status, category: p.categoryId, q: p.q, cursor: p.cursor, limit: p.limit, moderation: p.moderation })}`,
        undefined,
        projectId,
      ),
    getPost: (id: string) => request<Post>('GET', `/v1/admin/posts/${id}`, undefined, projectId),
    listQueue: (cursor?: string | null) => request<Page<Post>>('GET', `/v1/admin/queue${q({ cursor })}`, undefined, projectId),
    approve: (id: string) => request<Post>('POST', `/v1/admin/posts/${id}/approve`, undefined, projectId),
    decline: (id: string, reason?: string | null) =>
      request<Post>('POST', `/v1/admin/posts/${id}/decline`, { reason: reason ?? null }, projectId),
    updatePost: (id: string, patch: AdminPostPatch) => request<Post>('PATCH', `/v1/admin/posts/${id}`, patch, projectId),
    deletePost: (id: string) => request<void>('DELETE', `/v1/admin/posts/${id}`, undefined, projectId),
    merge: (id: string, intoId: string) => request<Post>('POST', `/v1/admin/posts/${id}/merge`, { intoId }, projectId),
    listComments: (postId: string, cursor?: string | null) =>
      request<Page<Comment>>('GET', `/v1/admin/posts/${postId}/comments${q({ cursor })}`, undefined, projectId),
    reply: (postId: string, body: string) =>
      request<Comment>('POST', `/v1/admin/posts/${postId}/comments`, { body }, projectId),
    deleteComment: (postId: string, commentId: string) =>
      request<void>('DELETE', `/v1/admin/posts/${postId}/comments/${commentId}`, undefined, projectId),
    listCategories: () => request<Category[]>('GET', '/v1/admin/categories', undefined, projectId),
    createCategory: (input: { name: string; color?: string | null }) =>
      request<Category>('POST', '/v1/admin/categories', input, projectId),
    updateCategory: (id: string, input: { name?: string; color?: string | null; sort?: number }) =>
      request<Category>('PATCH', `/v1/admin/categories/${id}`, input, projectId),
    deleteCategory: (id: string) => request<void>('DELETE', `/v1/admin/categories/${id}`, undefined, projectId),
    listWebhooks: () => request<WebhookConfig[]>('GET', '/v1/admin/webhooks', undefined, projectId),
    createWebhook: (input: { url: string; events: FeedbackEventType[] }) =>
      request<WebhookConfig>('POST', '/v1/admin/webhooks', input, projectId),
    deleteWebhook: (id: string) => request<void>('DELETE', `/v1/admin/webhooks/${id}`, undefined, projectId),
    getSettings: () => request<ProjectSettings>('GET', '/v1/admin/settings', undefined, projectId),
    updateSettings: (patch: Partial<ProjectSettings>) =>
      request<ProjectSettings>('PATCH', '/v1/admin/settings', patch, projectId),
  });

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
