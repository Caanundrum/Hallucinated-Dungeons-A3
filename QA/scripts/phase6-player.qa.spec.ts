/**
 * Independent QA — Phase 6 player validation (frozen origin only).
 *
 *   NODE_PATH=/workspace/Builder/node_modules \
 *   QA_CANDIDATE_ID=cand-… QA_ARENA_URL=http://127.0.0.1:5274 \
 *   /workspace/Builder/node_modules/.bin/playwright test -c playwright.phase6.config.ts
 */

import { expect, test, type Page } from '@playwright/test';

const ARENA = process.env.QA_ARENA_URL ?? 'http://127.0.0.1:5274';
const CANDIDATE = process.env.QA_CANDIDATE_ID ?? 'cand-pending';

async function dismissIntro(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function signIn(page: Page): Promise<void> {
  await page.goto(ARENA);
  await dismissIntro(page);
  await expect(page.getByTestId('candidate-id').first()).toHaveText(CANDIDATE);
  await page.getByTestId('shell-enter-account').click();
  await expect(page.getByTestId('shell-account-link')).toBeVisible();
}

async function quickCharacter(page: Page, name: string): Promise<void> {
  await page.getByTestId('nav-characters').click();
  await page.getByTestId('start-character').click();
  const tutorialNo = page.getByTestId('tutorial-ask-no');
  if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();
  await page.getByTestId('open-quick-start').click();
  await page.getByTestId('option-studious-mage').click();
  await page.getByTestId('identity-name').fill(name);
  await page.getByTestId('identity-name').dispatchEvent('change');
  await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
  await page.getByTestId('create-character').click();
  await expect(page.getByTestId('character-sheet-heading')).toHaveText(name);
}

async function createEmberferry(page: Page, name: string): Promise<void> {
  await page.getByTestId('nav-campaigns').click();
  await page.getByTestId('start-campaign').click();
  await page.getByTestId('campaign-name').fill(name);
  await page.getByTestId('campaign-name').dispatchEvent('change');
  await page.getByTestId('identity-veyra').click();
  await page.getByTestId('personality-seasoned_host').click();
  await page.getByTestId('create-campaign-submit').click();
  await expect(page.getByTestId('campaign-detail-heading')).toHaveText(name);
}

test.describe('Phase 6 Independent QA — hardening player paths', () => {
  test('QA-P6-01: account deletion request is operable and honestly labeled', async ({ page }) => {
    await signIn(page);
    await page.getByTestId('nav-account').click();
    await expect(page.getByTestId('request-account-deletion')).toBeVisible();
    await page.getByTestId('request-account-deletion').click();
    await expect(page.getByTestId('account-deletion-status')).toContainText(/requested|pending|local/i);
  });

  test('QA-P6-02: reduced motion / low effects remain operable on the table', async ({ page }) => {
    await signIn(page);
    await quickCharacter(page, 'QA P6 A11y');
    await createEmberferry(page, 'QA P6 A11y Table');
    const seatSelect = page.getByTestId('seat-character-select');
    const characterId = await seatSelect.locator('option').nth(1).getAttribute('value');
    await seatSelect.selectOption(characterId!);
    await page.getByTestId('create-seat').click();
    await page.getByTestId('open-campaign-table').click();
    await page.getByTestId('table-reduced-motion').check();
    await expect(page.locator('html')).toHaveClass(/hd-reduced-motion/);
  });

  test('QA-P6-03: longitudinal chapter travel reaches Mist-Cut Caves on the table', async ({
    page,
  }) => {
    await signIn(page);
    await quickCharacter(page, 'QA P6 Long');
    await createEmberferry(page, 'QA P6 Long Table');
    await page.getByTestId('close-chapter').click();
    await expect(page.getByTestId('current-chapter')).toContainText(/Mist-Cut Caves/i);
    const seatSelect = page.getByTestId('seat-character-select');
    const characterId = await seatSelect.locator('option').nth(1).getAttribute('value');
    await seatSelect.selectOption(characterId!);
    await page.getByTestId('create-seat').click();
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('map-bundle-meta')).toContainText(/Mist-Cut Caves/i);
  });

  test('QA-P6-04: ordinary player is denied Admin kill switch', async ({ page }) => {
    await signIn(page);
    await page.goto(`${ARENA}/admin`);
    await expect(page.getByTestId('admin-is-admin')).toHaveText('No');
    await expect(page.getByTestId('admin-toggle-kill-switch')).toHaveCount(0);
  });
});
