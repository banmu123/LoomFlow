import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@desktop': path.resolve(__dirname, 'src'),
      '@': path.resolve(__dirname, '../src'),
    },
  },
});
