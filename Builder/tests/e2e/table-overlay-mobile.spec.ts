import { expect, test, type Page } from '@playwright/test';

import { enterAccountFromShell, joinTableWithFirstCharacter } from './arena-page.js';

async function openSeatedTable(page: Page, name: string): Promise<void> {
  await page.goto('/');
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await enterAccountFromShell(page);
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
  await page.getByTestId('open-campaign-table').click();
  await expect(page.getByTestId('table-ambient-hud')).toBeVisible();
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

test.describe('Table mobile overlay fixes', () => {
  test('FABs stay in map chrome and do not cover chat composer', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 375, height: 812 });
    await openSeatedTable(page, 'MobileOverlay');

    await expect(page.getByTestId('table-map-chrome')).toBeVisible();
    await expect(page.getByTestId('floating-combat-host')).toBeVisible();
    await expect(page.getByTestId('dice-fab')).toBeVisible();

    // On play task, FABs must live inside map chrome and not overlap the action composer.
    await page.getByTestId('mobile-task-play').click();
    const chromeBox = await page.getByTestId('table-map-chrome').boundingBox();
    const fabBox = await page.getByTestId('floating-combat-bar').boundingBox();
    const diceBox = await page.getByTestId('dice-fab').boundingBox();
    const actionBox = await page.getByTestId('action-composer').boundingBox();
    expect(chromeBox).toBeTruthy();
    expect(fabBox).toBeTruthy();
    expect(diceBox).toBeTruthy();
    expect(actionBox).toBeTruthy();
    expect(fabBox!.y + fabBox!.height).toBeLessThanOrEqual(chromeBox!.y + chromeBox!.height + 1);
    expect(diceBox!.y + diceBox!.height).toBeLessThanOrEqual(chromeBox!.y + chromeBox!.height + 1);
    expect(overlaps(fabBox!, actionBox!)).toBe(false);
    expect(overlaps(diceBox!, actionBox!)).toBe(false);

    // Chat tab: FABs hidden; chat controls remain clickable.
    await page.getByTestId('mobile-task-chat').click();
    await expect(page.getByTestId('floating-combat-host')).toBeHidden();
    await expect(page.getByTestId('dice-fab-host')).toBeHidden();
    await expect(page.getByTestId('mobile-task-chat')).toBeVisible();
    await expect(page.getByTestId('dock-tab-party_chat')).toBeVisible();
    await page.getByTestId('dock-tab-party_chat').click();
    await expect(page.getByTestId('party-chat-input')).toBeVisible();
    await page.getByTestId('party-chat-input').click();
    await page.getByTestId('party-chat-input').fill('overlay check');

    // All four mobile task pills remain hittable after scrolling chat content.
    await page.getByTestId('table-mobile-task-nav').scrollIntoViewIfNeeded();
    for (const id of ['mobile-task-map', 'mobile-task-play', 'mobile-task-sheet', 'mobile-task-chat']) {
      const pill = page.getByTestId(id);
      await expect(pill).toBeVisible();
      await pill.scrollIntoViewIfNeeded();
      const box = await pill.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(812);
      await pill.click();
      await expect(pill).toHaveAttribute('aria-pressed', 'true');
    }

    await page.screenshot({ path: '/opt/cursor/artifacts/table-overlay-mobile-chat-fixed.png' });
    await page.getByTestId('mobile-task-map').click();
    await expect(page.getByTestId('floating-combat-bar')).toBeVisible();
    await expect(page.getByTestId('dice-fab')).toBeVisible();
    await page.screenshot({ path: '/opt/cursor/artifacts/table-overlay-mobile-map-fixed.png' });
  });
});
