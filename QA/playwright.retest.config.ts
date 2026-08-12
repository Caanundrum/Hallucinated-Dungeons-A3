/**
 * Independent QA Playwright configuration for the retest of Phase 0
 * candidate cand-882c6c2fe4a3.
 *
 * Identical to the original-pass config except that every output path is
 * namespaced to the retest, so the first pass's artifacts stay intact and a
 * reader can tell which candidate produced which evidence. The candidate under
 * test is already running and frozen, so there is no webServer block.
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '/workspace/QA/scripts',
  testMatch: /.*\.qa\.spec\.ts$/,
  outputDir: '/workspace/QA/results/retest-cand-882c6c2fe4a3/test-output',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    [
      'json',
      { outputFile: '/workspace/QA/results/retest-cand-882c6c2fe4a3/qa-browser-results.json' },
    ],
    [
      'html',
      {
        outputFolder: '/workspace/QA/results/retest-cand-882c6c2fe4a3/html-report',
        open: 'never',
      },
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
