import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: process.env.ZPC_BASE_PATH || './',
  build: {
    outDir: process.env.APPDEPLOY_VITE_OUT_DIR || 'dist',
    sourcemap:
      process.env.APPDEPLOY_VITE_SOURCEMAP === 'hidden' ? 'hidden' : false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        visualAudit: resolve(__dirname, 'visual-audit.html'),
      },
      maxParallelFileOps: 128,
    },
  },
});
