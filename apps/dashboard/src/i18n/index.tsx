import { FeedbackApiError, formatRelativeTime, locales, type FeedbackLocale, type FeedbackStrings } from '@kobecuppens/feedback-core';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { de } from './de';
import { en, type DashboardStrings } from './en';
import { es } from './es';
import { fr } from './fr';
import { ja } from './ja';
import { ko } from './ko';
import { nl } from './nl';

export type { DashboardStrings };

/** Same languages as the board, so statuses and relative times come from its strings. */
export const DASHBOARD_LOCALES: Record<FeedbackLocale, DashboardStrings> = { en, nl, fr, de, es, ja, ko };

const STORAGE_KEY = 'fb-dashboard-locale';

const isLocale = (value: string | null | undefined): value is FeedbackLocale => !!value && Object.hasOwn(DASHBOARD_LOCALES, value);

/** A saved choice, else the first browser language the dashboard speaks, else English. */
function initialLocale(): FeedbackLocale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // Storage can be blocked; fall back to the browser languages.
  }
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of preferred) {
    const base = tag?.toLowerCase().split(/[-_]/)[0];
    if (isLocale(base)) return base;
  }
  return 'en';
}

interface I18n {
  locale: FeedbackLocale;
  setLocale: (locale: FeedbackLocale) => void;
  t: DashboardStrings;
  /** The board's strings in the same language: status names, "Anonymous", relative times. */
  board: FeedbackStrings;
  ago: (timestamp: number) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState(initialLocale);
  const value = useMemo<I18n>(() => {
    const board = locales[locale];
    return {
      locale,
      setLocale: (next) => {
        setLocaleState(next);
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          // Not remembered across visits; the choice still applies now.
        }
      },
      t: DASHBOARD_LOCALES[locale],
      board,
      ago: (timestamp) => formatRelativeTime(board, timestamp),
    };
  }, [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = value.t.login.title;
  }, [locale, value.t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>.');
  return ctx;
}

/** A localized sentence for a failed request; the server's own (English, technical) message is kept for a tooltip. */
export function errorText(t: DashboardStrings, e: unknown): string {
  // A dropped connection (TypeError) or the client's timeout (AbortError) would otherwise
  // surface the browser's own wording, e.g. "signal is aborted without reason".
  if (e instanceof TypeError || (e instanceof Error && e.name === 'AbortError')) return t.errors.network;
  if (!(e instanceof FeedbackApiError)) return t.errors.generic;
  if (e.code === 'invalid_password') return t.errors.wrongPassword;
  if (e.code === 'slug_taken') return t.errors.slugTaken;
  switch (e.status) {
    case 400:
      return t.errors.invalidInput;
    case 401:
      return t.errors.session;
    case 403:
      return t.errors.notAllowed;
    case 404:
      return t.errors.notFound;
    case 409:
      return t.errors.conflict;
    case 413:
      return t.errors.tooLarge;
    case 429:
      return t.errors.rateLimited;
    default:
      return t.errors.generic;
  }
}
