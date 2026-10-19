import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    proxy: { '/api/runtime': { target: 'http://127.0.0.1:4181', changeOrigin: true } },
  },
  preview: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true,
    proxy: { '/api/runtime': { target: 'http://127.0.0.1:4181', changeOrigin: true } },
  },
  test: { include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'] },
});
