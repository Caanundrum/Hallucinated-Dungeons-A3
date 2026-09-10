import { expect, test, type Page } from '@playwright/test';

import { enterAccountFromShell, joinTableWithFirstCharacter, awaitAdventureReady } from './arena-page.js';

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

test('map a11y names are unique; door guidance omits Tools control', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await dismissIntroIfPresent(page);
  await enterAccountFromShell(page);
  await seatBlankCampaign(page, 'MapA11y');
  await page.getByTestId('open-campaign-table').click();

  const doorHit = page.locator('.map-edge-hit-target[aria-label*="Wooden door"]');
  if ((await doorHit.count()) === 0) {
    await awaitAdventureReady(page);
  }
  await expect(doorHit.first()).toBeVisible({ timeout: 60_000 });

  const doorLabels = await doorHit.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('aria-label') ?? ''),
  );
  expect(doorLabels.length).toBeGreaterThan(0);
  expect(new Set(doorLabels).size).toBe(doorLabels.length);

  const wallLabels = await page
    .locator('.map-edge-hit-target[aria-label*="Wall facing"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));
  if (wallLabels.length > 1) {
    expect(new Set(wallLabels).size).toBe(wallLabels.length);
    for (const label of wallLabels) {
      expect(label).toMatch(/at column \d+, row \d+/);
    }
  }

  const terrain = page.getByTestId('map-terrain-summary');
  await expect(terrain).not.toContainText(/unmarked opening/i);
  await expect(terrain).toContainText(/Routes:/i);

  await doorHit.first().evaluate((node) => {
    (node as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  const detail = page.getByTestId('door-selection-detail');
  await expect(detail).toBeVisible({ timeout: 10_000 });
  await expect(detail).not.toContainText(/Open adjacent door/i);
  await expect(detail).toContainText(/play channel|Open doorway|doorway/i);

  await expect(page.getByTestId('map-zoom-help')).toContainText(/Keyboard/i);
  await expect(page.getByTestId('map-zoom-help')).toContainText(/Tab/i);
  await page.getByTestId('map-toolbar-more').locator('summary').click();
    await expect(page.getByTestId('preview-scene-discovery-cue')).toBeVisible();

  await page.screenshot({ path: '/opt/cursor/artifacts/map-scene-a11y-door-guidance.png' });
});
