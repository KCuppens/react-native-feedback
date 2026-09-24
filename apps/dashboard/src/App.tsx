import type { FeedbackLocale, ProjectSecrets, ProjectSummary } from '@kobecuppens/feedback-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { api, isUnauthorized, keys } from './api';
import { DASHBOARD_LOCALES, useI18n } from './i18n';
import { CategoriesPage } from './pages/Categories';
import { PostDrawer } from './pages/PostDrawer';
import { PostsPage } from './pages/Posts';
import { QueuePage } from './pages/Queue';
import { RoadmapPage } from './pages/Roadmap';
import { SettingsPage } from './pages/Settings';
import { WebhooksPage } from './pages/Webhooks';
import { href, navigate, useRoute } from './router';
import { Modal, SecretField, ErrorMessage } from './ui';

export function App() {
  const { t } = useI18n();
  // A 401 means "show the login"; anything else (offline, 5xx) is worth retrying.
  const me = useQuery({ queryKey: keys.me, queryFn: api.dashboard.me, retry: (count, error) => !isUnauthorized(error) && count < 2 });
  // Start the projects list alongside the session probe instead of after it (it answers 401
  // too when signed out, which the prefetch simply ignores).
  const client = useQueryClient();
  useEffect(() => {
    void client.prefetchQuery({ queryKey: keys.projects, queryFn: api.dashboard.listProjects, retry: false });
  }, [client]);
  if (me.isPending) return <div className="center muted">{t.common.loading}</div>;
  if (me.isError) {
    return isUnauthorized(me.error) ? (
      <Login />
    ) : (
      <div className="center">
        <ErrorMessage error={me.error} retry={() => me.refetch()} />
      </div>
    );
  }
  return <Shell />;
}

function Login() {
  const { t } = useI18n();
  const client = useQueryClient();
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api.dashboard.login(password),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.me }),
  });
  return (
    <div className="center">
      <form
        className="card login"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          login.mutate();
        }}
      >
        <h1>{t.login.title}</h1>
        <LanguagePicker />
        <label>
          {t.login.password}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
        </label>
        <ErrorMessage error={login.error} />
        <button type="submit" className="primary" disabled={!password || login.isPending}>
          {login.isPending ? t.login.signingIn : t.login.signIn}
        </button>
      </form>
    </div>
  );
}

const TABS = ['queue', 'posts', 'roadmap', 'categories', 'webhooks', 'settings'] as const;

/** The dashboard's language; remembered in this browser. */
function LanguagePicker() {
  const { t, locale, setLocale } = useI18n();
  return (
    <label className="language">
      {t.common.language}
      <select value={locale} onChange={(e) => setLocale(e.target.value as FeedbackLocale)}>
        {Object.entries(DASHBOARD_LOCALES).map(([code, strings]) => (
          <option key={code} value={code} lang={code}>
            {strings.languageName}
          </option>
        ))}
      </select>
    </label>
  );
}

