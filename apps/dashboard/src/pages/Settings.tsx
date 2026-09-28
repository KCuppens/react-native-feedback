import type { ProjectSettings, ProjectSummary, PublicBoardAppearance } from '@kobecuppens/feedback-core';
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
                {t.settings.publicBoard}{' '}
                <a href={`${origin}/p/${project.slug}`} target="_blank" rel="noreferrer">{`${origin}/p/${project.slug}`}</a>
              </p>
            )}
          </>
        )}
      </section>

      {current && (
        <AppearanceCard
          key={JSON.stringify(current.appearance)}
          appearance={current.appearance}
          pending={save.isPending}
          onSave={(appearance) => save.mutate({ appearance })}
        />
      )}

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

type Scheme = NonNullable<PublicBoardAppearance['colorScheme']>;

/** Branding for the public board page (/p/<slug>): logo, fonts, theme tokens and CSS. */
function AppearanceCard({
  appearance,
  pending,
  onSave,
}: {
  appearance: PublicBoardAppearance | null;
  pending: boolean;
  onSave: (appearance: PublicBoardAppearance | null) => void;
}) {
  const { t } = useI18n();
  const a = t.settings.appearance;
  const [scheme, setScheme] = useState<Scheme>(appearance?.colorScheme ?? 'system');
  const [logoUrl, setLogoUrl] = useState(appearance?.logoUrl ?? '');
  const [homeUrl, setHomeUrl] = useState(appearance?.homeUrl ?? '');
  const [fontsUrl, setFontsUrl] = useState(appearance?.fontsUrl ?? '');
  const [theme, setTheme] = useState(appearance?.theme ? JSON.stringify(appearance.theme, null, 2) : '');
  const [css, setCss] = useState(appearance?.css ?? '');
  const [themeError, setThemeError] = useState(false);

  const save = () => {
    let parsed: PublicBoardAppearance['theme'];
    if (theme.trim()) {
      try {
        parsed = JSON.parse(theme) as PublicBoardAppearance['theme'];
      } catch {
        return setThemeError(true);
      }
    }
    setThemeError(false);
    // Empty fields are left out, so the server keeps only what was filled in.
    onSave({
      colorScheme: scheme,
      ...(logoUrl.trim() && { logoUrl: logoUrl.trim() }),
      ...(homeUrl.trim() && { homeUrl: homeUrl.trim() }),
      ...(fontsUrl.trim() && { fontsUrl: fontsUrl.trim() }),
      ...(parsed && { theme: parsed }),
      ...(css.trim() && { css }),
    });
  };

  return (
    <section className="card stack">
      <h3>{a.title}</h3>
      <p className="muted small">{a.intro}</p>
      <label>
        {a.colorScheme}
        <select value={scheme} onChange={(e) => setScheme(e.target.value as Scheme)}>
          {(['system', 'light', 'dark'] as const).map((s) => (
            <option key={s} value={s}>
              {a.schemes[s]}
            </option>
          ))}
        </select>
      </label>
      <label>
        {a.logoUrl}
        <input type="url" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://" />
      </label>
      <label>
        {a.homeUrl}
        <input type="url" value={homeUrl} onChange={(e) => setHomeUrl(e.target.value)} placeholder="https://" />
      </label>
      <label>
        {a.fontsUrl}
        <input
          type="url"
          value={fontsUrl}
          onChange={(e) => setFontsUrl(e.target.value)}
          placeholder="https://fonts.googleapis.com/css2?family=…"
        />
        <span className="muted small">{a.fontsHelp}</span>
      </label>
      <label>
        {a.theme}
        <textarea
          className="code"
          rows={8}
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          spellCheck={false}
          aria-invalid={themeError || undefined}
        />
        <span className="muted small">{a.themeHelp}</span>
      </label>
      {themeError && (
        <p className="danger-text small" role="alert">
          {a.invalidTheme}
        </p>
      )}
      <label>
        {a.css}
        <textarea className="code" rows={10} value={css} onChange={(e) => setCss(e.target.value)} spellCheck={false} />
      </label>
      <div className="row">
        <button type="button" className="primary" onClick={save} disabled={pending}>
          {a.save}
        </button>
        {appearance && (
          <button type="button" className="ghost" onClick={() => onSave(null)} disabled={pending}>
            {a.reset}
          </button>
        )}
      </div>
    </section>
  );
}
