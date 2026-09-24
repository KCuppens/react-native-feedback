import type { Category } from '@kobecuppens/feedback-core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorText } from '../api';
import { useProjectInvalidate } from './Queue';

export function CategoriesPage({ projectId }: { projectId: string }) {
  const admin = api.project(projectId);
  const invalidate = useProjectInvalidate(projectId);
  const categories = useQuery({ queryKey: ['p', projectId, 'categories'], queryFn: () => admin.listCategories() });
  const [name, setName] = useState('');
  const [color, setColor] = useState('#4F46E5');
  const create = useMutation({
    mutationFn: () => admin.createCategory({ name: name.trim(), color }),
    onSuccess: () => {
      setName('');
      invalidate();
    },
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; color?: string | null; sort?: number } }) => admin.updateCategory(id, patch),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: string) => admin.deleteCategory(id), onSuccess: invalidate });

  const list = categories.data ?? [];
  const swap = (a: Category, b: Category) => {
    update.mutate({ id: a.id, patch: { sort: b.sort } });
    update.mutate({ id: b.id, patch: { sort: a.sort } });
  };
  const error = create.error ?? update.error ?? remove.error;

  return (
    <div className="stack narrow">
      <p className="muted">Categories let users tag submissions (Feature, Bug, Improvement…) and filter the board.</p>
      <ul className="list">
        {list.map((c, i) => (
          <li key={c.id} className="row">
            <input type="color" value={c.color ?? '#6B7280'} onChange={(e) => update.mutate({ id: c.id, patch: { color: e.target.value } })} aria-label={`Colour of ${c.name}`} />
            <input
              defaultValue={c.name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && update.mutate({ id: c.id, patch: { name: e.target.value.trim() } })}
              aria-label="Category name"
            />
            <button className="ghost" disabled={i === 0} onClick={() => swap(c, list[i - 1]!)} aria-label="Move up">
              ↑
            </button>
            <button className="ghost" disabled={i === list.length - 1} onClick={() => swap(c, list[i + 1]!)} aria-label="Move down">
              ↓
            </button>
            <button className="ghost danger-text" onClick={() => remove.mutate(c.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Colour" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category" maxLength={40} />
        <button className="primary" disabled={!name.trim() || create.isPending}>
          Add
        </button>
      </form>
      {error && <p className="error">{errorText(error)}</p>}
    </div>
  );
}
