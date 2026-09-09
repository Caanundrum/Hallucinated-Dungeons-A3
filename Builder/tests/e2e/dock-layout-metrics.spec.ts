import { expect, test } from '@playwright/test';
import { enterAccountFromShell, joinTableWithFirstCharacter } from './arena-page.js';

async function dismissIntroIfPresent(page) {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

test('dock layout metrics', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await dismissIntroIfPresent(page);
  await enterAccountFromShell(page);
  await page.getByTestId('nav-characters').click();
  await page.getByTestId('start-character').click();
  const tutorialNo = page.getByTestId('tutorial-ask-no');
  if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();
  await page.getByTestId('open-quick-start').click();
  await page.getByTestId('option-stalwart-defender').click();
  await page.getByTestId('identity-name').fill('DockMeasure');
  await page.getByTestId('identity-name').dispatchEvent('change');
  await page.getByTestId('create-character').click();
  await page.getByTestId('nav-campaigns').click();
  await page.getByTestId('start-campaign').click();
  await page.getByTestId('campaign-name').fill('Dock Measure Camp');
  await page.getByTestId('campaign-name').dispatchEvent('change');
  await page.getByTestId('identity-veyra').click();
  await page.getByTestId('personality-seasoned_host').click();
  await page.getByTestId('create-campaign-submit').click();
  await expect(page.getByTestId('join-table-heading')).toBeVisible();
  await joinTableWithFirstCharacter(page);
  await expect(page.getByTestId('action-composer')).toBeVisible();
  const metrics = await page.evaluate(() => {
    const play = document.querySelector('main.table-play-column') as HTMLElement | null;
    const map = document.querySelector('[data-testid="table-map-chrome"]') as HTMLElement | null;
    const action = document.querySelector('[data-testid="action-composer"]') as HTMLElement | null;
    const inner = document.querySelector('.table-action-bar-inner') as HTMLElement | null;
    const thread = document.querySelector('[data-testid="dm-play-thread"]') as HTMLElement | null;
    const banner = document.querySelector('[data-testid="table-turn-banner"]') as HTMLElement | null;
    const sheetLink = document.querySelector('[data-testid="table-character-sheet-link"]');
    const openSheet = document.querySelector('[data-testid="open-table-sheet-modal"]');
    const filter = document.querySelector(
      '[data-testid="chronicle-kind-filter"]',
    ) as HTMLSelectElement | null;
    const as = getComputedStyle(action!);
    const bs = getComputedStyle(banner!);
    return {
      playH: play?.clientHeight ?? 0,
      mapH: map?.clientHeight ?? 0,
      actionH: action?.clientHeight ?? 0,
      innerH: inner?.clientHeight ?? 0,
      threadH: thread?.clientHeight ?? 0,
      actionMaxH: as.maxHeight,
      bannerOverflowY: bs.overflowY,
      bannerMaxH: bs.maxHeight,
      gapPlayMinusChildren:
        play && map && action ? play.clientHeight - map.clientHeight - action.clientHeight : 99,
      sheetLinkPresent: !!sheetLink,
      openSheetPresent: !!openSheet,
      chronicleFilter: filter?.value ?? '',
      slotFlexes:
        getComputedStyle(
          document.querySelector('[data-testid="table-action-slot"]') as HTMLElement,
        ).flexGrow === '1',
    };
  });
  console.log('DOCK_METRICS', JSON.stringify(metrics));
  expect(metrics.sheetLinkPresent).toBe(false);
  expect(metrics.openSheetPresent).toBe(true);
  expect(metrics.chronicleFilter).toBe('');
  expect(metrics.actionMaxH).toBe('none');
  // Banner is capped so it cannot starve the timeline (recheck: 72px thread).
  expect(metrics.bannerOverflowY).toMatch(/auto|scroll/);
  expect(metrics.bannerMaxH).not.toBe('none');
  expect(metrics.slotFlexes).toBe(true);
  expect(Math.abs(metrics.gapPlayMinusChildren)).toBeLessThan(12);
  expect(metrics.innerH).toBeGreaterThan(metrics.actionH * 0.8);
  expect(metrics.threadH).toBeGreaterThan(70);
  expect(metrics.actionH).toBeGreaterThan(200);
  // Map-first shell: the tactical stage should dominate the play column.
  expect(metrics.mapH).toBeGreaterThan(metrics.actionH * 0.9);
  await page.screenshot({ path: '/opt/cursor/artifacts/dock-layout-metrics.png' });
});
