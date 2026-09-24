import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FeedbackAdapter } from '../adapter';
import { createHostedAdapter, type KeyValueStorage } from '../hosted';
import { useStableValue } from './stable';
import { resolveStrings, type FeedbackStrings, type FeedbackStringsInput } from '../i18n';
import { resolveTheme, type FeedbackTheme, type ThemeProp } from '../theme';
import { FeedbackApiError, type ClientFeatures, type Post } from '../types';
import { feedbackKeys } from './keys';

export type FeedbackUIEvent =
  | { type: 'post_opened'; post: Post }
  | { type: 'post_created'; post: Post }
  | { type: 'voted'; post: Post }
  | { type: 'comment_created'; postId: string }
  | { type: 'error'; error: unknown };

export interface FeedbackProviderProps {
  /** Public project key (`pk_…`). Required unless you pass a custom `adapter`. */
  projectKey?: string;
  /** Hosted API base URL. */
  baseUrl?: string;
  /** Signed user token from your server. Omit for anonymous users. */
  userToken?: string | null;
  getUserToken?: () => Promise<string | null>;
  /** Replace the hosted backend entirely. */
  adapter?: FeedbackAdapter;
  storage?: KeyValueStorage;
  theme?: ThemeProp;
  /** Resolved system scheme, supplied by the platform package. */
  colorScheme?: 'light' | 'dark';
  locale?: string;
  strings?: FeedbackStringsInput;
  /** Hide features. Cannot enable anything the server has turned off. */
  features?: ClientFeatures;
  onEvent?: (event: FeedbackUIEvent) => void;
  queryClient?: QueryClient;
  children?: ReactNode;
}

export interface FeedbackContextValue {
  adapter: FeedbackAdapter;
  /** Cache namespace: changes when the project or user changes. */
  scope: string;
  theme: FeedbackTheme;
  strings: FeedbackStrings;
  clientFeatures: ClientFeatures;
  onEvent: (event: FeedbackUIEvent) => void;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

const noop = () => {};

export function FeedbackProvider(props: FeedbackProviderProps) {
  const { projectKey, baseUrl, userToken, getUserToken, storage, adapter: customAdapter } = props;
  if (!customAdapter && !projectKey) {
    throw new Error('FeedbackProvider: pass either `projectKey` or a custom `adapter`.');
  }

  // Intentional dependencies: getUserToken is read at call time; inline arrows would rebuild the adapter on every render
  const adapter = useMemo(
    () => customAdapter ?? createHostedAdapter({ projectKey: projectKey!, baseUrl, userToken, getUserToken, storage }),
    [customAdapter, projectKey, baseUrl, userToken, storage],
  );

  // Inline `theme={{…}}` objects are common: key on content (themes are plain data) so a
  // host re-render does not rebuild every style in the board.
  const themeKey = JSON.stringify(props.theme ?? null);
  // Intentional dependencies: keyed on the theme's content so inline theme objects do not rebuild styles
  const theme = useMemo(() => resolveTheme(props.theme, props.colorScheme ?? 'light'), [themeKey, props.colorScheme]);
  const stringOverrides = useStableValue(props.strings);
  const strings = useMemo(() => resolveStrings(props.locale, stringOverrides), [props.locale, stringOverrides]);

  const featuresKey = JSON.stringify(props.features ?? {});
  // Intentional dependencies: keyed on the features' content so inline objects do not re-render the board
  const clientFeatures = useMemo<ClientFeatures>(() => props.features ?? {}, [featuresKey]);
  // Stable callback around the latest onEvent, so inline handlers do not re-render the board.
  const onEventRef = useRef(props.onEvent ?? noop);
  onEventRef.current = props.onEvent ?? noop;
  const onEvent = useCallback((event: FeedbackUIEvent) => onEventRef.current(event), []);
  const value = useMemo<FeedbackContextValue>(
    () => ({
      adapter,
      scope: `${projectKey ?? 'custom'}|${userToken ?? 'anon'}`,
      theme,
      strings,
      clientFeatures,
      onEvent,
    }),
    [adapter, projectKey, userToken, theme, strings, clientFeatures, onEvent],
  );

  const [ownClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // 4xx answers (bad key, not found, rate limited) will not change on a retry.
            retry: (count, error) => count < 1 && !(error instanceof FeedbackApiError && error.status < 500),
            refetchOnWindowFocus: true,
          },
        },
      }),
  );

  const client = props.queryClient ?? ownClient;
  // A different user must never see the previous one's votes, posts or admin config.
  const scope = value.scope;
  useEffect(
    () => adapter.subscribeIdentity?.(() => void client.resetQueries({ queryKey: feedbackKeys.all(scope) })),
    [adapter, client, scope],
  );

  return (
    <QueryClientProvider client={client}>
      <FeedbackContext.Provider value={value}>{props.children}</FeedbackContext.Provider>
    </QueryClientProvider>
  );
}

export function useFeedbackContext(): FeedbackContextValue {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('Feedback hooks must be used inside <FeedbackProvider> or <FeedbackBoard>.');
  return ctx;
}

/** True when a parent already provides feedback context (lets FeedbackBoard nest safely). */
export function useHasFeedbackProvider(): boolean {
  return useContext(FeedbackContext) !== null;
}

export const useFeedbackTheme = () => useFeedbackContext().theme;
export const useFeedbackStrings = () => useFeedbackContext().strings;
