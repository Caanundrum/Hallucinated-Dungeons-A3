import { defineConfig, devices } from '@playwright/test';

/**
 * Actual-page test configuration.
 *
 * Blueprint ownership: Sections 1.11.12 (Builder uses the rendered page),
 * 26.5 (browser journeys assert visible behavior), and 1.12.7 (certification
 * runs record structured results).
 *
 * The arena is started by the orchestrator, not by Playwright, so a
 * certification run always tests the frozen runtime it was handed rather than
 * a convenience server started by the test framework.
 */
const baseURL = process.env.HD_E2E_BASE_URL ?? 'http://127.0.0.1:5173';
const outputRoot = process.env.HD_E2E_OUTPUT_DIR ?? 'test-results';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: `${outputRoot}/artifacts`,
  reporter: [
    ['list'],
    ['json', { outputFile: `${outputRoot}/results.json` }],
    ['html', { outputFolder: `${outputRoot}/html`, open: 'never' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader-webgl',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
