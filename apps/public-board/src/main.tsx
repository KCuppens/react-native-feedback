import type { PublicBoardAppearance } from '@kobecuppens/feedback-core';
import { FeedbackBoard, matchLocale, resolveStrings } from '@kobecuppens/react-feedback';
import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

interface PublicProject {
  name: string;
  slug: string;
  publicKey: string;
  appearance: PublicBoardAppearance | null;
}

/** The project's branding: its fonts, extra CSS and colour scheme, applied to the page. */
function applyAppearance(appearance: PublicBoardAppearance | null) {
  if (!appearance) return;
  if (appearance.fontsUrl) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = appearance.fontsUrl;
    document.head.append(link);
  }
  if (appearance.css) {
    const style = document.createElement('style');
    style.dataset.appearance = '';
    style.textContent = appearance.css;
    document.head.append(style);
  }
  // index.html only darkens the page for 'system'; a fixed scheme wins over the device.
  if (appearance.colorScheme && appearance.colorScheme !== 'system') document.documentElement.dataset.colorScheme = appearance.colorScheme;
}

type LoadState = { kind: 'loading' } | { kind: 'ready'; project: PublicProject } | { kind: 'missing' } | { kind: 'failed' };

const slug = window.location.pathname.replace(/^\/p\/?/, '').split('/')[0] ?? '';
// Apps can link here with a signed token (?user=...) so votes count as that user.
const params = new URLSearchParams(window.location.search);
const userToken = params.get('user');
if (userToken) {
  // Drop only the token from the address bar; keep ?lang= and anything else for reloads and shares.
  params.delete('user');
  const rest = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
}
const locale = matchLocale(params.get('lang') ?? navigator.language);
const strings = resolveStrings(locale);
document.documentElement.lang = locale;

// --muted is defined per colour scheme in index.html, so these states stay readable in dark mode.
const center = { fontFamily: 'system-ui, sans-serif', textAlign: 'center', padding: 48, color: 'var(--muted)' } as const;

function PublicBoard() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const load = useCallback(() => {
    if (!slug) return setState({ kind: 'missing' });
    setState({ kind: 'loading' });
    // Time out so a stalled connection reaches the retry state instead of loading forever.
    fetch(`/v1/public/projects/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout?.(15_000) })
      .then(async (r) => {
        if (r.status === 404) return setState({ kind: 'missing' });
        if (!r.ok) return setState({ kind: 'failed' });
        const project = (await r.json()) as PublicProject;
        document.title = `${project.name} · ${strings.tabs.board}`;
        applyAppearance(project.appearance);
        setState({ kind: 'ready', project });
      })
      .catch(() => setState({ kind: 'failed' }));
  }, []);

  useEffect(load, [load]);

  if (state.kind === 'loading') {
    return (
      <p style={center} role="status">
        {strings.common.loading}
      </p>
    );
  }
  if (state.kind === 'missing') return <p style={center}>{strings.errors.boardNotFound}</p>;
  if (state.kind === 'failed') {
    return (
      <div style={center} role="alert">
        <p>{strings.errors.boardLoadFailed}</p>
        <button type="button" onClick={load}>
          {strings.errors.retry}
        </button>
      </div>
    );
  }
  const { project } = state;
  const appearance = project.appearance ?? {};
  const logo = appearance.logoUrl ? <img className="fb-page-logo" src={appearance.logoUrl} alt={project.name} /> : null;
  return (
    <main className="fb-page">
      <FeedbackBoard
        projectKey={project.publicKey}
        baseUrl={window.location.origin}
        userToken={userToken}
        locale={locale}
        theme={appearance.theme}
        colorScheme={appearance.colorScheme ?? 'system'}
        style={{ flex: 1 }}
        headerAccessory={
          <header className="fb-page-header">
            {logo && (appearance.homeUrl ? <a href={appearance.homeUrl}>{logo}</a> : logo)}
            <h1 className="fb-page-title">{project.name}</h1>
          </header>
        }
      />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PublicBoard />
  </StrictMode>,
);
