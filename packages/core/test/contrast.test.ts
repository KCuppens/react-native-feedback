import { describe, expect, it } from 'vitest';
import { darkTheme, lightTheme, type FeedbackTheme } from '../src';

// Status pills draw the status colour as small text on a 0x22 (13%) tint of itself.
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (c: number[]) => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

function pillContrasts(theme: FeedbackTheme) {
  const surface = rgb(theme.colors.surface);
  return Object.entries(theme.colors.status).map(([status, hex]) => {
    const fg = rgb(hex);
    const pill = fg.map((c, i) => c * (0x22 / 255) + surface[i]! * (1 - 0x22 / 255));
    return [status, contrast(fg, pill)] as const;
  });
}

describe('default themes', () => {
  it.each([
    ['light', lightTheme],
    ['dark', darkTheme],
  ])('%s status pills meet WCAG AA (4.5:1)', (_name, theme) => {
    for (const [status, ratio] of pillContrasts(theme)) {
      expect(ratio, status).toBeGreaterThanOrEqual(4.5);
    }
  });
});