function Shell() {
  const { t } = useI18n();
  const route = useRoute();
  const client = useQueryClient();
  const projects = useQuery({ queryKey: keys.projects, queryFn: api.dashboard.listProjects });
  const [creating, setCreating] = useState(false);
  const logout = useMutation({
    mutationFn: api.dashboard.logout,
    // Reload either way: never leave the admin believing they are signed out when they are not.
    onSettled: () => {
      client.clear();
      window.location.reload();
    },
  });

  const list = projects.data ?? [];
  const project = list.find((p) => p.id === route.projectId) ?? null;
  const firstId = list[0]?.id;
  useEffect(() => {
    if (!route.projectId && firstId) navigate(href(firstId));
  }, [route.projectId, firstId]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">{t.shell.brand}</div>
        <nav aria-label={t.shell.projects}>
          {list.map((p) => (
            <a
              key={p.id}
              href={href(p.id)}
              className={p.id === route.projectId ? 'active' : undefined}
              aria-current={p.id === route.projectId ? 'page' : undefined}
            >
              <span>{p.name}</span>
              {p.pendingCount > 0 && (
                <span className="count">
                  {p.pendingCount}
                  <span className="sr-only"> {t.shell.pending(p.pendingCount)}</span>
                </span>
              )}
            </a>
          ))}
        </nav>
        <button type="button" className="ghost" onClick={() => setCreating(true)}>
          {t.shell.newProject}
        </button>
        <div className="spacer" />
        <LanguagePicker />
        <button type="button" className="ghost" onClick={() => logout.mutate()}>
          {t.shell.signOut}
        </button>
      </aside>
      <main className="main">
        {projects.isPending ? (
          <p className="muted">{t.common.loading}</p>
        ) : projects.isError ? (
          // Never fall through to "no projects" on a failed load: it invites duplicate projects.
          <ErrorMessage error={projects.error} retry={() => projects.refetch()} />
        ) : !project ? (
          <div className="empty">
            <h2>{t.shell.noProject}</h2>
            <p className="muted">{t.shell.noProjectHelp}</p>
            <button type="button" className="primary" onClick={() => setCreating(true)}>
              {t.shell.createProject}
            </button>
          </div>
        ) : (
          <>
            <header className="page-header">
              <h1>{project.name}</h1>
              <nav className="tabs" aria-label={t.shell.sections}>
                {TABS.map((id) => (
                  <a
                    key={id}
                    href={href(project.id, id)}
                    className={route.tab === id ? 'active' : undefined}
                    aria-current={route.tab === id ? 'page' : undefined}
                  >
                    {t.tabs[id]}
                    {id === 'queue' && project.pendingCount > 0 ? ` (${project.pendingCount})` : ''}
                  </a>
                ))}
              </nav>
            </header>
            <ProjectPage key={project.id} project={project} />
          </>
        )}
      </main>
      {project && route.postId && (
        <PostDrawer projectId={project.id} postId={route.postId} onClose={() => navigate(href(project.id, route.tab))} />
      )}
      {creating && <CreateProject onClose={() => setCreating(false)} />}
    </div>
  );
}

function ProjectPage({ project }: { project: ProjectSummary }) {
  const { tab } = useRoute();
  switch (tab) {
    case 'posts':
      return <PostsPage projectId={project.id} />;
    case 'roadmap':
      return <RoadmapPage projectId={project.id} />;
    case 'categories':
      return <CategoriesPage projectId={project.id} />;
    case 'webhooks':
      return <WebhooksPage projectId={project.id} />;
    case 'settings':
      return <SettingsPage project={project} />;
    default:
      return <QueuePage projectId={project.id} />;
  }
}

function CreateProject({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [secrets, setSecrets] = useState<(ProjectSecrets & { id: string }) | null>(null);
  const create = useMutation({
    mutationFn: () => api.dashboard.createProject({ name: name.trim() }),
    onSuccess: (p) => {
      setSecrets({ ...p.secrets, id: p.id });
      void client.invalidateQueries({ queryKey: keys.projects });
    },
  });

  if (secrets) {
    const done = () => {
      navigate(href(secrets.id, 'settings'));
      onClose();
    };
    // Its own key so the dialog remounts and focus moves into it (the Create button is gone),
    // and not dismissible: a stray click must not discard the only copy of the admin key.
    return (
      <Modal key="created" title={t.create.createdTitle} onClose={done} dismissible={false}>
        <p role="alert">{t.create.createdAlert}</p>
        <SecretField label={t.create.publicKey} value={secrets.publicKey} revealed />
        <SecretField label={t.create.signingSecret} value={secrets.signingSecret} />
        <SecretField label={t.create.adminKey} value={secrets.secretKey ?? ''} />
        <button type="button" className="primary" onClick={done}>
          {t.create.copiedKey}
        </button>
      </Modal>
    );
  }
  return (
    <Modal title={t.create.title} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <label>
          {t.create.appName}
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="1% Better" />
        </label>
        <ErrorMessage error={create.error} />
        <button type="submit" className="primary" disabled={!name.trim() || create.isPending}>
          {t.common.create}
        </button>
      </form>
    </Modal>
  );
}
