import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const qaRoot = path.resolve(__dirname);
const baseURL = process.env.QA_ARENA_URL ?? 'http://127.0.0.1:5274';
const outputRoot = process.env.QA_EVIDENCE_DIR ?? path.join(qaRoot, 'evidence/phase-5/ui');

export default defineConfig({
  testDir: path.join(qaRoot, 'scripts'),
  testMatch: 'phase5-player.qa.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
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
