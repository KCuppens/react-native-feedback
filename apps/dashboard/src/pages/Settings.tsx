import type { ProjectSettings, ProjectSummary } from '@kobecuppens/feedback-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorText } from '../api';
import { navigate } from '../router';
import { SecretField } from '../ui';
import { useProjectInvalidate } from './Queue';

const TOGGLES: { key: keyof ProjectSettings; label: string; help: string }[] = [
  { key: 'autoApprove', label: 'Auto-approve submissions', help: 'Skip the review queue: new posts are public immediately.' },
  { key: 'allowAnonymous', label: 'Allow anonymous users', help: 'Users without a signed token can post and vote with a device id.' },
  { key: 'allowDownvotes', label: 'Allow downvotes', help: 'Otherwise only upvotes are possible.' },
  { key: 'allowComments', label: 'Allow comments', help: '' },
  { key: 'allowAttachments', label: 'Allow image attachments', help: 'Screenshots up to 5 MB.' },
  { key: 'roadmapEnabled', label: 'Show roadmap', help: 'Planned / In progress / Done columns.' },
  { key: 'inAppAdmin', label: 'In-app admin', help: 'Signed users with isAdmin: true can moderate inside the widget.' },
  { key: 'publicBoard', label: 'Public board page', help: 'Read-and-vote page at /p/<slug>.' },
  { key: 'notifySubmitter', label: 'Email submitters', help: 'On approval, decline and status changes (needs their email in the signed token).' },
];

export function SettingsPage({ project }: { project: ProjectSummary }) {
  const admin = api.project(project.id);
  const client = useQueryClient();
  const invalidate = useProjectInvalidate(project.id);
  const settings = useQuery({ queryKey: ['p', project.id, 'settings'], queryFn: () => admin.getSettings() });
  const secrets = useQuery({ queryKey: ['p', project.id, 'secrets'], queryFn: () => api.dashboard.getSecrets(project.id) });
  const [newSecretKey, setNewSecretKey] = useState<string | null>(null);
  const [name, setName] = useState(project.name);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState('');

  const save = useMutation({
    mutationFn: (patch: Partial<ProjectSettings>) => admin.updateSettings(patch),
    onSuccess: (next) => {
      client.setQueryData(['p', project.id, 'settings'], next);
      invalidate();
    },
  });
  const rename = useMutation({ mutationFn: () => api.dashboard.updateProject(project.id, { name: name.trim() }), onSuccess: invalidate });
  const rotate = useMutation({
    mutationFn: (key: 'public' | 'signing' | 'secret') => api.dashboard.rotateKey(project.id, key),
    onSuccess: (res) => {
      if (res.secretKey) setNewSecretKey(res.secretKey);
      void client.invalidateQueries({ queryKey: ['p', project.id, 'secrets'] });
      invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.dashboard.deleteProject(project.id),
    onSuccess: () => {
      navigate('#/');
      invalidate();
    },
  });

  const s = settings.data;
  const error = save.error ?? rename.error ?? rotate.error ?? remove.error;
  const origin = window.location.origin;

  return (
    <div className="stack narrow">
      {error && <p className="error">{errorText(error)}</p>}

      <section className="card stack">
        <h3>Board behaviour</h3>
        {!s ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            {TOGGLES.map((t) => (
              <label key={t.key} className="toggle">
                <input type="checkbox" checked={Boolean(s[t.key])} onChange={(e) => save.mutate({ [t.key]: e.target.checked })} />
                <span>
                  {t.label}
                  {t.help && <span className="muted small block">{t.help}</span>}
                </span>
              </label>
            ))}
            <label>
              Moderation email
              <div className="row">
                <input
                  type="email"
                  value={adminEmail ?? s.adminEmail ?? ''}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder="Defaults to ADMIN_EMAIL on the worker"
                />
                <button onClick={() => save.mutate({ adminEmail: (adminEmail ?? '').trim() || null })} disabled={adminEmail === null}>
                  Save
                </button>
              </div>
            </label>
            {s.publicBoard && (
              <p className="small">
                Public board: <a href={`${origin}/p/${project.slug}`} target="_blank" rel="noreferrer">{`${origin}/p/${project.slug}`}</a>
              </p>
            )}
          </>
        )}
      </section>

      <section className="card stack">
        <h3>Keys</h3>
        {secrets.data && (
          <>
            <SecretField label="Public key: pass as projectKey in your app" value={secrets.data.publicKey} revealed />
            <SecretField label="Signing secret: your server only, for signFeedbackUser()" value={secrets.data.signingSecret} />
          </>
        )}
        {newSecretKey && <SecretField label="New admin API key (copy now, shown once)" value={newSecretKey} revealed />}
        <div className="row wrap">
          <button onClick={() => rotate.mutate('secret')}>Rotate admin API key</button>
          <button onClick={() => rotate.mutate('signing')}>Rotate signing secret</button>
          <button onClick={() => rotate.mutate('public')}>Rotate public key</button>
        </div>
        <p className="muted small">
          Rotating the public key or signing secret breaks existing app builds and server tokens until you ship the new values.
        </p>
      </section>

      <section className="card stack">
        <h3>Install</h3>
        <pre className="code">{`npm i @kobecuppens/react-native-feedback   # Expo / React Native / RN-web
npm i @kobecuppens/react-feedback          # React DOM

<FeedbackBoard
  projectKey="${secrets.data?.publicKey ?? 'pk_…'}"
  baseUrl="${origin}"
  userToken={tokenFromYourServer}
/>

// On your server
import { signFeedbackUser } from '@kobecuppens/feedback-core/server';
const token = await signFeedbackUser({ id: user.id, name: user.name, email: user.email }, process.env.FEEDBACK_SIGNING_SECRET);`}</pre>
      </section>

      <section className="card stack">
        <h3>Project</h3>
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Project name" />
          <button onClick={() => rename.mutate()} disabled={!name.trim() || name === project.name}>
            Rename
          </button>
        </div>
        <details>
          <summary className="danger-text">Delete project…</summary>
          <p className="small">
            This deletes every post, vote, comment and image. Type <strong>{project.slug}</strong> to confirm.
          </p>
          <div className="row">
            <input value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} aria-label="Confirm slug" />
            <button className="danger" disabled={confirmDelete !== project.slug || remove.isPending} onClick={() => remove.mutate()}>
              Delete forever
            </button>
          </div>
        </details>
      </section>
    </div>
  );
}
