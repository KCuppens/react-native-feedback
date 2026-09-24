// Resolve workspace packages to their TypeScript sources in tests, Vite apps and
// wrangler, so nothing needs building first. Order matters: subpaths before roots.
import { fileURLToPath } from 'node:url';

const src = (p) => fileURLToPath(new URL(`./packages/${p}`, import.meta.url));

export const sourceAliases = [
  { find: /^@kobecuppens\/feedback-core\/server$/, replacement: src('core/src/server.ts') },
  { find: /^@kobecuppens\/feedback-core\/react$/, replacement: src('core/src/react/index.ts') },
  { find: /^@kobecuppens\/feedback-core$/, replacement: src('core/src/index.ts') },
  { find: /^@kobecuppens\/react-feedback$/, replacement: src('react/src/index.ts') },
  { find: /^@kobecuppens\/react-native-feedback$/, replacement: src('native/src/index.ts') },
];
