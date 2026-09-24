import { FEEDBACK_EVENT_TYPES, locales, type FeedbackEventType, type WebhookConfig } from '@kobecuppens/feedback-core';
import { signWebhook } from '@kobecuppens/feedback-core/server';
import type { EndUserRow, Env, EventMessage } from './env';
import { getPost, publicPost, type PostRecord } from './posts';
import { findProjectById } from './projects';
import { createLimiter, escapeHtml, flag, log, newId, now, type Limiter } from './util';

export interface EventInput {
  projectId: string;
  type: FeedbackEventType;
  postId: string | null;
  actorId: string | null;
  /** Extra data, e.g. `{ previousStatus }`, `{ commentId }`, or a post snapshot for deletes. */
  data?: Record<string, unknown>;
  /** Base URL for links/file URLs in payloads. */
  origin: string;
}

interface EventRow {
  id: string;
  project_id: string;
  type: FeedbackEventType;
  post_id: string | null;
  actor_id: string | null;
  payload: string;
  created_at: number;
  processed_at: number | null;
}

export interface PendingEvent {
  id: string;
  /** The outbox INSERT: put it in the same DB.batch as the change it describes. */
  statement: D1PreparedStatement;
}

/**
 * Build the outbox row for an event. Callers add `statement` to the batch that makes
 * the change, so the change and its event commit (or fail) together, then call
 * `dispatchEvent` once the batch has committed.
 */
export function prepareEvent(env: Env, input: EventInput, onlyIf?: { sql: string; params: (string | number)[] }): PendingEvent {
  const id = newId();
  const values = [
    id,
    input.projectId,
    input.type,
    input.postId,
    input.actorId,
    JSON.stringify({ origin: input.origin, ...input.data }),
    now(),
  ];
  // `onlyIf` makes the row conditional on the batch's own change having taken effect,
  // so a concurrent duplicate request cannot record (and notify) the same change twice.
  const statement = onlyIf
    ? env.DB.prepare(
        `INSERT INTO events (id, project_id, type, post_id, actor_id, payload, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${onlyIf.sql}`,
      ).bind(...values, ...onlyIf.params)
    : env.DB.prepare('INSERT INTO events (id, project_id, type, post_id, actor_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
        ...values,
      );
  return { id, statement };
}

/**
 * Hand a committed event to the queue. Without a queue binding (local dev) it is
 * processed in the background of the current request instead.
 */
export async function dispatchEvent(env: Env, ctx: { waitUntil(promise: Promise<unknown>): void } | undefined, id: string): Promise<void> {
  if (env.EVENTS) {
    // The change is already committed and the outbox row is stored: if the send fails, the
    // hourly sweep (maintenance.ts) delivers it. So the response never waits on the queue.
    const send = env.EVENTS.send({ eventId: id }).catch((error: unknown) =>
      log('error', 'event enqueue failed', { eventId: id, error: String(error) }),
    );
    if (ctx) ctx.waitUntil(send);
    else await send;
  } else {
    const work = processEvent(env, id).catch((error: unknown) =>
      log('error', 'event processing failed', { eventId: id, error: String(error) }),
    );
    if (ctx) ctx.waitUntil(work);
    else await work;
  }
}

/** Exponential backoff with jitter, capped at 5 minutes, so retries outlast short outages. */
export function retryDelaySeconds(attempts: number): number {
  return Math.min(300, 10 * 2 ** Math.max(0, attempts - 1)) + Math.floor(Math.random() * 5);
}

/** Workers allow 6 open connections per invocation; fetches beyond that queue up inside it. */
const MAX_CONCURRENT_WEBHOOKS = 6;

export async function handleEventBatch(batch: MessageBatch<EventMessage>, env: Env): Promise<void> {
  // In parallel, so one slow webhook does not hold up the rest of the batch. One shared
  // limiter keeps the batch's webhook fetches within the connection limit, so a queued
  // fetch does not burn its timeout waiting and get dropped (delivery is at-most-once).
  const limit = createLimiter(MAX_CONCURRENT_WEBHOOKS);
  await Promise.all(
    batch.messages.map(async (message) => {
      try {
        await processEvent(env, message.body.eventId, limit);
        message.ack();
      } catch (error) {
        log('error', 'event processing failed', { eventId: message.body.eventId, error: String(error) });
        message.retry({ delaySeconds: retryDelaySeconds(message.attempts ?? 1) });
      }
    }),
  );
}

/** 4xx means the endpoint rejected this payload; only timeouts and throttling are worth a retry. */
function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

export async function processEvent(env: Env, eventId: string, limit = createLimiter(MAX_CONCURRENT_WEBHOOKS)): Promise<void> {
  const event = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(eventId).first<EventRow>();
  if (!event || event.processed_at) return;
  const payload = JSON.parse(event.payload) as Record<string, unknown> & { origin: string };
  const origin = env.PUBLIC_URL?.replace(/\/+$/, '') || payload.origin;
  // Independent lookups: the post only needs the project id, which the event already has.
  const [project, post] = await Promise.all([
    findProjectById(env, event.project_id),
    event.post_id ? getPost(env, origin, event.project_id, event.post_id, null) : null,
  ]);
  if (!project) return;

  const author = post ? await env.DB.prepare('SELECT * FROM end_users WHERE id = ?').bind(post.authorId).first<EndUserRow>() : null;

  // Mark first: webhook/email delivery is at-most-once so queue retries never double-send.
  const claimed = await env.DB.prepare('UPDATE events SET processed_at = ? WHERE id = ? AND processed_at IS NULL')
    .bind(now(), eventId)
    .run();
  if (!claimed.meta.changes) return;

  const { origin: _origin, snapshot, ...extra } = payload;
  const body = JSON.stringify({
    id: event.id,
    type: event.type,
    projectId: project.id,
    createdAt: event.created_at,
    data: { post: post ? publicPost(post) : (snapshot ?? null), ...extra },
  });

  const [hooks, mail] = await Promise.allSettled([
    deliverWebhooks(env, { eventId, projectId: project.id, type: event.type }, body, limit),
    sendEmails(env, { type: event.type, project, post, author, actorId: event.actor_id, extra, origin }),
  ]);
  // Delivery is at-most-once (the event is already claimed), so a failure here is final: log it.
  for (const [channel, result] of [
    ['webhooks', hooks],
    ['email', mail],
  ] as const) {
    if (result.status === 'rejected') {
      log('error', 'event delivery failed', { channel, eventId, type: event.type, projectId: project.id, error: String(result.reason) });
    }
  }
}

