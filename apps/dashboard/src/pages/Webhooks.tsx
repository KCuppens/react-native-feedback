import { FEEDBACK_EVENT_TYPES, type FeedbackEventType } from '@kobecuppens/feedback-core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorText } from '../api';
import { ConfirmButton, SecretField } from '../ui';
import { useProjectInvalidate } from './Queue';

export function WebhooksPage({ projectId }: { projectId: string }) {
  const admin = api.project(projectId);
  const invalidate = useProjectInvalidate(projectId);
  const hooks = useQuery({ queryKey: ['p', projectId, 'webhooks'], queryFn: () => admin.listWebhooks() });
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
        Events are POSTed as JSON with an <code>X-Feedback-Signature</code> header. Verify it with <code>verifyWebhook()</code> from{' '}
        <code>@kobecuppens/feedback-core/server</code>, for example to send your own push notifications.
      </p>
      {hooks.data?.map((h) => (
        <article key={h.id} className="card stack">
          <div className="row between">
            <strong className="mono">{h.url}</strong>
            <ConfirmButton
              label="Delete"
              question="Delete this webhook?"
              pending={remove.isPending}
              onConfirm={() => remove.mutate(h.id)}
            />
          </div>
          <span className="muted small">{h.events.join(', ')}</span>
          <SecretField label="Signing secret" value={h.secret} />
        </article>
      ))}
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <h3>Add endpoint</h3>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://api.yourapp.com/feedback-webhook"
          aria-label="Webhook URL"
          required
        />
        <fieldset className="checks">
          <legend>Events</legend>
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
          Add webhook
        </button>
        {(create.error ?? remove.error) && <p className="error">{errorText(create.error ?? remove.error)}</p>}
      </form>
    </div>
  );
}
