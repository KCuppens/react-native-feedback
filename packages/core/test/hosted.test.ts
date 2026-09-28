import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHostedAdapter, createMemoryAdapter, FeedbackApiError } from '../src';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('createHostedAdapter', () => {
  it('sends the project key and a persisted anonymous id', async () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const fetch = vi.fn(async () => jsonResponse(200, { items: [], nextCursor: null }));
    const adapter = createHostedAdapter({ projectKey: 'pk_1', baseUrl: 'https://api.test/', storage, fetch });

    await adapter.listPosts({ sort: 'new', status: ['planned', 'done'], q: '' });
    await adapter.listPosts({});

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/posts?sort=new&status=planned%2Cdone');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Feedback-Key']).toBe('pk_1');
    expect(headers['X-Feedback-Anon']).toMatch(/[0-9a-f-]{36}/);
    const secondHeaders = (fetch.mock.calls[1] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(secondHeaders['X-Feedback-Anon']).toBe(headers['X-Feedback-Anon']);
    expect(store.get('rnf:anon-id')).toBe(headers['X-Feedback-Anon']);
  });

  it('prefers a signed user token', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, {}));
    const adapter = createHostedAdapter({ projectKey: 'pk_1', baseUrl: 'https://api.test', userToken: 'tok', fetch });
    await adapter.getConfig();
    const headers = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers['X-Feedback-User']).toBe('tok');
    expect(headers['X-Feedback-Anon']).toBeUndefined();
  });

  it("sends the user's language, read per request", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, {}));
    let locale = 'de';
    const adapter = createHostedAdapter({ projectKey: 'pk_1', baseUrl: 'https://api.test', userToken: 'tok', fetch, locale: () => locale });
    await adapter.getConfig();
    locale = 'ja';
    await adapter.getConfig();
    const sent = fetch.mock.calls.map(
      (call) => ((call as unknown as [string, RequestInit])[1].headers as Record<string, string>)['X-Feedback-Locale'],
    );
    expect(sent).toEqual(['de', 'ja']);

    const silent = vi.fn(async () => jsonResponse(200, {}));
    await createHostedAdapter({ projectKey: 'pk_1', baseUrl: 'https://api.test', userToken: 'tok', fetch: silent }).getConfig();
    expect((silent.mock.calls[0] as unknown as [string, RequestInit])[1].headers).not.toHaveProperty('X-Feedback-Locale');
  });

  it('refreshes an expired token once and retries', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: 'user_token_expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const getUserToken = vi.fn().mockResolvedValueOnce('fresh');
    const adapter = createHostedAdapter({ projectKey: 'pk', baseUrl: 'https://a', userToken: 'old', getUserToken, fetch });
    await adapter.getConfig();
    expect(getUserToken).toHaveBeenCalledTimes(1);
    const retryHeaders = (fetch.mock.calls[1] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(retryHeaders['X-Feedback-User']).toBe('fresh');
  });

  it('throws typed errors', async () => {
    const fetch = vi.fn(async () => jsonResponse(403, { error: 'forbidden', message: 'nope' }));
    const adapter = createHostedAdapter({ projectKey: 'pk', baseUrl: 'https://a', fetch });
    const error = await adapter.getPost('p1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FeedbackApiError);
    expect(error).toMatchObject({ status: 403, code: 'forbidden', message: 'nope' });
  });

  it('sends JSON bodies for votes', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, {}));
    const adapter = createHostedAdapter({ projectKey: 'pk', baseUrl: 'https://a', fetch });
    await adapter.vote('p1', -1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://a/v1/posts/p1/vote');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"value":-1}');
  });

  it('recovers after getUserToken fails once, and picks up a later sign-in', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, {}));
    const getUserToken = vi
      .fn<() => Promise<string | null>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('signed-in');
    const adapter = createHostedAdapter({ projectKey: 'pk', baseUrl: 'https://a', getUserToken, fetch });
    const header = (i: number) => (fetch.mock.calls[i] as unknown as [string, RequestInit])[1].headers as Record<string, string>;

    await expect(adapter.getConfig()).rejects.toThrow('offline');
    await adapter.getConfig();
    expect(header(0)['X-Feedback-Anon']).toBeDefined();
    await adapter.getConfig();
    expect(header(1)['X-Feedback-User']).toBe('signed-in');
  });

  it('shares one refresh between concurrent requests and throws after a second expiry', async () => {
    const expired = () => jsonResponse(401, { error: 'user_token_expired' });
    const fetch = vi.fn(async () => expired());
    const getUserToken = vi.fn(async () => 'still-bad');
    const adapter = createHostedAdapter({ projectKey: 'pk', baseUrl: 'https://a', userToken: 'old', getUserToken, fetch });
    const results = await Promise.allSettled([adapter.getConfig(), adapter.getConfig()]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(getUserToken).toHaveBeenCalledTimes(1);
  });

  it('still works when storage throws', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, {}));
    const storage = {
      getItem: () => Promise.reject(new Error('denied')),
      setItem: () => Promise.reject(new Error('denied')),
    };
    const adapter = createHostedAdapter({ projectKey: 'pk', baseUrl: 'https://a', storage, fetch });
    await adapter.getConfig();
    await adapter.getConfig();
    const ids = fetch.mock.calls.map(
      (c) => ((c as unknown as [string, RequestInit])[1].headers as Record<string, string>)['X-Feedback-Anon'],
    );
    expect(ids[0]).toBeDefined();
    expect(ids[1]).toBe(ids[0]);
  });

  it('keeps the status when an error body is not JSON', async () => {
    const fetch = vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 }));
    const adapter = createHostedAdapter({ projectKey: 'pk', baseUrl: 'https://a', fetch });
    await expect(adapter.getConfig()).rejects.toMatchObject({ name: 'FeedbackApiError', status: 502, code: 'request_failed' });
  });
});

