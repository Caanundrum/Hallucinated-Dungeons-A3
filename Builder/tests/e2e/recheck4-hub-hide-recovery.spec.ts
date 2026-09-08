import { expect, test, type Page } from '@playwright/test';

import { acceptAllLegalForPlay, enterAccountFromShell } from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

test.describe('Recheck 4 hub hide recovery', () => {
  test('Hide updates counts and Show/Restore recovers the card', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await acceptAllLegalForPlay(page);

    await page.getByTestId('nav-characters').click();
    await page.getByTestId('start-character').click();
    const tutorialNo = page.getByTestId('tutorial-ask-no');
    if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();
    await page.getByTestId('open-quick-start').click();
    await page.getByTestId('option-stalwart-defender').click();
    const name = `HideRec${Date.now().toString().slice(-6)}`;
    await page.getByTestId('identity-name').fill(name);
    await page.getByTestId('identity-name').dispatchEvent('change');
    await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
    await page.getByTestId('create-character').click();

    await page.getByTestId('nav-campaigns').click();
    await page.getByTestId('start-campaign').click();
    const tableName = `Hide Table ${Date.now()}`;
    await page.getByTestId('campaign-name').fill(tableName);
    await page.getByTestId('campaign-name').dispatchEvent('change');
    await page.getByTestId('identity-garrick').click();
    await page.getByTestId('personality-seasoned_host').click();
    await page.getByTestId('create-campaign-submit').click();
    await expect(page.getByTestId('join-table-heading')).toBeVisible();

    await page.getByTestId('nav-campaigns').click();
    await expect(page.getByTestId('campaigns-heading')).toBeVisible();
    await page.getByTestId('tables-tab-mine').click();
    await expect(page.getByTestId('campaign-list-owned')).toContainText(tableName);
    const before = await page.getByTestId('tables-filter-summary').innerText();
    const beforeMatch = /Showing (\d+) of (\d+)/.exec(before);
    expect(beforeMatch).toBeTruthy();
    const beforeShown = Number(beforeMatch![1]);
    const beforeTotal = Number(beforeMatch![2]);
    expect(beforeShown).toBe(beforeTotal);

    await page
      .getByTestId('campaign-list-owned')
      .locator('[data-testid="campaign-item"]')
      .filter({ hasText: tableName })
      .getByTestId('hide-table')
      .click();

    await expect(page.getByTestId('tables-filter-summary')).toContainText(/hidden.*omitted from this list/i);
    const after = await page.getByTestId('tables-filter-summary').innerText();
    const afterMatch = /Showing (\d+) of (\d+)/.exec(after);
    expect(afterMatch).toBeTruthy();
    expect(Number(afterMatch![1])).toBe(beforeShown - 1);
    expect(Number(afterMatch![2])).toBe(beforeTotal - 1);
    // Sole owned table hidden → empty hub (no owned list / no name cards).
    await expect(page.getByTestId('campaign-list-owned')).toHaveCount(0);
    await expect(page.getByTestId('campaign-list-name')).toHaveCount(0);
    await expect(page.getByTestId('campaigns-empty')).toBeVisible();
    await expect(page.getByTestId('tables-toggle-hidden')).toBeVisible();
    await expect(page.getByTestId('tables-clear-hidden')).toBeVisible();

    await page.getByTestId('campaigns-search').fill(tableName);
    await page.getByTestId('campaigns-search').dispatchEvent('input');
    await expect(page.getByTestId('tables-filter-summary')).toContainText(/Showing 0 of/i);
    await page.getByTestId('campaigns-search').fill('');
    await page.getByTestId('campaigns-search').dispatchEvent('input');

    await page.getByTestId('tables-toggle-hidden').click();
    await expect(page.getByTestId('tables-filter-summary')).toContainText(/hidden.*included below/i);
    await expect(page.getByTestId('campaign-list-owned')).toContainText(tableName);
    await page
      .getByTestId('campaign-list-owned')
      .locator('[data-testid="campaign-item"]')
      .filter({ hasText: tableName })
      .getByTestId('unhide-table')
      .click();
    await expect(page.getByTestId('campaign-list-owned')).toContainText(tableName);
    await expect(page.getByTestId('tables-filter-summary')).not.toContainText(/omitted from this list/i);
    await expect(page.getByTestId('tables-filter-summary')).not.toContainText(/hidden/i);
    await page.screenshot({
      path: '/opt/cursor/artifacts/recheck4_hub_hide_recovery.png',
      fullPage: false,
    });
  });
});
