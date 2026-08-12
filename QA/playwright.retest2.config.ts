/**
 * Independent QA Playwright configuration for retest pass 2 of Phase 0
 * candidate cand-32058f47eda8.
 *
 * Output paths are namespaced to this pass so the earlier passes' artifacts
 * stay intact. The candidate is already running and frozen, so there is no
 * webServer block.
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '/workspace/QA/scripts',
  testMatch: /.*\.qa\.spec\.ts$/,
  outputDir: '/workspace/QA/results/retest2-cand-32058f47eda8/test-output',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: '/workspace/QA/results/retest2-cand-32058f47eda8/qa-browser-results.json' }],
    [
      'html',
      { outputFolder: '/workspace/QA/results/retest2-cand-32058f47eda8/html-report', open: 'never' },
    ],
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