describe('uploads', () => {
  /** React Native's FormData keeps `{ uri }` parts as they are; Node's would stringify them. */
  class NativeFormData {
    parts: [string, unknown][] = [];
    append(name: string, value: unknown) {
      this.parts.push([name, value]);
    }
  }

  class FakeXhr {
    static last: FakeXhr;
    method = '';
    url = '';
    headers: Record<string, string> = {};
    body: unknown;
    status = 0;
    responseText = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    constructor() {
      FakeXhr.last = this;
    }
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(key: string, value: string) {
      this.headers[key] = value;
    }
    send(body: unknown) {
      this.body = body;
      this.status = 201;
      this.responseText = JSON.stringify({ id: 'att_1', url: 'https://a/v1/files/att_1', mime: 'image/png' });
      queueMicrotask(() => this.onload?.());
    }
    abort() {
      this.onabort?.();
    }
  }

  afterEach(() => vi.unstubAllGlobals());

  it('sends a React Native { uri } file through XMLHttpRequest, not fetch', async () => {
    vi.stubGlobal('FormData', NativeFormData);
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const globalFetch = vi.fn();
    vi.stubGlobal('fetch', globalFetch);
    const adapter = createHostedAdapter({ projectKey: 'pk_1', baseUrl: 'https://a', userToken: 'tok' });

    const file = { uri: 'file:///cache/shot.png', name: 'shot.png', type: 'image/png' };
    await expect(adapter.upload(file)).resolves.toMatchObject({ id: 'att_1' });

    expect(globalFetch).not.toHaveBeenCalled();
    const xhr = FakeXhr.last;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('https://a/v1/uploads');
    expect(xhr.headers).toMatchObject({ 'X-Feedback-Key': 'pk_1', 'X-Feedback-User': 'tok' });
    expect(xhr.headers['Content-Type']).toBeUndefined();
    expect((xhr.body as NativeFormData).parts).toEqual([['file', file]]);
  });

  it('turns an XMLHttpRequest error status into a FeedbackApiError', async () => {
    vi.stubGlobal('FormData', NativeFormData);
    class Rejecting extends FakeXhr {
      override send() {
        this.status = 415;
        this.responseText = JSON.stringify({ error: 'unsupported_type' });
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('XMLHttpRequest', Rejecting);
    const adapter = createHostedAdapter({ projectKey: 'pk_1', baseUrl: 'https://a', userToken: 'tok' });
    await expect(adapter.upload({ uri: 'file:///x.bmp', name: 'x.bmp', type: 'image/bmp' })).rejects.toMatchObject({
      name: 'FeedbackApiError',
      status: 415,
      code: 'unsupported_type',
    });
  });

  it('keeps using fetch for a Blob, and for any file when a fetch option is given', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const fetch = vi.fn(async () => jsonResponse(201, { id: 'att_2' }));
    const adapter = createHostedAdapter({ projectKey: 'pk_1', baseUrl: 'https://a', userToken: 'tok', fetch });

    await adapter.upload(new Blob(['png'], { type: 'image/png' }));
    vi.stubGlobal('FormData', NativeFormData);
    await adapter.upload({ uri: 'file:///cache/shot.png', name: 'shot.png', type: 'image/png' });

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('identity changes', () => {
  const token = (id: string, n: number) => `${btoa(JSON.stringify({ id, iat: n })).replace(/=+$/, '')}.sig${n}`;

  it('notifies on sign-in, account switch and sign-out, but not on a refresh for the same user', async () => {
    const expired = new Set<string>();
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const user = (init.headers as Record<string, string>)['X-Feedback-User'];
      return user && expired.has(user) ? jsonResponse(401, { error: 'user_token_expired' }) : jsonResponse(200, {});
    });
    const sequence = [null, token('ann', 1), token('ann', 2), token('bob', 3), null];
    let i = 0;
    const getUserToken = vi.fn(async () => sequence[i++] ?? null);
    const adapter = createHostedAdapter({
      projectKey: 'pk',
      baseUrl: 'https://a',
      getUserToken,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const changed = vi.fn();
    adapter.subscribeIdentity!(changed);
    const expireCurrent = () => expired.add(sequence[i - 1]!);

    await adapter.getConfig(); // anonymous
    expect(changed).toHaveBeenCalledTimes(0);
    await adapter.getConfig(); // ann signs in
    expect(changed).toHaveBeenCalledTimes(1);
    expireCurrent();
    await adapter.getConfig(); // ann's token refreshed: same user
    expect(changed).toHaveBeenCalledTimes(1);
    expireCurrent();
    await adapter.getConfig(); // switched to bob
    expect(changed).toHaveBeenCalledTimes(2);
    expireCurrent();
    await adapter.getConfig(); // signed out
    expect(changed).toHaveBeenCalledTimes(3);
  });
});

describe('createMemoryAdapter', () => {
  it('404s instead of deleting another post when the id is unknown', async () => {
    const adapter = createMemoryAdapter({
      settings: { inAppAdmin: true },
      viewer: { id: 'boss', isAdmin: true },
      posts: [{ title: 'Keep me' }],
    });
    await expect(adapter.admin!.deletePost('nope')).rejects.toMatchObject({ status: 404 });
    expect(adapter.posts.map((p) => p.title)).toEqual(['Keep me']);
  });
});
