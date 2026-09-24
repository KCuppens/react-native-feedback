import { formatRelativeTime, nextVote, POST_STATUSES, type Comment, type Post } from '@kobecuppens/feedback-core';
import {
  useComments,
  useCreateComment,
  useFeatures,
  useFeedbackContext,
  useModeration,
  usePost,
  useVote,
} from '@kobecuppens/feedback-core/react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Avatar, Button, CategoryPill, Chip, ErrorState, Header, InlineError, Loading, PostStatusPill, VoteControl } from '../components';
import { useUI } from '../ui';

export interface FeedbackDetailProps {
  postId: string;
  initialPost?: Post;
  onBack?: () => void;
  onDeleted?: () => void;
}

export function FeedbackDetail({ postId, initialPost, onBack, onDeleted }: FeedbackDetailProps) {
  const { slot, strings } = useUI();
  const { onEvent } = useFeedbackContext();
  const features = useFeatures();
  const query = usePost(postId, initialPost);
  const post = query.data;
  const vote = useVote();

  // Intentional dependencies: report post_opened once per opened post, not on every refetch
  useEffect(() => {
    if (post) onEvent({ type: 'post_opened', post });
  }, [post?.id]);

  if (!post) {
    return (
      <>
        <Header title="" onBack={onBack} />
        {query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : <Loading />}
      </>
    );
  }
  const canComment = !!features?.comments && post.moderation !== 'declined' && !post.mergedIntoId;

  return (
    <>
      <Header title={post.title} onBack={onBack} />
      <article {...slot('detail')}>
        {post.moderation !== 'approved' && (
          <div {...slot('moderationBanner')} role="status">
            {post.moderation === 'pending'
              ? strings.moderation.pending
              : post.declineReason
                ? strings.moderation.declinedWithReason(post.declineReason)
                : strings.moderation.declined}
          </div>
        )}
        {post.mergedIntoId && <div {...slot('moderationBanner')}>{strings.post.mergedInto}</div>}
        <div style={{ display: 'flex', gap: 12 }}>
          <VoteControl
            post={post}
            onVote={(v) => vote.mutate({ post, value: nextVote(post.myVote, v) })}
            disabled={!features?.vote || post.moderation !== 'approved' || !!post.mergedIntoId}
            showDownvote={!!features?.downvote}
          />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h1 {...slot('detailTitle')}>{post.title}</h1>
            <div {...slot('cardMeta')}>
              <PostStatusPill post={post} />
              {post.category && <CategoryPill name={post.category.name} color={post.category.color} />}
              <span {...slot('cardMetaText')}>
                {strings.post.by(post.author.name ?? strings.post.anonymous)} · {formatRelativeTime(strings, post.createdAt)}
              </span>
            </div>
          </div>
        </div>
        {post.body && <p {...slot('detailBody')}>{post.body}</p>}
        {post.attachments.length > 0 && (
          <div {...slot('attachmentRow')} role="group" aria-label={strings.post.attachments}>
            {post.attachments.map((a, i) => (
              <a key={a.id} href={a.url} target="_blank" rel="noreferrer noopener" aria-label={strings.post.openAttachment(i + 1)}>
                <img {...slot('attachmentImage')} src={a.url} alt="" loading="lazy" />
              </a>
            ))}
          </div>
        )}
        {features?.admin && <AdminControls post={post} onDeleted={onDeleted ?? onBack} />}
        <h2 {...slot('sectionTitle')}>{strings.comments.title}</h2>
        <CommentList postId={post.id} />
      </article>
      {canComment && <Composer postId={post.id} />}
    </>
  );
}

function CommentList({ postId }: { postId: string }) {
  const { strings, slot } = useUI();
  const query = useComments(postId);
  const comments = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (comments.length === 0) return <p {...slot('helperText')}>{strings.comments.empty}</p>;
  return (
    <ul {...slot('commentList')}>
      {comments.map((c) => (
        <CommentItem key={c.id} comment={c} />
      ))}
      {query.hasNextPage && (
        <li>
          <Button
            label={strings.list.loadMore}
            variant="secondary"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          />
        </li>
      )}
    </ul>
  );
}

function CommentItem({ comment }: { comment: Comment }) {
  const { slot, strings } = useUI();
  const name = comment.author.name ?? (comment.isOfficial ? strings.post.official : strings.post.anonymous);
  return (
    <li {...slot('commentItem', comment.isOfficial && 'commentOfficial')}>
      <div {...slot('commentHeader')}>
        <Avatar name={name} src={comment.author.avatarUrl} />
        <span {...slot('commentAuthor')}>{name}</span>
        {comment.isOfficial && <span {...slot('officialBadge')}>{strings.post.official}</span>}
        <time {...slot('commentTime')} dateTime={new Date(comment.createdAt).toISOString()}>
          {formatRelativeTime(strings, comment.createdAt)}
        </time>
      </div>
      <p {...slot('commentBody')}>{comment.body}</p>
    </li>
  );
}

function Composer({ postId }: { postId: string }) {
  const { slot, strings } = useUI();
  const create = useCreateComment(postId);
  const [body, setBody] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (text) create.mutate({ body: text }, { onSuccess: () => setBody('') });
  };
  return (
    <form {...slot('composer')} onSubmit={submit}>
      <textarea
        {...slot('composerInput')}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
        }}
        placeholder={strings.comments.placeholder}
        aria-label={strings.comments.placeholder}
        rows={1}
      />
      <Button type="submit" label={strings.comments.send} disabled={!body.trim()} loading={create.isPending} />
      <InlineError error={create.error} />
    </form>
  );
}

