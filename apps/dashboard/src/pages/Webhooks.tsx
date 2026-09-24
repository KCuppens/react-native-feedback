import { FEEDBACK_EVENT_TYPES, type FeedbackEventType } from '@kobecuppens/feedback-core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, keys } from '../api';
import { useI18n } from '../i18n';
import { ConfirmButton, ErrorMessage, SecretField } from '../ui';
import { useProjectInvalidate } from './Queue';

export function WebhooksPage({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const admin = api.project(projectId);
  const invalidate = useProjectInvalidate(projectId);
  const hooks = useQuery({ queryKey: keys.webhooks(projectId), queryFn: () => admin.listWebhooks() });
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<FeedbackEventType[]>(['post.created', 'post.status_changed']);
  const create = useMutation({
    mutationFn: () => admin.createWebhook({ url: url.trim(), events }),
    onSuccess: () => {
      setUrl('');
      invalidate();
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => admin.deleteWebhook(id), onSuccess: invalidate });

  return (
    <div className="stack narrow">
      <p className="muted">
        {t.webhooks.intro({
          header: <code>X-Feedback-Signature</code>,
          verify: <code>verifyWebhook()</code>,
          pkg: <code>@kobecuppens/feedback-core/server</code>,
        })}
      </p>
      {hooks.isPending && <p className="muted">{t.common.loading}</p>}
      <ErrorMessage error={hooks.error} retry={() => hooks.refetch()} />
      {hooks.isSuccess && hooks.data.length === 0 && <p className="muted">{t.webhooks.empty}</p>}
      <ErrorMessage error={remove.error} />
      {hooks.data?.map((h) => (
        <article key={h.id} className="card stack">
          <div className="row between">
            <strong className="mono">{h.url}</strong>
            <ConfirmButton
              label={t.common.delete}
              question={t.webhooks.deleteQuestion}
              pending={remove.isPending}
              onConfirm={() => remove.mutate(h.id)}
            />
          </div>
          <span className="muted small">{h.events.join(', ')}</span>
          <SecretField label={t.webhooks.signingSecret} value={h.secret} />
        </article>
      ))}
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <h3>{t.webhooks.addEndpoint}</h3>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://api.yourapp.com/feedback-webhook"
          aria-label={t.webhooks.urlLabel}
          required
        />
        <fieldset className="checks">
          <legend>{t.webhooks.events}</legend>
          {FEEDBACK_EVENT_TYPES.map((type) => (
            <label key={type} className="check">
              <input
                type="checkbox"
                checked={events.includes(type)}
                onChange={(e) => setEvents((list) => (e.target.checked ? [...list, type] : list.filter((t) => t !== type)))}
              />
              <code>{type}</code>
            </label>
          ))}
        </fieldset>
        <button type="submit" className="primary" disabled={!url || events.length === 0 || create.isPending}>
          {t.webhooks.addWebhook}
        </button>
        <ErrorMessage error={create.error} />
      </form>
    </div>
  );
}
