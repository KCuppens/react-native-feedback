import type { Post } from '@kobecuppens/feedback-core';
import {
  FeedbackProvider as CoreFeedbackProvider,
  useFeatures,
  useHasFeedbackProvider,
  useRefreshStale,
  type FeedbackProviderProps as CoreProviderProps,
} from '@kobecuppens/feedback-core/react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState, BackHandler, Pressable, Text, useColorScheme, View } from 'react-native';
import { defaultStorage } from './platform';
import { FeedbackAdminQueue } from './screens/FeedbackAdminQueue';
import { FeedbackDetail } from './screens/FeedbackDetail';
import { FeedbackList } from './screens/FeedbackList';
import { FeedbackRoadmap } from './screens/FeedbackRoadmap';
import { FeedbackSubmit } from './screens/FeedbackSubmit';
import { FeedbackUpdates, FeedbackUpdatesBadge } from './screens/FeedbackUpdates';
import { FeedbackErrorBoundary } from './ErrorBoundary';
import { NativeUIProvider, useUI, type NativeUIOptions } from './ui';

export type FeedbackProviderProps = Omit<CoreProviderProps, 'colorScheme'> & {
  /** 'system' (default) follows the device; or force 'light' / 'dark'. */
  colorScheme?: 'light' | 'dark' | 'system';
} & NativeUIOptions;

/**
 * Provider for composing the exported screens inside your own navigation.
 * Defaults storage to AsyncStorage (native) / localStorage (web).
 */
export function FeedbackProvider({
  styles,
  components,
  pickImage,
  hideHeader,
  colorScheme = 'system',
  storage,
  ...props
}: FeedbackProviderProps) {
  const system = useColorScheme();
  const scheme = colorScheme === 'system' ? (system === 'dark' ? 'dark' : 'light') : colorScheme;
  const resolvedStorage = useMemo(() => storage ?? defaultStorage(), [storage]);
  return (
    <CoreFeedbackProvider {...props} storage={resolvedStorage} colorScheme={scheme}>
      <NativeUIProvider options={{ styles, components, pickImage, hideHeader }}>{props.children}</NativeUIProvider>
    </CoreFeedbackProvider>
  );
}

export type BoardTab = 'board' | 'roadmap' | 'updates' | 'admin';

export type FeedbackBoardProps = Omit<FeedbackProviderProps, 'children'> & {
  initialTab?: BoardTab;
  /** Rendered above the tab bar (e.g. a title or close button for a modal). */
  headerAccessory?: ReactNode;
};

type Route = { name: 'tabs' } | { name: 'post'; id: string; initial?: Post } | { name: 'submit' };

/**
 * The complete board: tabs for feedback, roadmap, updates and (for admins) the
 * review queue, with its own detail/submit navigation. Drop it in any screen or modal.
 */
export function FeedbackBoard({ initialTab = 'board', headerAccessory, ...providerProps }: FeedbackBoardProps) {
  const nested = useHasFeedbackProvider();
  const board = (
    <FeedbackErrorBoundary>
      <BoardNavigator initialTab={initialTab} headerAccessory={headerAccessory} />
    </FeedbackErrorBoundary>
  );
  // Inside an existing provider (and no new backend config), reuse it.
  if (nested && !providerProps.projectKey && !providerProps.adapter) {
    return <NativeUIProvider options={providerProps}>{board}</NativeUIProvider>;
  }
  return <FeedbackProvider {...providerProps}>{board}</FeedbackProvider>;
}

function BoardNavigator({ initialTab, headerAccessory }: { initialTab: BoardTab; headerAccessory?: ReactNode }) {
  const { styles, strings } = useUI();
  const features = useFeatures();
  const [tab, setTab] = useState<BoardTab>(initialTab);
  const [stack, setStack] = useState<Route[]>([{ name: 'tabs' }]);
  const route = stack[stack.length - 1]!;

  const push = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const openPost = useCallback((post: Post) => push({ name: 'post', id: post.id, initial: post }), [push]);

  useEffect(() => {
    if (stack.length <= 1) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      pop();
      return true;
    });
    return () => sub.remove();
  }, [stack.length, pop]);

  // The tabs stay mounted under pushed screens, and React Native has no window focus: refresh
  // what is stale when the user comes back to them or reopens the app, so a post moderated
  // meanwhile does not keep showing its old state until a pull-to-refresh.
  const refreshStale = useRefreshStale();
  const onTabs = route.name === 'tabs';
  useEffect(() => {
    if (onTabs) refreshStale();
  }, [onTabs, refreshStale]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshStale();
    });
    return () => sub.remove();
  }, [refreshStale]);

  const tabs = useMemo(() => {
    const list: BoardTab[] = ['board'];
    if (features?.roadmap) list.push('roadmap');
    if (features?.updates) list.push('updates');
    if (features?.admin) list.push('admin');
    return list;
  }, [features]);
  const activeTab = tabs.includes(tab) ? tab : 'board';

  // The tabs stay mounted under pushed screens so going back keeps scroll position,
  // search and filters, and does not refetch every loaded page.
  const covered = route.name !== 'tabs';
  return (
    <>
      {route.name === 'post' && <FeedbackDetail key={route.id} postId={route.id} initialPost={route.initial} onBack={pop} />}
      {route.name === 'submit' && (
        <FeedbackSubmit onCancel={pop} onDone={(post) => setStack([{ name: 'tabs' }, { name: 'post', id: post.id, initial: post }])} />
      )}
      <View
        style={[styles.container, covered && { display: 'none' }]}
        accessibilityElementsHidden={covered}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
      >
        {headerAccessory}
        {tabs.length > 1 && (
          <View style={styles.tabBar} accessibilityRole="tablist">
            {tabs.map((t) => {
              const active = t === activeTab;
              return (
                <Pressable
                  key={t}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  onPress={() => setTab(t)}
                  style={[styles.tab, active && styles.tabActive]}
                >
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>{strings.tabs[t]}</Text>
                  {t === 'updates' && <FeedbackUpdatesBadge />}
                </Pressable>
              );
            })}
          </View>
        )}
        {activeTab === 'board' && <FeedbackList onOpenPost={openPost} onNewPost={() => push({ name: 'submit' })} />}
        {activeTab === 'roadmap' && <FeedbackRoadmap onOpenPost={openPost} />}
        {activeTab === 'updates' && <FeedbackUpdates onOpenPost={openPost} />}
        {activeTab === 'admin' && <FeedbackAdminQueue onOpenPost={openPost} />}
      </View>
    </>
  );
}
