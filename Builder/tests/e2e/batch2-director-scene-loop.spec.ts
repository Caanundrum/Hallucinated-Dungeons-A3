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
  await expect(page.getByTestId('begin-adventure')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('begin-adventure').click();
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

test.describe('Batch 2/3 Director scene loop', () => {
  test('interior → object change → exterior → encounter (actor on map) → return', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatAndOpenTable(page, 'SceneLoop', 'a misty marsh inn beside the reeds');

    await beginAdventure(page);
    await expect(page.getByTestId('map-scene-banner')).not.toContainText(/Quiet chamber/i);
    const interiorTitle = (await page.getByTestId('map-scene-banner').innerText()).trim();
    expect(interiorTitle.length).toBeGreaterThan(8);
    expect(interiorTitle).toMatch(/inn|crypt|workshop|cottage|warehouse|chamber|room|parlor|bay/i);

    await openTableAdvancedControls(page);

    // Non-door light change.
    await page.getByTestId('nl-intent-input').fill('extinguish the lamp');
    await page.getByTestId('interpret-nl-intent').click();
    await confirmDraft(page);
    await expect(page.getByTestId('map-notable-features')).toContainText(/unlit/i, {
      timeout: 20_000,
    });

    // Second stateful object (not light/door).
    await page.getByTestId('nl-intent-input').fill('smash the overturned bench');
    await page.getByTestId('interpret-nl-intent').click();
    await confirmDraft(page);
    await expect(page.getByTestId('map-notable-features')).toContainText(/broken/i, {
      timeout: 20_000,
    });

    // Leave for exterior/travel.
    await page.getByTestId('nl-intent-input').fill('leave through the doorway toward the marsh trail');
    await page.getByTestId('interpret-nl-intent').click();
    await confirmDraft(page);
    await expect(page.getByTestId('map-scene-banner')).not.toContainText(interiorTitle, {
      timeout: 30_000,
    });
    const exteriorTitle = (await page.getByTestId('map-scene-banner').innerText()).trim();
    expect(exteriorTitle).not.toEqual(interiorTitle);

    // Encounter onward — inhabitant must appear on the tactical map.
    await page.getByTestId('nl-intent-input').fill('travel onward into danger ahead');
    await page.getByTestId('interpret-nl-intent').click();
    await confirmDraft(page);
    await expect(page.getByTestId('map-scene-banner')).not.toContainText(exteriorTitle, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('map-notable-features')).toContainText(
      /stranger|bandit|wolf|lookout/i,
      { timeout: 20_000 },
    );
    await expect(page.getByTestId('map-actor-marker').first()).toBeVisible({ timeout: 10_000 });

    // Return with consequences preserved.
    await page.getByTestId('nl-intent-input').fill('return to the earlier scene');
    await page.getByTestId('interpret-nl-intent').click();
    await confirmDraft(page);
    const afterFirstReturn = (await page.getByTestId('map-scene-banner').innerText()).trim();
    if (afterFirstReturn !== interiorTitle) {
      await page.getByTestId('nl-intent-input').fill('return to the earlier scene');
      await page.getByTestId('interpret-nl-intent').click();
      await confirmDraft(page);
    }
    await expect(page.getByTestId('map-scene-banner')).toContainText(
      interiorTitle.split('—')[0]!.trim().slice(0, 10),
      { timeout: 30_000 },
    );
    await expect(page.locator('body')).toContainText(/unlit/i, { timeout: 30_000 });
    await expect(page.locator('body')).toContainText(/broken/i, { timeout: 30_000 });

    await page.reload();
    await expect(page.getByTestId('table-ambient-hud')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('body')).toContainText(/unlit/i, { timeout: 30_000 });
    await expect(page.locator('body')).toContainText(/broken/i, { timeout: 30_000 });
  });

  test('open-ended landmark destination differs from prepared travel wording', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatAndOpenTable(page, 'LandmarkLoop', 'a misty marsh inn beside the reeds');
    await beginAdventure(page);
    await openTableAdvancedControls(page);

    await page
      .getByTestId('nl-intent-input')
      .fill('climb to the ruined watchtower on the ridge');
    await page.getByTestId('interpret-nl-intent').click();
    await confirmDraft(page);
    await expect(page.getByTestId('map-scene-banner')).toContainText(/watchtower|ridge|tower/i, {
      timeout: 30_000,
    });
    // Materially different layout — tall tower footprint and shutter object.
    await expect(page.getByTestId('map-notable-features')).toContainText(
      /shutter|masonry|parapet|arrow/i,
      { timeout: 20_000 },
    );
    await expect(page.getByTestId('map-scene-banner')).not.toContainText(/Marsh boardwalk/i);
  });

  test('reusability: different premise yields different opening scene', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatAndOpenTable(page, 'CryptLoop', 'a sealed stone crypt under the hill');
    await beginAdventure(page);
    await expect(page.getByTestId('map-scene-banner')).toContainText(
      /crypt|stone|tomb|niche|cresset/i,
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('map-scene-banner')).not.toContainText(/Quiet chamber/i);
  });
});
