import { formatRelativeTime, locales, POST_STATUSES, type PostStatus } from '@kobecuppens/feedback-core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { href } from '../router';
import { STATUS_LABELS, StatusBadge } from '../ui';
import { useProjectInvalidate } from './Queue';

type Moderation = 'all' | 'pending' | 'approved' | 'declined';

export function PostsPage({ projectId }: { projectId: string }) {
  const admin = api.project(projectId);
  const invalidate = useProjectInvalidate(projectId);
  const [moderation, setModeration] = useState<Moderation>('all');
  const [status, setStatus] = useState<PostStatus | ''>('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);
  useEffect(() => setPage(null), [moderation, status, q]);

  const params = { moderation, status: status || undefined, q: q || undefined, cursor: page, sort: 'new' as const, limit: 50 };
  const posts = useQuery({ queryKey: ['p', projectId, 'posts', params], queryFn: () => admin.listPosts(params) });
  const categories = useQuery({ queryKey: ['p', projectId, 'categories'], queryFn: () => admin.listCategories() });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof admin.updatePost>[1] }) => admin.updatePost(id, patch),
    onSuccess: invalidate,
  });

  return (
    <div className="stack">
      <div className="row filters">
        <input type="search" placeholder="Search title or body…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={moderation} onChange={(e) => setModeration(e.target.value as Moderation)} aria-label="Moderation">
          <option value="all">Any moderation</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="declined">Declined</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as PostStatus | '')} aria-label="Status">
          <option value="">Any status</option>
          {POST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      {update.isError && <p className="error">{errorText(update.error)}</p>}
      {posts.isPending ? (
        <p className="muted">Loading…</p>
      ) : posts.isError ? (
        <p className="error">{errorText(posts.error)}</p>
      ) : posts.data.items.length === 0 ? (
        <p className="muted">No posts match.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th className="num">Score</th>
                <th className="num">Comments</th>
                <th>State</th>
                <th>Status</th>
                <th>Category</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {posts.data.items.map((post) => (
                <tr key={post.id}>
                  <td>
                    <a href={href(projectId, 'posts', post.id)}>{post.title}</a>
                    <div className="muted small">{post.author.name ?? 'Anonymous'}</div>
                  </td>
                  <td className="num">
                    {post.score}
                    <span className="muted small"> (+{post.upvotes}/−{post.downvotes})</span>
                  </td>
                  <td className="num">{post.commentCount}</td>
                  <td>
                    <StatusBadge post={post} />
                  </td>
                  <td>
                    <select
                      value={post.status}
                      aria-label={`Status of ${post.title}`}
                      onChange={(e) => update.mutate({ id: post.id, patch: { status: e.target.value as PostStatus } })}
                    >
                      {POST_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={post.category?.id ?? ''}
                      aria-label={`Category of ${post.title}`}
                      onChange={(e) => update.mutate({ id: post.id, patch: { categoryId: e.target.value || null } })}
                    >
                      <option value="">—</option>
                      {categories.data?.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="muted small">{formatRelativeTime(locales.en, post.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row">
        {page && <button onClick={() => setPage(null)}>First page</button>}
        {posts.data?.nextCursor && <button onClick={() => setPage(posts.data.nextCursor)}>Next page</button>}
      </div>
    </div>
  );
}
