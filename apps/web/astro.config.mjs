import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  output: 'static',
  integrations: [react()],
  vite: {
    worker: { format: 'es' },
    // Workspace root: the WASM engines are built into packages/wasm (npm run build:wasm).
    server: { fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
    // Workspace packages ship TypeScript source; let Vite transform them.
    ssr: { noExternal: ['@oel/emboss', '@oel/desk', '@oel/engine', '@oel/docs', '@oel/forms', '@oel/sheets', '@oel/collab-client'] },
  },
});
