import { locales, type Post } from '@kobecuppens/feedback-core';
import { useEffect, useState, type ReactNode } from 'react';

export const STATUS_LABELS = locales.en.status;

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between">
          <h2>{title}</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SecretField({ label, value, revealed = false }: { label: string; value: string; revealed?: boolean }) {
  const [show, setShow] = useState(revealed);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <label className="secret">
      {label}
      <div className="row">
        <input readOnly value={show ? value : '•'.repeat(Math.min(value.length, 32))} className="mono" onFocus={(e) => show && e.target.select()} />
        {!revealed && (
          <button type="button" className="ghost" onClick={() => setShow((s) => !s)}>
            {show ? 'Hide' : 'Show'}
          </button>
        )}
        <button
          type="button"
          className="ghost"
          onClick={() => {
            const done = (state: 'copied' | 'failed') => {
              setCopyState(state);
              setTimeout(() => setCopyState('idle'), 1500);
            };
            // Clipboard is missing on insecure origins and can be denied.
            (navigator.clipboard?.writeText(value) ?? Promise.reject(new Error('no clipboard'))).then(
              () => done('copied'),
              () => done('failed'),
            );
          }}
        >
          {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
        </button>
      </div>
    </label>
  );
}

export function StatusBadge({ post }: { post: Post }) {
  if (post.moderation !== 'approved') return <span className={`badge ${post.moderation}`}>{post.moderation}</span>;
  return <span className={`badge status-${post.status}`}>{STATUS_LABELS[post.status]}</span>;
}
