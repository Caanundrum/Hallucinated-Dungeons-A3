import { expect, test, type Page } from '@playwright/test';

import {
  acceptAllLegalForPlay,
  enterAccountFromShell,
  joinTableWithFirstCharacter,
} from './arena-page.js';

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

async function createPublicTable(page: Page, name: string): Promise<string> {
  await page.getByTestId('nav-campaigns').click();
  await page.getByTestId('start-campaign').click();
  await expect(page.getByTestId('create-campaign-heading')).toBeVisible();

  const optionList = page.getByTestId('table-visibility-list');
  await expect(optionList).toBeVisible();
  expect(await optionList.evaluate((el) => el.tagName)).toBe('DIV');
  expect(await optionList.locator('li').count()).toBe(0);
  await page.screenshot({
    path: '/opt/cursor/artifacts/punch-create-table-bullets.png',
    fullPage: true,
  });

  await page.getByTestId('visibility-public').click();
  await page.getByTestId('campaign-name').fill(name);
  await page.getByTestId('campaign-name').dispatchEvent('change');
  await page.getByTestId('identity-veyra').click();
  await page.getByTestId('personality-seasoned_host').click();
  await page.getByTestId('create-campaign-submit').click();
  await expect(page.getByTestId('join-table-heading')).toBeVisible();
  const match = page.url().match(/\/campaigns\/([A-Za-z0-9-]+)\/join/);
  expect(match).toBeTruthy();
  return match![1]!;
}

test.describe('Punch list smoke', () => {
  test('welcome legal, hub filters, desktop dock, HUD, free-explore NL', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);

    // Hosted welcome consolidates legal into one footer; Local Arena uses the shell home.
    const welcomeScreen = page.getByTestId('welcome-screen');
    if (await welcomeScreen.isVisible().catch(() => false)) {
      const legal = page.getByTestId('welcome-legal-links');
      await expect(legal).toBeVisible();
      await expect(legal).toContainText('Terms');
      await expect(legal).toContainText('Privacy');
      await expect(page.locator('[data-testid="welcome-legal-links"]')).toHaveCount(1);
      await page.screenshot({
        path: '/opt/cursor/artifacts/punch-welcome-legal.png',
        fullPage: true,
      });
    }

    await signIn(page);
    await createQuickCharacter(page, 'Duran Stoneguard');
    await createPublicTable(page, `Punch Parlor ${Date.now()}`);
    await joinTableWithFirstCharacter(page);
    await expect(page.getByTestId('campaign-table-heading')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('table-back').click();
    await page.getByTestId('nav-campaigns').click();
    const tools = page.getByTestId('campaign-list-tools');
    await expect(tools).toBeVisible();
    const toolsLayout = await tools.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        display: style.display,
        columns: style.gridTemplateColumns,
        height: el.getBoundingClientRect().height,
      };
    });
    expect(toolsLayout.display).toBe('grid');
    // Horizontal compact row: more than one track on a 1440px viewport.
    expect(toolsLayout.columns.split(' ').length).toBeGreaterThan(1);
    expect(toolsLayout.height).toBeLessThan(220);
    const firstCard = page
      .getByTestId('campaign-list-owned')
      .locator('[data-testid="my-table-open"]')
      .first();
    await expect(firstCard).toBeVisible();
    await page.screenshot({
      path: '/opt/cursor/artifacts/punch-campaigns-filters.png',
      fullPage: false,
    });

    await firstCard.click();
    await expect(page.getByTestId('table-page-shell')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('action-composer')).toBeVisible();
    await expect(page.getByTestId('table-floating-hud')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('table-character-hud')).toContainText(/Duran|Lv/i);

    const storyBox = await page.getByTestId('action-composer').boundingBox();
    const playBox = await page.locator('.table-play-column').boundingBox();
    expect(storyBox && playBox).toBeTruthy();
    expect((storyBox?.x ?? 0) > (playBox?.x ?? 0) + 40).toBeTruthy();
    await page.screenshot({
      path: '/opt/cursor/artifacts/punch-table-desktop-dock.png',
      fullPage: false,
    });

    const input = page.getByTestId('player-action-input');
    await expect(input).toBeVisible();
    await input.fill(
      'I examine the table lantern and listen closely at the shuttered window to hear what is happening outside in Emberferry',
    );
    await page.getByTestId('submit-player-action').click();
    await expect
      .poll(async () => page.getByTestId('dm-play-thread').innerText().catch(() => ''), {
        timeout: 90_000,
      })
      .not.toMatch(/Say one clear action your character attempts/i);

    await input.fill('Open the wooden doorway east');
    await page.getByTestId('submit-player-action').click();
    await expect(page.getByTestId('confirm-intent-draft')).toBeHidden({ timeout: 45_000 });
    await page.screenshot({
      path: '/opt/cursor/artifacts/punch-table-after-nl.png',
      fullPage: false,
    });
  });
});

