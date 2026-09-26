import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a production build (`next build && next start`) and the mock API, on their own ports
 * so they never collide with `npm run dev`. Tenants are addressed by host: *.localhost resolves to loopback in Chromium.
 */
const WEB_PORT = 3100;
const API_PORT = 8797;
const env = {
  API_URL: `http://127.0.0.1:${API_PORT}`,
  API_SERVICE_TOKEN: 'dev-service-token',
  PLATFORM_ROOT_DOMAIN: 'localhost',
  REVALIDATE_SECRET: 'dev-revalidate-secret',
  NOINDEX_HOSTS: '',
  DEV_DEFAULT_TENANT: 'amplify',
  PORT: String(WEB_PORT),
  MOCK_API_PORT: String(API_PORT),
};

export const tenantUrl = (tenant: string, path = '/') => `http://${tenant}.localhost:${WEB_PORT}${path}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: tenantUrl('amplify'), trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npx tsx mock-api/server.ts',
      url: `http://127.0.0.1:${API_PORT}/platform/v1/domains/resolve?host=x`,
      env,
      reuseExistingServer: !process.env.CI,
      ignoreHTTPSErrors: true,
    },
    {
      // Start from an empty Data Cache so every run sees the current seed.
      command: `node -e "require('fs').rmSync('.next/cache',{recursive:true,force:true})" && npx next build && npx next start -p ${WEB_PORT}`,
      url: `http://127.0.0.1:${WEB_PORT}/hooks/health`,
      env,
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
