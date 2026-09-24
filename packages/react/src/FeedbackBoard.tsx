import { themeToCssVars, type KeyValueStorage, type Post } from '@kobecuppens/feedback-core';
import {
  FeedbackProvider as CoreFeedbackProvider,
  useFeatures,
  useFeedbackContext,
  useHasFeedbackProvider,
  type FeedbackProviderProps as CoreProviderProps,
} from '@kobecuppens/feedback-core/react';
import { useCallback, useEffect, useInsertionEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { feedbackCss } from './css';
import {
  FeedbackAdminQueue,
  FeedbackDetail,
  FeedbackList,
  FeedbackRoadmap,
  FeedbackSubmit,
  FeedbackUpdates,
  FeedbackUpdatesBadge,
} from './screens';
import { DomUIProvider, useUI, type DomUIOptions } from './ui';

const STYLE_ID = 'rnf-feedback-styles';

function useInjectedStyles(enabled: boolean) {
  useInsertionEffect(() => {
    if (!enabled || typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = feedbackCss;
    // Prepend so the host app's own stylesheets win on equal specificity.
    document.head.prepend(el);
  }, [enabled]);
}

const darkQuery = '(prefers-color-scheme: dark)';
function useSystemScheme(): 'light' | 'dark' {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mq = window.matchMedia(darkQuery);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => (typeof window !== 'undefined' && window.matchMedia?.(darkQuery).matches ? 'dark' : 'light'),
    () => 'light',
  );
}

function browserStorage(): KeyValueStorage | undefined {
  try {
    const ls = globalThis.localStorage;
    return ls ? { getItem: (k) => ls.getItem(k), setItem: (k, v) => ls.setItem(k, v) } : undefined;
  } catch {
    return undefined;
  }
}

export type FeedbackProviderProps = Omit<CoreProviderProps, 'colorScheme'> & {
  colorScheme?: 'light' | 'dark' | 'system';
  /** Inject the default stylesheet (default true; ignored when `unstyled`). */
  injectStyles?: boolean;
} & DomUIOptions;

export function FeedbackProvider({
  classNames,
  styles,
  components,
  unstyled,
  hideHeader,
  injectStyles = true,
  colorScheme = 'system',
  storage,
  ...props
}: FeedbackProviderProps) {
  const system = useSystemScheme();
  const scheme = colorScheme === 'system' ? system : colorScheme;
  const resolvedStorage = useMemo(() => storage ?? browserStorage(), [storage]);
  useInjectedStyles(injectStyles && !unstyled);
  return (
    <CoreFeedbackProvider {...props} storage={resolvedStorage} colorScheme={scheme}>
      <DomUIProvider options={{ classNames, styles, components, unstyled, hideHeader }}>{props.children}</DomUIProvider>
    </CoreFeedbackProvider>
  );
}

/** Root element carrying the theme as CSS variables. Wrap composed screens in it. */
export function FeedbackRoot({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const { theme } = useFeedbackContext();
  const { slot } = useUI();
  const root = slot('root');
  const vars = useMemo(() => themeToCssVars(theme) as CSSProperties, [theme]);
  return (
    <div
      className={[root.className, className].filter(Boolean).join(' ') || undefined}
      style={{ ...vars, colorScheme: theme.colorScheme, ...root.style, ...style }}
      data-color-scheme={theme.colorScheme}
    >
      {children}
    </div>
  );
}

export type BoardTab = 'board' | 'roadmap' | 'updates' | 'admin';

export type FeedbackBoardProps = Omit<FeedbackProviderProps, 'children'> & {
  initialTab?: BoardTab;
  headerAccessory?: ReactNode;
  className?: string;
  style?: CSSProperties;
};

type Route = { name: 'tabs' } | { name: 'post'; id: string; initial?: Post } | { name: 'submit' };

export function FeedbackBoard({ initialTab = 'board', headerAccessory, className, style, ...providerProps }: FeedbackBoardProps) {
  const nested = useHasFeedbackProvider();
  const board = (
    <FeedbackRoot className={className} style={style}>
      <BoardNavigator initialTab={initialTab} headerAccessory={headerAccessory} />
    </FeedbackRoot>
  );
  if (nested && !providerProps.projectKey && !providerProps.adapter) {
    return <DomUIProvider options={providerProps}>{board}</DomUIProvider>;
  }
  return <FeedbackProvider {...providerProps}>{board}</FeedbackProvider>;
}

function BoardNavigator({ initialTab, headerAccessory }: { initialTab: BoardTab; headerAccessory?: ReactNode }) {
  const { slot, strings } = useUI();
  const features = useFeatures();
  const [tab, setTab] = useState<BoardTab>(initialTab);
  const [stack, setStack] = useState<Route[]>([{ name: 'tabs' }]);
  const route = stack[stack.length - 1]!;
  const push = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const openPost = useCallback((post: Post) => push({ name: 'post', id: post.id, initial: post }), [push]);

  // Escape goes back, like the hardware back button on Android.
  useEffect(() => {
    if (stack.length <= 1) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) pop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stack.length, pop]);

  const tabs = useMemo(() => {
    const list: BoardTab[] = ['board'];
    if (features?.roadmap) list.push('roadmap');
    if (features?.updates) list.push('updates');
    if (features?.admin) list.push('admin');
    return list;
  }, [features]);
  const activeTab = tabs.includes(tab) ? tab : 'board';

  if (route.name === 'post') return <FeedbackDetail key={route.id} postId={route.id} initialPost={route.initial} onBack={pop} />;
  if (route.name === 'submit') {
    return <FeedbackSubmit onCancel={pop} onDone={(post) => setStack([{ name: 'tabs' }, { name: 'post', id: post.id, initial: post }])} />;
  }

  return (
    <>
      {headerAccessory}
      {tabs.length > 1 && (
        <div {...slot('tabBar')} role="tablist">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={t === activeTab}
              {...slot('tab', t === activeTab && 'tabActive')}
              onClick={() => setTab(t)}
            >
              {strings.tabs[t]}
              {t === 'updates' && <FeedbackUpdatesBadge />}
            </button>
          ))}
        </div>
      )}
      <div role="tabpanel" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        {activeTab === 'board' && <FeedbackList onOpenPost={openPost} onNewPost={() => push({ name: 'submit' })} />}
        {activeTab === 'roadmap' && <FeedbackRoadmap onOpenPost={openPost} />}
        {activeTab === 'updates' && <FeedbackUpdates onOpenPost={openPost} />}
        {activeTab === 'admin' && <FeedbackAdminQueue onOpenPost={openPost} />}
      </div>
    </>
  );
}
