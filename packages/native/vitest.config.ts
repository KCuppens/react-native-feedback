import { defineConfig } from 'vitest/config';
import { sourceAliases } from '../../source-aliases.mjs';

// Components are rendered through react-native-web in jsdom: this doubles as the
// check that the package works on the web.
export default defineConfig({
  resolve: {
    alias: [{ find: /^react-native$/, replacement: 'react-native-web' }, ...sourceAliases],
    extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.web.js', '.js', '.json'],
  },
  define: { __DEV__: 'true' },
  test: { environment: 'jsdom', setupFiles: ['./test/setup.ts'] },
});
