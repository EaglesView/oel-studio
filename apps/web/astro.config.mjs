import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  output: 'static',
  integrations: [react()],
  vite: {
    worker: { format: 'es' },
    // Workspace packages ship TypeScript source; let Vite transform them.
    ssr: { noExternal: ['@oel/emboss', '@oel/desk', '@oel/engine'] },
  },
});
