import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Pages serves this repo from a subpath, so assets must be requested relative to it.
// `buildLink()` derives invite links from location.pathname, so they follow automatically.
export default defineConfig({
  base: '/one-page-baby-monitor/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4173 },
});
