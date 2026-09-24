import { formatRelativeTime, locales, type Post } from '@kobecuppens/feedback-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorText } from '../api';
import { href } from '../router';

export function useProjectInvalidate(projectId: string) {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ['p', projectId] });
    void client.invalidateQueries({ queryKey: ['projects'] });
  };
}

export function QueuePage({ projectId }: { projectId: string }) {
  const admin = api.project(projectId);
  const queue = useQuery({ queryKey: ['p', projectId, 'queue'], queryFn: () => admin.listQueue() });

  if (queue.isPending) return <p className="muted">Loading…</p>;
  if (queue.isError) return <p className="error">{errorText(queue.error)}</p>;
  if (queue.data.items.length === 0) {
    return (
      <div className="empty">
        <h2>All caught up</h2>
        <p className="muted">New submissions that need approval appear here.</p>
      </div>
    );
  }
  return (
    <div className="stack">
      {queue.data.items.map((post) => (
        <QueueCard key={post.id} projectId={projectId} post={post} />
      ))}
    </div>
  );
}

function QueueCard({ projectId, post }: { projectId: string; post: Post }) {
  const admin = api.project(projectId);
  const invalidate = useProjectInvalidate(projectId);
  const [reason, setReason] = useState('');
  const [declining, setDeclining] = useState(false);
  const approve = useMutation({ mutationFn: () => admin.approve(post.id), onSuccess: invalidate });
  const decline = useMutation({ mutationFn: () => admin.decline(post.id, reason.trim() || null), onSuccess: invalidate });
  const error = approve.error ?? decline.error;

  return (
    <article className="card">
      <div className="row between">
        <a href={href(projectId, 'queue', post.id)}>
          <h3>{post.title}</h3>
        </a>
        <span className="muted small">
          {post.author.name ?? 'Anonymous'} · {formatRelativeTime(locales.en, post.createdAt)}
          {post.category ? ` · ${post.category.name}` : ''}
        </span>
      </div>
      {post.body && <p className="body">{post.body}</p>}
      {post.attachments.length > 0 && (
        <div className="thumbs">
          {post.attachments.map((a, i) => (
            <a key={a.id} href={a.url} target="_blank" rel="noreferrer" aria-label={`Attachment ${i + 1} (opens in a new tab)`}>
              <img src={a.url} alt="" />
            </a>
          ))}
        </div>
      )}
      {declining ? (
        <div className="row">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason shown to the author (optional)"
            aria-label="Decline reason"
            autoFocus
          />
          <button type="button" className="danger" onClick={() => decline.mutate()} disabled={decline.isPending}>
            Decline
          </button>
          <button type="button" className="ghost" onClick={() => setDeclining(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="row">
          <button type="button" className="primary" onClick={() => approve.mutate()} disabled={approve.isPending}>
            Approve
          </button>
          <button type="button" onClick={() => setDeclining(true)}>
            Decline…
          </button>
        </div>
      )}
      {error && <p className="error">{errorText(error)}</p>}
    </article>
  );
}
