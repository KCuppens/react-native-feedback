import type { ProjectSettings, ProjectSummary } from '@kobecuppens/feedback-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, latestError, keys } from '../api';
import { navigate } from '../router';
import { DASHBOARD_LOCALES, useI18n, type DashboardStrings } from '../i18n';
import { ConfirmButton, SecretField, ErrorMessage } from '../ui';
import { useProjectInvalidate } from './Queue';

const TOGGLES = [
  'autoApprove',
  'allowAnonymous',
  'allowDownvotes',
  'allowComments',
  'allowAttachments',
  'roadmapEnabled',
  'inAppAdmin',
  'publicBoard',
  'notifySubmitter',
] as const satisfies readonly (keyof ProjectSettings & keyof DashboardStrings['settings']['toggles'])[];

export function SettingsPage({ project }: { project: ProjectSummary }) {
  const { t } = useI18n();
  const admin = api.project(project.id);
  const client = useQueryClient();
  const invalidate = useProjectInvalidate(project.id);
  const settings = useQuery({ queryKey: keys.settings(project.id), queryFn: () => admin.getSettings() });
  const secrets = useQuery({ queryKey: keys.secrets(project.id), queryFn: () => api.dashboard.getSecrets(project.id) });
  const [newSecretKey, setNewSecretKey] = useState<string | null>(null);
  const [name, setName] = useState(project.name);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState('');

  const save = useMutation({
    mutationFn: (patch: Partial<ProjectSettings>) => admin.updateSettings(patch),
    onSuccess: (next) => {
      client.setQueryData(keys.settings(project.id), next);
      invalidate();
    },
  });
  const rename = useMutation({ mutationFn: () => api.dashboard.updateProject(project.id, { name: name.trim() }), onSuccess: invalidate });
  const rotate = useMutation({
    mutationFn: (key: 'public' | 'signing' | 'secret') => api.dashboard.rotateKey(project.id, key),
    onSuccess: (res) => {
      if (res.secretKey) setNewSecretKey(res.secretKey);
      void client.invalidateQueries({ queryKey: keys.secrets(project.id) });
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

  const current = settings.data;
  const error = latestError(save, rename, rotate, remove);
  const origin = window.location.origin;

  return (
    <div className="stack narrow">
      <ErrorMessage error={error} />

      <section className="card stack">
        <h3>{t.settings.behaviour}</h3>
        {settings.isError ? (
          <ErrorMessage error={settings.error} retry={() => settings.refetch()} />
        ) : !current ? (
          <p className="muted">{t.common.loading}</p>
        ) : (
          <>
            {TOGGLES.map((key) => (
              <label key={key} className="toggle">
                <input type="checkbox" checked={Boolean(current[key])} onChange={(e) => save.mutate({ [key]: e.target.checked })} />
                <span>
                  {t.settings.toggles[key].label}
                  {t.settings.toggles[key].help && <span className="muted small block">{t.settings.toggles[key].help}</span>}
                </span>
              </label>
            ))}
            <label>
              {t.settings.moderationEmail}
              <div className="row">
                <input
                  type="email"
                  value={adminEmail ?? current.adminEmail ?? ''}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder={t.settings.moderationEmailPlaceholder}
                />
                <button
                  type="button"
                  onClick={() => save.mutate({ adminEmail: (adminEmail ?? '').trim() || null })}
                  disabled={adminEmail === null}
                >
                  {t.common.save}
                </button>
              </div>
            </label>
            <label>
              {t.settings.emailLanguage}
              <select value={current.emailLocale} onChange={(e) => save.mutate({ emailLocale: e.target.value })}>
                {Object.entries(DASHBOARD_LOCALES).map(([code, strings]) => (
                  <option key={code} value={code} lang={code}>
                    {strings.languageName}
                  </option>
                ))}
              </select>
              <span className="muted small">{t.settings.emailLanguageHelp}</span>
            </label>
            {current.publicBoard && (
              <p className="small">
                {t.settings.publicBoard} <a href={`${origin}/p/${project.slug}`} target="_blank" rel="noreferrer">{`${origin}/p/${project.slug}`}</a>
              </p>
            )}
          </>
        )}
      </section>

      <section className="card stack">
        <h3>{t.settings.keys}</h3>
        <ErrorMessage error={secrets.error} retry={() => secrets.refetch()} />
        {secrets.data && (
          <>
            <SecretField label={t.settings.publicKey} value={secrets.data.publicKey} revealed />
            <SecretField label={t.settings.signingSecret} value={secrets.data.signingSecret} />
          </>
        )}
        {newSecretKey && <SecretField label={t.settings.newAdminKey} value={newSecretKey} revealed />}
        <div className="row wrap">
          <ConfirmButton
            label={t.settings.rotateAdmin}
            question={t.settings.rotateAdminQuestion}
            confirmLabel={t.settings.rotate}
            className=""
            pending={rotate.isPending}
            onConfirm={() => rotate.mutate('secret')}
          />
          <ConfirmButton
            label={t.settings.rotateSigning}
            question={t.settings.rotateSigningQuestion}
            confirmLabel={t.settings.rotate}
            className=""
            pending={rotate.isPending}
            onConfirm={() => rotate.mutate('signing')}
          />
          <ConfirmButton
            label={t.settings.rotatePublic}
            question={t.settings.rotatePublicQuestion}
            confirmLabel={t.settings.rotate}
            className=""
            pending={rotate.isPending}
            onConfirm={() => rotate.mutate('public')}
          />
        </div>
        <p className="muted small">{t.settings.rotateNote}</p>
      </section>

      <section className="card stack">
        <h3>{t.settings.install}</h3>
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
        <h3>{t.settings.project}</h3>
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label={t.settings.projectName} />
          <button type="button" onClick={() => rename.mutate()} disabled={!name.trim() || name === project.name}>
            {t.settings.rename}
          </button>
        </div>
        <details>
          <summary className="danger-text">{t.settings.deleteProject}</summary>
          <p className="small">{t.settings.deleteWarning(<strong>{project.slug}</strong>)}</p>
          <div className="row">
            <input value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} aria-label={t.settings.confirmSlug} />
            <button
              type="button"
              className="danger"
              disabled={confirmDelete !== project.slug || remove.isPending}
              onClick={() => remove.mutate()}
            >
              {t.settings.deleteForever}
            </button>
          </div>
        </details>
      </section>
    </div>
  );
}
