import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { config } = require('./config');
const backendTarget = `http://localhost:${config.port}`;

export default defineConfig({
  root: path.resolve('client'),
  plugins: [react()],
  publicDir: false,
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': backendTarget,
      '/videos': backendTarget
    }
  },
  build: {
    outDir: config.publicDir,
    emptyOutDir: true,
    assetsDir: 'assets'
  }
});
