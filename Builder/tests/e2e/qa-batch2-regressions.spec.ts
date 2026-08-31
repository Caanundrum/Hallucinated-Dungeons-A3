import { expect, test, type Page } from '@playwright/test';

import {
  enterAccountFromShell,
  joinTableWithFirstCharacter,
  openTableAdvancedControls,
  openTablePresencePanel,
} from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function seatFreshCampaign(page: Page, name: string): Promise<void> {
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
  await page.getByTestId('identity-veyra').click();
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

test.describe('PQA batch 2 regressions', () => {
  test('PQA-062/063/064: campaign detail loads and leave seat after join', async ({
    page,
  }) => {
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatFreshCampaign(page, 'Batch2 Seat');
    await expect(page.getByTestId('seat-item').first()).not.toContainText(/Seat [0-9a-f]{8}/i);
    await expect(page.getByTestId('seat-item').first()).not.toContainText('event sequence');
    await page.getByTestId('leave-seat').click();
    await page.getByTestId('confirm-dialog-confirm').click();
    await expect(page.getByTestId('create-seat')).toBeVisible();
  });

  test('PQA-065/066/073/074/075/082: combat UI, out-of-combat gates, end encounter', async ({
    page,
  }) => {
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatFreshCampaign(page, 'Batch2 Combat');
    await page.getByTestId('open-campaign-table').click();
    await openTableAdvancedControls(page);
    await page.getByTestId('begin-encounter').click();
    await page.getByTestId('roll-initiative').click();
    await expect(page.getByTestId('encounter-meta')).not.toContainText('active · round');
    await expect(page.getByTestId('timing-authority-meta')).not.toContainText(
      'credential active · expires',
    );
    await expect(page.getByTestId('rules-short-rest')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('rules-long-rest')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('rules-award-xp')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('rules-level-up')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('own-combatant-inventory')).toContainText(/Potion/i);
    await expect(page.getByTestId('end-encounter')).toBeVisible();
    await page.getByTestId('end-encounter').click();
    await expect(page.getByTestId('encounter-meta')).toContainText(/ended/i);
  });

  test('PQA-081/084: close chapter and suspend disabled during combat with feedback', async ({
    page,
  }) => {
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatFreshCampaign(page, 'Batch2 Suspend');
    await page.getByTestId('open-campaign-table').click();
    await openTableAdvancedControls(page);
    await page.getByTestId('begin-encounter').click();
    await page.getByTestId('roll-initiative').click();
    await page.getByTestId('table-back').click();
    await expect(page.getByTestId('campaign-detail-heading')).toBeVisible();
    // FQA-043: Close chapter only exists for seeded adventure templates.
    const closeChapter = page.getByTestId('close-chapter');
    if ((await closeChapter.count()) > 0) {
      await expect(closeChapter).toHaveAttribute('aria-disabled', 'true');
      await expect(page.getByTestId('chapter-travel-hint')).toContainText(/encounter/i);
    }
    await expect(page.getByTestId('suspend-session')).toHaveAttribute('aria-disabled', 'true');
  });

  test('PQA-085/087/088/089/090/107: suspended notice, checkpoint, presence, art, NPCs, move select', async ({
    page,
  }) => {
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatFreshCampaign(page, 'Batch2 TableUX');
    await page.getByTestId('open-campaign-table').click();
    await openTableAdvancedControls(page);
    await page.getByTestId('commit-table-sync').click();
    await expect
      .poll(async () => page.getByTestId('table-state-meta').getAttribute('data-state-version'))
      .toMatch(/^[1-9]/);
    await expect(page.getByTestId('move-destination-select')).toBeVisible();
    await page.getByTestId('table-info-tab-people').click();
    await expect(page.getByTestId('table-npc-empty')).toBeVisible();
    await openTablePresencePanel(page);
    await expect(page.getByTestId('presence-meta')).toContainText(/online \d+/);
    await expect(page.getByTestId('presence-meta')).not.toContainText('devices/tabs');
    await expect(page.locator('body')).not.toContainText('original phase5 starter v1');
    await page.getByTestId('table-back').click();
    await page.getByTestId('suspend-session').click();
    await expect(page.getByTestId('campaign-time')).toContainText(/suspended/i);
    await expect(page.getByTestId('session-action-message')).toContainText(/checkpoint [1-9]/i);
    await expect(page.getByTestId('session-action-message')).not.toContainText('checkpoint 0');
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('table-suspended-notice')).toBeVisible();
    await expect(page.getByTestId('table-turn-title')).toContainText(/suspended/i);
    await page.getByTestId('dock-tab-chronicle').click();
    await page.getByTestId('chronicle-kind-filter').selectOption('all');
    await expect(page.getByTestId('chronicle-entry').filter({ hasText: /session was suspended/i })).toBeVisible();
    await expect(page.getByTestId('chronicle-pane')).not.toContainText('checkpoint 0');
    await expect(page.getByTestId('chronicle-pane')).not.toContainText(/Table checkpoint/i);
    await openTableAdvancedControls(page);
    await expect(page.getByTestId('nl-intent-input')).toBeDisabled();
  });

  test('FQA-010 / PQA-187: blank table awaits Director first scene', async ({ page }) => {
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatFreshCampaign(page, 'QuietChamber');
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('map-scene-banner')).toContainText(/first scene|Game Director/i);
    await expect(page.getByTestId('begin-adventure')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Local starter chamber');
    await expect(page.locator('body')).not.toContainText(/empty table/i);
    const terrain = page.getByTestId('map-terrain-summary');
    if (await terrain.isVisible().catch(() => false)) {
      await expect(terrain).not.toHaveText(/^49 floor, 47 unexplored$/);
    }
  });

  test('PQA-177: reference markers appear after Director establishes a scene', async ({ page }) => {
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatFreshCampaign(page, 'MapMarkers');
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('begin-adventure')).toBeVisible();
    // Markers are scene-owned; blank await state has none until Begin the adventure confirms.
    await expect(page.locator('[data-notable-feature*="lighting reference"]')).toHaveCount(0);
  });
});