/**
 * An inline confirmation replaces the button that opened it, which would drop focus to
 * <body>. Move focus to the confirmation's last button (Cancel) when it opens, and to the
 * last button of the trigger row when it closes. Rows are looked up by ref because Button
 * can be a host override that does not forward refs.
 */
function useSwapFocus(open: boolean) {
  const openRow = useRef<HTMLDivElement>(null);
  const closedRow = useRef<HTMLDivElement>(null);
  const fallback = useRef<HTMLElement>(null);
  const was = useRef(open);
  useEffect(() => {
    if (was.current === open) return;
    was.current = open;
    const row = open ? openRow.current : closedRow.current;
    if (open && !row) return; // the opened content focuses itself (autoFocus)
    const buttons = row?.querySelectorAll<HTMLElement>('button');
    (buttons?.[buttons.length - 1] ?? fallback.current)?.focus();
  }, [open]);
  return { openRow, closedRow, fallback };
}

function AdminControls({ post, onDeleted }: { post: Post; onDeleted?: () => void }) {
  const { slot, strings } = useUI();
  const moderation = useModeration();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const declineFocus = useSwapFocus(declining);
  const deleteFocus = useSwapFocus(confirmDelete);
  const section = useRef<HTMLElement | null>(null);
  // Approving here swaps the Approve/Decline row for the status chips: keep focus in the
  // panel. Only for this user's own approval (not a background refetch), and only when focus
  // was actually lost with the removed row.
  const approvedHere = useRef(false);
  useEffect(() => {
    if (post.moderation !== 'approved' || !approvedHere.current) return;
    approvedHere.current = false;
    const lost = !document.activeElement || document.activeElement === document.body;
    if (lost && section.current) (section.current.querySelector<HTMLElement>('button') ?? section.current).focus();
  }, [post.moderation]);
  // Escape answers "no" to an open inline question instead of leaving the screen.
  const cancelOnEscape = (cancel: () => void) => (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    cancel();
  };
  const failed = [moderation.approve, moderation.decline, moderation.update, moderation.remove].find((mutation) => mutation.isError);
  return (
    <section
      {...slot('adminBar')}
      aria-label={strings.admin.queue}
      ref={(el) => {
        section.current = el;
        declineFocus.fallback.current = el;
        deleteFocus.fallback.current = el;
      }}
      tabIndex={-1}
    >
      <InlineError error={failed?.error} />
      {post.moderation !== 'approved' && !declining && (
        <div {...slot('adminRow')} ref={declineFocus.closedRow}>
          <Button
            label={strings.admin.approve}
            onClick={() => {
              approvedHere.current = true;
              moderation.approve.mutate(post.id, { onError: () => (approvedHere.current = false) });
            }}
            loading={moderation.approve.isPending}
          />
          {post.moderation === 'pending' && <Button label={strings.admin.decline} variant="secondary" onClick={() => setDeclining(true)} />}
        </div>
      )}
      {declining && (
        <div style={{ display: 'contents' }} onKeyDown={cancelOnEscape(() => setDeclining(false))}>
          <input
            {...slot('input')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={strings.admin.declineReasonPlaceholder}
            aria-label={strings.admin.declineReasonPlaceholder}
            // Focus follows the Decline button this field replaces.
            autoFocus
          />
          <div {...slot('adminRow')}>
            <Button
              label={strings.admin.confirmDecline}
              variant="danger"
              loading={moderation.decline.isPending}
              onClick={() =>
                moderation.decline.mutate({ id: post.id, reason: reason.trim() || null }, { onSuccess: () => setDeclining(false) })
              }
            />
            <Button label={strings.admin.cancel} variant="secondary" onClick={() => setDeclining(false)} />
          </div>
        </div>
      )}
      {post.moderation === 'approved' && (
        <>
          <span {...slot('inputLabel')}>{strings.admin.changeStatus}</span>
          <div {...slot('adminRow')}>
            {POST_STATUSES.map((s) => (
              <Chip
                key={s}
                label={strings.status[s]}
                active={post.status === s}
                onClick={() => !moderation.update.isPending && moderation.update.mutate({ id: post.id, patch: { status: s } })}
              />
            ))}
          </div>
        </>
      )}
      {confirmDelete ? (
        <>
          <p {...slot('errorText')} role="alert">
            {strings.admin.confirmDelete}
          </p>
          <div {...slot('adminRow')} ref={deleteFocus.openRow} onKeyDown={cancelOnEscape(() => setConfirmDelete(false))}>
            <Button
              label={strings.admin.delete}
              variant="danger"
              loading={moderation.remove.isPending}
              onClick={() => moderation.remove.mutate(post.id, { onSuccess: () => onDeleted?.() })}
            />
            <Button label={strings.admin.cancel} variant="secondary" onClick={() => setConfirmDelete(false)} />
          </div>
        </>
      ) : (
        <div {...slot('adminRow')} ref={deleteFocus.closedRow}>
          <Button label={strings.admin.delete} variant="secondary" onClick={() => setConfirmDelete(true)} />
        </div>
      )}
    </section>
  );
}
