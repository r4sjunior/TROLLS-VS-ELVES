import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  server: { proxy: { '/ws': { target: 'ws://localhost:3000', ws: true }, '/api': 'http://localhost:3000' } },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1200 },
});
