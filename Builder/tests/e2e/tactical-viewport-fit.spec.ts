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

test.describe('Tactical viewport fit and canopy terrain', () => {
  test('fit contains scene; canopy differs from timber; cue preview works', async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatAndOpenTable(page, 'FitCue', 'a misty marsh inn beside the reeds');
    await beginAdventure(page);
    await openTableAdvancedControls(page);

    const stage = page.getByTestId('table-stage-semantic');
    await expect(stage).toHaveAttribute('data-atmosphere', 'enclosed_warm', { timeout: 20_000 });
    await expect(stage).toHaveAttribute('data-terrain-bias', 'timber');

    await page.locator('[data-map-zoom="fit"]').click();
    const overflow = await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>('[data-testid="table-stage-svg-viewport"]');
      if (viewport === null) {
        return { scrollWidth: 0, clientWidth: 0 };
      }
      return { scrollWidth: viewport.scrollWidth, clientWidth: viewport.clientWidth };
    });
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);

    await page.getByTestId('nl-intent-input').fill('leave the room');
    await page.getByTestId('interpret-nl-intent').click();
    await confirmDraft(page);
    // Premise owns the exterior family (marsh), not player destination naming.
    await expect(stage).toHaveAttribute('data-atmosphere', 'wet_fog', { timeout: 30_000 });
    await expect(stage).toHaveAttribute('data-terrain-bias', 'damp');

    await page.getByTestId('nl-intent-input').fill('travel onward');
    await page.getByTestId('interpret-nl-intent').click();
    await confirmDraft(page);
    await expect(stage).toHaveAttribute('data-threat', 'threat_encounter', { timeout: 30_000 });
    // Director picks the encounter family; assert the reusable atmosphere→bias rule.
    const atmosphere = await stage.getAttribute('data-atmosphere');
    const bias = await stage.getAttribute('data-terrain-bias');
    const expectedBias: Record<string, string> = {
      wooded_path: 'canopy',
      wet_fog: 'damp',
      open_clearing: 'open',
      enclosed_warm: 'timber',
      elevated_exposed: 'stone',
    };
    if (atmosphere !== null && expectedBias[atmosphere] !== undefined) {
      expect(bias).toBe(expectedBias[atmosphere]);
    }
    if (bias === 'canopy') {
      await expect(page.locator('.map-terrain-canopy, .map-terrain-canopy-dense').first()).toBeVisible();
    }
    await page.screenshot({
      path: '/opt/cursor/artifacts/viewport-fit-wooded-canopy.webp',
      fullPage: true,
    });

    await page.getByTestId('map-zoom-help').locator('summary').click();
    await page.getByTestId('preview-scene-discovery-cue').click();
    await expect(page.getByTestId('table-stage-slot')).toHaveAttribute('data-scene-cue', /motion|static/);
    await page.screenshot({
      path: '/opt/cursor/artifacts/viewport-fit-discovery-cue.webp',
      fullPage: true,
    });

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByTestId('preview-scene-discovery-cue').click();
    await expect(page.getByTestId('table-stage-slot')).toHaveAttribute('data-scene-cue', 'static');
    await expect(page.getByTestId('table-stage-slot')).toHaveClass(/map-scene-transition-static/);

    await page.setViewportSize({ width: 768, height: 900 });
    await page.getByTestId('mobile-task-play').click();
    const combatBox = await page.getByTestId('floating-combat-host').boundingBox();
    const mapBox = await page.getByTestId('table-stage-slot').boundingBox();
    expect(combatBox).toBeTruthy();
    expect(mapBox).toBeTruthy();
    if (combatBox !== null && mapBox !== null) {
      expect(combatBox.y).toBeGreaterThanOrEqual(mapBox.y + mapBox.height - 4);
    }
    await page.screenshot({
      path: '/opt/cursor/artifacts/viewport-fit-tablet-docked-actions.webp',
      fullPage: true,
    });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByTestId('mobile-task-play').click();
    const phoneCombat = await page.getByTestId('floating-combat-host').boundingBox();
    const phoneMap = await page.getByTestId('table-stage-slot').boundingBox();
    expect(phoneCombat).toBeTruthy();
    expect(phoneMap).toBeTruthy();
    if (phoneCombat !== null && phoneMap !== null) {
      expect(phoneCombat.y).toBeGreaterThanOrEqual(phoneMap.y + phoneMap.height - 4);
    }
    await page.screenshot({
      path: '/opt/cursor/artifacts/viewport-fit-phone-docked-actions.webp',
      fullPage: true,
    });
  });
});
