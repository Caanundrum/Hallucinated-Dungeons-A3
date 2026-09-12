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
    const composer = document.querySelector(
      '[data-testid="table-player-turn-composer"]',
    ) as HTMLElement | null;
    const expand = document.querySelector('[data-testid="dm-thread-expand"]') as HTMLElement | null;
    const jump = document.querySelector(
      '[data-testid="dm-thread-jump-latest"]',
    ) as HTMLElement | null;
    const tell = document.querySelector('[data-testid="submit-player-action"]') as HTMLElement | null;
    const chrome = document.querySelector('.dm-play-thread-chrome') as HTMLElement | null;
    const banner = document.querySelector('[data-testid="table-turn-banner"]') as HTMLElement | null;
    const sheetLink = document.querySelector('[data-testid="table-character-sheet-link"]');
    const openSheet = document.querySelector('[data-testid="open-table-sheet-modal"]');
    const filter = document.querySelector(
      '[data-testid="chronicle-kind-filter"]',
    ) as HTMLSelectElement | null;
    const as = getComputedStyle(action!);
    const bannerHidden =
      banner === null ||
      banner.classList.contains('visually-hidden') ||
      getComputedStyle(banner).position === 'absolute';
    const bs = banner && !banner.classList.contains('visually-hidden') ? getComputedStyle(banner) : null;
    const actionRect = action?.getBoundingClientRect();
    const composerRect = composer?.getBoundingClientRect();
    const tellRect = tell?.getBoundingClientRect();
    const expandRect = expand?.getBoundingClientRect();
    return {
      playH: play?.clientHeight ?? 0,
      mapH: map?.clientHeight ?? 0,
      actionH: action?.clientHeight ?? 0,
      innerH: inner?.clientHeight ?? 0,
      threadH: thread?.clientHeight ?? 0,
      threadExpanded: thread?.classList.contains('is-expanded') ?? false,
      actionMaxH: as.maxHeight,
      actionFlexGrow: as.flexGrow,
      bannerQuiet: bannerHidden,
      bannerOverflowY: bs?.overflowY ?? 'hidden',
      bannerMaxH: bs?.maxHeight ?? '0px',
      gapPlayMinusChildren:
        play && map && action ? play.clientHeight - map.clientHeight - action.clientHeight : 99,
      bottomDeadSpace:
        actionRect && composerRect ? Math.max(0, actionRect.bottom - composerRect.bottom) : 99,
      expandBesideTell:
        !!tell &&
        !!expand &&
        expand.closest('[data-testid="table-player-actions"]') !== null &&
        !(chrome?.contains(expand) ?? false),
      jumpBesideTell:
        !!jump &&
        jump.closest('[data-testid="table-player-actions"]') !== null &&
        !(chrome?.contains(jump) ?? false),
      expandRightOfTell:
        tellRect && expandRect ? expandRect.left >= tellRect.left - 4 : false,
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
  // Expanded dock may use a viewport cap (e.g. 52vh) so the map keeps room.
  expect(metrics.actionMaxH === 'none' || /px$|vh$|rem$/.test(metrics.actionMaxH)).toBe(true);
  // Exploration chrome is quiet; combat banners still cap height when shown.
  expect(metrics.bannerQuiet || /^(auto|scroll)$/.test(metrics.bannerOverflowY)).toBe(true);
  if (!metrics.bannerQuiet) {
    expect(metrics.bannerMaxH).not.toBe('none');
  }
  expect(metrics.threadExpanded).toBe(true);
  expect(metrics.actionFlexGrow).toBe('0');
  expect(metrics.expandBesideTell).toBe(true);
  expect(metrics.jumpBesideTell).toBe(true);
  expect(metrics.expandRightOfTell).toBe(true);
  expect(metrics.bottomDeadSpace).toBeLessThan(28);
  expect(Math.abs(metrics.gapPlayMinusChildren)).toBeLessThan(12);
  expect(metrics.innerH).toBeGreaterThan(metrics.actionH * 0.45);
  expect(metrics.threadH).toBeGreaterThan(70);
  expect(metrics.actionH).toBeGreaterThan(160);
  await page.screenshot({ path: '/opt/cursor/artifacts/dock-layout-metrics.png' });
});
