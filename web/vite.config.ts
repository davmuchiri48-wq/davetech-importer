import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname),
  envDir: path.resolve(__dirname, '..'),
  plugins: [react()],
  build: { outDir: path.resolve(__dirname, '../dist/web'), emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: { proxy: { '/api': 'http://localhost:8080' } },
  css: { postcss: path.resolve(__dirname) },
});
