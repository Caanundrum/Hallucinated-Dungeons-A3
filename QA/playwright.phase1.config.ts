import { defineConfig, devices } from '@playwright/test';

/**
 * Independent QA Playwright config for Phase 1.
 * Points at the frozen certification origin by default (5274).
 */

const baseURL = process.env.QA_ARENA_URL ?? 'http://127.0.0.1:5274';
const outputRoot = process.env.QA_EVIDENCE_DIR ?? 'results/phase-1';

export default defineConfig({
  testDir: 'scripts',
  testMatch: 'phase1-player.qa.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: `${outputRoot}/artifacts`,
  reporter: [
    ['list'],
    ['json', { outputFile: `${outputRoot}/results.json` }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
