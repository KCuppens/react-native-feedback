import { useSyncExternalStore } from 'react';

/** Minimal hash router: #/projects/<id>/<tab>[/<postId>] */
export interface Route {
  projectId: string | null;
  tab: string;
  postId: string | null;
}

function parse(): Route {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] !== 'projects' || !parts[1]) return { projectId: null, tab: 'queue', postId: null };
  return { projectId: parts[1], tab: parts[2] ?? 'queue', postId: parts[3] ?? null };
}

let current = parse();
const listeners = new Set<() => void>();
window.addEventListener('hashchange', () => {
  current = parse();
  for (const l of listeners) l();
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export function href(projectId: string, tab = 'queue', postId?: string | null): string {
  return `#/projects/${projectId}/${tab}${postId ? `/${postId}` : ''}`;
}

export function navigate(to: string) {
  window.location.hash = to.replace(/^#/, '');
}
