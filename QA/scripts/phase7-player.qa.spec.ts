/**
 * Independent QA — Phase 7 player validation (frozen origin only).
 *
 *   NODE_PATH=/workspace/Builder/node_modules \
 *   QA_CANDIDATE_ID=cand-… QA_ARENA_URL=http://127.0.0.1:5274 \
 *   /workspace/Builder/node_modules/.bin/playwright test -c playwright.phase7.config.ts
 */

import { expect, test, type Page } from '@playwright/test';

const ARENA = process.env.QA_ARENA_URL ?? 'http://127.0.0.1:5274';
const CANDIDATE = process.env.QA_CANDIDATE_ID ?? 'cand-pending';

async function dismissIntro(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

test.describe('Phase 7 Independent QA — Gold Master release paths', () => {
  test('QA-P7-01: Safari is not claimed as certified on the landing matrix', async ({ page }) => {
    await page.goto(ARENA);
    await dismissIntro(page);
    await expect(page.getByTestId('candidate-id').first()).toHaveText(CANDIDATE);
    await expect(page.getByTestId('browser-support-safari')).toHaveAttribute(
      'data-support-status',
      'not_yet_certified',
    );
  });

  test('QA-P7-02: legal Terms V2 name Google Sign-In only', async ({ page }) => {
    await page.goto(`${ARENA}/legal/terms`);
    await expect(page.getByTestId('legal-version')).toHaveText('V2');
    await expect(page.locator('body')).toContainText('Google Sign-In only');
  });

  test('QA-P7-03: Gold Master package is NOT_DEPLOYED and strips development mint', async ({
    page,
  }) => {
    const response = await page.request.get(`${ARENA}/api/release/gold-master`);
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as {
      candidateId: string;
      launchProduction: string;
      strippedFromHostedArtifacts: string[];
    };
    expect(body.candidateId).toBe(CANDIDATE);
    expect(body.launchProduction).toBe('NOT_DEPLOYED');
    expect(body.strippedFromHostedArtifacts).toContain('development_identity_mint');
  });

  test('QA-P7-04: player can record legal acceptance after sign-in', async ({ page }) => {
    await page.goto(ARENA);
    await dismissIntro(page);
    await page.getByTestId('shell-enter-account').click();
    await expect(page.getByTestId('shell-account-link')).toBeVisible();
    await page.getByTestId('nav-account').click();
    await page.getByTestId('accept-legal--legal-privacy').click();
    await expect(page.getByTestId('legal-acceptance--legal-privacy')).toContainText('accepted');
  });
});
