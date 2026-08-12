/**
 * Independent QA Playwright configuration for Phase 0 candidate
 * cand-0f810c6c26d8.
 *
 * Every path this config produces stays inside QA Root. The candidate under
 * test is already running and frozen, so there is deliberately no webServer
 * block: this config attaches to the running stack and never starts, rebuilds,
 * or stops it.
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '/workspace/QA/scripts',
  testMatch: /.*\.qa\.spec\.ts$/,
  outputDir: '/workspace/QA/results/test-output',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: '/workspace/QA/results/qa-browser-results.json' }],
    ['html', { outputFolder: '/workspace/QA/results/html-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:5274',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
