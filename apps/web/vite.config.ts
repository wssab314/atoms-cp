import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4010',
        changeOrigin: true
      },
      '/preview': {
        target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4010',
        changeOrigin: true
      }
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true
  }
});
