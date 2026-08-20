import { expect, test, type Page } from '@playwright/test';

import {enterAccountFromShell} from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
  }
}

test.describe('Phase 7 Gold Master release packaging', () => {
  test('home states certified browsers honestly, including Safari not yet certified', async ({
    page,
  }) => {
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await expect(page.getByTestId('browser-support-matrix')).toBeVisible();
    await expect(page.getByTestId('browser-support-safari')).toHaveAttribute(
      'data-support-status',
      'not_yet_certified',
    );
    await expect(page.getByTestId('browser-support-tablet')).toHaveAttribute(
      'data-support-status',
      'not_yet_certified',
    );
    await expect(page.getByTestId('public-surface')).toHaveText('local_arena');
  });

  test('legal V2 documents name Google hosted identity and Local Arena-only development identities', async ({
    page,
  }) => {
    const response = await page.goto('/legal/terms');
    expect(response?.ok()).toBeTruthy();
    await expect(page.getByTestId('legal-version')).toHaveText('V2');
    await expect(page.locator('body')).toContainText('Google Sign-In only');
    await expect(page.locator('body')).toContainText('stripped from Gold Master');
  });

  test('QA harness is available on this Local Arena surface and Gold Master package is NOT_DEPLOYED', async ({
    page,
  }) => {
    const harness = await page.request.get('/api/qa/harness');
    expect(harness.ok()).toBeTruthy();
    const harnessBody = (await harness.json()) as { available: boolean; publicSurface: string };
    expect(harnessBody.available).toBe(true);
    expect(harnessBody.publicSurface).toBe('local_arena');

    const pack = await page.request.get('/api/release/gold-master');
    expect(pack.ok()).toBeTruthy();
    const body = (await pack.json()) as {
      launchProduction: string;
      productOwnerAuthorization: string;
      strippedFromHostedArtifacts: string[];
      eligibilityPolicy: { status: string };
    };
    expect(body.launchProduction).toBe('NOT_DEPLOYED');
    expect(body.productOwnerAuthorization).toBe('NOT_GRANTED');
    expect(body.eligibilityPolicy.status).toBe('inactive');
    expect(body.strippedFromHostedArtifacts).toContain('development_identity_mint');
    expect(body.strippedFromHostedArtifacts).toContain('qa_progression_harness');
  });

  test('signed-in player can record legal acceptance of current V2 documents', async ({ page }) => {
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await page.getByTestId('nav-account').click();
    await expect(page.getByTestId('legal-acceptance-list')).toBeVisible();
    await expect(page.getByTestId('gold-master-status')).toContainText('NOT_DEPLOYED');
    await page.getByTestId('accept-legal--legal-terms').click();
    await expect(page.getByTestId('legal-acceptance--legal-terms')).toContainText('accepted');
  });

  test('Google emulator sign-in projects google_sign_in identity mode', async ({ page }) => {
    await page.goto('/account');
    await dismissIntroIfPresent(page);
    await expect(page.getByTestId('account-google-emulator-enter')).toBeVisible();
    await page.getByTestId('account-google-email').fill('phase7-player@example.com');
    await page.getByTestId('account-google-emulator-enter').click();
    await expect(page.getByTestId('account-identity-mode')).toHaveText('google_sign_in');
    await expect(page.getByTestId('account-email')).toHaveText('phase7-player@example.com');
  });
});
