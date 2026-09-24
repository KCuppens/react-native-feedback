import type { Category } from '@kobecuppens/feedback-core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { ConfirmButton } from '../ui';
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
  // Rewrite positions from the list order so equal sort values can never stall a swap,
  // and block further moves until both writes land.
  const reorder = useMutation({
    mutationFn: (ordered: Category[]) => Promise.all(ordered.map((c, sort) => (c.sort === sort ? null : admin.updateCategory(c.id, { sort })))),
    onSettled: invalidate,
  });
  const move = (from: number, to: number) => {
    const ordered = [...list];
    const [item] = ordered.splice(from, 1);
    ordered.splice(to, 0, item!);
    reorder.mutate(ordered);
  };
  const error = create.error ?? update.error ?? remove.error ?? reorder.error;

  return (
    <div className="stack narrow">
      <p className="muted">Categories let users tag submissions (Feature, Bug, Improvement…) and filter the board.</p>
      {categories.isPending && <p className="muted">Loading…</p>}
      {categories.isError && <p className="error">{errorText(categories.error)}</p>}
      {categories.isSuccess && list.length === 0 && <p className="muted">No categories yet. Add the first one below.</p>}
      <ul className="list">
        {list.map((c, i) => (
          <li key={c.id} className="row">
            <ColorField
              value={c.color ?? '#6B7280'}
              label={`Colour of ${c.name}`}
              onSave={(color) => update.mutate({ id: c.id, patch: { color } })}
            />
            <input
              defaultValue={c.name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && update.mutate({ id: c.id, patch: { name: e.target.value.trim() } })}
              aria-label={`Name of ${c.name}`}
            />
            <button className="ghost" disabled={i === 0 || reorder.isPending} onClick={() => move(i, i - 1)} aria-label={`Move ${c.name} up`}>
              ↑
            </button>
            <button
              className="ghost"
              disabled={i === list.length - 1 || reorder.isPending}
              onClick={() => move(i, i + 1)}
              aria-label={`Move ${c.name} down`}
            >
              ↓
            </button>
            <ConfirmButton
              label="Delete"
              question={`Delete "${c.name}"? Its posts become uncategorized.`}
              pending={remove.isPending}
              onConfirm={() => remove.mutate(c.id)}
            />
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
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category" aria-label="New category name" maxLength={40} />
        <button className="primary" disabled={!name.trim() || create.isPending}>
          Add
        </button>
      </form>
      {error && <p className="error">{errorText(error)}</p>}
    </div>
  );
}

/** Colour pickers fire onChange continuously while dragging: save once the value settles. */
function ColorField({ value, label, onSave }: { value: string; label: string; onSave: (color: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (draft === value) return;
    const id = setTimeout(() => onSave(draft), 400);
    return () => clearTimeout(id);
    // onSave is recreated every render; the timer only needs the latest draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, value]);
  return <input type="color" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={label} />;
}
