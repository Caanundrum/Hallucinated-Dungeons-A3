import { expect, test, type Page } from '@playwright/test';

import {
  awaitAdventureReady,
  enterAccountFromShell,
  joinTableWithFirstCharacter,
} from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function advanceDoorCrossStep(page: Page, declaration: string): Promise<void> {
  const token = page.locator('[data-token][data-anchor-column][data-anchor-row]').first();
  const colBefore = Number(await token.getAttribute('data-anchor-column'));
  const rowBefore = Number(await token.getAttribute('data-anchor-row'));
  await page.getByTestId('player-action-input').fill(declaration);
  await page.getByTestId('player-action-input').dispatchEvent('input');
  await page.getByTestId('submit-player-action').click();
  // #142: routine exploration movement/door actions auto-commit directly without a confirm card;
  // handle both auto-commit and any residual intercept card cleanly.
  const intercept = page.getByTestId('intent-intercept');
  if (await intercept.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await page.getByTestId('confirm-intent-intercept').click();
    await expect(intercept).toHaveCount(0, { timeout: 15_000 });
  } else {
    await expect
      .poll(
        async () => {
          const c = Number(await token.getAttribute('data-anchor-column'));
          const r = Number(await token.getAttribute('data-anchor-row'));
          return c !== colBefore || r !== rowBefore;
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  }
}

async function crossToFarSideOfDoorway(page: Page): Promise<void> {
  for (let step = 0; step < 12; step += 1) {
    const token = page.locator('[data-token][data-anchor-column][data-anchor-row]').first();
    if (Number(await token.getAttribute('data-anchor-column')) >= 7) break;
    await advanceDoorCrossStep(page, 'I open the unlocked doorway and step through.');
    await expect
      .poll(
        async () => {
          const el = page.locator('[data-token][data-anchor-column][data-anchor-row]').first();
          return Number(await el.getAttribute('data-anchor-column'));
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThanOrEqual(7);
  }
}

async function seatBlankCampaign(page: Page, name: string): Promise<string> {
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
  return match![1]!;
}

test.describe('Open + step-through doorway cross', () => {
  test('fresh closed door: single open+cross confirm moves token and narrates once', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatBlankCampaign(page, 'ClosedCross');
    await page.getByTestId('open-campaign-table').click();
    await awaitAdventureReady(page);

    // Chamber boots with a closed door — prove closed → open + cross.
    const doorHit = page.locator('.map-edge-hit-target[aria-label*="Wooden door"]').first();
    await expect(doorHit).toBeVisible();
    await doorHit.click();
    await expect(page.getByTestId('door-selection-detail')).toContainText(/closed/i);
    await page.screenshot({ path: '/opt/cursor/artifacts/door-closed-before.png' }).catch(() => {});

    const token = page.locator('[data-token][data-anchor-column][data-anchor-row]').first();
    await expect(token).toBeVisible();
    const startColumn = Number(await token.getAttribute('data-anchor-column'));

    await crossToFarSideOfDoorway(page);

    await expect
      .poll(async () => {
        const el = page.locator('[data-token][data-anchor-column][data-anchor-row]').first();
        return Number(await el.getAttribute('data-anchor-column'));
      }, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(7);

    const endColumn = Number(
      await page.locator('[data-token][data-anchor-column]').first().getAttribute('data-anchor-column'),
    );
    expect(endColumn).toBeGreaterThan(startColumn);
    await page.screenshot({ path: '/opt/cursor/artifacts/token-far-after-cross.png' }).catch(() => {});

    await expect(page.getByTestId('dm-play-thread')).toContainText(
      /Opened the door and stepped through the doorway/i,
      { timeout: 20_000 },
    );
    await page.getByTestId('dm-play-thread').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '/opt/cursor/artifacts/story-after-cross-clean.png' }).catch(() => {});
    const threadText = await page.getByTestId('dm-play-thread').innerText();
    // Post-commit Story must not still ask the player to Confirm the crossing.
    expect(threadText).not.toMatch(/Confirm to (?:open it and )?cross|Confirm to commit the step/i);
    expect(threadText).not.toMatch(/already through the doorway/i);
    const openedCrossMatches =
      threadText.match(/Opened the door and stepped through the doorway/gi) ?? [];
    expect(openedCrossMatches.length).toBeGreaterThanOrEqual(1);
    // Live Story: one Garrick/DM beat for the crossing (not optimistic+chronicle).
    const dmCrossing = page
      .locator('[data-testid="dm-play-thread-list"] li.dm-thread-dm')
      .filter({ hasText: /Opened the door and stepped through the doorway/i });
    await expect(dmCrossing).toHaveCount(1);

    await doorHit.click();
    await expect(page.getByTestId('door-selection-detail')).toContainText(/open/i);
  });

  test('far-side reverse through is a confirmable cross back', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatBlankCampaign(page, 'ReverseCross');
    await page.getByTestId('open-campaign-table').click();
    await awaitAdventureReady(page);

    await crossToFarSideOfDoorway(page);

    await expect
      .poll(async () => {
        const el = page.locator('[data-token][data-anchor-column][data-anchor-row]').first();
        return Number(await el.getAttribute('data-anchor-column'));
      }, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(7);

    const activeRoomTitle = (await page.getByTestId('map-scene-banner').innerText()).trim();

    // Far-side reverse: through open door / west through doorway — not re-open, not mark-square.
    await advanceDoorCrossStep(page, 'I step through the open wooden door.');

    await expect
      .poll(async () => {
        const el = page.locator('[data-token][data-anchor-column][data-anchor-row]').first();
        return Number(await el.getAttribute('data-anchor-column'));
      }, { timeout: 20_000 })
      .toBeLessThan(7);

    await expect(page.getByTestId('dm-play-thread')).toContainText(
      /Stepped back through the open doorway/i,
      { timeout: 20_000 },
    );
    await expect(page.getByTestId('map-scene-banner')).toContainText(activeRoomTitle);
    const reverseThread = await page.getByTestId('dm-play-thread').innerText();
    expect(reverseThread).not.toMatch(/Ready to open the door beside|Confirm to open/i);
    // Live Story must not show the same reverse-cross sentence twice in a row (optimistic+chronicle).
    expect(reverseThread).not.toMatch(
      /Stepped back through the open doorway[^\n]*\n(?:[^\n]*\n){0,2}Stepped back through the open doorway/i,
    );
    const dmReverse = page
      .locator('[data-testid="dm-play-thread-list"] li.dm-thread-dm')
      .filter({ hasText: /Stepped back through the open doorway/i });
    await expect(dmReverse).toHaveCount(1);

    await page.screenshot({ path: '/opt/cursor/artifacts/reverse-cross-token.png' }).catch(() => {});
  });

  test('enter room beyond while already past doorway clarifies once', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatBlankCampaign(page, 'AlreadyBeyond');
    await page.getByTestId('open-campaign-table').click();
    await awaitAdventureReady(page);

    await crossToFarSideOfDoorway(page);

    await expect
      .poll(async () => {
        const el = page.locator('[data-token][data-anchor-column][data-anchor-row]').first();
        return Number(await el.getAttribute('data-anchor-column'));
      }, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(7);

    await page.getByTestId('player-action-input').fill('I enter the room beyond.');
    await page.getByTestId('player-action-input').dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    await expect(page.getByTestId('intent-intercept')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('dm-play-thread')).toContainText(/already through the doorway/i, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('dm-play-thread')).not.toContainText(/Confirm to commit the step/i);
    const listText = await page.getByTestId('dm-play-thread-list').innerText();
    const alreadyThrough = (listText.match(/already through the doorway/gi) ?? []).length;
    expect(alreadyThrough).toBe(1);
  });
});
