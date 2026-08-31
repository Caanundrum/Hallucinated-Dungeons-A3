import { expect, test, type Page } from '@playwright/test';

import {
  enterAccountFromShell,
  joinTableWithFirstCharacter,
} from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function seatAndOpenTable(page: Page, name: string): Promise<void> {
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

test.describe('Visual remediation Batch 1', () => {
  test('A: tablet/phone task modes keep map dominant and chat spacer-free', async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatAndOpenTable(page, 'Batch1A');

    await page.setViewportSize({ width: 768, height: 900 });
    await expect(page.getByTestId('mobile-task-map')).toBeVisible();
    await page.getByTestId('mobile-task-play').click();
    await expect(page.getByTestId('table-page-shell')).toHaveAttribute('data-mobile-task', 'play');
    const playMetrics = await page.evaluate(() => {
      const shell = document.querySelector('[data-testid="table-page-shell"]') as HTMLElement;
      const map = document.querySelector('[data-testid="table-map-chrome"]') as HTMLElement | null;
      const action = document.querySelector('[data-testid="action-composer"]') as HTMLElement | null;
      const mapBox = map?.getBoundingClientRect();
      const actionBox = action?.getBoundingClientRect();
      return {
        vh: window.innerHeight,
        mapH: mapBox?.height ?? 0,
        actionH: actionBox?.height ?? 0,
        docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        shellOverflowX: shell.scrollWidth - shell.clientWidth,
      };
    });
    expect(playMetrics.docOverflowX).toBeLessThanOrEqual(1);
    expect(playMetrics.mapH / playMetrics.vh).toBeGreaterThanOrEqual(0.55);
    expect(playMetrics.actionH / playMetrics.vh).toBeLessThanOrEqual(0.35);
    await page.screenshot({ path: '/opt/cursor/artifacts/batch1-a-tablet-768-play.png' });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByTestId('mobile-task-chat').click();
    await expect(page.getByTestId('table-page-shell')).toHaveAttribute('data-mobile-task', 'chat');
    const chatMetrics = await page.evaluate(() => {
      const play = document.querySelector('.table-play-column') as HTMLElement | null;
      const display = play ? getComputedStyle(play).display : 'none';
      const playH = play && display !== 'none' ? play.getBoundingClientRect().height : 0;
      const dock = document.querySelector('[data-testid="communication-dock"]') as HTMLElement;
      const nav = document.querySelector('.table-mobile-task-nav') as HTMLElement;
      return {
        playH,
        playDisplay: display,
        dockTop: dock.getBoundingClientRect().top,
        navBottom: nav.getBoundingClientRect().bottom,
        docH: document.documentElement.scrollHeight,
        clientH: document.documentElement.clientHeight,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(chatMetrics.playDisplay).toBe('none');
    expect(chatMetrics.playH).toBe(0);
    expect(chatMetrics.dockTop).toBeLessThanOrEqual(chatMetrics.navBottom + 8);
    expect(chatMetrics.overflowX).toBeLessThanOrEqual(1);
    await page.screenshot({ path: '/opt/cursor/artifacts/batch1-a-phone-375-chat.png' });

    await page.getByTestId('mobile-task-play').click();
    const composerVisible = await page.evaluate(() => {
      const composer = document.querySelector(
        '[data-testid="player-action-input"]',
      ) as HTMLElement | null;
      if (!composer) return false;
      const box = composer.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= window.innerHeight + 1;
    });
    expect(composerVisible).toBeTruthy();
    await page.screenshot({ path: '/opt/cursor/artifacts/batch1-a-phone-375-play.png' });

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId('table-ambient-hud')).toBeVisible();
    await page.screenshot({ path: '/opt/cursor/artifacts/batch1-a-desktop-1440.png' });
  });

  test('B: sheet modal tabs eliminate ledger overflow', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatAndOpenTable(page, 'Batch1B');

    await page.getByTestId('open-table-sheet-modal').click();
    await expect(page.getByTestId('table-sheet-modal')).toBeVisible();
    await expect(page.getByTestId('sheet-modal-tabs')).toBeVisible();
    await expect(page.getByTestId('sheet-hp-damage')).toHaveCount(0);
    await expect(page.getByTestId('sheet-modal-full-page-link')).toBeVisible();
    await expect(page.locator('.sheet-modal-hint')).toContainText(/read-only|overview|full sheet/i);

    const overflow = await page.evaluate(() => {
      const dialog = document.querySelector(
        '[data-testid="table-sheet-modal-dialog"]',
      ) as HTMLElement;
      const body = document.querySelector('[data-testid="sheet-modal-body"]') as HTMLElement;
      return {
        dialogSW: dialog.scrollWidth,
        dialogCW: dialog.clientWidth,
        bodySW: body.scrollWidth,
        bodyCW: body.clientWidth,
      };
    });
    expect(overflow.dialogSW).toBeLessThanOrEqual(overflow.dialogCW + 1);
    expect(overflow.bodySW).toBeLessThanOrEqual(overflow.bodyCW + 1);
    await page.screenshot({ path: '/opt/cursor/artifacts/batch1-b-sheet-modal-overview.png' });

    await page.getByTestId('sheet-modal-tab-abilities').click();
    await expect(page.getByTestId('sheet-modal-tab-abilities')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const abilitiesOverflow = await page.evaluate(() => {
      const body = document.querySelector('[data-testid="sheet-modal-body"]') as HTMLElement;
      const layout = document.querySelector(
        '[data-testid="character-sheet-layout"]',
      ) as HTMLElement;
      return {
        bodySW: body.scrollWidth,
        bodyCW: body.clientWidth,
        layoutSW: layout.scrollWidth,
        layoutCW: layout.clientWidth,
      };
    });
    expect(abilitiesOverflow.bodySW).toBeLessThanOrEqual(abilitiesOverflow.bodyCW + 1);
    expect(abilitiesOverflow.layoutSW).toBeLessThanOrEqual(abilitiesOverflow.layoutCW + 1);
    await page.screenshot({ path: '/opt/cursor/artifacts/batch1-fix-abilities-no-overflow.png' });

    await page.getByTestId('sheet-modal-tab-features').click();
    await expect(page.getByTestId('sheet-modal-tab-features')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('sheet-modal-tab-equipment')).toHaveCount(0);
    await expect(page.getByTestId('sheet-modal-full-page-link')).toBeVisible();
    await page.screenshot({ path: '/opt/cursor/artifacts/batch1-b-sheet-modal-features.png' });

    await page.setViewportSize({ width: 375, height: 812 });
    const phoneDialog = await page.evaluate(() => {
      const dialog = document.querySelector(
        '[data-testid="table-sheet-modal-dialog"]',
      ) as HTMLElement;
      const box = dialog.getBoundingClientRect();
      return {
        w: box.width,
        h: box.height,
        sw: dialog.scrollWidth,
        cw: dialog.clientWidth,
      };
    });
    expect(phoneDialog.w).toBeGreaterThanOrEqual(370);
    expect(phoneDialog.h).toBeGreaterThanOrEqual(700);
    expect(phoneDialog.sw).toBeLessThanOrEqual(phoneDialog.cw + 1);
    await page.screenshot({ path: '/opt/cursor/artifacts/batch1-b-sheet-modal-phone.png' });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('table-sheet-modal')).toHaveCount(0);
  });

  test('C: each die family shows a distinct face while rolling', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatAndOpenTable(page, 'Batch1C');

    await page.getByTestId('dice-fab').click();
    await expect(page.getByTestId('dice-tray')).toBeVisible();
    await expect(page.getByTestId('dice-tray').locator('[aria-label="Dice"]')).toBeVisible();

    for (const sides of [4, 6, 8, 10, 12, 20, 100]) {
      await page.getByTestId(`dice-roll-d${sides}`).click();
      const tumble = page.getByTestId('dice-tumble');
      await expect(tumble).toBeVisible();
      await expect(tumble).toHaveAttribute('data-sides', String(sides));
      await expect(tumble).toHaveClass(new RegExp(`dice-face-d${sides === 100 ? '100' : sides}`));
      await expect(page.getByTestId('dice-tray-result')).toBeVisible({ timeout: 5_000 });
      const separation = await page.evaluate(() => {
        const label = document.querySelector('.dice-face-label') as HTMLElement | null;
        const result = document.querySelector('[data-testid="dice-tray-result"]') as HTMLElement;
        if (label === null) return { ok: false, gap: -1 };
        const labelBox = label.getBoundingClientRect();
        const resultBox = result.getBoundingClientRect();
        return { ok: true, gap: resultBox.top - labelBox.bottom };
      });
      expect(separation.ok).toBeTruthy();
      expect(separation.gap).toBeGreaterThanOrEqual(8);
    }
    await page.screenshot({ path: '/opt/cursor/artifacts/batch1-fix-dice-label-separated.png' });
  });

  test('A-fix: phone task modes survive repeated Map→Play→Sheet→Chat→Map cycles', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatAndOpenTable(page, 'Batch1Phone');

    const cycle = ['map', 'play', 'sheet', 'chat', 'map'] as const;
    for (let round = 0; round < 3; round += 1) {
      for (const mode of cycle) {
        await page.getByTestId(`mobile-task-${mode}`).click();
        await expect(page.getByTestId('table-page-shell')).toHaveAttribute(
          'data-mobile-task',
          mode,
          { timeout: 5_000 },
        );
        await expect(page.getByTestId(`mobile-task-${mode}`)).toHaveAttribute(
          'aria-pressed',
          'true',
        );
      }
    }

    // After many switches, listener count on the shell must stay at one delegated handler.
    const listenerPressure = await page.evaluate(() => {
      const shell = document.querySelector('[data-testid="table-page-shell"]') as HTMLElement;
      return shell.dataset.mobileTaskBound === '1';
    });
    expect(listenerPressure).toBeTruthy();

    await page.getByTestId('mobile-task-chat').click();
    await expect(page.getByTestId('table-page-shell')).toHaveAttribute('data-mobile-task', 'chat');
    const chatSpacer = await page.evaluate(() => {
      const play = document.querySelector('.table-play-column') as HTMLElement | null;
      return play ? getComputedStyle(play).display : 'none';
    });
    expect(chatSpacer).toBe('none');
    await page.screenshot({ path: '/opt/cursor/artifacts/batch1-fix-phone-mode-cycles.png' });
  });

  test('D: chargen shows one primary stage rail plus local step context', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await page.getByTestId('nav-characters').click();
    await page.getByTestId('start-character').click();
    const tutorialNo = page.getByTestId('tutorial-ask-no');
    if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();

    await expect(page.getByTestId('wizard-carousel')).toBeVisible();
    await expect(page.getByTestId('wizard-stage-context')).toBeVisible();
    await expect(page.getByTestId('wizard-steps')).toHaveCount(0);
    await expect(page.getByTestId('wizard-local-steps')).toBeVisible();
    await expect(page.getByTestId('step-class')).toBeVisible();
    await expect(page.getByTestId('step-species')).toBeVisible();
    await expect(page.getByTestId('step-background')).toHaveCount(0);
    await page.screenshot({ path: '/opt/cursor/artifacts/batch1-d-chargen-desktop.png' });

    await page.getByTestId('open-quick-start').click();
    await page.getByTestId('option-stalwart-defender').click();
    await expect(page.getByTestId('quick-start-applied-notice')).toBeVisible();
    await expect(page.getByTestId('quick-start-applied-notice')).toContainText(/prefilled/i);
    await page.screenshot({ path: '/opt/cursor/artifacts/batch1-d-premade-notice.png' });

    await page.setViewportSize({ width: 375, height: 812 });
    const progressBudget = await page.evaluate(() => {
      const carousel = document.querySelector('[data-testid="wizard-carousel"]') as HTMLElement;
      const context = document.querySelector(
        '[data-testid="wizard-stage-context"]',
      ) as HTMLElement;
      const h =
        (carousel?.getBoundingClientRect().height ?? 0) +
        (context?.getBoundingClientRect().height ?? 0);
      return { h, vh: window.innerHeight };
    });
    expect(progressBudget.h / progressBudget.vh).toBeLessThanOrEqual(0.25);
    await page.screenshot({ path: '/opt/cursor/artifacts/batch1-d-chargen-phone.png' });
  });
});
