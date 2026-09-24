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
import { srOnly } from './components';
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
  /**
   * An unsaved submit draft appeared or cleared (false when the form closes). Use it to
   * stop a host dialog from closing on Escape or an outside click while a draft exists.
   */
  onDirtyChange?: (dirty: boolean) => void;
  className?: string;
  style?: CSSProperties;
};

type Route = { name: 'tabs' } | { name: 'post'; id: string; initial?: Post } | { name: 'submit' };

export function FeedbackBoard({
  initialTab = 'board',
  headerAccessory,
  onDirtyChange,
  className,
  style,
  ...providerProps
}: FeedbackBoardProps) {
  const nested = useHasFeedbackProvider();
  const board = (
    <FeedbackRoot className={className} style={style}>
      <FeedbackErrorBoundary>
        <BoardNavigator initialTab={initialTab} headerAccessory={headerAccessory} onDirtyChange={onDirtyChange} />
      </FeedbackErrorBoundary>
    </FeedbackRoot>
  );
  if (nested && !providerProps.projectKey && !providerProps.adapter) {
    return <DomUIProvider options={providerProps}>{board}</DomUIProvider>;
  }
  return <FeedbackProvider {...providerProps}>{board}</FeedbackProvider>;
}

function BoardNavigator({
  initialTab,
  headerAccessory,
  onDirtyChange,
}: {
  initialTab: BoardTab;
  headerAccessory?: ReactNode;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { slot, strings } = useUI();
  const features = useFeatures();
  const [tab, setTab] = useState<BoardTab>(initialTab);
  const [stack, setStack] = useState<Route[]>([{ name: 'tabs' }]);
  const route = stack[stack.length - 1]!;
  const push = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);

  const tabs = useMemo(() => {
    const list: BoardTab[] = ['board'];
    if (features?.roadmap) list.push('roadmap');
    if (features?.updates) list.push('updates');
    if (features?.admin) list.push('admin');
    return list;
  }, [features]);
  const activeTab = tabs.includes(tab) ? tab : 'board';

  const { screen, navigate } = useRouteFocus(stack.length, route, push);
  const open = (post: Post) => navigate({ name: 'post', id: post.id, initial: post });

  const { onScreenKey, onSubmitDirtyChange, draftNotice } = useDraftEscape(route.name === 'submit', pop, onDirtyChange);

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
        <div
          ref={screen}
          tabIndex={-1}
          style={{ display: 'flex', flexDirection: 'column', flex: 1, outline: 'none' }}
          onKeyDown={onScreenKey}
        >
          {/* Escape on a kept draft does nothing visible: say why, and how to leave. */}
          <div role="status" style={srOnly}>
            <span key={draftNotice.count}>{draftNotice.text}</span>
          </div>
          {route.name === 'post' && <FeedbackDetail key={route.id} postId={route.id} initialPost={route.initial} onBack={pop} />}
          {route.name === 'submit' && (
            <FeedbackSubmit
              onCancel={pop}
              onDone={(post) => setStack([{ name: 'tabs' }, { name: 'post', id: post.id, initial: post }])}
              onDirtyChange={onSubmitDirtyChange}
            />
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

/**
 * Move focus to the new screen's heading on push, and back to the trigger on pop, so
 * keyboard and screen reader users keep their place. Keyed on the top route, not just the
 * depth: submit replaces [tabs, submit] with [tabs, post] at the same depth and must still
 * move focus to the new screen.
 */
function useRouteFocus(depth: number, route: Route, push: (r: Route) => void) {
  const screen = useRef<HTMLDivElement>(null);
  const triggers = useRef<(HTMLElement | null)[]>([]);
  const previous = useRef({ depth, top: 'tabs' });
  const top = route.name === 'post' ? `post:${route.id}` : route.name;
  useEffect(() => {
    const before = previous.current;
    previous.current = { depth, top };
    if (depth < before.depth) {
      triggers.current.pop()?.focus();
    } else if (top !== before.top) {
      // A custom or hidden header has no title to focus: fall back to the screen itself.
      (screen.current?.querySelector<HTMLElement>('[data-fb-screen-title]') ?? screen.current)?.focus();
    }
  }, [depth, top]);
  const navigate = (r: Route) => {
    triggers.current.push(document.activeElement as HTMLElement | null);
    push(r);
  };
  return { screen, navigate };
}

/**
 * Escape goes back, like the hardware back button on Android. Scoped to the pushed screen
 * (the caller puts onScreenKey on it) so an Escape meant for the host app (its own modal or
 * menu) never pops the board. A started submit draft only lives in FeedbackSubmit's state:
 * never discard it on Escape, and say so.
 */
function useDraftEscape(onSubmit: boolean, pop: () => void, onDirtyChange?: (dirty: boolean) => void) {
  const { strings } = useUI();
  const draftDirty = useRef(false);
  const reportDirty = useRef(onDirtyChange);
  reportDirty.current = onDirtyChange;
  const [draftNotice, setDraftNotice] = useState({ text: '', count: 0 });
  const onScreenKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return;
    // Checked before defaultPrevented: a capture-phase host dialog (e.g. Radix, via
    // onDirtyChange) may already have blocked this Escape, and the user still needs to hear why.
    if (onSubmit && draftDirty.current) {
      // Handled: the draft stays. This also stops bubble-phase host dialogs that respect
      // defaultPrevented or React propagation.
      e.preventDefault();
      e.stopPropagation();
      // A new count each time, so repeated presses change the live region and are announced again.
      setDraftNotice((notice) => ({ text: strings.submit.draftKept, count: notice.count + 1 }));
      return;
    }
    if (e.defaultPrevented) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    pop();
  };
  const onSubmitDirtyChange = (dirty: boolean) => {
    draftDirty.current = dirty;
    reportDirty.current?.(dirty);
    if (!dirty) setDraftNotice((notice) => ({ ...notice, text: '' }));
  };
  return { onScreenKey, onSubmitDirtyChange, draftNotice };
}
