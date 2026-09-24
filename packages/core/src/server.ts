/**
 * Server-side helpers for host apps (Node 18+, Cloudflare Workers, Deno, Bun).
 * Never ship your signing secret to a client.
 */
import { base64UrlDecodeToString, base64UrlEncode, textEncoder, timingSafeEqual, toHex } from './encoding';

export interface FeedbackUserClaims {
  /** Stable user id in your app. */
  id: string;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  isAdmin?: boolean;
  /** Issued-at, seconds since epoch. Filled in by `signFeedbackUser`. */
  iat?: number;
}

export const USER_TOKEN_MAX_AGE_SECONDS = 24 * 60 * 60;

/** Hex HMAC-SHA256, e.g. for deriving keyed identifiers on your server. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, textEncoder.encode(message)));
}

/**
 * Sign a user for the feedback board. Call this on your server and hand the
 * returned token to the app (e.g. in your session/bootstrap response).
 */
export async function signFeedbackUser(claims: FeedbackUserClaims, signingSecret: string, now: number = Date.now()): Promise<string> {
  if (!claims.id) throw new Error('signFeedbackUser: claims.id is required');
  const payload = base64UrlEncode(JSON.stringify({ ...claims, iat: claims.iat ?? Math.floor(now / 1000) }));
  return `${payload}.${await hmacHex(signingSecret, payload)}`;
}

export type VerifyResult =
  | { ok: true; claims: FeedbackUserClaims & { iat: number } }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export async function verifyFeedbackUser(
  token: string,
  signingSecret: string,
  now: number = Date.now(),
  maxAgeSeconds: number = USER_TOKEN_MAX_AGE_SECONDS,
): Promise<VerifyResult> {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return { ok: false, reason: 'malformed' };
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!timingSafeEqual(signature, await hmacHex(signingSecret, payload))) {
    return { ok: false, reason: 'bad_signature' };
  }
  let claims: unknown;
  try {
    claims = JSON.parse(base64UrlDecodeToString(payload));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!isClaims(claims)) return { ok: false, reason: 'malformed' };
  const age = Math.floor(now / 1000) - claims.iat;
  if (age > maxAgeSeconds || age < -300) return { ok: false, reason: 'expired' };
  return { ok: true, claims };
}

function isClaims(value: unknown): value is FeedbackUserClaims & { iat: number } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const optionalString = (x: unknown) => x === undefined || x === null || typeof x === 'string';
  return (
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    v.id.length <= 200 &&
    typeof v.iat === 'number' &&
    optionalString(v.name) &&
    optionalString(v.email) &&
    optionalString(v.avatarUrl) &&
    (v.isAdmin === undefined || typeof v.isAdmin === 'boolean')
  );
}

/** Signature header for outgoing webhooks: `t=<unix>,v1=<hex hmac of "t.body">`. */
export async function signWebhook(secret: string, body: string, now: number = Date.now()): Promise<string> {
  const t = Math.floor(now / 1000);
  return `t=${t},v1=${await hmacHex(secret, `${t}.${body}`)}`;
}

/** Verify an incoming webhook in your own backend. */
export async function verifyWebhook(
  secret: string,
  body: string,
  header: string,
  toleranceSeconds = 300,
  now: number = Date.now(),
): Promise<boolean> {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(t)) return false;
  if (Math.abs(Math.floor(now / 1000) - t) > toleranceSeconds) return false;
  return timingSafeEqual(parts.v1, await hmacHex(secret, `${t}.${body}`));
}
