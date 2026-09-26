import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'mock-api/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    coverage: { provider: 'v8', include: ['src/lib/**', 'src/features/**/*.ts', 'mock-api/**'], exclude: ['**/*.test.*'] },
  },
});
