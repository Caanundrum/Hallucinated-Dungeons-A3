import { expect, test, type Page } from '@playwright/test';

import { enterAccountFromShell, joinTableWithFirstCharacter } from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

test.describe('Phase 2 polish: halos, dice SFX gate, painted directors', () => {
  test('create flow shows painted Veyra/Garrick portraits', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await page.getByTestId('nav-campaigns').click();
    await page.getByTestId('start-campaign').click();

    await expect(page.getByTestId('identity-avatar-veyra')).toBeVisible();
    await expect(page.getByTestId('identity-avatar-garrick')).toBeVisible();
    await expect(page.getByTestId('identity-avatar-veyra')).toHaveAttribute('src', /veyra-painted/);
    await expect(page.getByTestId('identity-avatar-garrick')).toHaveAttribute(
      'src',
      /garrick-painted/,
    );

    await page.getByTestId('identity-garrick').click();
    await page.getByTestId('personality-seasoned_host').click();
    await expect(page.getByTestId('preview-director-avatar')).toBeVisible();
    await expect(page.getByTestId('preview-director-avatar')).toHaveAttribute(
      'src',
      /garrick-painted/,
    );

    await page.screenshot({ path: '/opt/cursor/artifacts/phase2-director-portraits-create.png' });
  });

  test('table tokens expose hover halo target and dice tray still rolls', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);

    await page.getByTestId('nav-characters').click();
    await page.getByTestId('start-character').click();
    const tutorialNo = page.getByTestId('tutorial-ask-no');
    if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();
    await page.getByTestId('open-quick-start').click();
    await page.getByTestId('option-stalwart-defender').click();
    await page.getByTestId('identity-name').fill('HaloDemo');
    await page.getByTestId('identity-name').dispatchEvent('change');
    await page.getByTestId('create-character').click();
    await page.getByTestId('nav-campaigns').click();
    await page.getByTestId('start-campaign').click();
    await page.getByTestId('campaign-name').fill('Halo Demo Camp');
    await page.getByTestId('campaign-name').dispatchEvent('change');
    await page.getByTestId('identity-veyra').click();
    await page.getByTestId('personality-seasoned_host').click();
    await page.getByTestId('create-campaign-submit').click();
    await expect(page.getByTestId('join-table-heading')).toBeVisible();
    const match = page.url().match(/\/campaigns\/([A-Za-z0-9-]+)\/join/);
    expect(match).toBeTruthy();
    await joinTableWithFirstCharacter(page);
    await page.goto(`/campaigns/${match![1]}`);
    await expect(page.getByTestId('own-seat')).toBeVisible();
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('table-ambient-hud')).toBeVisible();

    const token = page.locator('[data-testid="map-token"]').first();
    await expect(token).toBeVisible({ timeout: 20_000 });
    await expect(token.locator('.token-halo')).toHaveCount(1);
    await token.hover();
    await page.screenshot({ path: '/opt/cursor/artifacts/phase2-token-hover-halo.png' });

    await page.getByTestId('dice-fab').click();
    await expect(page.getByTestId('dice-tray')).toBeVisible();
    await page.getByTestId('dice-roll-d20').click();
    await expect(page.getByTestId('dice-tray-result')).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('dice-tray')).toHaveCount(0);
  });
});
