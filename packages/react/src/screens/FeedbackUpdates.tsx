import { formatRelativeTime, type Post, type UpdateItem } from '@kobecuppens/feedback-core';
import { useMarkUpdatesSeen, useUpdates } from '@kobecuppens/feedback-core/react';
import { useEffect } from 'react';
import { EmptyState, ErrorState, Loading } from '../components';
import { useUI } from '../ui';

export function FeedbackUpdates({ onOpenPost, markSeen = true }: { onOpenPost: (post: Post) => void; markSeen?: boolean }) {
  const { slot, strings } = useUI();
  const query = useUpdates();
  const seen = useMarkUpdatesSeen();
  const unseen = query.data?.unseen ?? 0;
  // Intentional dependencies: the mutation object changes every render; only a new unseen count should trigger this
  useEffect(() => {
    if (markSeen && unseen > 0 && !seen.isPending) seen.mutate();
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
