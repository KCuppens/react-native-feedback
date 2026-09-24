import type { PostStatus } from './types';

export interface FeedbackTheme {
  colorScheme: 'light' | 'dark';
  colors: {
    background: string;
    surface: string;
    surfaceAlt: string;
    text: string;
    textMuted: string;
    border: string;
    primary: string;
    onPrimary: string;
    danger: string;
    onDanger: string;
    upvote: string;
    downvote: string;
    overlay: string;
    status: Record<PostStatus | 'pending' | 'declined', string>;
  };
  fonts: {
    body: string | undefined;
    heading: string | undefined;
    mono: string | undefined;
    sizes: { xs: number; sm: number; md: number; lg: number; xl: number };
    weights: { regular: '400'; medium: '500' | '600'; bold: '600' | '700' | '800' };
  };
  radii: { sm: number; md: number; lg: number; pill: number };
  spacing: { xs: number; sm: number; md: number; lg: number; xl: number };
  shadow: {
    /** CSS box-shadow for the web; native maps it to elevation/shadow props. */
    card: string;
    elevation: number;
  };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type FeedbackThemeInput = DeepPartial<FeedbackTheme>;

export const lightTheme: FeedbackTheme = {
  colorScheme: 'light',
  colors: {
    background: '#F7F7F8',
    surface: '#FFFFFF',
    surfaceAlt: '#F0F0F2',
    text: '#141418',
    textMuted: '#6B6B76',
    border: '#E3E3E8',
    primary: '#4F46E5',
    onPrimary: '#FFFFFF',
    danger: '#DC2626',
    onDanger: '#FFFFFF',
    upvote: '#4F46E5',
    downvote: '#DC2626',
    overlay: 'rgba(0,0,0,0.4)',
    // Dark enough for 4.5:1 as 11px pill text on their own 13% tint over white.
    status: {
      open: '#4B5563',
      under_review: '#92400E',
      planned: '#1D4ED8',
      in_progress: '#6D28D9',
      done: '#047857',
      closed: '#52525B',
      pending: '#92400E',
      declined: '#B91C1C',
    },
  },
  fonts: {
    body: undefined,
    heading: undefined,
    mono: undefined,
    sizes: { xs: 11, sm: 13, md: 15, lg: 18, xl: 22 },
    weights: { regular: '400', medium: '600', bold: '700' },
  },
  radii: { sm: 6, md: 10, lg: 16, pill: 999 },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  shadow: { card: '0 1px 2px rgba(0,0,0,0.06)', elevation: 1 },
};

export const darkTheme: FeedbackTheme = {
  ...lightTheme,
  colorScheme: 'dark',
  colors: {
    ...lightTheme.colors,
    background: '#0E0E11',
    surface: '#18181C',
    surfaceAlt: '#222228',
    text: '#F4F4F6',
    textMuted: '#9A9AA6',
    border: '#2C2C34',
    primary: '#818CF8',
    onPrimary: '#0E0E11',
    upvote: '#818CF8',
    downvote: '#F87171',
    overlay: 'rgba(0,0,0,0.6)',
    status: {
      open: '#9CA3AF',
      under_review: '#FBBF24',
      planned: '#60A5FA',
      in_progress: '#A78BFA',
      done: '#34D399',
      closed: '#A1A1AA',
      pending: '#FBBF24',
      declined: '#F87171',
    },
  },
  shadow: { card: 'none', elevation: 0 },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch) || !isPlainObject(base)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? deepMerge(out[key], value) : value;
  }
  return out as T;
}

/**
 * Build a theme from partial tokens. `input.colorScheme` picks the base palette;
 * pass separate inputs per scheme to `resolveTheme` for light/dark apps.
 */
export function createTheme(input: FeedbackThemeInput = {}): FeedbackTheme {
  const base = input.colorScheme === 'dark' ? darkTheme : lightTheme;
  return deepMerge(base, input);
}

export type ThemeProp =
  | FeedbackThemeInput
  | { light?: FeedbackThemeInput; dark?: FeedbackThemeInput };

/** Resolve the `theme` prop for the current system scheme. */
export function resolveTheme(prop: ThemeProp | undefined, scheme: 'light' | 'dark'): FeedbackTheme {
  if (!prop) return scheme === 'dark' ? darkTheme : lightTheme;
  if ('light' in prop || 'dark' in prop) {
    const split = prop as { light?: FeedbackThemeInput; dark?: FeedbackThemeInput };
    return createTheme({ ...(split[scheme] ?? {}), colorScheme: scheme });
  }
  const single = prop as FeedbackThemeInput;
  return createTheme({ colorScheme: single.colorScheme ?? scheme, ...single });
}

/** Flatten tokens to CSS custom properties (`--fb-color-primary`, …) for the DOM package. */
export function themeToCssVars(theme: FeedbackTheme): Record<string, string> {
  const vars: Record<string, string> = {};
  const c = theme.colors;
  for (const [key, value] of Object.entries(c)) {
    if (typeof value === 'string') vars[`--fb-color-${kebab(key)}`] = value;
  }
  for (const [key, value] of Object.entries(c.status)) vars[`--fb-status-${kebab(key)}`] = value;
  for (const [key, value] of Object.entries(theme.fonts.sizes)) vars[`--fb-font-size-${key}`] = `${value}px`;
  for (const [key, value] of Object.entries(theme.fonts.weights)) vars[`--fb-font-weight-${key}`] = value;
  vars['--fb-font-body'] = theme.fonts.body ?? 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  vars['--fb-font-heading'] = theme.fonts.heading ?? 'var(--fb-font-body)';
  vars['--fb-font-mono'] = theme.fonts.mono ?? 'ui-monospace, SFMono-Regular, Menlo, monospace';
  for (const [key, value] of Object.entries(theme.radii)) vars[`--fb-radius-${key}`] = `${value}px`;
  for (const [key, value] of Object.entries(theme.spacing)) vars[`--fb-space-${key}`] = `${value}px`;
  vars['--fb-shadow-card'] = theme.shadow.card;
  return vars;
}

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`).replace(/_/g, '-');
}
