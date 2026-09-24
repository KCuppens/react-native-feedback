import type { ProjectSecrets, ProjectSummary } from '@kobecuppens/feedback-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { api, isUnauthorized } from './api';
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
  // A 401 means "show the login"; anything else (offline, 5xx) is worth retrying.
  const me = useQuery({ queryKey: ['me'], queryFn: api.dashboard.me, retry: (count, error) => !isUnauthorized(error) && count < 2 });
  if (me.isPending) return <div className="center muted">Loading…</div>;
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
  const client = useQueryClient();
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api.dashboard.login(password),
    onSuccess: () => client.invalidateQueries({ queryKey: ['me'] }),
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
        <h1>Feedback admin</h1>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
        </label>
        <ErrorMessage error={login.error} />
        <button type="submit" className="primary" disabled={!password || login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

const TABS = [
  ['queue', 'Review queue'],
  ['posts', 'All posts'],
  ['roadmap', 'Roadmap'],
  ['categories', 'Categories'],
  ['webhooks', 'Webhooks'],
  ['settings', 'Settings & keys'],
] as const;

function Shell() {
  const route = useRoute();
  const client = useQueryClient();
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.dashboard.listProjects });
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
        <div className="brand">Feedback</div>
        <nav aria-label="Projects">
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
                  <span className="sr-only"> pending</span>
                </span>
              )}
            </a>
          ))}
        </nav>
        <button type="button" className="ghost" onClick={() => setCreating(true)}>
          ＋ New project
        </button>
        <div className="spacer" />
        <button type="button" className="ghost" onClick={() => logout.mutate()}>
          Sign out
        </button>
      </aside>
      <main className="main">
        {projects.isPending ? (
          <p className="muted">Loading…</p>
        ) : projects.isError ? (
          // Never fall through to "no projects" on a failed load: it invites duplicate projects.
          <ErrorMessage error={projects.error} retry={() => projects.refetch()} />
        ) : !project ? (
          <div className="empty">
            <h2>No project selected</h2>
            <p className="muted">Create a project for each app that embeds the board.</p>
            <button type="button" className="primary" onClick={() => setCreating(true)}>
              Create a project
            </button>
          </div>
        ) : (
          <>
            <header className="page-header">
              <h1>{project.name}</h1>
              <nav className="tabs" aria-label="Sections">
                {TABS.map(([id, label]) => (
                  <a
                    key={id}
                    href={href(project.id, id)}
                    className={route.tab === id ? 'active' : undefined}
                    aria-current={route.tab === id ? 'page' : undefined}
                  >
                    {label}
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
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [secrets, setSecrets] = useState<(ProjectSecrets & { id: string }) | null>(null);
  const create = useMutation({
    mutationFn: () => api.dashboard.createProject({ name: name.trim() }),
    onSuccess: (p) => {
      setSecrets({ ...p.secrets, id: p.id });
      void client.invalidateQueries({ queryKey: ['projects'] });
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
      <Modal key="created" title="Project created" onClose={done} dismissible={false}>
        <p role="alert">Project created. Copy the admin API key now: it is stored hashed and won't be shown again.</p>
        <SecretField label="Public key (in your app)" value={secrets.publicKey} revealed />
        <SecretField label="Signing secret (your server only)" value={secrets.signingSecret} />
        <SecretField label="Admin API key (shown once)" value={secrets.secretKey ?? ''} />
        <button type="button" className="primary" onClick={done}>
          I've copied the key
        </button>
      </Modal>
    );
  }
  return (
    <Modal title="New project" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <label>
          App name
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="1% Better" />
        </label>
        <ErrorMessage error={create.error} />
        <button type="submit" className="primary" disabled={!name.trim() || create.isPending}>
          Create
        </button>
      </form>
    </Modal>
  );
}
