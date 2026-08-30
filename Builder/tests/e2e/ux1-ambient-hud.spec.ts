import { expect, test, type Page } from '@playwright/test';

import { enterAccountFromShell, joinTableWithFirstCharacter } from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function seatAndOpenTable(page: Page, name: string): Promise<void> {
  await page.getByTestId('nav-characters').click();
  await page.getByTestId('start-character').click();
  const tutorialNo = page.getByTestId('tutorial-ask-no');
  if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();
  await page.getByTestId('open-quick-start').click();
  await page.getByTestId('option-stalwart-defender').click();
  await page.getByTestId('identity-name').fill(name);
  await page.getByTestId('identity-name').dispatchEvent('change');
  await page.getByTestId('create-character').click();
  await page.getByTestId('nav-campaigns').click();
  await page.getByTestId('start-campaign').click();
  await page.getByTestId('campaign-name').fill(`${name} Camp`);
  await page.getByTestId('campaign-name').dispatchEvent('change');
  await page.getByTestId('identity-garrick').click();
  await page.getByTestId('personality-seasoned_host').click();
  await page.getByTestId('create-campaign-submit').click();
  await expect(page.getByTestId('join-table-heading')).toBeVisible();
  const match = page.url().match(/\/campaigns\/([A-Za-z0-9-]+)\/join/);
  expect(match).toBeTruthy();
  await joinTableWithFirstCharacter(page);
  await page.goto(`/campaigns/${match![1]}`);
  await expect(page.getByTestId('own-seat')).toBeVisible();
  await page.getByTestId('open-campaign-table').click();
  await expect(page.getByTestId('campaign-table-heading')).toBeVisible();
}

test.describe('UX-1 ambient HUD cockpit', () => {
  test('table session uses ambient HUD and locks desktop viewport scroll', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatAndOpenTable(page, 'CockpitHud');

    const root = page.locator('#app');
    await expect(root).toHaveClass(/shell-table-mode/);
    await expect(page.locator('.shell-header')).toBeHidden();
    await expect(page.locator('.shell-footer')).toBeHidden();

    await expect(page.getByTestId('table-ambient-hud')).toBeVisible();
    await expect(page.getByTestId('table-hud-home')).toBeVisible();
    await expect(page.getByTestId('campaign-table-heading')).toBeVisible();
    await expect(page.getByTestId('map-scene-banner')).toBeVisible();
    await expect(page.getByTestId('table-settings')).toBeVisible();
    await expect(page.getByTestId('table-back')).toContainText(/Exit table/i);

    const scrollMetrics = await page.evaluate(() => ({
      docScrollHeight: document.documentElement.scrollHeight,
      docClientHeight: document.documentElement.clientHeight,
      bodyScrollHeight: document.body.scrollHeight,
      windowScrollY: window.scrollY,
    }));
    expect(scrollMetrics.docScrollHeight).toBeLessThanOrEqual(scrollMetrics.docClientHeight + 2);

    await page.screenshot({ path: '/opt/cursor/artifacts/ux1-cockpit-hud-1440.png' });

    // Exit restores global chrome.
    await page.getByTestId('table-back').click();
    await expect(root).not.toHaveClass(/shell-table-mode/);
    await expect(page.locator('.shell-header')).toBeVisible();
  });
});
