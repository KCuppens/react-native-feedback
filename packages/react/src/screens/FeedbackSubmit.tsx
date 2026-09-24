import { FeedbackApiError, type Attachment, type Post } from '@kobecuppens/feedback-core';
import { useConfig, useCreatePost, useFeatures, useUpload } from '@kobecuppens/feedback-core/react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button, Chip, Header, InlineError } from '../components';
import { useUI } from '../ui';

export interface FeedbackSubmitProps {
  onDone?: (post: Post) => void;
  onCancel?: () => void;
  /** Called when the form gains or loses unsaved input, e.g. to guard navigating away. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function FeedbackSubmit({ onDone, onCancel, onDirtyChange }: FeedbackSubmitProps) {
  const { slot, strings } = useUI();
  const features = useFeatures();
  const { data: config } = useConfig();
  const create = useCreatePost();
  const upload = useUpload();
  const ids = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<{ attachment: Attachment; preview: string }[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<Post | null>(null);
  const limits = config?.limits;

  const dirty = !created && !!(title.trim() || body.trim() || categoryId || attachments.length > 0);
  const onDirty = useRef(onDirtyChange);
  onDirty.current = onDirtyChange;
  useEffect(() => onDirty.current?.(dirty), [dirty]);
  const titleMin = limits?.titleMin ?? 3;

  // Free preview blobs on unmount (removals free their own).
  const previews = useRef<string[]>([]);
  previews.current = attachments.map((a) => a.preview);
  useEffect(
    () => () => {
      for (const url of previews.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (limits && file.size > limits.attachmentMaxBytes) {
      setError(new FeedbackApiError(413, 'file_too_large'));
      return;
    }
    try {
      const attachment = await upload.mutateAsync(file);
      setAttachments((list) => [...list, { attachment, preview: URL.createObjectURL(file) }]);
    } catch (e) {
      setError(e);
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate(
      { title: title.trim(), body: body.trim(), categoryId, attachmentIds: attachments.map((a) => a.attachment.id) },
      { onSuccess: setCreated, onError: setError },
    );
  };

  if (created) {
    return (
      <>
        <Header title={strings.submit.title} onBack={() => onDone?.(created)} />
        <div {...slot('empty')} role="status">
          <p style={{ margin: 0 }}>{created.moderation === 'approved' ? strings.submit.successPublished : strings.submit.successPending}</p>
          <Button label={strings.submit.done} onClick={() => onDone?.(created)} />
        </div>
      </>
    );
  }

  const canAttach = !!features?.attachments && attachments.length < (limits?.attachmentsPerPost ?? 4);

  return (
    <>
      <Header title={strings.submit.title} onBack={onCancel} />
      <form {...slot('form')} onSubmit={submit}>
        <label {...slot('inputLabel')} htmlFor={`${ids}-title`}>
          {strings.submit.titleLabel}
        </label>
        <input
          id={`${ids}-title`}
          {...slot('input')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={limits?.titleMax ?? 120}
          minLength={titleMin}
          required
          placeholder={strings.submit.titlePlaceholder}
          autoFocus
        />
        <label {...slot('inputLabel')} htmlFor={`${ids}-body`}>
          {strings.submit.bodyLabel}
        </label>
        <textarea
          id={`${ids}-body`}
          {...slot('textarea')}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={limits?.bodyMax ?? 5000}
          placeholder={strings.submit.bodyPlaceholder}
        />
        {config && config.categories.length > 0 && (
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'contents' }}>
            <legend {...slot('inputLabel')}>{strings.submit.categoryLabel}</legend>
            <div {...slot('chipRow')}>
              {config.categories.map((cat) => (
                <Chip
                  key={cat.id}
                  label={cat.name}
                  active={categoryId === cat.id}
                  onClick={() => setCategoryId(categoryId === cat.id ? null : cat.id)}
                />
              ))}
            </div>
          </fieldset>
        )}
        {attachments.length > 0 && (
          <div {...slot('attachmentRow')}>
            {attachments.map(({ attachment, preview }) => (
              <button
                key={attachment.id}
                type="button"
                aria-label={strings.submit.removeAttachment}
                onClick={() => {
                  URL.revokeObjectURL(preview);
                  setAttachments((list) => list.filter((a) => a.attachment.id !== attachment.id));
                }}
                style={{ padding: 0, border: 0, background: 'none' }}
              >
                <img {...slot('attachmentImage')} src={preview} alt="" />
              </button>
            ))}
          </div>
        )}
        {canAttach && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept={(limits?.attachmentMimeTypes ?? ['image/*']).join(',')}
              style={{ display: 'none' }}
              onChange={(e) => void onFile(e.target.files?.[0])}
              aria-label={strings.submit.attach}
            />
            <Button
              label={strings.submit.attach}
              variant="secondary"
              loading={upload.isPending}
              onClick={() => fileInput.current?.click()}
            />
          </>
        )}
        <InlineError error={error} />
        <Button
          type="submit"
          label={strings.submit.submit}
          disabled={title.trim().length < titleMin || upload.isPending}
          loading={create.isPending}
        />
        {onCancel && <Button label={strings.submit.cancel} variant="secondary" onClick={onCancel} />}
      </form>
    </>
  );
}
