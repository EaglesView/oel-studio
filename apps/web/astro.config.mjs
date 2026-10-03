import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  output: 'static',
  integrations: [react()],
  vite: {
    worker: { format: 'es' },
    // The oeldocx-rs WASM package lives in the sibling repo (file: dependency).
    server: { fs: { allow: [fileURLToPath(new URL('../..', import.meta.url)), fileURLToPath(new URL('../../../oeldocx_rs', import.meta.url))] } },
    // Workspace packages ship TypeScript source; let Vite transform them.
    ssr: { noExternal: ['@oel/emboss', '@oel/desk', '@oel/engine', '@oel/docs', '@oel/forms'] },
  },
});
