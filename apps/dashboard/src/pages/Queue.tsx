import type { Post } from '@kobecuppens/feedback-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { authorName, ErrorMessage, Thumbs } from '../ui';
import { api, latestError, keys } from '../api';
import { useI18n } from '../i18n';
import { href } from '../router';

/**
 * After a post changed: write the returned post into its detail cache instead of refetching
 * it, refetch only the post lists, and the project list (pending counts, which run a COUNT
 * per project) only when moderation changed. Comments and categories are left alone.
 */
export function usePostChanged(projectId: string) {
  const client = useQueryClient();
  return ({ post, moderation = false, comments = false }: { post?: Post; moderation?: boolean; comments?: boolean } = {}) => {
    if (post) client.setQueryData(keys.post(projectId, post.id), post);
    for (const list of ['queue', 'posts', 'kanban'] as const) void client.invalidateQueries({ queryKey: keys.list(projectId, list) });
    if (comments) void client.invalidateQueries({ queryKey: keys.comments(projectId) });
    if (moderation) void client.invalidateQueries({ queryKey: keys.projects });
  };
}

/** Everything for a project: for settings, categories and webhooks, which touch many views. */
export function useProjectInvalidate(projectId: string) {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: keys.project(projectId) });
    void client.invalidateQueries({ queryKey: keys.projects });
  };
}

export function QueuePage({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const admin = api.project(projectId);
  const queue = useQuery({ queryKey: keys.list(projectId, 'queue'), queryFn: () => admin.listQueue() });

  // Approving or declining here removes the card, and focus with it: move it to the card that
  // took its place (or the new last one, or the empty state) so keyboard users keep going.
  // Only for this user's own action: a background refetch must not move focus or scroll.
  const list = useRef<HTMLDivElement>(null);
  const empty = useRef<HTMLHeadingElement>(null);
  const shown = useRef<string[]>([]);
  const moderatedHere = useRef<string | null>(null);
  const ids = queue.data?.items.map((post) => post.id).join(',') ?? '';
  useEffect(() => {
    const before = shown.current;
    const now = ids ? ids.split(',') : [];
    shown.current = now;
    const id = moderatedHere.current;
    if (!id || now.includes(id)) return;
    moderatedHere.current = null;
    const removed = before.indexOf(id);
    const lost = !document.activeElement || document.activeElement === document.body;
    if (removed < 0 || !lost) return;
    if (now.length === 0) return empty.current?.focus();
    list.current?.querySelectorAll<HTMLElement>('article > .row > a')[Math.min(removed, now.length - 1)]?.focus();
  }, [ids]);

  if (queue.isPending) return <p className="muted">{t.common.loading}</p>;
  if (queue.isError) return <ErrorMessage error={queue.error} retry={() => queue.refetch()} />;
  if (queue.data.items.length === 0) {
    return (
      <div className="empty">
        <h2 ref={empty} tabIndex={-1}>
          {t.queue.emptyTitle}
        </h2>
        <p className="muted">{t.queue.emptyHelp}</p>
      </div>
    );
  }
  return (
    <div className="stack" ref={list}>
      {queue.data.items.map((post) => (
        <QueueCard
          key={post.id}
          projectId={projectId}
          post={post}
          onModerated={() => {
            moderatedHere.current = post.id;
          }}
        />
      ))}
    </div>
  );
}

function QueueCard({ projectId, post, onModerated }: { projectId: string; post: Post; onModerated: () => void }) {
  const { t, board, ago } = useI18n();
  const admin = api.project(projectId);
  const changed = usePostChanged(projectId);
  const [reason, setReason] = useState('');
  const [declining, setDeclining] = useState(false);
  const done = (updated: Post) => {
    onModerated();
    changed({ post: updated, moderation: true });
  };
  const approve = useMutation({ mutationFn: () => admin.approve(post.id), onSuccess: done });
  const decline = useMutation({ mutationFn: () => admin.decline(post.id, reason.trim() || null), onSuccess: done });
  const error = latestError(approve, decline);
  // Cancel replaces itself with the Decline… button: send focus back there, not to <body>.
  const declineButton = useRef<HTMLButtonElement>(null);
  const wasDeclining = useRef(false);
  useEffect(() => {
    if (wasDeclining.current && !declining) declineButton.current?.focus();
    wasDeclining.current = declining;
  }, [declining]);

  return (
    <article className="card">
      <div className="row between">
        <a href={href(projectId, 'queue', post.id)}>
          <h3>{post.title}</h3>
        </a>
        <span className="muted small">
          {authorName(post.author, board.post.anonymous)} · {ago(post.createdAt)}
          {post.category ? ` · ${post.category.name}` : ''}
        </span>
      </div>
      {post.body && <p className="body">{post.body}</p>}
      <Thumbs attachments={post.attachments} />
      {declining ? (
        <div className="row">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t.queue.reasonPlaceholder}
            aria-label={t.queue.reasonLabel}
            autoFocus
          />
          {/* aria-disabled, not disabled, while busy: disabling drops focus to <body> if it then fails. */}
          <button
            type="button"
            className="danger"
            onClick={() => !decline.isPending && decline.mutate()}
            aria-disabled={decline.isPending || undefined}
          >
            {t.queue.decline}
          </button>
          <button type="button" className="ghost" onClick={() => setDeclining(false)}>
            {t.common.cancel}
          </button>
        </div>
      ) : (
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={() => !approve.isPending && approve.mutate()}
            aria-disabled={approve.isPending || undefined}
          >
            {t.queue.approve}
          </button>
          <button ref={declineButton} type="button" onClick={() => setDeclining(true)}>
            {t.queue.declineMore}
          </button>
        </div>
      )}
      <ErrorMessage error={error} />
    </article>
  );
}
