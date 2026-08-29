import { expect, test, type Page } from '@playwright/test';

import { enterAccountFromShell, joinTableWithFirstCharacter } from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function seatBlankCampaign(page: Page, name: string): Promise<void> {
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
  await page.getByTestId('identity-garrick').click();
  await page.getByTestId('personality-seasoned_host').click();
  await page.getByTestId('create-campaign-submit').click();
  await expect(page.getByTestId('join-table-heading')).toBeVisible();
  const match = page.url().match(/\/campaigns\/([A-Za-z0-9-]+)\/join/);
  expect(match).toBeTruthy();
  await joinTableWithFirstCharacter(page);
  await page.goto(`/campaigns/${match![1]}`);
  await expect(page.getByTestId('own-seat')).toBeVisible();
  await expect(page.getByTestId('leave-seat')).toBeVisible();
}

test.describe('PQA layout and playability batch 3', () => {
  test('PQA-112/115/148: phone stacks regions; composer usable; Tools stays for Arena', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatBlankCampaign(page, 'LayoutPhone');
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('table-page-shell')).toBeVisible();
    await expect(page.getByTestId('table-mobile-task-nav')).toBeVisible();

    await page.getByTestId('mobile-task-play').click();
    const play = page.locator('main.table-play-column');
    await expect(play).toBeVisible();
    const composer = page.getByTestId('player-action-input');
    await expect(composer).toBeVisible();
    const composerBox = await composer.boundingBox();
    expect(composerBox).toBeTruthy();
    expect(composerBox!.width).toBeGreaterThan(200);
    expect(composerBox!.height).toBeGreaterThan(40);
    await expect(page.getByTestId('action-channel-hint')).toBeVisible();

    await page.getByTestId('mobile-task-sheet').click();
    await expect(page.getByTestId('table-info-rail')).toBeVisible();
    await expect(page.getByTestId('table-info-tab-tools')).toBeVisible();
    await expect(page.getByTestId('collapse-info-rail')).toBeVisible();

    await page.getByTestId('mobile-task-chat').click();
    await expect(page.getByTestId('communication-dock')).toBeVisible();
    await expect(page.getByTestId('collapse-comms-rail')).toBeVisible();

    await page.getByTestId('mobile-task-map').click();
    await expect(page.getByTestId('table-stage-slot')).toBeVisible();
  });

  test('NEW-PQA-05: selected door guidance renders once', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatBlankCampaign(page, 'DoorDedupe');
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('map-scene-banner')).toContainText(/Quiet chamber/i);
    const doorHit = page.locator('.map-edge-hit-target[aria-label*="Wooden door"]');
    await expect(doorHit.first()).toBeVisible();
    await doorHit.first().click();
    const detail = page.getByTestId('door-selection-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(/Selected wooden door in Quiet chamber/i);
    await expect(page.getByTestId('move-target-meta')).toHaveCount(0);
    const bannerText = await page.getByTestId('table-turn-banner').innerText();
    expect((bannerText.match(/Selected wooden door in Quiet chamber/g) ?? []).length).toBe(1);
  });

  test('PQA-187/141: blank-table door declaration uses Quiet chamber doorway', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatBlankCampaign(page, 'DoorBuild');
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('map-scene-banner')).toContainText(/Quiet chamber/i);
    await expect(page.getByTestId('map-scene-banner')).not.toContainText(/empty table/i);
    await page.getByTestId('player-action-input').fill(
      'I walk to the far wall, open the wooden door, and enter the room beyond.',
    );
    await page.getByTestId('player-action-input').dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    await expect(page.getByTestId('intent-intercept')).toBeVisible();
    await expect(page.getByTestId('intent-intercept-summary')).toContainText(/door|chamber|wall|open|move/i);
    await expect(page.locator('body')).not.toContainText('table.open_door');
    await expect(page.locator('body')).not.toContainText('edgeId');
    await expect(page.locator('body')).not.toContainText('column 0, row 0');
    await expect(page.getByTestId('confirm-intent-intercept')).toBeVisible();
  });
  test('PQA-130/151: phone composer does not overlap map; compact character sheet', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatBlankCampaign(page, 'PhoneLayout');
    await page.getByTestId('open-campaign-table').click();
    const stage = page.getByTestId('table-stage-slot');
    const composer = page.getByTestId('table-player-turn-composer');
    await expect(stage).toBeVisible();
    await expect(composer).toBeVisible();
    const stageBox = await stage.boundingBox();
    const composerBox = await composer.boundingBox();
    expect(stageBox).toBeTruthy();
    expect(composerBox).toBeTruthy();
    expect(composerBox!.y).toBeGreaterThanOrEqual(stageBox!.y + stageBox!.height - 4);

    await page.getByTestId('mobile-task-sheet').click();
    await page.getByTestId('table-info-tab-character').click();
    await expect(page.getByTestId('table-character-compact')).toBeVisible();
    await expect(page.getByTestId('open-table-sheet-modal')).toBeVisible();
    await expect(page.getByTestId('table-sheet-modal')).toHaveCount(0);
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(pageHeight).toBeLessThan(5000);
  });

  test('PQA-133/139/140: map toolbar, legible token labels, and fog legend render', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatBlankCampaign(page, 'MapUx');
    await page.getByTestId('open-campaign-table').click();
    await page.getByTestId('mobile-task-map').click();
    await expect(page.getByTestId('map-stage-toolbar')).toBeVisible();
    await expect(page.getByTestId('map-fog-legend')).toBeAttached();
    await expect(page.getByTestId('map-fog-legend')).toContainText(/Fog|Door|Floor/i);
    await expect(page.getByTestId('table-stage-svg')).toHaveAttribute('role', 'grid');
    const tokenLabelSize = await page
      .locator('[data-testid="table-stage-svg"] text')
      .first()
      .evaluate((node) => Number(node.getAttribute('font-size') ?? '0'));
    expect(tokenLabelSize).toBeGreaterThan(12);
    const beforeZoom = await page
      .locator('[data-testid="table-stage-svg"]')
      .evaluate((node) => node.getBoundingClientRect().width);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    const afterZoomIn = await page
      .locator('[data-testid="table-stage-svg"]')
      .evaluate((node) => node.getBoundingClientRect().width);
    expect(afterZoomIn).toBeGreaterThan(beforeZoom);
    await page.locator('[data-map-zoom="fit"]').click();
    const afterFit = await page
      .locator('[data-testid="table-stage-svg"]')
      .evaluate((node) => node.getBoundingClientRect().width);
    // Fit restores a readable map width; allow small layout variance on phone Map mode.
    expect(afterFit).toBeGreaterThan(120);
    expect(Math.abs(afterFit - beforeZoom)).toBeLessThan(beforeZoom * 0.35);
  });

  test('PQA-146/147: persisted chamber declaration sees committed geometry', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatBlankCampaign(page, 'PersistScene');
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('map-scene-banner')).toContainText(/Quiet chamber/i);
    const declaration =
      'I walk to the far wall, open the wooden door, and enter the room beyond.';
    await page.getByTestId('player-action-input').fill(declaration);
    await page.getByTestId('player-action-input').dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    await expect(page.getByTestId('confirm-intent-intercept')).toBeVisible();
    await page.getByTestId('confirm-intent-intercept').click();
    await expect(page.getByTestId('map-bundle-meta')).toContainText(/Quiet chamber/i, {
      timeout: 15000,
    });
    await expect(page.locator('[data-testid="table-stage-svg"] line[data-edge]')).not.toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('map-bundle-meta')).toContainText(/Quiet chamber/i);
    await expect(page.locator('[data-testid="table-stage-svg"] line[data-edge]')).not.toHaveCount(0);
    await page.getByTestId('player-action-input').fill(declaration);
    await page.getByTestId('player-action-input').dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    await expect(page.getByTestId('dm-play-thread')).not.toContainText(/open floor/i);
    await expect(page.getByTestId('dm-play-thread')).toContainText(
      /already through|already open|move toward|walls and structural|Quiet chamber|Ready to open|door/i,
    );
    await expect(page.getByTestId('door-recovery-panel')).toHaveCount(0);
  });
});
