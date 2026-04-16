import { defineConfig } from '@playwright/test'

export default defineConfig({
  testMatch: ['e2e.spec.ts', 'e2e-*.spec.ts', 'test-*.spec.ts', 'debug-*.spec.ts'],
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
  },
  workers: 1,
  reporter: 'list',
})
