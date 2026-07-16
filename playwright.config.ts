import { defineConfig, devices } from '@playwright/test';

// QA E2E (Actualización 5). NO forma parte del build de producción (devDependency).
// baseURL configurable: por defecto el sitio desplegado; se puede apuntar a local
// (http://localhost:4200) con QA_BASE_URL. Credenciales QA en qa/qa-users.local.json
// (gitignoreado). Headless, screenshots + trace en fallo.
export default defineConfig({
  testDir: './qa/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'qa/report' }]],
  use: {
    baseURL: process.env['QA_BASE_URL'] || 'https://sgcconstructorasd.com',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
