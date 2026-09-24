import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { sourceAliases } from '../../source-aliases.mjs';

// Served by the worker at /admin/. In dev, API calls proxy to `wrangler dev`.
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  resolve: { alias: sourceAliases },
  server: { port: 5174, proxy: { '/v1': 'http://localhost:8787' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
