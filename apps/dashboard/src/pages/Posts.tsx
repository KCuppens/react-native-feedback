import type { PostStatus } from '@kobecuppens/feedback-core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, keys } from '../api';
import { href } from '../router';
import { useI18n } from '../i18n';
import { authorName, ErrorMessage, type ModerationFilter, StatusBadge, StatusOptions, useDebouncedValue } from '../ui';
import { usePostChanged } from './Queue';

export function PostsPage({ projectId }: { projectId: string }) {
  const { t, board, ago } = useI18n();
  const admin = api.project(projectId);
  const changed = usePostChanged(projectId);
  const [moderation, setModeration] = useState<ModerationFilter>('all');
  const [status, setStatus] = useState<PostStatus | ''>('');
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 300);
  const [page, setPage] = useState<string | null>(null);
  // Intentional dependencies: the filters are the trigger: any change returns to the first page
  useEffect(() => setPage(null), [moderation, status, q]);

  const params = { moderation, status: status || undefined, q: q || undefined, cursor: page, sort: 'new' as const, limit: 50 };
  const posts = useQuery({ queryKey: keys.posts(projectId, params), queryFn: () => admin.listPosts(params) });
  const categories = useQuery({ queryKey: keys.categories(projectId), queryFn: () => admin.listCategories() });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof admin.updatePost>[1] }) => admin.updatePost(id, patch),
    onSuccess: (post) => changed({ post }),
  });

  return (
    <div className="stack">
      <div className="row filters">
        <input
          type="search"
          placeholder={t.posts.searchPlaceholder}
          aria-label={t.posts.searchLabel}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={moderation} onChange={(e) => setModeration(e.target.value as ModerationFilter)} aria-label={t.posts.moderation}>
          <option value="all">{t.posts.anyModeration}</option>
          <option value="pending">{t.moderation.pending}</option>
          <option value="approved">{t.moderation.approved}</option>
          <option value="declined">{t.moderation.declined}</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as PostStatus | '')} aria-label={t.posts.status}>
          <option value="">{t.posts.anyStatus}</option>
          <StatusOptions />
        </select>
      </div>
      <ErrorMessage error={update.error} />
      {posts.isPending ? (
        <p className="muted">{t.common.loading}</p>
      ) : posts.isError ? (
        <ErrorMessage error={posts.error} retry={() => posts.refetch()} />
      ) : posts.data.items.length === 0 ? (
        <p className="muted">{t.posts.noMatch}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.posts.columns.title}</th>
                <th className="num">{t.posts.columns.score}</th>
                <th className="num">{t.posts.columns.comments}</th>
                <th>{t.posts.columns.state}</th>
                <th>{t.posts.columns.status}</th>
                <th>{t.posts.columns.category}</th>
                <th>{t.posts.columns.created}</th>
              </tr>
            </thead>
            <tbody>
              {posts.data.items.map((post) => (
                <tr key={post.id}>
                  <td>
                    <a href={href(projectId, 'posts', post.id)}>{post.title}</a>
                    <div className="muted small">{authorName(post.author, board.post.anonymous)}</div>
                  </td>
                  <td className="num">
                    {post.score}
                    <span className="muted small">
                      {' '}
                      (+{post.upvotes}/−{post.downvotes})
                    </span>
                  </td>
                  <td className="num">{post.commentCount}</td>
                  <td>
                    <StatusBadge post={post} />
                  </td>
                  <td>
                    <select
                      value={post.status}
                      aria-label={t.posts.statusOf(post.title)}
                      onChange={(e) => update.mutate({ id: post.id, patch: { status: e.target.value as PostStatus } })}
                    >
                      <StatusOptions />
                    </select>
                  </td>
                  <td>
                    <select
                      value={post.category?.id ?? ''}
                      aria-label={t.posts.categoryOf(post.title)}
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
                  <td className="muted small">{ago(post.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row">
        {page && (
          <button type="button" onClick={() => setPage(null)}>
            {t.posts.firstPage}
          </button>
        )}
        {posts.data?.nextCursor && (
          <button type="button" onClick={() => setPage(posts.data.nextCursor)}>
            {t.posts.nextPage}
          </button>
        )}
      </div>
    </div>
  );
}
