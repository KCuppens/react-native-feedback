import type { Post } from '@kobecuppens/feedback-core';
import { useAdminQueue, useModeration } from '@kobecuppens/feedback-core/react';
import { useMemo, useState } from 'react';
import { Button, EmptyState, ErrorState, InlineError, Loading } from '../components';
import { useUI } from '../ui';

export function FeedbackAdminQueue({ onOpenPost }: { onOpenPost: (post: Post) => void }) {
  const { slot, strings } = useUI();
  const query = useAdminQueue();
  const m = useModeration();
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const startDecline = (id: string | null) => {
    setDeclining(id);
    setReason('');
  };
  const failed = [m.approve, m.decline].find((mutation) => mutation.isError);
  const posts = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (posts.length === 0) return <EmptyState message={strings.admin.queueEmpty} />;

  return (
    <>
      <InlineError error={failed?.error} />
      <ul {...slot('list')}>
        {posts.map((post) => (
          <li key={post.id} className={slot('card').className} style={{ flexDirection: 'column', ...slot('card').style }}>
            <div {...slot('cardBody')}>
              <h3 {...slot('cardTitle')}>
                <button type="button" {...slot('cardLink')} onClick={() => onOpenPost(post)}>
                  {post.title}
                </button>
              </h3>
              {post.body && <p {...slot('cardExcerpt')}>{post.body}</p>}
              <span {...slot('cardMetaText')}>{strings.post.by(post.author.name ?? strings.post.anonymous)}</span>
            </div>
            {declining === post.id ? (
              <>
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
                    loading={m.decline.isPending}
                    onClick={() =>
                      m.decline.mutate({ id: post.id, reason: reason.trim() || null }, { onSuccess: () => startDecline(null) })
                    }
                  />
                  <Button label={strings.admin.cancel} variant="secondary" onClick={() => startDecline(null)} />
                </div>
              </>
            ) : (
              <div {...slot('adminRow')}>
                <Button
                  label={strings.admin.approve}
                  onClick={() => m.approve.mutate(post.id)}
                  loading={m.approve.isPending && m.approve.variables === post.id}
                />
                <Button label={strings.admin.decline} variant="secondary" onClick={() => startDecline(post.id)} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
