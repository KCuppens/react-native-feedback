import { describe, expect, it } from 'vitest';
import {
  applyVote,
  createTheme,
  darkTheme,
  formatRelativeTime,
  lightTheme,
  matchLocale,
  nextVote,
  resolveStrings,
  resolveTheme,
  themeToCssVars,
  type Post,
} from '../src';

describe('theme', () => {
  it('merges partial tokens onto the base palette', () => {
    const t = createTheme({ colors: { primary: '#FF0000', status: { done: '#00FF00' } }, radii: { md: 4 } });
    expect(t.colors.primary).toBe('#FF0000');
    expect(t.colors.status.done).toBe('#00FF00');
    expect(t.colors.status.planned).toBe(lightTheme.colors.status.planned);
    expect(t.radii.md).toBe(4);
    expect(t.radii.lg).toBe(lightTheme.radii.lg);
  });

  it('resolves split light/dark themes by scheme', () => {
    const prop = { light: { colors: { primary: '#111111' } }, dark: { colors: { primary: '#EEEEEE' } } };
    expect(resolveTheme(prop, 'light').colors.primary).toBe('#111111');
    const dark = resolveTheme(prop, 'dark');
    expect(dark.colors.primary).toBe('#EEEEEE');
    expect(dark.colors.background).toBe(darkTheme.colors.background);
  });

  it('follows the system scheme when no theme is given', () => {
    expect(resolveTheme(undefined, 'dark')).toBe(darkTheme);
  });

  it('emits CSS variables', () => {
    const vars = themeToCssVars(lightTheme);
    expect(vars['--fb-color-primary']).toBe(lightTheme.colors.primary);
    expect(vars['--fb-color-on-primary']).toBe(lightTheme.colors.onPrimary);
    expect(vars['--fb-status-in-progress']).toBe(lightTheme.colors.status.in_progress);
    expect(vars['--fb-radius-md']).toBe('10px');
  });
});

describe('i18n', () => {
  it('matches regional tags and falls back to English', () => {
    expect(matchLocale('nl-BE')).toBe('nl');
    expect(matchLocale('fr_CA')).toBe('fr');
    expect(matchLocale('de-DE')).toBe('en');
    expect(matchLocale(undefined)).toBe('en');
  });

  it('applies deep overrides including functions', () => {
    const s = resolveStrings('nl', { tabs: { board: 'Ideeën' }, post: { votes: (n) => `${n}!` } });
    expect(s.tabs.board).toBe('Ideeën');
    expect(s.tabs.roadmap).toBe('Roadmap');
    expect(s.post.votes(3)).toBe('3!');
    expect(s.post.comments(2)).toBe('2 reacties');
  });

  it('formats relative time', () => {
    const s = resolveStrings('en');
    const now = 10_000_000_000;
    expect(formatRelativeTime(s, now - 10_000, now)).toBe('just now');
    expect(formatRelativeTime(s, now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatRelativeTime(s, now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatRelativeTime(s, now - 2 * 86_400_000, now)).toBe('2d ago');
  });
});

describe('votes', () => {
  const post = { upvotes: 5, downvotes: 2, score: 3, myVote: 0 } as Post;

  it('toggles and switches', () => {
    expect(nextVote(0, 1)).toBe(1);
    expect(nextVote(1, 1)).toBe(0);
    expect(nextVote(1, -1)).toBe(-1);
  });

  it('adjusts counters optimistically', () => {
    const up = applyVote(post, 1);
    expect(up).toMatchObject({ upvotes: 6, downvotes: 2, score: 4, myVote: 1 });
    const switched = applyVote(up, -1);
    expect(switched).toMatchObject({ upvotes: 5, downvotes: 3, score: 2, myVote: -1 });
    expect(applyVote(switched, 0)).toMatchObject({ upvotes: 5, downvotes: 2, score: 3, myVote: 0 });
    expect(applyVote(post, 0)).toBe(post);
  });
});
