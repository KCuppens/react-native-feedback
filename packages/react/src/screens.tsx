import {
  FeedbackApiError,
  formatRelativeTime,
  nextVote,
  POST_STATUSES,
  type Attachment,
  type Comment,
  type Post,
  type PostSort,
  type UpdateItem,
} from '@kobecuppens/feedback-core';
import {
  useAdminQueue,
  useComments,
  useConfig,
  useCreateComment,
  useCreatePost,
  useFeatures,
  useFeedbackContext,
  useMarkUpdatesSeen,
  useModeration,
  usePost,
  usePosts,
  useRoadmap,
  useUpdates,
  useUpload,
  useVote,
} from '@kobecuppens/feedback-core/react';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Avatar,
  Button,
  CategoryPill,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  Loading,
  PostCard,
  PostStatusPill,
  StatusPill,
  VoteControl,
} from './components';
import { useUI } from './ui';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

// ---------------------------------------------------------------------------

export interface FeedbackListProps {
  onOpenPost: (post: Post) => void;
  onNewPost?: () => void;
  initialSort?: PostSort;
  hideToolbar?: boolean;
}

const SORTS: PostSort[] = ['top', 'trending', 'new'];

export function FeedbackList({ onOpenPost, onNewPost, initialSort = 'top', hideToolbar }: FeedbackListProps) {
  const { slot, strings } = useUI();
  const features = useFeatures();
  const { data: config } = useConfig();
  const [sort, setSort] = useState<PostSort>(initialSort);
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);
  const query = usePosts({ sort, categoryId, q: q || undefined });
  const vote = useVote();
  const posts = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const sentinel = useRef<HTMLDivElement>(null);

  // Infinite scroll where IntersectionObserver exists; a button otherwise.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [query]);

  return (
    <>
      {!hideToolbar && (
        <div {...slot('toolbar')} role="search">
          <input
            type="search"
            {...slot('searchInput')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={strings.list.searchPlaceholder}
            aria-label={strings.list.searchPlaceholder}
          />
          <div {...slot('chipRow')}>
            {SORTS.map((s) => (
              <Chip key={s} label={strings.sort[s]} active={sort === s} onClick={() => setSort(s)} />
            ))}
          </div>
          {config && config.categories.length > 0 && (
            <div {...slot('chipRow')}>
              <Chip label={strings.list.allCategories} active={!categoryId} onClick={() => setCategoryId(undefined)} />
              {config.categories.map((cat) => (
                <Chip key={cat.id} label={cat.name} active={categoryId === cat.id} onClick={() => setCategoryId(cat.id)} />
              ))}
            </div>
          )}
        </div>
      )}
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : posts.length === 0 ? (
        <EmptyState message={q || categoryId ? strings.list.emptySearch : strings.list.empty} />
      ) : (
        <ul {...slot('list')}>
          {posts.map((post) => (
            <li key={post.id}>
              <PostCard
                post={post}
                onOpen={() => onOpenPost(post)}
                onVote={(v) => vote.mutate({ post, value: nextVote(post.myVote, v) })}
                canVote={!!features?.vote}
                canDownvote={!!features?.downvote}
              />
            </li>
          ))}
          {query.hasNextPage && (
            <li>
              <div ref={sentinel} />
              <Button label={strings.list.loadMore} variant="secondary" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} />
            </li>
          )}
        </ul>
      )}
      {onNewPost && features?.submit && (
        <button type="button" {...slot('button', 'fab')} onClick={onNewPost}>
          ＋ {strings.list.newPost}
        </button>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

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

  useEffect(() => {
    if (post) onEvent({ type: 'post_opened', post });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          <div {...slot('attachmentRow')} aria-label={strings.post.attachments}>
            {post.attachments.map((a) => (
              <a key={a.id} href={a.url} target="_blank" rel="noreferrer noopener">
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
          <Button label={strings.list.loadMore} variant="secondary" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} />
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
    </form>
  );
}

function AdminControls({ post, onDeleted }: { post: Post; onDeleted?: () => void }) {
  const { slot, strings } = useUI();
  const m = useModeration();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <section {...slot('adminBar')} aria-label={strings.admin.queue}>
      {post.moderation !== 'approved' && !declining && (
        <div {...slot('adminRow')}>
          <Button label={strings.admin.approve} onClick={() => m.approve.mutate(post.id)} loading={m.approve.isPending} />
          {post.moderation === 'pending' && <Button label={strings.admin.decline} variant="secondary" onClick={() => setDeclining(true)} />}
        </div>
      )}
      {declining && (
        <>
          <input {...slot('input')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={strings.admin.declineReasonPlaceholder} aria-label={strings.admin.declineReasonPlaceholder} />
          <div {...slot('adminRow')}>
            <Button
              label={strings.admin.confirmDecline}
              variant="danger"
              loading={m.decline.isPending}
              onClick={() => m.decline.mutate({ id: post.id, reason: reason.trim() || null }, { onSuccess: () => setDeclining(false) })}
            />
            <Button label={strings.admin.cancel} variant="secondary" onClick={() => setDeclining(false)} />
          </div>
        </>
      )}
      {post.moderation === 'approved' && (
        <>
          <span {...slot('inputLabel')}>{strings.admin.changeStatus}</span>
          <div {...slot('adminRow')}>
            {POST_STATUSES.map((s) => (
              <Chip key={s} label={strings.status[s]} active={post.status === s} onClick={() => m.update.mutate({ id: post.id, patch: { status: s } })} />
            ))}
          </div>
        </>
      )}
      {confirmDelete ? (
        <>
          <p {...slot('errorText')}>{strings.admin.confirmDelete}</p>
          <div {...slot('adminRow')}>
            <Button label={strings.admin.delete} variant="danger" loading={m.remove.isPending} onClick={() => m.remove.mutate(post.id, { onSuccess: () => onDeleted?.() })} />
            <Button label={strings.admin.cancel} variant="secondary" onClick={() => setConfirmDelete(false)} />
          </div>
        </>
      ) : (
        <div {...slot('adminRow')}>
          <Button label={strings.admin.delete} variant="secondary" onClick={() => setConfirmDelete(true)} />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

export interface FeedbackSubmitProps {
  onDone?: (post: Post) => void;
  onCancel?: () => void;
}

export function FeedbackSubmit({ onDone, onCancel }: FeedbackSubmitProps) {
  const { slot, strings } = useUI();
  const features = useFeatures();
  const { data: config } = useConfig();
  const create = useCreatePost();
  const upload = useUpload();
  const ids = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<{ attachment: Attachment; preview: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Post | null>(null);
  const limits = config?.limits;

  // Free preview blobs on unmount (removals free their own).
  const previews = useRef<string[]>([]);
  previews.current = attachments.map((a) => a.preview);
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const errorMessage = (e: unknown) => {
    if (e instanceof FeedbackApiError) {
      if (e.status === 413) return strings.errors.uploadTooLarge;
      if (e.status === 403) return strings.errors.notAllowed;
      return e.message || strings.errors.generic;
    }
    return e instanceof TypeError ? strings.errors.network : strings.errors.generic;
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (limits && file.size > limits.attachmentMaxBytes) {
      setError(strings.errors.uploadTooLarge);
      return;
    }
    try {
      const attachment = await upload.mutateAsync(file);
      setAttachments((list) => [...list, { attachment, preview: URL.createObjectURL(file) }]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate(
      { title: title.trim(), body: body.trim(), categoryId, attachmentIds: attachments.map((a) => a.attachment.id) },
      { onSuccess: setCreated, onError: (err) => setError(errorMessage(err)) },
    );
  };

  if (created) {
    return (
      <>
        <Header title={strings.submit.title} onBack={() => onDone?.(created)} />
        <div {...slot('empty')} role="status">
          <p style={{ margin: 0 }}>{created.moderation === 'approved' ? strings.submit.successPublished : strings.submit.successPending}</p>
          <Button label="OK" onClick={() => onDone?.(created)} />
        </div>
      </>
    );
  }

  const canAttach = !!features?.attachments && attachments.length < (limits?.attachmentsPerPost ?? 4);

  return (
    <>
      <Header title={strings.submit.title} onBack={onCancel} />
      <form {...slot('form')} onSubmit={submit}>
        <label {...slot('inputLabel')} htmlFor={`${ids}-title`}>
          {strings.submit.titleLabel}
        </label>
        <input
          id={`${ids}-title`}
          {...slot('input')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={limits?.titleMax ?? 120}
          minLength={3}
          required
          placeholder={strings.submit.titlePlaceholder}
          autoFocus
        />
        <label {...slot('inputLabel')} htmlFor={`${ids}-body`}>
          {strings.submit.bodyLabel}
        </label>
        <textarea
          id={`${ids}-body`}
          {...slot('textarea')}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={limits?.bodyMax ?? 5000}
          placeholder={strings.submit.bodyPlaceholder}
        />
        {config && config.categories.length > 0 && (
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'contents' }}>
            <legend {...slot('inputLabel')}>{strings.submit.categoryLabel}</legend>
            <div {...slot('chipRow')}>
              {config.categories.map((cat) => (
                <Chip key={cat.id} label={cat.name} active={categoryId === cat.id} onClick={() => setCategoryId(categoryId === cat.id ? null : cat.id)} />
              ))}
            </div>
          </fieldset>
        )}
        {attachments.length > 0 && (
          <div {...slot('attachmentRow')}>
            {attachments.map(({ attachment, preview }) => (
              <button
                key={attachment.id}
                type="button"
                aria-label={strings.submit.removeAttachment}
                onClick={() => {
                  URL.revokeObjectURL(preview);
                  setAttachments((list) => list.filter((a) => a.attachment.id !== attachment.id));
                }}
                style={{ padding: 0, border: 0, background: 'none' }}
              >
                <img {...slot('attachmentImage')} src={preview} alt="" />
              </button>
            ))}
          </div>
        )}
        {canAttach && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept={(limits?.attachmentMimeTypes ?? ['image/*']).join(',')}
              style={{ display: 'none' }}
              onChange={(e) => void onFile(e.target.files?.[0])}
              aria-label={strings.submit.attach}
            />
            <Button label={strings.submit.attach} variant="secondary" loading={upload.isPending} onClick={() => fileInput.current?.click()} />
          </>
        )}
        {error && (
          <p {...slot('errorText')} role="alert">
            {error}
          </p>
        )}
        <Button type="submit" label={strings.submit.submit} disabled={title.trim().length < 3 || upload.isPending} loading={create.isPending} />
        {onCancel && <Button label={strings.submit.cancel} variant="secondary" onClick={onCancel} />}
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------

export function FeedbackRoadmap({ onOpenPost }: { onOpenPost: (post: Post) => void }) {
  const { slot, strings } = useUI();
  const query = useRoadmap();
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return (
    <div {...slot('roadmap')}>
      {query.data.map((column) => (
        <section key={column.status} {...slot('roadmapColumn')} aria-label={strings.status[column.status]}>
          <div {...slot('roadmapColumnHeader')}>
            <StatusPill status={column.status} label={strings.status[column.status]} />
            <span {...slot('roadmapCount')}>{column.posts.length}</span>
          </div>
          {column.posts.length === 0 ? (
            <EmptyState message={strings.roadmap.empty} />
          ) : (
            column.posts.map((post) => (
              <button key={post.id} type="button" {...slot('roadmapCard')} onClick={() => onOpenPost(post)}>
                <span {...slot('roadmapCardTitle')}>{post.title}</span>
                <span {...slot('cardMeta')}>
                  <span {...slot('cardMetaText')}>▲ {post.score}</span>
                  {post.category && <CategoryPill name={post.category.name} color={post.category.color} />}
                </span>
              </button>
            ))
          )}
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function FeedbackUpdates({ onOpenPost, markSeen = true }: { onOpenPost: (post: Post) => void; markSeen?: boolean }) {
  const { slot, strings } = useUI();
  const query = useUpdates();
  const seen = useMarkUpdatesSeen();
  const unseen = query.data?.unseen ?? 0;
  useEffect(() => {
    if (markSeen && unseen > 0 && !seen.isPending) seen.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markSeen, unseen]);

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.data.items.length === 0) return <EmptyState message={strings.updates.empty} />;

  const label = (item: UpdateItem) =>
    item.kind === 'approved'
      ? strings.updates.approved
      : item.kind === 'declined'
        ? strings.updates.declined
        : item.kind === 'official_reply'
          ? strings.updates.officialReply
          : strings.updates.statusChanged(strings.status[item.post.status]);

  return (
    <ul {...slot('list')}>
      {query.data.items.map((item) => (
        <li key={`${item.post.id}:${item.kind}:${item.at}`}>
          <button type="button" {...slot('updateItem')} onClick={() => onOpenPost(item.post)}>
            <span {...slot('commentHeader')}>
              <span {...slot('updateKind')}>{label(item)}</span>
              <span {...slot('commentTime')}>{formatRelativeTime(strings, item.at)}</span>
            </span>
            <span {...slot('updateTitle')}>{item.post.title}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function FeedbackUpdatesBadge() {
  const { slot } = useUI();
  const { data } = useUpdates();
  if (!data?.unseen) return null;
  return <span {...slot('tabBadge')}>{data.unseen > 99 ? '99+' : data.unseen}</span>;
}

// ---------------------------------------------------------------------------

export function FeedbackAdminQueue({ onOpenPost }: { onOpenPost: (post: Post) => void }) {
  const { slot, strings } = useUI();
  const query = useAdminQueue();
  const m = useModeration();
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const posts = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (posts.length === 0) return <EmptyState message={strings.admin.queueEmpty} />;

  return (
    <ul {...slot('list')}>
      {posts.map((post) => (
        <li key={post.id} className={slot('card').className} style={{ flexDirection: 'column', ...slot('card').style }}>
          <button type="button" {...slot('cardBody')} onClick={() => onOpenPost(post)}>
            <h3 {...slot('cardTitle')}>{post.title}</h3>
            {post.body && <p {...slot('cardExcerpt')}>{post.body}</p>}
            <span {...slot('cardMetaText')}>{strings.post.by(post.author.name ?? strings.post.anonymous)}</span>
          </button>
          {declining === post.id ? (
            <>
              <input {...slot('input')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={strings.admin.declineReasonPlaceholder} aria-label={strings.admin.declineReasonPlaceholder} />
              <div {...slot('adminRow')}>
                <Button
                  label={strings.admin.confirmDecline}
                  variant="danger"
                  loading={m.decline.isPending}
                  onClick={() => m.decline.mutate({ id: post.id, reason: reason.trim() || null }, { onSuccess: () => { setDeclining(null); setReason(''); } })}
                />
                <Button label={strings.admin.cancel} variant="secondary" onClick={() => setDeclining(null)} />
              </div>
            </>
          ) : (
            <div {...slot('adminRow')}>
              <Button label={strings.admin.approve} onClick={() => m.approve.mutate(post.id)} loading={m.approve.isPending && m.approve.variables === post.id} />
              <Button label={strings.admin.decline} variant="secondary" onClick={() => setDeclining(post.id)} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
