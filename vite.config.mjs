import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve('client'),
  plugins: [react()],
  publicDir: false,
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/videos': 'http://localhost:3001'
    }
  },
  build: {
    outDir: path.resolve('public'),
    emptyOutDir: true,
    assetsDir: 'assets'
  }
});
