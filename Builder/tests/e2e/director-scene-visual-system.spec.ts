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
  await confirmDraft(page);
  await expect(page.getByTestId('map-scene-banner')).not.toContainText(
    /Awaiting first scene|Game Director is ready to establish/i,
    { timeout: 30_000 },
  );
}

test.describe('Director scene visual system', () => {
  test('four scenes show distinct reusable atmosphere families and object states', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatAndOpenTable(page, 'VisSys', 'a misty marsh inn beside the reeds');
    await beginAdventure(page);
    await openTableAdvancedControls(page);

    const stage = page.getByTestId('table-stage-semantic');
    await expect(stage).toHaveAttribute('data-atmosphere', 'enclosed_warm', { timeout: 20_000 });
    await expect(stage).toHaveAttribute('data-light-wash', /wash_torchlit|wash_dim/);
    await expect(page.getByTestId('map-light-marker').first()).toHaveAttribute(
      'data-visual-state',
      'state_lit',
    );
    await page.screenshot({
      path: '/opt/cursor/artifacts/visual-system-interior.webp',
      fullPage: true,
    });

    await page.getByTestId('nl-intent-input').fill('extinguish the lamp');
    await page.getByTestId('interpret-nl-intent').click();
    await confirmDraft(page);
    await expect(page.getByTestId('map-light-marker').first()).toHaveAttribute(
      'data-visual-state',
      'state_unlit',
      { timeout: 20_000 },
    );
    await expect(stage).toHaveAttribute('data-light-wash', 'wash_darkened');

    await page.getByTestId('nl-intent-input').fill('smash the overturned bench');
    await page.getByTestId('interpret-nl-intent').click();
    await confirmDraft(page);
    await expect(page.locator('[data-visual-family="family_cover"][data-visual-state="state_broken"]')).toBeVisible({
      timeout: 20_000,
    });

    await page.getByTestId('nl-intent-input').fill('leave toward the misty marsh');
    await page.getByTestId('interpret-nl-intent').click();
    await confirmDraft(page);
    await expect(stage).toHaveAttribute('data-atmosphere', 'wet_fog', { timeout: 30_000 });
    await expect(stage).toHaveAttribute('data-terrain-bias', 'damp');
    await page.screenshot({
      path: '/opt/cursor/artifacts/visual-system-marsh.webp',
      fullPage: true,
    });

    await page.getByTestId('nl-intent-input').fill('travel onward');
    await page.getByTestId('interpret-nl-intent').click();
    await confirmDraft(page);
    await expect(stage).toHaveAttribute('data-threat', 'threat_encounter', { timeout: 30_000 });
    await expect(page.getByTestId('map-actor-marker').first()).toBeVisible();
    await expect(page.getByTestId('map-actor-marker').first()).toHaveAttribute(
      'data-visual-family',
      /family_npc|family_creature/,
    );
    await page.screenshot({
      path: '/opt/cursor/artifacts/visual-system-encounter.webp',
      fullPage: true,
    });

    await page.getByTestId('nl-intent-input').fill('return to the earlier scene');
    await page.getByTestId('interpret-nl-intent').click();
    await confirmDraft(page);
    // Engage the Director-presented landmark exit on the travel scene.
    await page.getByTestId('nl-intent-input').fill('take the trail toward higher ground');
    await page.getByTestId('interpret-nl-intent').click();
    await confirmDraft(page);
    await expect(stage).toHaveAttribute(
      'data-atmosphere',
      /elevated_exposed|waterfront|cavernous|ruined_open/,
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('map-exit-marker').first()).toBeVisible();
    await page.screenshot({
      path: '/opt/cursor/artifacts/visual-system-watchtower.webp',
      fullPage: true,
    });

    // Phone readability smoke: stage still exposes atmosphere attrs.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(stage).toHaveAttribute(
      'data-atmosphere',
      /elevated_exposed|waterfront|cavernous|ruined_open/,
    );
    await expect(page.getByTestId('map-visual-summary')).toBeVisible();
  });
});
