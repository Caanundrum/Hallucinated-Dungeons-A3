import { expect, test, type Page } from '@playwright/test';

import { recordDefaultSessionZero,  enterAccountFromShell } from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

test.describe('PQA residual regressions', () => {
  test('PQA-061: switching ability method uses an in-app confirm dialog', async ({ page }) => {
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await page.getByTestId('nav-characters').click();
    await page.getByTestId('start-character').click();
    const tutorialNo = page.getByTestId('tutorial-ask-no');
    if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();
    await page.getByTestId('open-quick-start').click();
    await page.getByTestId('option-stalwart-defender').click();
    await expect(page.getByTestId('active-step-heading')).toHaveText('Identity & Final Review');
    await page.getByTestId('step-abilities').click();
    await expect(page.getByTestId('ability-method-options')).toBeVisible();
    await page.locator('input[name="ability-method"][value="point-buy"]').check();
    await expect(page.getByTestId('confirm-ability-method')).toBeVisible();
    await expect(page.getByTestId('confirm-ability-method')).toContainText(
      /clears your current score assignments/i,
    );
    await page.getByTestId('confirm-ability-method-cancel').click();
    await expect(page.getByTestId('confirm-ability-method')).toHaveCount(0);
    await page.locator('input[name="ability-method"][value="point-buy"]').check();
    await page.getByTestId('confirm-ability-method-confirm').click();
    await expect(page.getByTestId('confirm-ability-method')).toHaveCount(0);
    await expect(page.locator('input[name="ability-method"][value="point-buy"]')).toBeChecked();
  });

  test('PQA-012/013/014: chronicle, director, and rules copy stay player-facing', async ({
    page,
  }) => {
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await page.getByTestId('nav-characters').click();
    await page.getByTestId('start-character').click();
    const tutorialNo = page.getByTestId('tutorial-ask-no');
    if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();
    await page.getByTestId('open-quick-start').click();
    await page.getByTestId('option-studious-mage').click();
    await page.getByTestId('identity-name').fill('Copy Scout');
    await page.getByTestId('identity-name').dispatchEvent('change');
    await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
    await page.getByTestId('create-character').click();
    await page.getByTestId('nav-campaigns').click();
    await page.getByTestId('start-campaign').click();
    await page.getByTestId('campaign-name').fill('Copy Scout Camp');
    await page.getByTestId('campaign-name').dispatchEvent('change');
    await page.getByTestId('identity-veyra').click();
    await page.getByTestId('personality-seasoned_host').click();
    await page.getByTestId('create-campaign-submit').click();
    const seatSelect = page.getByTestId('seat-character-select');
    const characterId = await seatSelect.locator('option').nth(1).getAttribute('value');
    await recordDefaultSessionZero(page);
    await seatSelect.selectOption(characterId!);
    await page.getByTestId('create-seat').click();
    await page.getByTestId('open-campaign-table').click();
    await page.getByTestId('dock-tab-director_address').click();
    await expect(page.getByTestId('dock-tab-director_address')).toContainText('Ask the Director');
    await page.getByTestId('dock-tab-rules_desk').click();
    await expect(page.getByTestId('rules-catalog-meta')).toHaveText('SRD 5.2.1 reference');
    await expect(page.getByTestId('rules-catalog-meta')).not.toContainText('srd-5.2.1');
    await page.getByTestId('open-rules-modal').click();
    await expect(page.getByTestId('rules-search-modal')).toBeVisible();
    await page.getByTestId('rules-catalog-category').selectOption('core_mechanics');
    await page.getByTestId('rules-catalog-entry').filter({ hasText: 'XP-only Progression' }).click();
    await expect(page.getByTestId('rules-explanation')).toContainText(/Game Director awards XP/i);
    await expect(page.getByTestId('rules-explanation')).not.toContainText('server-validated');
    const explanationText = await page.getByTestId('rules-explanation').innerText();
    expect(explanationText).not.toMatch(/XP\.Each|slots\.Single/);
    await page.getByTestId('close-rules-modal').click();
    await page.getByTestId('chronicle-kind-filter').selectOption('all');
    await page.getByTestId('dock-tab-chronicle').click();
    await expect(page.getByTestId('chronicle-entry').first()).toContainText('Campaign created');
    await expect(page.getByTestId('chronicle-entry').first()).not.toContainText('campaign_created');
  });
});
