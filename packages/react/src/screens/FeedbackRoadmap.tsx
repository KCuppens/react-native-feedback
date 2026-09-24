import type { Post } from '@kobecuppens/feedback-core';
import { useRoadmap } from '@kobecuppens/feedback-core/react';
import { CategoryPill, EmptyState, ErrorState, Loading, StatusPill } from '../components';
import { useUI } from '../ui';

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
                  <span {...slot('cardMetaText')}>
                    <span aria-hidden="true">▲ {post.score}</span>
                    <span className="fb-srOnly">{strings.post.votes(post.score)}</span>
                  </span>
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
