import { themeToCssVars, type KeyValueStorage, type Post } from '@kobecuppens/feedback-core';
import {
  FeedbackProvider as CoreFeedbackProvider,
  useFeatures,
  useFeedbackContext,
  useHasFeedbackProvider,
  type FeedbackProviderProps as CoreProviderProps,
} from '@kobecuppens/feedback-core/react';
import {
  useCallback,
  useEffect,
  useId,
  useInsertionEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { feedbackCss } from './css';
import { FeedbackErrorBoundary } from './ErrorBoundary';
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
      <FeedbackErrorBoundary>
        <BoardNavigator initialTab={initialTab} headerAccessory={headerAccessory} />
      </FeedbackErrorBoundary>
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

  // Escape goes back, like the hardware back button on Android.
  useEffect(() => {
    if (stack.length <= 1) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
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

  // Move focus to the new screen's heading on push, and back to the trigger on pop,
  // so keyboard and screen reader users keep their place.
  // Keyed on the top route, not just the depth: submit replaces [tabs, submit] with
  // [tabs, post] at the same depth and must still move focus to the new screen.
  const screen = useRef<HTMLDivElement>(null);
  const triggers = useRef<(HTMLElement | null)[]>([]);
  const previous = useRef({ depth: stack.length, top: 'tabs' });
  const top = route.name === 'post' ? `post:${route.id}` : route.name;
  useEffect(() => {
    const before = previous.current;
    previous.current = { depth: stack.length, top };
    if (stack.length < before.depth) {
      triggers.current.pop()?.focus();
    } else if (top !== before.top) {
      // A custom or hidden header has no title to focus: fall back to the screen itself.
      (screen.current?.querySelector<HTMLElement>('[data-fb-screen-title]') ?? screen.current)?.focus();
    }
  }, [stack.length, top]);
  const navigate = (r: Route) => {
    triggers.current.push(document.activeElement as HTMLElement | null);
    push(r);
  };
  const open = (post: Post) => navigate({ name: 'post', id: post.id, initial: post });

  // Tabs pattern: arrow keys move between tabs, only the active one is in the tab order.
  const ids = useId();
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.indexOf(activeTab);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const t = tabs[(next + tabs.length) % tabs.length]!;
    setTab(t);
    document.getElementById(`${ids}-tab-${t}`)?.focus();
  };

  // The tabs stay mounted (hidden) under pushed screens so going back keeps scroll
  // position, search and filters, and does not refetch every loaded page.
  const covered = route.name !== 'tabs';
  return (
    <div style={{ display: 'contents' }}>
      {covered && (
        <div ref={screen} tabIndex={-1} style={{ display: 'flex', flexDirection: 'column', flex: 1, outline: 'none' }}>
          {route.name === 'post' && <FeedbackDetail key={route.id} postId={route.id} initialPost={route.initial} onBack={pop} />}
          {route.name === 'submit' && (
            <FeedbackSubmit onCancel={pop} onDone={(post) => setStack([{ name: 'tabs' }, { name: 'post', id: post.id, initial: post }])} />
          )}
        </div>
      )}
      <div hidden={covered} style={{ display: covered ? 'none' : 'contents' }}>
        {headerAccessory}
        {tabs.length > 1 && (
          <div {...slot('tabBar')} role="tablist" onKeyDown={onTabKey}>
            {tabs.map((t) => (
              <button
                key={t}
                id={`${ids}-tab-${t}`}
                type="button"
                role="tab"
                aria-selected={t === activeTab}
                aria-controls={`${ids}-panel`}
                tabIndex={t === activeTab ? 0 : -1}
                {...slot('tab', t === activeTab && 'tabActive')}
                onClick={() => setTab(t)}
              >
                {strings.tabs[t]}
                {t === 'updates' && <FeedbackUpdatesBadge />}
              </button>
            ))}
          </div>
        )}
        <div
          id={`${ids}-panel`}
          {...(tabs.length > 1 ? { role: 'tabpanel', 'aria-labelledby': `${ids}-tab-${activeTab}` } : {})}
          style={{ display: 'flex', flexDirection: 'column', flex: 1 }}
        >
          {activeTab === 'board' && <FeedbackList onOpenPost={open} onNewPost={() => navigate({ name: 'submit' })} />}
          {activeTab === 'roadmap' && <FeedbackRoadmap onOpenPost={open} />}
          {activeTab === 'updates' && <FeedbackUpdates onOpenPost={open} />}
          {activeTab === 'admin' && <FeedbackAdminQueue onOpenPost={open} />}
        </div>
      </div>
    </div>
  );
}
