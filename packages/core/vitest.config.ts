import { defineConfig } from 'vitest/config';
import { sourceAliases } from '../../source-aliases.mjs';

export default defineConfig({
  resolve: { alias: sourceAliases },
  test: { environment: 'node' },
});
