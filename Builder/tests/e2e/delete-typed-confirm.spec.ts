import { expect, test, type Page } from '@playwright/test';

import { enterAccountFromShell, joinTableWithFirstCharacter } from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function createCharacter(page: Page, name: string): Promise<void> {
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
}

async function createCampaign(page: Page, name: string): Promise<string> {
  await page.getByTestId('nav-campaigns').click();
  await page.getByTestId('start-campaign').click();
  await page.getByTestId('campaign-name').fill(name);
  await page.getByTestId('campaign-name').dispatchEvent('change');
  await page.getByTestId('identity-veyra').click();
  await page.getByTestId('personality-seasoned_host').click();
  await page.getByTestId('create-campaign-submit').click();
  await expect(page.getByTestId('join-table-heading')).toBeVisible({ timeout: 20_000 });
  const match = page.url().match(/\/campaigns\/([A-Za-z0-9-]+)\/join/);
  expect(match).toBeTruthy();
  return match![1]!;
}

test.describe('Typed-name destructive deletes', () => {
  test('character delete requires typing the character name', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await createCharacter(page, 'Typed Delete Mage');
    await page.getByTestId('nav-characters').click();
    await page.getByRole('link', { name: /Typed Delete Mage/i }).click();
    await expect(page.getByTestId('character-sheet-heading')).toBeVisible();
    await page.getByTestId('delete-character').click();
    const dialog = page.getByTestId('confirm-delete-character');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('confirm-delete-character-confirm')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await dialog.getByTestId('confirm-delete-character-typed-phrase').fill('wrong name');
    await expect(dialog.getByTestId('confirm-delete-character-confirm')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await dialog.getByTestId('confirm-delete-character-typed-phrase').fill('Typed Delete Mage');
    await expect(dialog.getByTestId('confirm-delete-character-confirm')).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    await dialog.getByTestId('confirm-delete-character-confirm').click();
    await expect(page.getByTestId('vault-heading')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('link', { name: /Typed Delete Mage/i })).toHaveCount(0);
  });

  test('campaign delete requires typing the campaign name', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await createCharacter(page, 'Campaign Delete Scout');
    const campaignId = await createCampaign(page, 'Typed Delete Camp');
    await joinTableWithFirstCharacter(page);
    await page.goto(`/campaigns/${campaignId}`);
    await expect(page.getByTestId('campaign-detail-heading')).toBeVisible();
    await page.getByTestId('delete-campaign').click();
    const dialog = page.getByTestId('confirm-delete-campaign');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('confirm-delete-campaign-confirm')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await dialog.getByTestId('confirm-delete-campaign-typed-phrase').fill('Typed Delete Camp');
    await expect(dialog.getByTestId('confirm-delete-campaign-confirm')).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    await dialog.getByTestId('confirm-delete-campaign-confirm').click();
    await expect(page.getByTestId('campaigns-heading').or(page.getByTestId('tables-heading'))).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('Typed Delete Camp')).toHaveCount(0);
  });
});
