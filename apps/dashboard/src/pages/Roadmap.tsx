import type { Post, PostStatus } from '@kobecuppens/feedback-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, keys } from '../api';
import { href } from '../router';
import { usePostChanged } from './Queue';
import { STATUS_LABELS, ErrorMessage } from '../ui';

const COLUMNS: PostStatus[] = ['open', 'under_review', 'planned', 'in_progress', 'done'];
const PER_COLUMN = 100;

interface Kanban {
  items: Post[];
  /** Columns with more posts than were loaded. */
  truncated: PostStatus[];
}

/** Kanban of approved posts; drag a card (or use its menu) to change status. */
export function RoadmapPage({ projectId }: { projectId: string }) {
  const admin = api.project(projectId);
  const client = useQueryClient();
  const key = keys.list(projectId, 'kanban');
  const changed = usePostChanged(projectId);
  // One query per column, so a busy "Open" column cannot push the others off the board.
  const posts = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Kanban> => {
      const pages = await Promise.all(
        COLUMNS.map((status) => admin.listPosts({ moderation: 'approved', status: [status], sort: 'top', limit: PER_COLUMN })),
      );
      return {
        items: pages.flatMap((page) => page.items),
        truncated: COLUMNS.filter((_, i) => pages[i]!.nextCursor !== null),
      };
    },
  });
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<PostStatus | null>(null);

  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: PostStatus }) => admin.updatePost(id, { status }),
    onMutate: async ({ id, status }) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<Kanban>(key);
      client.setQueryData<Kanban>(key, (board) =>
        board ? { ...board, items: board.items.map((p) => (p.id === id ? { ...p, status } : p)) } : board,
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => client.setQueryData(key, ctx?.previous),
    onSettled: () => changed(),
  });

  if (posts.isPending) return <p className="muted">Loading…</p>;
  if (posts.isError) return <ErrorMessage error={posts.error} retry={() => posts.refetch()} />;

  return (
    <>
      <ErrorMessage error={move.error} />
      <div className="kanban">
        {COLUMNS.map((status) => {
          const items = posts.data.items.filter((p) => p.status === status);
          return (
            <section
              key={status}
              className={`column${over === status ? ' over' : ''}`}
              aria-label={STATUS_LABELS[status]}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(status);
              }}
              onDragLeave={() => setOver((s) => (s === status ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData('text/plain');
                if (id && posts.data.items.find((p) => p.id === id)?.status !== status) move.mutate({ id, status });
              }}
            >
              <h3>
                <span className={`badge status-${status}`}>{STATUS_LABELS[status]}</span> <span className="muted">{items.length}</span>
              </h3>
              {posts.data.truncated.includes(status) && (
                <p className="muted column-note">Showing the top {PER_COLUMN}. Use All posts to see the rest.</p>
              )}
              {items.map((post) => (
                <article
                  key={post.id}
                  className={`kcard${dragging === post.id ? ' dragging' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', post.id);
                    setDragging(post.id);
                  }}
                  onDragEnd={() => setDragging(null)}
                >
                  <a href={href(projectId, 'roadmap', post.id)}>{post.title}</a>
                  <div className="row between small muted">
                    <span>▲ {post.score}</span>
                    <select
                      value={post.status}
                      aria-label={`Move ${post.title}`}
                      onChange={(e) => move.mutate({ id: post.id, status: e.target.value as PostStatus })}
                    >
                      {COLUMNS.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
