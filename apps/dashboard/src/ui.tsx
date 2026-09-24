import {
  formatRelativeTime,
  locales,
  POST_STATUSES,
  type Attachment,
  type Moderation,
  type Post,
  type PostStatus,
} from '@kobecuppens/feedback-core';
import { errorText } from './api';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export const STATUS_LABELS = locales.en.status;

/** The posts list filter: one moderation state, or all of them. */
export type ModerationFilter = Moderation | 'all';

/** "3 hours ago", in the dashboard's (English) locale. */
export const ago = (timestamp: number) => formatRelativeTime(locales.en, timestamp);

export const authorName = (author: { name: string | null }, fallback = 'Anonymous') => author.name ?? fallback;

/** `value`, but only once it has stopped changing for `ms` (e.g. a search box). */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/** Options for a status <select>. */
export function StatusOptions({ statuses = POST_STATUSES }: { statuses?: readonly PostStatus[] }) {
  return (
    <>
      {statuses.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </>
  );
}

/** Attachment thumbnails that open the full image in a new tab. */
export function Thumbs({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="thumbs">
      {attachments.map((a, i) => (
        <a key={a.id} href={a.url} target="_blank" rel="noreferrer" aria-label={`Attachment ${i + 1} (opens in a new tab)`}>
          <img src={a.url} alt="" />
        </a>
      ))}
    </div>
  );
}

/** An announced error line, with an optional retry for failed loads. */
export function ErrorMessage({ error, retry }: { error: unknown; retry?: () => unknown }) {
  if (!error) return null;
  return (
    <p className="error" role="alert">
      {errorText(error)}
      {retry && (
        <>
          {' '}
          <button type="button" className="ghost small" onClick={() => void retry()}>
            Retry
          </button>
        </>
      )}
    </p>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
      // An inner control that handled Escape itself (e.g. an inline confirmation) wins.
      if (e.key === 'Escape') return e.defaultPrevented ? undefined : close.current();
      if (e.key !== 'Tab' || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      // Focus on the container itself, or lost to <body> after an inline swap: bring it back in.
      if (document.activeElement === dialog || !dialog.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
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

/**
 * `dismissible={false}` is for content that must not be lost to a stray click or Escape
 * (a key shown once): only an explicit button inside the dialog closes it.
 */
export function Modal({
  title,
  onClose,
  children,
  dismissible = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  dismissible?: boolean;
}) {
  const ref = useDialogFocus<HTMLDivElement>(dismissible ? onClose : () => {});
  return (
    <div className="overlay" onMouseDown={(e) => dismissible && e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className="card modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between">
          <h2>{title}</h2>
          {dismissible && (
            <button type="button" className="ghost" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
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
        <input
          readOnly
          value={show ? value : '•'.repeat(Math.min(value.length, 32))}
          className="mono"
          onFocus={(e) => show && e.target.select()}
        />
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

/**
 * A destructive action that asks once, inline, before running. Focus moves to Cancel (the
 * safe choice, which also announces the question) and returns to the trigger afterwards.
 */
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
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);
  useEffect(() => {
    if (asking) cancel.current?.focus();
    else if (wasAsking.current) trigger.current?.focus();
    wasAsking.current = asking;
  }, [asking]);
  if (!asking) {
    return (
      <button ref={trigger} type="button" className={className} onClick={() => setAsking(true)} disabled={pending}>
        {label}
      </button>
    );
  }
  return (
    <span
      className="row"
      role="group"
      aria-label={question}
      onKeyDown={(e) => {
        // Escape answers "no" here instead of closing the surrounding drawer or dialog.
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        setAsking(false);
      }}
    >
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
      <button ref={cancel} type="button" className="ghost" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}

export function StatusBadge({ post }: { post: Post }) {
  if (post.moderation !== 'approved') return <span className={`badge ${post.moderation}`}>{post.moderation}</span>;
  return <span className={`badge status-${post.status}`}>{STATUS_LABELS[post.status]}</span>;
}
