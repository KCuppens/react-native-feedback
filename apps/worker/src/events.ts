import { FEEDBACK_EVENT_TYPES, locales, type FeedbackEventType, type WebhookConfig } from '@kobecuppens/feedback-core';
import { signWebhook } from '@kobecuppens/feedback-core/server';
import type { EndUserRow, Env, EventMessage } from './env';
import { getPost, publicPost, type PostRecord } from './posts';
import { findProjectById } from './projects';
import { escapeHtml, flag, newId, now } from './util';

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

/**
 * Record an event in the outbox and hand it to the queue. Without a queue binding
 * (local dev) it is processed in the background of the current request instead.
 */
export async function emitEvent(env: Env, ctx: { waitUntil(promise: Promise<unknown>): void } | undefined, input: EventInput): Promise<void> {
  const id = newId();
  await env.DB.prepare(
    'INSERT INTO events (id, project_id, type, post_id, actor_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, input.projectId, input.type, input.postId, input.actorId, JSON.stringify({ origin: input.origin, ...input.data }), now())
    .run();
  if (env.EVENTS) {
    try {
      await env.EVENTS.send({ eventId: id });
    } catch (error) {
      // The change is already committed and the outbox row is stored: the hourly
      // sweep (maintenance.ts) delivers it. Failing the request would invite duplicates.
      console.error(JSON.stringify({ msg: 'event enqueue failed', eventId: id, error: String(error) }));
    }
  } else {
    const work = processEvent(env, id).catch((error: unknown) =>
      console.error(JSON.stringify({ msg: 'event processing failed', eventId: id, error: String(error) })),
    );
    if (ctx) ctx.waitUntil(work);
    else await work;
  }
}

export async function handleEventBatch(batch: MessageBatch<EventMessage>, env: Env): Promise<void> {
  // In parallel, so one slow webhook does not hold up the rest of the batch.
  await Promise.all(
    batch.messages.map(async (message) => {
      try {
        await processEvent(env, message.body.eventId);
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({ msg: 'event processing failed', eventId: message.body.eventId, error: String(error) }));
        message.retry();
      }
    }),
  );
}

export async function processEvent(env: Env, eventId: string): Promise<void> {
  const event = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(eventId).first<EventRow>();
  if (!event || event.processed_at) return;
  const project = await findProjectById(env, event.project_id);
  if (!project) return;
  const data = JSON.parse(event.payload) as Record<string, unknown> & { origin: string };
  const origin = env.PUBLIC_URL?.replace(/\/+$/, '') || data.origin;

  const post = event.post_id ? await getPost(env, origin, project.id, event.post_id, null) : null;
  const author = post
    ? await env.DB.prepare('SELECT * FROM end_users WHERE id = ?').bind(post.authorId).first<EndUserRow>()
    : null;

  // Mark first: webhook/email delivery is at-most-once so queue retries never double-send.
  const claimed = await env.DB.prepare('UPDATE events SET processed_at = ? WHERE id = ? AND processed_at IS NULL')
    .bind(now(), eventId)
    .run();
  if (!claimed.meta.changes) return;

  const { origin: _origin, snapshot, ...extra } = data;
  const body = JSON.stringify({
    id: event.id,
    type: event.type,
    projectId: project.id,
    createdAt: event.created_at,
    data: { post: post ? publicPost(post) : (snapshot ?? null), ...extra },
  });

  const [hooks, mail] = await Promise.allSettled([
    deliverWebhooks(env, project.id, event.type, body),
    sendEmails(env, { type: event.type, project, post, author, actorId: event.actor_id, extra, origin }),
  ]);
  // Delivery is at-most-once (the event is already claimed), so a failure here is final: log it.
  for (const [channel, result] of [['webhooks', hooks], ['email', mail]] as const) {
    if (result.status === 'rejected') {
      console.error(JSON.stringify({ msg: 'event delivery failed', channel, eventId, type: event.type, projectId: project.id, error: String(result.reason) }));
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

async function deliverWebhooks(env: Env, projectId: string, type: FeedbackEventType, body: string): Promise<void> {
  const { results } = await env.DB.prepare('SELECT * FROM webhooks WHERE project_id = ?')
    .bind(projectId)
    .all<{ id: string; url: string; secret: string; events: string }>();
  const targets = results.filter((w) => parseEventTypes(w.events).includes(type));
  await Promise.allSettled(
    targets.map(async (hook) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch(hook.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'react-native-feedback-webhooks/1',
              'X-Feedback-Event': type,
              'X-Feedback-Signature': await signWebhook(hook.secret, body),
            },
            body,
            signal: AbortSignal.timeout(10_000),
          });
          if (res.ok) return;
          console.warn(JSON.stringify({ msg: 'webhook non-2xx', hookId: hook.id, status: res.status }));
        } catch (error) {
          console.warn(JSON.stringify({ msg: 'webhook failed', hookId: hook.id, error: String(error) }));
        }
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
