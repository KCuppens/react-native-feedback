import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { FeedbackAdapter } from '../adapter';
import { createHostedAdapter, type KeyValueStorage } from '../hosted';
import { resolveStrings, type FeedbackStrings, type FeedbackStringsInput } from '../i18n';
import { resolveTheme, type FeedbackTheme, type ThemeProp } from '../theme';
import type { ClientFeatures, Post } from '../types';

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

  const adapter = useMemo(
    () =>
      customAdapter ??
      createHostedAdapter({ projectKey: projectKey!, baseUrl, userToken, getUserToken, storage }),
    // getUserToken is intentionally excluded: inline arrow functions would rebuild the adapter every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customAdapter, projectKey, baseUrl, userToken, storage],
  );

  const theme = useMemo(
    () => resolveTheme(props.theme, props.colorScheme ?? 'light'),
    [props.theme, props.colorScheme],
  );
  const strings = useMemo(() => resolveStrings(props.locale, props.strings), [props.locale, props.strings]);

  const featuresKey = JSON.stringify(props.features ?? {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const clientFeatures = useMemo<ClientFeatures>(() => props.features ?? {}, [featuresKey]);
  const onEventProp = props.onEvent;
  const value = useMemo<FeedbackContextValue>(
    () => ({
      adapter,
      scope: `${projectKey ?? 'custom'}|${userToken ?? 'anon'}`,
      theme,
      strings,
      clientFeatures,
      onEvent: onEventProp ?? noop,
    }),
    [adapter, projectKey, userToken, theme, strings, clientFeatures, onEventProp],
  );

  const [ownClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true } },
      }),
  );

  return (
    <QueryClientProvider client={props.queryClient ?? ownClient}>
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
