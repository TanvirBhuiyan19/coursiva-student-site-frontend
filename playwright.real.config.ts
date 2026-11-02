import { defineConfig, devices } from '@playwright/test';

/**
 * Cross-surface checks on an already running real stack (Laravel or Go API + tenant dashboard + student site). Starts
 * nothing: point it at the running apps with env (see e2e-real/live-moderation.spec.ts). Never hard-codes hosts.
 */
export default defineConfig({
  testDir: './e2e-real',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
