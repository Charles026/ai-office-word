import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // 测试环境
    environment: 'node',
    
    // 全局 API
    globals: true,
    
    // 包含的测试文件
    include: [
      'src/**/__tests__/**/*.test.ts',
      'src/**/__tests__/**/*.test.tsx',
    ],
    
    // 排除
    exclude: [
      'node_modules',
      'dist',
      'dist-electron',
    ],
    
    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/document/**/*.ts',
        'src/docops/**/*.ts',
        'src/format/**/*.ts',
        'src/runtime/**/*.ts',
      ],
      exclude: [
        '**/__tests__/**',
        '**/types.ts',
        '**/index.ts',
      ],
    },
    
    // 超时
    testTimeout: 10000,
  },
  
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});

