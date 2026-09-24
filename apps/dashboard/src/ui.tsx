import { locales, type Post } from '@kobecuppens/feedback-core';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export const STATUS_LABELS = locales.en.status;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal focus handling: focus moves into the dialog, Tab stays inside it, Escape closes,
 * and focus returns to whatever opened it.
 */
export function useDialogFocus<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return close.current();
      if (e.key !== 'Tab' || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, []);
  return ref;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useDialogFocus<HTMLDivElement>(onClose);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className="card modal" role="dialog" aria-modal="true" aria-label={title}>
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

/** A destructive action that asks once, inline, before running. */
export function ConfirmButton({
  label,
  question,
  confirmLabel,
  onConfirm,
  pending,
  className = 'ghost danger-text',
}: {
  label: string;
  question: string;
  confirmLabel?: string;
  onConfirm: () => void;
  pending?: boolean;
  className?: string;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={className} onClick={() => setAsking(true)} disabled={pending}>
        {label}
      </button>
    );
  }
  return (
    <span className="row" role="group" aria-label={question}>
      <span className="small">{question}</span>
      <button
        type="button"
        className="danger"
        disabled={pending}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel ?? label}
      </button>
      <button type="button" className="ghost" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}

export function StatusBadge({ post }: { post: Post }) {
  if (post.moderation !== 'approved') return <span className={`badge ${post.moderation}`}>{post.moderation}</span>;
  return <span className={`badge status-${post.status}`}>{STATUS_LABELS[post.status]}</span>;
}
