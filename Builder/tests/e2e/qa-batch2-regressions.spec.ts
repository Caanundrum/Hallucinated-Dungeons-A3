import { expect, test, type Page } from '@playwright/test';

import { enterAccountFromShell, openTableAdvancedControls } from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function seatFreshCampaign(page: Page, name: string): Promise<void> {
  await page.getByTestId('nav-characters').click();
  await page.getByTestId('start-character').click();
  const tutorialNo = page.getByTestId('tutorial-ask-no');
  if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();
  await page.getByTestId('open-quick-start').click();
  await page.getByTestId('option-stalwart-defender').click();
  await page.getByTestId('identity-name').fill(name);
  await page.getByTestId('identity-name').dispatchEvent('change');
  await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
  await page.getByTestId('create-character').click();
  await page.getByTestId('nav-campaigns').click();
  await page.getByTestId('start-campaign').click();
  await page.getByTestId('campaign-name').fill(`${name} Camp`);
  await page.getByTestId('campaign-name').dispatchEvent('change');
  await page.getByTestId('identity-veyra').click();
  await page.getByTestId('personality-seasoned_host').click();
  await page.getByTestId('create-campaign-submit').click();
  await expect(page.getByTestId('campaign-detail-heading')).not.toHaveText('Campaign unavailable');
  await expect(page.getByTestId('campaign-detail-heading')).toContainText(`${name} Camp`);
  const seatSelect = page.getByTestId('seat-character-select');
  const characterId = await seatSelect.locator('option').nth(1).getAttribute('value');
  await seatSelect.selectOption(characterId!);
  await page.getByTestId('create-seat').click();
  await expect(page.getByTestId('own-seat')).toBeVisible();
  await expect(page.getByTestId('leave-seat')).toBeVisible();
}

test.describe('PQA batch 2 regressions', () => {
  test('PQA-062/063/064: campaign detail loads without ID leak and can leave seat', async ({
    page,
  }) => {
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatFreshCampaign(page, 'Batch2 Seat');
    await expect(page.getByTestId('seat-item').first()).not.toContainText(/Seat [0-9a-f]{8}/i);
    await expect(page.getByTestId('seat-item').first()).not.toContainText('event sequence');
    await page.getByTestId('leave-seat').click();
    await page.getByTestId('confirm-dialog-confirm').click();
    await expect(page.getByTestId('create-seat')).toBeVisible();
  });

  test('PQA-065/066/073/074/075: combat UI and out-of-combat gates', async ({ page }) => {
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatFreshCampaign(page, 'Batch2 Combat');
    await page.getByTestId('open-campaign-table').click();
    await openTableAdvancedControls(page);
    await page.getByTestId('begin-encounter').click();
    await page.getByTestId('roll-initiative').click();
    await expect(page.getByTestId('encounter-meta')).not.toContainText('active · round');
    await expect(page.getByTestId('timing-authority-meta')).not.toContainText(
      'credential active · expires',
    );
    await expect(page.getByTestId('rules-short-rest')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('rules-long-rest')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('rules-award-xp')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('rules-level-up')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('own-combatant-inventory')).toContainText(/Potion/i);
  });

  test('PQA-105: blank table does not advertise Emberferry chamber art', async ({ page }) => {
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await page.getByTestId('nav-campaigns').click();
    await page.getByTestId('start-campaign').click();
    await page.getByTestId('campaign-name').fill('Blank Arena Batch2');
    await page.getByTestId('campaign-name').dispatchEvent('change');
    await page.getByTestId('adventure-template-blank').click();
    await page.getByTestId('identity-veyra').click();
    await page.getByTestId('personality-seasoned_host').click();
    await page.getByTestId('create-campaign-submit').click();
    await expect(page.getByTestId('chapter-travel-hint')).not.toContainText('Mist Dock');
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('map-scene-banner')).toContainText(/empty table/i);
    await expect(page.locator('body')).not.toContainText('Local starter chamber');
  });
});
