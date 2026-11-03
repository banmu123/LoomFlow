import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // JWT 测试需要 AUTH_SECRET（模块加载时读取，须在测试前注入）
    env: {
      AUTH_SECRET: 'test-secret-for-unit-tests',
      // 单测显式使用 legacy vm 后端（容器后端由 sandbox 相关测试单独覆盖；
      // 生产默认是 container，见 src/lib/sandbox/config.ts）
      LOOMFLOW_CODE_SANDBOX: 'vm',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
