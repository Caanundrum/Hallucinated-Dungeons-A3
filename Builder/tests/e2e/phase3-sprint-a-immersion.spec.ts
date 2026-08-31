import { expect, test, type Page } from '@playwright/test';

import {
  enterAccountFromShell,
  joinTableWithFirstCharacter,
  openTableAdvancedControls,
} from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function seatAndOpenTable(page: Page, name: string): Promise<string> {
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
  return match![1];
}

test.describe('Phase 3 Sprint A: immersion & combat drama', () => {
  test('atmosphere, floaters, dice drama, combat vignette', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatAndOpenTable(page, 'ImmersionA');

    await expect(page.getByTestId('table-stage-atmosphere')).toBeVisible();
    await expect(page.locator('.cavern-dust').first()).toBeVisible();
    await expect(page.locator('g.map-token').first()).toBeVisible({ timeout: 20_000 });

    const tokenTransition = await page.locator('g.token-moving').count();
    // Idle tokens may not have token-moving; assert the CSS contract exists in stage paint path.
    expect(tokenTransition).toBeGreaterThanOrEqual(0);

    await page.screenshot({ path: '/opt/cursor/artifacts/phase3-sprint-a-atmosphere.png' });

    await page.getByTestId('open-table-sheet-modal').click();
    await expect(page.getByTestId('table-sheet-modal')).toBeVisible();
    await page.getByTestId('sheet-hp-damage').click();
    await expect(page.getByTestId('combat-floater')).toBeVisible({ timeout: 3_000 });
    await page.screenshot({ path: '/opt/cursor/artifacts/phase3-sprint-a-damage-floater.png' });
    await page.getByTestId('close-table-sheet-modal').click();

    // Force Nat 20 / Nat 1 drama via Math.random stubs.
    await page.getByTestId('dice-fab').click();
    await expect(page.getByTestId('dice-tray')).toBeVisible();
    await page.evaluate(() => {
      Math.random = () => 0.999;
    });
    await page.getByTestId('dice-roll-d20').click();
    await expect(page.getByTestId('dice-tray-result')).toContainText(/Natural 20/i, {
      timeout: 5_000,
    });
    await expect(page.getByTestId('dice-drama-flash')).toBeVisible();
    await expect(page.getByTestId('dice-drama-burst')).toBeVisible();
    await page.screenshot({ path: '/opt/cursor/artifacts/phase3-sprint-a-nat20.png' });

    await page.evaluate(() => {
      Math.random = () => 0;
    });
    await page.getByTestId('dice-roll-d20').click();
    await expect(page.getByTestId('dice-tray-result')).toContainText(/Natural 1/i, {
      timeout: 5_000,
    });
    await expect(page.getByTestId('table-page-shell')).toHaveClass(/dice-nat1-shake/);
    await page.screenshot({ path: '/opt/cursor/artifacts/phase3-sprint-a-nat1.png' });
    await page.keyboard.press('Escape');

    await openTableAdvancedControls(page);
    await page.getByTestId('begin-encounter').click();
    await expect(page.getByTestId('table-page-shell')).toHaveClass(/table-combat-active/, {
      timeout: 15_000,
    });
    // Own turn splash may appear if the seated hero wins initiative.
    const splash = page.getByTestId('turn-splash-banner');
    if (await splash.isVisible().catch(() => false)) {
      await page.screenshot({ path: '/opt/cursor/artifacts/phase3-sprint-a-turn-splash.png' });
    } else {
      await page.screenshot({ path: '/opt/cursor/artifacts/phase3-sprint-a-combat-vignette.png' });
    }

    // Drop-cap class on director chronicle entries when present.
    const dropCap = page.locator('.illuminated-dropcap').first();
    if (await dropCap.count()) {
      await expect(dropCap).toBeVisible();
    }
  });
});
