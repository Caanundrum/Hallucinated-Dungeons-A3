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

test.describe('Tactical scene presence and atmosphere', () => {
  test('Quiet chamber presence, hierarchy, token, responsive modes', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatAndOpenTable(page, 'AtmScene');

    await expect(page.getByTestId('map-scene-banner')).toContainText(/Quiet chamber/i);
    await expect(page.getByTestId('table-stage-svg')).toBeVisible();
    await expect(page.getByTestId('map-token')).toBeVisible();

    // Atmosphere markers + door threshold remain interactive / named.
    await expect(page.locator('[data-notable-feature*="Wall sconce"]')).toBeVisible();
    await expect(page.locator('[data-notable-feature*="Rubble pile"]')).toBeVisible();
    await expect(page.locator('[data-notable-feature*="Damp stones"]')).toBeVisible();
    await expect(page.locator('.map-poi-torch')).toBeVisible();
    await expect(page.locator('.map-poi-rubble')).toBeVisible();
    await expect(page.locator('.map-poi-damp')).toBeVisible();
    await expect(page.locator('.map-edge-door')).toBeVisible();
    await expect(page.locator('.map-fog-depth').first()).toBeVisible();
    await expect(page.locator('.map-terrain-texture').first()).toBeVisible();

    // Token keeps accessible name and deliberate body treatment.
    const token = page.getByTestId('map-token');
    await expect(token).toHaveAttribute('aria-label', /token on the map/i);
    await expect(token.locator('.token-body-outer')).toBeVisible();
    await expect(token.locator('.token-halo')).toBeVisible();

    // Fit / zoom controls still work; presence fill keeps the map substantial.
    await page.getByRole('button', { name: 'Fit map to viewport' }).click();
    const fitMetrics = await page.evaluate(() => {
      const viewport = document.querySelector(
        '[data-testid="table-stage-svg-viewport"]',
      ) as HTMLElement;
      const scaler = document.querySelector(
        '[data-testid="table-stage-svg-scaler"]',
      ) as HTMLElement;
      const mapChrome = document.querySelector(
        '[data-testid="table-map-chrome"]',
      ) as HTMLElement | null;
      const vp = viewport.getBoundingClientRect();
      const sc = scaler.getBoundingClientRect();
      const chrome = mapChrome?.getBoundingClientRect();
      return {
        fillRatio: Math.min(sc.width / vp.width, sc.height / vp.height),
        mapShare: chrome ? chrome.height / window.innerHeight : 0,
        cellCssApprox: sc.width / 12,
      };
    });
    expect(fitMetrics.fillRatio).toBeGreaterThan(0.85);
    expect(fitMetrics.mapShare).toBeGreaterThan(0.4);
    expect(fitMetrics.cellCssApprox).toBeGreaterThanOrEqual(28);

    // Destination highlight styling is wired (selection is exercised in smoke-spine).
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const sheet = [...document.styleSheets];
          try {
            return sheet.some((s) => {
              try {
                return [...(s.cssRules ?? [])].some((rule) =>
                  String((rule as CSSStyleRule).selectorText ?? '').includes('map-square-selected'),
                );
              } catch {
                return false;
              }
            });
          } catch {
            return false;
          }
        }),
      )
      .toBe(true);
    await expect(page.locator('rect.map-square-floor').first()).toBeVisible();

    await page.screenshot({
      path: '/opt/cursor/artifacts/tactical-atmosphere-1440-quiet-chamber.png',
    });

    // Tablet Batch 1 proportions preserved.
    await page.setViewportSize({ width: 768, height: 900 });
    await expect(page.getByTestId('mobile-task-map')).toBeVisible();
    await page.getByTestId('mobile-task-map').click();
    await expect(page.getByTestId('table-page-shell')).toHaveAttribute('data-mobile-task', 'map');
    const tabletMap = await page.evaluate(() => {
      const map = document.querySelector('[data-testid="table-map-chrome"]') as HTMLElement;
      return map.getBoundingClientRect().height / window.innerHeight;
    });
    expect(tabletMap).toBeGreaterThanOrEqual(0.55);
    await page.getByTestId('mobile-task-play').click();
    await expect(page.getByTestId('table-page-shell')).toHaveAttribute('data-mobile-task', 'play');
    await page.screenshot({
      path: '/opt/cursor/artifacts/tactical-atmosphere-768-map.png',
    });

    // Phone map focus + play composer access.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByTestId('mobile-task-map').click();
    await expect(page.getByTestId('table-page-shell')).toHaveAttribute('data-mobile-task', 'map');
    await expect(page.getByTestId('table-stage-svg')).toBeVisible();
    await expect(page.getByTestId('map-token')).toBeVisible();
    const phoneOverflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      shell:
        (document.querySelector('[data-testid="table-page-shell"]') as HTMLElement).scrollWidth -
        (document.querySelector('[data-testid="table-page-shell"]') as HTMLElement).clientWidth,
    }));
    expect(phoneOverflow.doc).toBeLessThanOrEqual(1);
    expect(phoneOverflow.shell).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: '/opt/cursor/artifacts/tactical-atmosphere-375-map.png',
    });

    await page.getByTestId('mobile-task-play').click();
    await expect(page.getByTestId('table-page-shell')).toHaveAttribute('data-mobile-task', 'play');
    const composer = page.getByTestId('action-composer');
    await expect(composer).toBeVisible();
    const composerInView = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="action-composer"]') as HTMLElement;
      const box = el.getBoundingClientRect();
      return box.top < window.innerHeight && box.bottom > 0;
    });
    expect(composerInView).toBe(true);
    await page.screenshot({
      path: '/opt/cursor/artifacts/tactical-atmosphere-375-play.png',
    });

    // Reduced-motion / low-effects: atmosphere remains understandable without glow animation.
    await page.evaluate(() => document.documentElement.classList.add('hd-low-effects'));
    await page.getByRole('button', { name: 'Fit map to viewport' }).click();
    await expect(page.locator('.map-poi-torch .map-poi-core')).toBeVisible();
    await expect(page.locator('.map-edge-door')).toBeVisible();
    await expect(page.getByTestId('map-token').locator('.token-halo')).toBeVisible();
  });
});
