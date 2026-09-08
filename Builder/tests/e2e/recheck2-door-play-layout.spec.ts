import { expect, test, type Page } from '@playwright/test';

import {
  acceptAllLegalForPlay,
  enterAccountFromShell,
  joinTableWithFirstCharacter,
} from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function seatQuietChamber(page: Page, name: string): Promise<void> {
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
  await joinTableWithFirstCharacter(page);
  // Join may already land on the table; otherwise open it from the campaign page.
  if (!(await page.getByTestId('action-composer').isVisible().catch(() => false))) {
    const openTable = page.getByTestId('open-campaign-table');
    if (await openTable.isVisible().catch(() => false)) {
      await openTable.click();
    }
  }
  await expect(page.getByTestId('action-composer')).toBeVisible({ timeout: 30_000 });
  const begin = page.getByTestId('begin-adventure');
  if (await begin.isVisible().catch(() => false)) {
    await begin.click();
    // Begin posts an intent draft — confirm it when present.
    const confirm = page.getByTestId('confirm-intent-intercept');
    if (await confirm.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await confirm.click();
    }
    await expect(page.getByTestId('map-scene-banner')).toBeVisible({ timeout: 45_000 });
  }
}

test.describe('Recheck 2 door + play layout', () => {
  test('1081×898 keeps action composer in viewport', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1081, height: 898 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await acceptAllLegalForPlay(page);
    await seatQuietChamber(page, 'Layout1081');
    const metrics = await page.evaluate(() => {
      const action = document.querySelector('[data-testid="action-composer"]') as HTMLElement | null;
      const input = document.querySelector('[data-testid="player-action-input"]') as HTMLElement | null;
      const rect = action?.getBoundingClientRect();
      const inputRect = input?.getBoundingClientRect();
      return {
        actionH: action?.clientHeight ?? 0,
        actionTop: rect?.top ?? -1,
        actionBottom: rect?.bottom ?? -1,
        inputH: input?.clientHeight ?? 0,
        inputVisible:
          inputRect !== undefined &&
          inputRect.height > 0 &&
          inputRect.top < window.innerHeight &&
          inputRect.bottom > 0,
        viewportH: window.innerHeight,
      };
    });
    await page.screenshot({
      path: '/opt/cursor/artifacts/recheck2_layout_1081_play_visible.png',
      fullPage: false,
    });
    expect(metrics.actionH).toBeGreaterThan(120);
    expect(metrics.inputVisible).toBe(true);
    expect(metrics.actionTop).toBeLessThan(metrics.viewportH);
    expect(metrics.actionBottom).toBeGreaterThan(0);
  });

  test('close open doorway updates map; already-beside is explicit', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await acceptAllLegalForPlay(page);
    await seatQuietChamber(page, 'CloseDoor');

    // Approach and open first.
    for (let step = 0; step < 10; step += 1) {
      await page.getByTestId('player-action-input').fill(
        'I open the unlocked doorway and step through.',
      );
      await page.getByTestId('player-action-input').dispatchEvent('input');
      await page.getByTestId('submit-player-action').click();
      await expect(page.getByTestId('intent-intercept')).toBeVisible({ timeout: 15_000 });
      const summary = await page.getByTestId('intent-intercept-summary').innerText();
      if (/closer only|move beside|step toward/i.test(summary)) {
        await page.getByTestId('confirm-intent-intercept').click();
        await expect(page.getByTestId('intent-intercept')).toHaveCount(0, { timeout: 15_000 });
        continue;
      }
      if (/Ready to open/i.test(summary)) {
        await page.getByTestId('confirm-intent-intercept').click();
        await expect(page.getByTestId('intent-intercept')).toHaveCount(0, { timeout: 15_000 });
        break;
      }
      // Already open / move through — confirm and stop.
      await page.getByTestId('confirm-intent-intercept').click();
      await expect(page.getByTestId('intent-intercept')).toHaveCount(0, { timeout: 15_000 });
      break;
    }

    await expect(page.getByTestId('map-terrain-summary')).toContainText(/open/i, { timeout: 15_000 });

    // Already beside the open doorway.
    await page.getByTestId('player-action-input').fill(
      'I move beside the open wooden doorway east and stop there.',
    );
    await page.getByTestId('player-action-input').dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    await expect(page.getByTestId('intent-intercept')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('intent-intercept-summary')).toContainText(/already beside/i);
    await page.getByTestId('confirm-intent-intercept').click();
    await expect(page.getByTestId('intent-intercept')).toHaveCount(0, { timeout: 15_000 });

    // Close must mutate door authority — not "already in that state".
    await page.getByTestId('player-action-input').fill('I close the wooden doorway east.');
    await page.getByTestId('player-action-input').dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    await expect(page.getByTestId('intent-intercept')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('intent-intercept-summary')).toContainText(/close/i);
    await expect(page.getByTestId('intent-intercept-summary')).not.toContainText(
      /already in that state/i,
    );
    await page.getByTestId('confirm-intent-intercept').click();
    await expect(page.getByTestId('intent-intercept')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId('map-terrain-summary')).toContainText(/closed/i, {
      timeout: 15_000,
    });
    await page.screenshot({
      path: '/opt/cursor/artifacts/recheck2_door_closed_after_confirm.png',
      fullPage: false,
    });

    // Lock query while closed+unlocked must not say "lock is open".
    await page.getByTestId('player-action-input').fill(
      'I check whether the wooden doorway east is locked, but I do not open or close it.',
    );
    await page.getByTestId('player-action-input').dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    const intercept = page.getByTestId('intent-intercept');
    if (await intercept.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await page.getByTestId('confirm-intent-intercept').click();
      await expect(intercept).toHaveCount(0, { timeout: 15_000 });
    }
    await expect
      .poll(async () => page.locator('[data-testid="dm-play-thread"]').innerText(), {
        timeout: 20_000,
      })
      .toMatch(/unlocked|locked|closed/i);
    const threadText = await page.locator('[data-testid="dm-play-thread"]').innerText();
    expect(threadText).not.toMatch(/lock is already open/i);
    await page.screenshot({
      path: '/opt/cursor/artifacts/recheck2_lock_query_reply.png',
      fullPage: false,
    });
  });

  test('named premise entities and location art appear on opening scene', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await acceptAllLegalForPlay(page);

    await page.getByTestId('nav-characters').click();
    await page.getByTestId('start-character').click();
    const tutorialNo = page.getByTestId('tutorial-ask-no');
    if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();
    await page.getByTestId('open-quick-start').click();
    await page.getByTestId('option-stalwart-defender').click();
    await page.getByTestId('identity-name').fill('PremisePip');
    await page.getByTestId('identity-name').dispatchEvent('change');
    await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
    await page.getByTestId('create-character').click();

    await page.getByTestId('nav-campaigns').click();
    await page.getByTestId('start-campaign').click();
    await page.getByTestId('campaign-name').fill('Premise Named Camp');
    await page.getByTestId('campaign-name').dispatchEvent('change');
    const premise =
      'At the Blue Heron, Mara Venn waits for a missing courier. A broken silver lantern and locked red warehouse door mark the canal loft.';
    await page.getByTestId('campaign-summary').fill(premise);
    await page.getByTestId('campaign-summary').dispatchEvent('input');
    await page.getByTestId('campaign-summary').dispatchEvent('change');
    await expect(page.getByTestId('premise-committed-facts')).toContainText(/Blue Heron/i);
    await expect(page.getByTestId('premise-committed-facts')).toContainText(/Mara Venn/i);
    await page.getByTestId('identity-garrick').click();
    await page.getByTestId('personality-seasoned_host').click();
    await page.getByTestId('create-campaign-submit').click();
    await expect(page.getByTestId('join-table-heading')).toBeVisible();
    await joinTableWithFirstCharacter(page);
    if (!(await page.getByTestId('action-composer').isVisible().catch(() => false))) {
      const openTable = page.getByTestId('open-campaign-table');
      if (await openTable.isVisible().catch(() => false)) await openTable.click();
    }
    await expect(page.getByTestId('action-composer')).toBeVisible({ timeout: 30_000 });
    const begin = page.getByTestId('begin-adventure');
    if (await begin.isVisible().catch(() => false)) {
      await begin.click();
      const confirm = page.getByTestId('confirm-intent-intercept');
      if (await confirm.isVisible({ timeout: 5_000 }).catch(() => false)) await confirm.click();
    }
    await expect
      .poll(async () => page.getByTestId('map-scene-banner').innerText().catch(() => ''), {
        timeout: 60_000,
      })
      .toMatch(/canal|warehouse|loft|inn|chamber|room/i);
    await expect(page.getByTestId('scene-location-backdrop')).toBeVisible();
    await expect
      .poll(
        async () => {
          const summary =
            (await page.getByTestId('map-terrain-summary').innerText().catch(() => '')) ?? '';
          const labels = await page.locator('[data-testid="map-label-chip"]').allInnerTexts();
          const thread =
            (await page.locator('[data-testid="dm-play-thread"]').innerText().catch(() => '')) ?? '';
          return `${summary}\n${labels.join(' ')}\n${thread}`;
        },
        { timeout: 45_000 },
      )
      .toMatch(/Blue Heron/i);
    const mapHay = await page.evaluate(() => {
      const summary = document.querySelector('[data-testid="map-terrain-summary"]')?.textContent ?? '';
      const labels = Array.from(document.querySelectorAll('[data-testid="map-label-chip"]'))
        .map((el) => el.textContent ?? '')
        .join(' ');
      const thread = document.querySelector('[data-testid="dm-play-thread"]')?.textContent ?? '';
      return `${summary}\n${labels}\n${thread}`;
    });
    expect(mapHay).toMatch(/Mara Venn/i);
    expect(mapHay).toMatch(/silver lantern/i);
    expect(mapHay).toMatch(/red warehouse door|locked red/i);
    await page.screenshot({
      path: '/opt/cursor/artifacts/recheck2_premise_entities_map.png',
      fullPage: false,
    });

    // Report wrong resolution requires confirm + reason (no instant public beat).
    const reportBtn = page.getByTestId('report-wrong-resolution').first();
    if (await reportBtn.isVisible().catch(() => false)) {
      await reportBtn.click();
      await expect(page.getByTestId('wrong-resolution-report')).toBeVisible();
      await page.getByTestId('wrong-resolution-report-reason').fill('Premise entities were missing before this fix.');
      await page.screenshot({
        path: '/opt/cursor/artifacts/recheck2_report_confirm_modal.png',
        fullPage: false,
      });
      await page.getByTestId('wrong-resolution-report-cancel').click();
      await expect(page.getByTestId('wrong-resolution-report')).toHaveCount(0);
    }
  });
});
