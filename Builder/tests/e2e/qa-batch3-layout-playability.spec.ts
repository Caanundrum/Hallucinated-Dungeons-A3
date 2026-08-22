import { expect, test, type Page } from '@playwright/test';

import { enterAccountFromShell, recordDefaultSessionZero } from './arena-page.js';

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
  await page.getByTestId('adventure-template-blank').click();
  await page.getByTestId('identity-garrick').click();
  await page.getByTestId('personality-seasoned_host').click();
  await page.getByTestId('create-campaign-submit').click();
  await expect(page.getByTestId('campaign-detail-heading')).toContainText(`${name} Camp`);
  await recordDefaultSessionZero(page);
  const seatSelect = page.getByTestId('seat-character-select');
  const characterId = await seatSelect.locator('option').nth(1).getAttribute('value');
  await seatSelect.selectOption(characterId!);
  await page.getByTestId('create-seat').click();
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

    const info = page.getByTestId('table-info-rail');
    const play = page.locator('main.table-play-column');
    const comms = page.getByTestId('communication-dock');
    const infoBox = await info.boundingBox();
    const playBox = await play.boundingBox();
    const commsBox = await comms.boundingBox();
    expect(infoBox).toBeTruthy();
    expect(playBox).toBeTruthy();
    expect(commsBox).toBeTruthy();
    // Primary regions must not share the same origin (PQA-112).
    const origins = new Set(
      [infoBox!, playBox!, commsBox!].map((box) => `${Math.round(box.x)}:${Math.round(box.y)}`),
    );
    expect(origins.size).toBe(3);

    const composer = page.getByTestId('player-action-input');
    await expect(composer).toBeVisible();
    const composerBox = await composer.boundingBox();
    expect(composerBox).toBeTruthy();
    expect(composerBox!.width).toBeGreaterThan(200);
    expect(composerBox!.height).toBeGreaterThan(40);

    await expect(page.getByTestId('table-info-tab-tools')).toBeVisible();
    await expect(page.getByTestId('action-channel-hint')).toBeVisible();
    await expect(page.getByTestId('collapse-info-rail')).toBeVisible();
    await expect(page.getByTestId('collapse-comms-rail')).toBeVisible();
  });

  test('PQA-141/143/145: blank-table door declaration offers build_scene draft', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatBlankCampaign(page, 'DoorBuild');
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('map-scene-banner')).toContainText(/empty table|no seeded/i);
    await page.getByTestId('player-action-input').fill(
      'I walk to the far wall, open the wooden door, and enter the room beyond.',
    );
    await page.getByTestId('player-action-input').dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    await expect(page.getByTestId('intent-intercept')).toBeVisible();
    await expect(page.getByTestId('intent-intercept-summary')).toContainText(/wall|door|blank|scene/i);
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

    await page.getByTestId('table-info-tab-character').click();
    await expect(page.getByTestId('table-character-compact')).toBeVisible();
    await expect(page.getByTestId('table-character-sheet-panel')).not.toHaveAttribute('open', '');
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
    await expect(page.getByTestId('map-stage-toolbar')).toBeVisible();
    await expect(page.getByTestId('map-fog-legend')).toBeVisible();
    await expect(page.getByTestId('table-stage-svg')).toHaveAttribute('role', 'grid');
    const tokenLabelSize = await page
      .locator('[data-testid="table-stage-svg"] text')
      .first()
      .evaluate((node) => Number(node.getAttribute('font-size') ?? '0'));
    expect(tokenLabelSize).toBeGreaterThan(12);
    const beforeFit = await page
      .locator('[data-testid="table-stage-svg"]')
      .evaluate((node) => node.getBoundingClientRect().width);
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await page.getByRole('button', { name: 'Fit map' }).click();
    const afterFit = await page
      .locator('[data-testid="table-stage-svg"]')
      .evaluate((node) => node.getBoundingClientRect().width);
    expect(afterFit).not.toBeCloseTo(beforeFit, 0);
  });
});