/** Stored event lists are JSON; ignore anything malformed rather than failing delivery. */
function parseEventTypes(raw: string): FeedbackEventType[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((e): e is FeedbackEventType => (FEEDBACK_EVENT_TYPES as readonly unknown[]).includes(e))
      : [];
  } catch {
    return [];
  }
}

async function deliverWebhooks(
  env: Env,
  { eventId, projectId, type }: { eventId: string; projectId: string; type: FeedbackEventType },
  body: string,
  limit: Limiter,
): Promise<void> {
  const { results } = await env.DB.prepare('SELECT * FROM webhooks WHERE project_id = ?')
    .bind(projectId)
    .all<{ id: string; url: string; secret: string; events: string }>();
  const targets = results.filter((w) => parseEventTypes(w.events).includes(type));
  await Promise.allSettled(
    targets.map(async (hook) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const signature = await signWebhook(hook.secret, body);
          // The timeout starts once a connection slot is free, not while waiting for one.
          const res = await limit(async () => {
            const response = await fetch(hook.url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'react-native-feedback-webhooks/1',
                'X-Feedback-Event': type,
                'X-Feedback-Signature': signature,
              },
              body,
              signal: AbortSignal.timeout(10_000),
            });
            // Only the status matters; release the connection before freeing the slot.
            await response.body?.cancel();
            return response;
          });
          if (res.ok) return;
          log('warn', 'webhook non-2xx', { eventId, projectId, type, hookId: hook.id, attempt, status: res.status });
          if (!isRetryableStatus(res.status)) return;
        } catch (error) {
          log('warn', 'webhook failed', { eventId, projectId, type, hookId: hook.id, attempt, error: String(error) });
        }
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 1000));
      }
    }),
  );
}

export function toWebhookConfig(row: { id: string; url: string; secret: string; events: string; created_at: number }): WebhookConfig {
  return { id: row.id, url: row.url, secret: row.secret, events: parseEventTypes(row.events), createdAt: row.created_at };
}

// ---------------------------------------------------------------------------
// Email

interface EmailContext {
  type: FeedbackEventType;
  project: { id: string; name: string; settings: { adminEmail: string | null; notifySubmitter: boolean } };
  post: PostRecord | null;
  author: EndUserRow | null;
  actorId: string | null;
  extra: Record<string, unknown>;
  origin: string;
}

async function sendEmails(env: Env, ctx: EmailContext): Promise<void> {
  if (!flag(env, 'FEATURE_EMAIL') || !env.EMAIL || !ctx.post) return;
  const from = { email: env.FROM_EMAIL ?? 'feedback@example.com', name: env.FROM_NAME ?? `${ctx.project.name} Feedback` };
  const { post } = ctx;

  if (ctx.type === 'post.created' && post.moderation === 'pending') {
    const to = ctx.project.settings.adminEmail ?? env.ADMIN_EMAIL;
    if (!to) return;
    const link = `${ctx.origin}/admin/#/projects/${ctx.project.id}/queue`;
    await env.EMAIL.send({
      to,
      from,
      subject: `[${ctx.project.name}] New feedback to review: ${post.title}`,
      text: `${post.title}\n\n${post.body}\n\nReview it: ${link}`,
      html: `<h2>${escapeHtml(post.title)}</h2><p style="white-space:pre-wrap">${escapeHtml(post.body)}</p><p><a href="${escapeHtml(link)}">Review in the dashboard</a></p>`,
    });
    return;
  }

  const author = ctx.author;
  if (!ctx.project.settings.notifySubmitter || !author?.email || author.id === ctx.actorId) return;

  let headline: string | null = null;
  if (ctx.type === 'post.approved') headline = 'Your feedback is now public';
  else if (ctx.type === 'post.declined') headline = 'Your feedback was declined';
  else if (ctx.type === 'post.status_changed' && post.moderation === 'approved') {
    headline = `Your feedback is now "${locales.en.status[post.status]}"`;
  }
  if (!headline) return;

  const reason = ctx.type === 'post.declined' && post.declineReason ? `\n\nReason: ${post.declineReason}` : '';
  await env.EMAIL.send({
    to: author.email,
    from,
    subject: `[${ctx.project.name}] ${headline}`,
    text: `${headline}: "${post.title}".${reason}\n\nThanks for helping improve ${ctx.project.name}!`,
    html: `<p>${escapeHtml(headline)}: <strong>${escapeHtml(post.title)}</strong>.</p>${
      reason ? `<p>Reason: ${escapeHtml(post.declineReason!)}</p>` : ''
    }<p>Thanks for helping improve ${escapeHtml(ctx.project.name)}!</p>`,
  });
}
