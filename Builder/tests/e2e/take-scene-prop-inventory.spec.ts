import { expect, type Page, test } from '@playwright/test';
import {
  awaitAdventureReady,
  enterAccountFromShell,
  joinTableWithFirstCharacter,
} from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function seatAndOpenTable(page: Page, name: string, premise: string): Promise<void> {
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
  await page.getByTestId('campaign-summary').fill(premise);
  await page.getByTestId('campaign-summary').dispatchEvent('change');
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
}

async function confirmDraft(page: Page): Promise<void> {
  const confirm = page.getByTestId('confirm-intent-intercept');
  await expect(confirm).toBeVisible({ timeout: 20_000 });
  await confirm.click();
}

async function beginAdventure(page: Page): Promise<void> {
  await awaitAdventureReady(page);
  await expect(page.getByTestId('intent-intercept-summary')).toContainText(
    /begin the adventure|opening scene/i,
    { timeout: 10_000 },
  );
  await confirmDraft(page);
  await expect(page.getByTestId('map-scene-banner')).not.toContainText(
    /Awaiting first scene|Game Director is ready to establish/i,
    { timeout: 30_000 },
  );
}

test.describe('Take portable scene prop into inventory', () => {
  test('Confirm take courier satchel stows gear and removes map prop', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatAndOpenTable(
      page,
      'TakeSatchel',
      'a canal town and a missing courier carrying a sealed package',
    );
    await awaitAdventureReady(page);
    const beginSummary = page.getByTestId('intent-intercept-summary');
    if (
      (await beginSummary.isVisible().catch(() => false)) &&
      /begin the adventure|opening scene/i.test((await beginSummary.innerText()).trim())
    ) {
      await beginAdventure(page);
    }
    await expect(page.getByTestId('map-terrain-summary')).toContainText(/courier satchel/i, {
      timeout: 30_000,
    });

    // Open the satchel first so Nearby shows open state (optional but mirrors QA path).
    await page.getByTestId('player-action-input').fill('open the courier satchel');
    await page.getByTestId('player-action-input').dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    if (await page.getByTestId('confirm-intent-intercept').isVisible({ timeout: 12_000 }).catch(() => false)) {
      await confirmDraft(page);
      await expect(page.getByTestId('map-terrain-summary')).toContainText(/open/i, {
        timeout: 20_000,
      });
    }

    await page.getByTestId('player-action-input').fill('I take the open courier satchel.');
    await page.getByTestId('player-action-input').dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    await expect(page.getByTestId('intent-intercept-summary')).toContainText(/Ready to take/i, {
      timeout: 20_000,
    });
    await expect(page.getByTestId('confirm-intent-intercept')).toBeVisible();
    await confirmDraft(page);

    await expect(page.getByTestId('dm-play-thread')).toContainText(/stowed in inventory/i, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('map-terrain-summary')).not.toContainText(/courier satchel/i, {
      timeout: 20_000,
    });
    // Nearby must lose the satchel while other props remain.
    await expect(page.getByTestId('map-terrain-summary')).toContainText(/hanging lantern/i);
    await page.screenshot({
      path: '/opt/cursor/artifacts/take-scene-prop-stowed.png',
      fullPage: true,
    });

    const campaignMatch = page.url().match(/\/campaigns\/([A-Za-z0-9-]+)/);
    expect(campaignMatch).toBeTruthy();
    const candidateId = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="hd-candidate-id"]');
      return meta?.getAttribute('content') ?? null;
    });
    const origin = new URL(page.url()).origin;
    const rulesResponse = await page.request.get(
      `${origin}/api/campaigns/${campaignMatch![1]}/rules-state`,
      {
        headers: {
          origin,
          ...(candidateId !== null ? { 'x-hd-candidate': candidateId } : {}),
        },
      },
    );
    expect(rulesResponse.ok()).toBeTruthy();
    const rulesBody = (await rulesResponse.json()) as {
      progression?: { sheet?: { equipment?: readonly { name: string }[] } };
    };
    const equipmentNames = (rulesBody.progression?.sheet?.equipment ?? []).map((item) => item.name);
    expect(equipmentNames.some((name) => /courier satchel/i.test(name))).toBeTruthy();

    const detailsSummary = page.getByTestId('table-details-summary');
    if (await detailsSummary.isVisible().catch(() => false)) {
      await detailsSummary.click();
    }
    const openSheet = page.getByTestId('open-table-sheet-modal');
    if (await openSheet.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await openSheet.click();
      await expect(page.getByTestId('table-sheet-modal')).toBeVisible();
      const equipmentTab = page.getByTestId('sheet-modal-tab-equipment');
      if (await equipmentTab.isVisible().catch(() => false)) {
        await equipmentTab.click();
      }
      await expect(page.getByTestId('sheet-equipment-list')).toContainText(/Courier satchel/i, {
        timeout: 10_000,
      });
    }

    await page.screenshot({
      path: '/opt/cursor/artifacts/take-scene-prop-success.png',
      fullPage: true,
    });
  });
});
