import { FeedbackApiError, type Post, type PostStatus } from '@kobecuppens/feedback-core';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, keys, latestError } from '../api';
import { ago, authorName, ConfirmButton, ErrorMessage, StatusBadge, StatusOptions, Thumbs, useDebouncedValue, useDialogFocus } from '../ui';
import { usePostChanged } from './Queue';

export function PostDrawer({ projectId, postId, onClose }: { projectId: string; postId: string; onClose: () => void }) {
  const admin = api.project(projectId);
  const changed = usePostChanged(projectId);
  const post = useQuery({ queryKey: keys.post(projectId, postId), queryFn: () => admin.getPost(postId) });
  const [declineReason, setDeclineReason] = useState('');

  const approve = useMutation({ mutationFn: () => admin.approve(postId), onSuccess: (p) => changed({ post: p, moderation: true }) });
  const decline = useMutation({
    mutationFn: () => admin.decline(postId, declineReason.trim() || null),
    onSuccess: (p) => changed({ post: p, moderation: true }),
  });
  const setStatus = useMutation({
    mutationFn: (status: PostStatus) => admin.updatePost(postId, { status }),
    onSuccess: (p) => changed({ post: p }),
  });
  const remove = useMutation({
    mutationFn: () => admin.deletePost(postId),
    onSuccess: () => {
      changed({ moderation: true });
      onClose();
    },
  });

  const dialog = useDialogFocus<HTMLElement>(onClose);
  const error = latestError(approve, decline, setStatus, remove);
  const current = post.data;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside ref={dialog} tabIndex={-1} className="drawer" role="dialog" aria-modal="true" aria-label="Post">
        <div className="row between">
          <span className="muted small">{current ? `${authorName(current.author)} · ${ago(current.createdAt)}` : ''}</span>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {post.isPending ? (
          <p className="muted">Loading…</p>
        ) : post.isError ? (
          <ErrorMessage error={post.error} retry={() => post.refetch()} />
        ) : (
          current && (
            <div className="stack">
              <h2>{current.title}</h2>
              <div className="row">
                <StatusBadge post={current} />
                <span className="muted small">
                  ▲ {current.upvotes} · ▼ {current.downvotes} · score {current.score}
                </span>
              </div>
              {current.mergedIntoId && <p className="muted">Merged into another post.</p>}
              {current.declineReason && <p className="muted">Decline reason: {current.declineReason}</p>}
              {current.body && <p className="body">{current.body}</p>}
              <Thumbs attachments={current.attachments} />

              <section className="panel stack">
                {current.moderation !== 'approved' && (
                  <div className="row">
                    <button type="button" className="primary" onClick={() => approve.mutate()} disabled={approve.isPending}>
                      Approve
                    </button>
                    {current.moderation === 'pending' && (
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
                  <select value={current.status} onChange={(e) => setStatus.mutate(e.target.value as PostStatus)}>
                    <StatusOptions />
                  </select>
                </label>
                {!current.mergedIntoId && <MergeControl projectId={projectId} post={current} onMerged={onClose} />}
                <ConfirmButton
                  label="Delete post…"
                  question="Delete permanently, including votes, comments and images?"
                  confirmLabel="Delete"
                  pending={remove.isPending}
                  onConfirm={() => remove.mutate()}
                />
              </section>

              <ErrorMessage error={error} />
              <PostComments projectId={projectId} postId={postId} />
            </div>
          )
        )}
      </aside>
    </div>
  );
}

/** Pick a target and merge this post into it as a duplicate. */
function MergeControl({ projectId, post, onMerged }: { projectId: string; post: Post; onMerged: () => void }) {
  const admin = api.project(projectId);
  const changed = usePostChanged(projectId);
  const client = useQueryClient();
  const [target, setTarget] = useState('');
  const [search, setSearch] = useState('');
  const query = useDebouncedValue(search.trim(), 300);
  const [open, setOpen] = useState(false);

  // Searchable, so low-voted duplicates beyond the top 100 can still be picked. Loaded only
  // once the admin reaches for the merge control, and debounced like the posts search.
  const candidates = useQuery({
    queryKey: keys.mergeCandidates(projectId, query),
    queryFn: async () => (await admin.listPosts({ moderation: 'approved', sort: 'top', limit: 100, q: query || undefined })).items,
    enabled: open,
    staleTime: 60_000,
  });
  const refetchSource = () => client.invalidateQueries({ queryKey: keys.post(projectId, post.id) });
  const merge = useMutation({
    mutationFn: () => admin.merge(post.id, target),
    onSuccess: (merged) => {
      changed({ post: merged });
      void refetchSource();
      onMerged();
    },
    // Lost a race with another merge: reload so the drawer and the candidates reflect it.
    onError: (e) => {
      if (!(e instanceof FeedbackApiError && e.status === 409)) return;
      changed();
      void refetchSource();
      void client.invalidateQueries({ queryKey: keys.mergeCandidates(projectId) });
      setTarget('');
    },
  });

  return (
    <>
      <div className="row">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find duplicate target…"
          aria-label="Search merge target"
          onFocus={() => setOpen(true)}
        />
        <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Merge into" onFocus={() => setOpen(true)}>
          <option value="">Merge into…</option>
          {candidates.data
            ?.filter((c) => c.id !== post.id)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} (▲{c.score})
              </option>
            ))}
        </select>
        <button type="button" onClick={() => merge.mutate()} disabled={!target || merge.isPending}>
          Merge
        </button>
      </div>
      <ErrorMessage error={merge.error} />
    </>
  );
}

/** The post's comments, with delete and an official team reply. */
function PostComments({ projectId, postId }: { projectId: string; postId: string }) {
  const admin = api.project(projectId);
  const changed = usePostChanged(projectId);
  const client = useQueryClient();
  const comments = useInfiniteQuery({
    queryKey: keys.comments(projectId, postId),
    queryFn: ({ pageParam }) => admin.listComments(postId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });
  const list = comments.data?.pages.flatMap((page) => page.items) ?? [];
  const [reply, setReply] = useState('');

  // Comment changes also move the post's comment count, so refetch the post itself.
  const commentsChanged = () => {
    changed({ comments: true });
    void client.invalidateQueries({ queryKey: keys.post(projectId, postId) });
  };
  const sendReply = useMutation({
    mutationFn: () => admin.reply(postId, reply.trim()),
    onSuccess: () => {
      setReply('');
      commentsChanged();
    },
  });
  const removeComment = useMutation({ mutationFn: (id: string) => admin.deleteComment(postId, id), onSuccess: commentsChanged });

  return (
    <>
      <h3>Comments</h3>
      {comments.isPending && <p className="muted">Loading comments…</p>}
      <ErrorMessage error={comments.error} retry={() => comments.refetch()} />
      <ErrorMessage error={removeComment.error} />
      {comments.isSuccess && list.length === 0 && <p className="muted">No comments yet.</p>}
      <ul className="comments">
        {list.map((c) => (
          <li key={c.id} className={c.isOfficial ? 'official' : undefined}>
            <div className="row between small">
              <strong>
                {authorName(c.author, c.isOfficial ? 'Team' : 'Anonymous')}
                {c.isOfficial && <span className="badge approved">Team</span>}
              </strong>
              <span className="row muted">
                {ago(c.createdAt)}
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
    </>
  );
}
