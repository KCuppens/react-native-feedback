import { deepMerge } from '../theme';
import { FeedbackApiError } from '../types';
import { en, type FeedbackStrings } from './en';
import { fr } from './fr';
import { nl } from './nl';

export type { FeedbackStrings };
export const locales = { en, nl, fr } as const;
export type FeedbackLocale = keyof typeof locales;

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (...args: never[]) => unknown ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};
export type FeedbackStringsInput = DeepPartial<FeedbackStrings>;

/** Map any BCP-47 tag (e.g. `nl-BE`) to a supported locale, defaulting to English. */
export function matchLocale(tag: string | null | undefined): FeedbackLocale {
  const lang = (tag ?? '').toLowerCase().split(/[-_]/)[0];
  return lang && lang in locales ? (lang as FeedbackLocale) : 'en';
}

export function detectLocale(): FeedbackLocale {
  try {
    return matchLocale(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return 'en';
  }
}

export function resolveStrings(locale: string | undefined, overrides?: FeedbackStringsInput): FeedbackStrings {
  const base = locales[locale ? matchLocale(locale) : detectLocale()];
  return overrides ? deepMerge(base, overrides) : base;
}

export function formatRelativeTime(strings: FeedbackStrings, timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return strings.time.justNow;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return strings.time.minutes(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return strings.time.hours(hours);
  const days = Math.floor(hours / 24);
  if (days < 30) return strings.time.days(days);
  return new Date(timestamp).toLocaleDateString(strings.dateLocale);
}

/**
 * A localized, user-facing message for any error thrown by an adapter call.
 * Server messages are English and meant for developers, so they are never shown as-is.
 */
export function describeError(strings: FeedbackStrings, error: unknown): string {
  if (error instanceof TypeError) return strings.errors.network;
  if (!(error instanceof FeedbackApiError)) return strings.errors.generic;
  if (error.status === 413) return strings.errors.uploadTooLarge;
  if (error.status === 429) return strings.errors.rateLimited;
  if (error.status === 401) return strings.errors.signIn;
  if (error.status === 403) return strings.errors.notAllowed;
  if (error.code === 'invalid_input' && error.reason === 'too_short') return strings.submit.required;
  return strings.errors.generic;
}
