import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

/**
 * Independent QA Playwright config for Phase 3.
 * Points at the frozen certification origin by default (5274).
 *
 * Run with Builder Playwright on PATH resolution:
 *   cd QA && NODE_PATH=/workspace/Builder/node_modules \
 *     QA_CANDIDATE_ID=cand-… QA_ARENA_URL=http://127.0.0.1:5274 \
 *     /workspace/Builder/node_modules/.bin/playwright test -c playwright.phase3.config.ts
 */

const qaRoot = path.resolve(__dirname);
const baseURL = process.env.QA_ARENA_URL ?? 'http://127.0.0.1:5274';
const outputRoot = process.env.QA_EVIDENCE_DIR ?? path.join(qaRoot, 'evidence/phase-3/ui');

export default defineConfig({
  testDir: path.join(qaRoot, 'scripts'),
  testMatch: 'phase3-player.qa.spec.ts',
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
