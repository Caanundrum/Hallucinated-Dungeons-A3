import { expect, test, type Page } from '@playwright/test';

import {enterAccountFromShell} from './arena-page.js';

/**
 * Phase 2 table accessibility / presentation preferences.
 */

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
  }
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await dismissIntroIfPresent(page);
  await enterAccountFromShell(page);
}

async function createQuickCharacter(page: Page, name: string): Promise<void> {
  await page.getByTestId('nav-characters').click();
  await expect(page.getByTestId('vault-heading')).toBeVisible();
  await page.getByTestId('start-character').click();
  await page.getByTestId('tutorial-ask-no').click();
  await page.getByTestId('open-quick-start').click();
  await page.getByTestId('option-stalwart-defender').click();
  await expect(page.getByTestId('active-step-heading')).toHaveText('Identity & Final Review');
  await page.getByTestId('identity-name').fill(name);
  await page.getByTestId('identity-name').dispatchEvent('change');
  await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
  await page.getByTestId('create-character').click();
  await expect(page.getByTestId('character-sheet-heading')).toHaveText(name);
}

async function createCampaign(page: Page, name: string): Promise<string> {
  await page.getByTestId('nav-campaigns').click();
  await page.getByTestId('start-campaign').click();
  await page.getByTestId('campaign-name').fill(name);
  await page.getByTestId('campaign-name').dispatchEvent('change');
  await page.getByTestId('identity-veyra').click();
  await page.getByTestId('personality-seasoned_host').click();
  await page.getByTestId('create-campaign-submit').click();
  await expect(page.getByTestId('campaign-detail-heading')).toHaveText(name);
  return page.url().split('/').pop()!;
}

async function seatOwnCharacter(page: Page): Promise<void> {
  const seatSelect = page.getByTestId('seat-character-select');
  const characterId = await seatSelect.locator('option').nth(1).getAttribute('value');
  expect(characterId).toBeTruthy();
  await seatSelect.selectOption(characterId!);
  await page.getByTestId('create-seat').click();
  await expect(page.getByTestId('own-seat')).toBeVisible();
}

test.describe('Phase 2 table a11y presentation', () => {
  test('reduced motion and low effects apply on the tactical table without voice UI', async ({
    page,
  }) => {
    await signIn(page);
    await createQuickCharacter(page, 'A11y Scout');
    await createCampaign(page, 'A11y Table');
    await seatOwnCharacter(page);
    await page.getByTestId('open-campaign-table').click();

    await expect(page.getByTestId('table-a11y-panel')).toBeVisible();
    await expect(page.getByTestId('table-presentation-meta')).toContainText('reduced motion off');
    await expect(page.getByTestId('table-presentation-meta')).toContainText('low effects off');
    await expect(page.getByTestId('table-presentation-meta')).toContainText('TTS off');
    await expect(page.getByTestId('table-presentation-meta')).toContainText('STT off');
    await expect(page.getByTestId('account-voice-select')).toHaveCount(0);

    await page.getByTestId('table-reduced-motion').check();
    await expect(page.locator('html')).toHaveClass(/hd-reduced-motion/);
    await expect(page.getByTestId('table-presentation-meta')).toContainText('reduced motion on');
    await expect(page.getByTestId('table-stage-slot')).toHaveClass(/table-stage-low-effects/);

    await page.getByTestId('table-low-effects').check();
    await expect(page.locator('html')).toHaveClass(/hd-low-effects/);
    await expect(page.getByTestId('table-presentation-meta')).toContainText('low effects on');

    await page.reload();
    await dismissIntroIfPresent(page);
    await expect(page.getByTestId('table-reduced-motion')).toBeChecked();
    await expect(page.getByTestId('table-low-effects')).toBeChecked();
    await expect(page.locator('html')).toHaveClass(/hd-reduced-motion/);
    await expect(page.locator('html')).toHaveClass(/hd-low-effects/);
    await expect(page.getByTestId('table-stage-slot')).toHaveClass(/table-stage-low-effects/);
  });
});
