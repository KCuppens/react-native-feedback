// Copy the built dashboard and public board into the worker's static assets dir.
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const out = new URL('../apps/worker/assets/', import.meta.url);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(new URL('../apps/dashboard/dist/', import.meta.url), new URL('admin/', out), { recursive: true });
cpSync(new URL('../apps/public-board/dist/', import.meta.url), new URL('p/', out), { recursive: true });
console.log('Assets collected in apps/worker/assets');
