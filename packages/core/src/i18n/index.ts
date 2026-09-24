import { deepMerge } from '../theme';
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
  return new Date(timestamp).toLocaleDateString();
}
