import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const qaRoot = path.resolve(__dirname);
const baseURL = process.env.QA_ARENA_URL ?? 'http://127.0.0.1:5274';
const outputRoot = process.env.QA_EVIDENCE_DIR ?? path.join(qaRoot, 'evidence/phase-3/playtest');

export default defineConfig({
  testDir: path.join(qaRoot, 'scripts'),
  testMatch: 'phase3-playtest.qa.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 25_000 },
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
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    // Emulated viewports on Chromium — not real Safari/iPadOS or Android (those remain Phase 6/7).
    {
      name: 'tablet-viewport',
      use: { ...devices['Desktop Chrome'], viewport: { width: 834, height: 1194 } },
    },
    {
      name: 'phone-viewport',
      use: { ...devices['Desktop Chrome'], viewport: { width: 412, height: 915 } },
    },
  ],
});
