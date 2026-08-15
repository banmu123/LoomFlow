import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // JWT 测试需要 AUTH_SECRET（模块加载时读取，须在测试前注入）
    env: {
      AUTH_SECRET: 'test-secret-for-unit-tests',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
