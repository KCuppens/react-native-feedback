import { FeedbackBoard } from '@kobecuppens/react-feedback';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

interface PublicProject {
  name: string;
  slug: string;
  publicKey: string;
}

const slug = window.location.pathname.replace(/^\/p\/?/, '').split('/')[0] ?? '';
// Apps can link here with a signed token (?user=...) so votes count as that user.
const params = new URLSearchParams(window.location.search);
const userToken = params.get('user');
if (userToken) window.history.replaceState(null, '', window.location.pathname);

function PublicBoard() {
  const [project, setProject] = useState<PublicProject | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!slug) return setError(true);
    fetch(`/v1/public/projects/${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? (r.json() as Promise<PublicProject>) : Promise.reject(new Error(String(r.status)))))
      .then((p) => {
        setProject(p);
        document.title = `${p.name} · Feedback`;
      })
      .catch(() => setError(true));
  }, []);

  if (error) {
    return <p style={{ fontFamily: 'system-ui', textAlign: 'center', padding: 48, color: '#6b6b76' }}>This board doesn't exist or isn't public.</p>;
  }
  if (!project) return null;
  return (
    <div style={{ maxWidth: 820, margin: '0 auto', minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <FeedbackBoard
        projectKey={project.publicKey}
        baseUrl={window.location.origin}
        userToken={userToken}
        locale={params.get('lang') ?? undefined}
        style={{ flex: 1 }}
        headerAccessory={
          <h1 style={{ margin: 0, padding: '20px 16px 8px', font: '700 22px var(--fb-font-heading)' }}>{project.name}</h1>
        }
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PublicBoard />
  </StrictMode>,
);
