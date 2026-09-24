import { readFileSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2020',
  jsx: 'automatic',
  external: ['react', 'react-dom', '@kobecuppens/feedback-core', '@tanstack/react-query'],
  // Also ship the stylesheet as a file for apps that inject CSS themselves (SSR, CSP).
  onSuccess: async () => {
    const source = readFileSync('src/css.ts', 'utf8');
    const css = source.slice(source.indexOf('`') + 1, source.lastIndexOf('`'));
    writeFileSync('dist/styles.css', `${css.trim()}\n`);
  },
});
