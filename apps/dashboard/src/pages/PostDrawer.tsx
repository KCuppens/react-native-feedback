import { formatRelativeTime, locales, POST_STATUSES, type PostStatus } from '@kobecuppens/feedback-core';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, latestError } from '../api';
import { ConfirmButton, STATUS_LABELS, StatusBadge, useDialogFocus, ErrorMessage } from '../ui';
import { useProjectInvalidate } from './Queue';

export function PostDrawer({ projectId, postId, onClose }: { projectId: string; postId: string; onClose: () => void }) {
  const admin = api.project(projectId);
  const invalidate = useProjectInvalidate(projectId);
  const post = useQuery({ queryKey: ['p', projectId, 'post', postId], queryFn: () => admin.getPost(postId) });
  const comments = useInfiniteQuery({
    queryKey: ['p', projectId, 'comments', postId],
    queryFn: ({ pageParam }) => admin.listComments(postId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });
  const commentList = comments.data?.pages.flatMap((page) => page.items) ?? [];
  const [reply, setReply] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const [declineReason, setDeclineReason] = useState('');
  const [mergeSearch, setMergeSearch] = useState('');
  const [mergeQuery, setMergeQuery] = useState('');
  const [mergeOpen, setMergeOpen] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setMergeQuery(mergeSearch.trim()), 300);
    return () => clearTimeout(id);
  }, [mergeSearch]);

  // Searchable, so low-voted duplicates beyond the top 100 can still be picked. Loaded only
  // once the admin reaches for the merge control, and debounced like the posts search.
  const mergeCandidates = useQuery({
    queryKey: ['merge-candidates', projectId, mergeQuery],
    queryFn: async () => (await admin.listPosts({ moderation: 'approved', sort: 'top', limit: 100, q: mergeQuery || undefined })).items,
    enabled: mergeOpen,
    staleTime: 60_000,
  });

  const run = <T,>(fn: () => Promise<T>) => ({ mutationFn: fn, onSuccess: invalidate });
  const approve = useMutation(run(() => admin.approve(postId)));
  const decline = useMutation(run(() => admin.decline(postId, declineReason.trim() || null)));
  const setStatus = useMutation({ mutationFn: (status: PostStatus) => admin.updatePost(postId, { status }), onSuccess: invalidate });
  const sendReply = useMutation({
    mutationFn: () => admin.reply(postId, reply.trim()),
    onSuccess: () => {
      setReply('');
      invalidate();
    },
  });
  const removeComment = useMutation({ mutationFn: (id: string) => admin.deleteComment(postId, id), onSuccess: invalidate });
  const merge = useMutation({
    mutationFn: () => admin.merge(postId, mergeTarget),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => admin.deletePost(postId),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const dialog = useDialogFocus<HTMLElement>(onClose);

  // Reply errors show next to the reply form; everything else next to the moderation panel.
  const error = latestError(approve, decline, setStatus, removeComment, merge, remove);
  const p = post.data;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside ref={dialog} tabIndex={-1} className="drawer" role="dialog" aria-modal="true" aria-label="Post">
        <div className="row between">
          <span className="muted small">{p ? `${p.author.name ?? 'Anonymous'} · ${formatRelativeTime(locales.en, p.createdAt)}` : ''}</span>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {post.isPending ? (
          <p className="muted">Loading…</p>
        ) : post.isError ? (
          <ErrorMessage error={post.error} retry={() => post.refetch()} />
        ) : (
          p && (
            <div className="stack">
              <h2>{p.title}</h2>
              <div className="row">
                <StatusBadge post={p} />
                <span className="muted small">
                  ▲ {p.upvotes} · ▼ {p.downvotes} · score {p.score}
                </span>
              </div>
              {p.mergedIntoId && <p className="muted">Merged into another post.</p>}
              {p.declineReason && <p className="muted">Decline reason: {p.declineReason}</p>}
              {p.body && <p className="body">{p.body}</p>}
              {p.attachments.length > 0 && (
                <div className="thumbs">
                  {p.attachments.map((a, i) => (
                    <a key={a.id} href={a.url} target="_blank" rel="noreferrer" aria-label={`Attachment ${i + 1} (opens in a new tab)`}>
                      <img src={a.url} alt="" />
                    </a>
                  ))}
                </div>
              )}

              <section className="panel stack">
                {p.moderation !== 'approved' && (
                  <div className="row">
                    <button type="button" className="primary" onClick={() => approve.mutate()} disabled={approve.isPending}>
                      Approve
                    </button>
                    {p.moderation === 'pending' && (
                      <>
                        <input
                          value={declineReason}
                          onChange={(e) => setDeclineReason(e.target.value)}
                          placeholder="Decline reason (optional)"
                          aria-label="Decline reason"
                        />
                        <button type="button" className="danger" onClick={() => decline.mutate()} disabled={decline.isPending}>
                          Decline
                        </button>
                      </>
                    )}
                  </div>
                )}
                <label>
                  Status
                  <select value={p.status} onChange={(e) => setStatus.mutate(e.target.value as PostStatus)}>
                    {POST_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
                {!p.mergedIntoId && (
                  <div className="row">
                    <input
                      type="search"
                      value={mergeSearch}
                      onChange={(e) => setMergeSearch(e.target.value)}
                      placeholder="Find duplicate target…"
                      aria-label="Search merge target"
                      onFocus={() => setMergeOpen(true)}
                    />
                    <select
                      value={mergeTarget}
                      onChange={(e) => setMergeTarget(e.target.value)}
                      aria-label="Merge into"
                      onFocus={() => setMergeOpen(true)}
                    >
                      <option value="">Merge into…</option>
                      {mergeCandidates.data
                        ?.filter((c) => c.id !== p.id)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title} (▲{c.score})
                          </option>
                        ))}
                    </select>
                    <button type="button" onClick={() => merge.mutate()} disabled={!mergeTarget || merge.isPending}>
                      Merge
                    </button>
                  </div>
                )}
                <ConfirmButton
                  label="Delete post…"
                  question="Delete permanently, including votes, comments and images?"
                  confirmLabel="Delete"
                  pending={remove.isPending}
                  onConfirm={() => remove.mutate()}
                />
              </section>

              <ErrorMessage error={error} />

              <h3>Comments</h3>
              {comments.isPending && <p className="muted">Loading comments…</p>}
              <ErrorMessage error={comments.error} />
              {comments.isSuccess && commentList.length === 0 && <p className="muted">No comments yet.</p>}
              <ul className="comments">
                {commentList.map((c) => (
                  <li key={c.id} className={c.isOfficial ? 'official' : undefined}>
                    <div className="row between small">
                      <strong>
                        {c.author.name ?? (c.isOfficial ? 'Team' : 'Anonymous')}
                        {c.isOfficial && <span className="badge approved">Team</span>}
                      </strong>
                      <span className="row muted">
                        {formatRelativeTime(locales.en, c.createdAt)}
                        <ConfirmButton
                          label="Delete"
                          question="Delete this comment?"
                          className="ghost small"
                          pending={removeComment.isPending}
                          onConfirm={() => removeComment.mutate(c.id)}
                        />
                      </span>
                    </div>
                    <p className="body">{c.body}</p>
                  </li>
                ))}
              </ul>
              {comments.hasNextPage && (
                <button type="button" onClick={() => void comments.fetchNextPage()} disabled={comments.isFetchingNextPage}>
                  Load more comments
                </button>
              )}
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (reply.trim()) sendReply.mutate();
                }}
              >
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Official reply (shown with a Team badge)"
                  aria-label="Official reply"
                  rows={3}
                />
                <button type="submit" className="primary" disabled={!reply.trim() || sendReply.isPending}>
                  Reply as team
                </button>
                <ErrorMessage error={sendReply.error} />
              </form>
            </div>
          )
        )}
      </aside>
    </div>
  );
}
