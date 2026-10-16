import { expect, test, type Page } from '@playwright/test';

import {
  acceptAllLegalForPlay,
  awaitAdventureReady,
  enterAccountFromShell,
  joinTableWithFirstCharacter,
} from './arena-page.js';

/**
 * Phase 1-2 visual blueprint gate (Local Arena).
 *
 * One journey proves the pieces that make a table look and behave like a table:
 * the forged Dwarf Fighter portrait reaches the vault, the table HUD, and the
 * map token; the 12x8 Campaign Blueprint scene paints its battlemap art; the
 * east chamber stays fogged behind a closed door; and declaring the east
 * doorway open reveals it.
 */

const DWARF_PORTRAIT = '/assets/portraits/dwarf_fighter.jpg';
const COLUMNS = 12;
const ROWS = 8;
const FIRST_EAST_COLUMN = 7;
const PREMISE =
  'Bram Ironkettle stands at the bar of the Brass Lantern inn while the cellar stairs behind him creak.';
const ARTIFACTS = '/opt/cursor/artifacts';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function createDwarfFighterWithPortrait(page: Page, name: string): Promise<void> {
  await page.getByTestId('nav-characters').click();
  await page.getByTestId('start-character').click();
  const tutorialNo = page.getByTestId('tutorial-ask-no');
  if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();
  await page.getByTestId('open-quick-start').click();
  await page.getByTestId('option-stalwart-defender').click();
  await page.getByTestId('identity-name').fill(name);
  await page.getByTestId('identity-name').dispatchEvent('change');
  await page
    .getByTestId('identity-physical-appearance')
    .fill('Braided copper beard, steel pauldrons, a notch in the left ear');
  await page.getByTestId('forge-portrait').click();
  await expect(page.getByTestId('portrait-preview')).toHaveAttribute('src', DWARF_PORTRAIT);
  await expect(page.getByTestId('portrait-section')).toContainText('Portrait saved with this draft');
  await expect(page.getByTestId('create-character')).toHaveAttribute('aria-disabled', 'false');
  await page.getByTestId('create-character').click();
  await expect(page.getByTestId('character-sheet-heading')).toHaveText(name);
}

async function createBlueprintCampaign(page: Page, name: string): Promise<string> {
  await page.getByTestId('nav-campaigns').click();
  await page.getByTestId('start-campaign').click();
  await page.getByTestId('campaign-name').fill(name);
  await page.getByTestId('campaign-name').dispatchEvent('change');
  await page.getByTestId('campaign-summary').fill(PREMISE);
  await page.getByTestId('campaign-summary').dispatchEvent('change');
  await page.getByTestId('identity-veyra').click();
  await page.getByTestId('personality-seasoned_host').click();
  await page.getByTestId('create-campaign-submit').click();
  await expect(page.getByTestId('join-table-heading')).toBeVisible();
  const match = page.url().match(/\/campaigns\/([A-Za-z0-9-]+)\/join/);
  expect(match).toBeTruthy();
  const campaignId = match![1]!;
  await joinTableWithFirstCharacter(page);
  await page.goto(`/campaigns/${campaignId}`);
  await expect(page.getByTestId('own-seat')).toBeVisible();
  return campaignId;
}

interface CellFog {
  readonly column: number;
  readonly row: number;
  readonly known: string | null;
}

async function readCellFog(page: Page): Promise<CellFog[]> {
  return page.locator('rect[data-square]').evaluateAll((nodes) =>
    nodes.map((node) => {
      const [column, row] = (node.getAttribute('data-square') ?? '0,0').split(',').map(Number);
      return { column: column!, row: row!, known: node.getAttribute('data-known') };
    }),
  );
}

async function declareAndConfirmIfAsked(page: Page, text: string): Promise<void> {
  await page.getByTestId('player-action-input').fill(text);
  await page.getByTestId('player-action-input').dispatchEvent('input');
  await page.getByTestId('submit-player-action').click();
  const confirm = page.getByTestId('confirm-intent-intercept');
  if (await confirm.isVisible({ timeout: 2_500 }).catch(() => false)) {
    await confirm.click();
    await expect(page.getByTestId('intent-intercept')).toHaveCount(0, { timeout: 20_000 });
  }
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${ARTIFACTS}/${name}.png` }).catch(() => {});
  await page.screenshot({ path: `test-results/${name}.png` }).catch(() => {});
}

test.describe('Phase 1-2 visual blueprint gate', () => {
  test('portrait, painted 12x8 battlemap, closed-door fog, and east doorway reveal', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await acceptAllLegalForPlay(page).catch(() => {});

    await createDwarfFighterWithPortrait(page, 'Duran Gate');
    await expect(page.getByTestId('character-portrait')).toHaveAttribute('src', DWARF_PORTRAIT);

    await page.getByTestId('back-to-vault').click();
    const vaultPortrait = page.getByTestId('vault-portrait').first();
    await expect(vaultPortrait).toHaveAttribute('src', DWARF_PORTRAIT);
    expect(
      await vaultPortrait.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
    ).toBe(true);
    await screenshot(page, 'phase1-2-vault-portrait');

    await createBlueprintCampaign(page, 'Shadows over Gate');
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('table-ambient-hud')).toBeVisible();
    await awaitAdventureReady(page);

    // Painted battlemap art is an SVG <image> inside the tabletop stage.
    const art = page.getByTestId('map-battlemap-art');
    await expect(art).toHaveCount(1);
    const artHref = await art.getAttribute('href');
    expect(artHref).toMatch(/^\/assets\/maps\/.+\.(?:jpg|png|webp)$/);
    expect(await art.evaluate((node) => node.tagName.toLowerCase())).toBe('image');
    const artResponse = await page.request.get(artHref!);
    expect(artResponse.ok()).toBe(true);
    expect(artResponse.headers()['content-type']).toMatch(/^image\//);

    // Portrait token on the map and the HUD portrait both carry the forged avatar.
    const tokenAvatar = page.getByTestId('map-token-avatar').first();
    await expect(tokenAvatar).toHaveAttribute('href', DWARF_PORTRAIT);
    await expect(page.locator('[data-testid="map-token"][data-has-avatar="true"]').first()).toBeVisible();
    const heroAvatar = page.getByTestId('hero-avatar-img');
    await expect(heroAvatar).toHaveAttribute('src', DWARF_PORTRAIT);
    expect(
      await heroAvatar.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
    ).toBe(true);
    await expect(page.getByTestId('hero-class-level')).toContainText(/Lv 1 Fighter/i);

    // Canonical 12x8 grid, no jittered dimensions.
    const closedFog = await readCellFog(page);
    expect(closedFog).toHaveLength(COLUMNS * ROWS);
    expect(Math.max(...closedFog.map((cell) => cell.column))).toBe(COLUMNS - 1);
    expect(Math.max(...closedFog.map((cell) => cell.row))).toBe(ROWS - 1);

    // Closed east door: the east chamber is unknown (fogged) for every row. The scene
    // contract pre-explores exactly one square behind the door: the Cellar exit landmark.
    const eastDoor = page.locator('.map-edge-hit-target[aria-label*="Wooden doorway east"]');
    await expect(eastDoor).toHaveCount(1);
    await expect(eastDoor).toHaveAttribute('aria-label', /closed/i);
    const eastClosed = closedFog.filter((cell) => cell.column >= FIRST_EAST_COLUMN);
    expect(eastClosed).toHaveLength((COLUMNS - FIRST_EAST_COLUMN) * ROWS);
    const eastLeaks = eastClosed.filter((cell) => cell.known !== 'false');
    expect(eastLeaks.length).toBeLessThanOrEqual(1);
    expect(eastClosed.filter((cell) => cell.known === 'false').length).toBeGreaterThanOrEqual(
      eastClosed.length - 1,
    );
    expect(closedFog.some((cell) => cell.column < FIRST_EAST_COLUMN && cell.known === 'true')).toBe(
      true,
    );
    await screenshot(page, 'phase1-2-east-fogged');

    // Declaring the east doorway open walks to it, opens it, and reveals the chamber.
    await declareAndConfirmIfAsked(page, 'I open the wooden doorway to the east.');
    await expect(eastDoor).toHaveAttribute('aria-label', /open/i, { timeout: 30_000 });
    await expect(eastDoor).not.toHaveAttribute('aria-label', /closed/i);
    await expect(page.getByTestId('dm-play-thread')).toContainText(/doorway east/i, {
      timeout: 20_000,
    });

    await expect
      .poll(
        async () =>
          (await readCellFog(page)).filter(
            (cell) => cell.column >= FIRST_EAST_COLUMN && cell.known === 'true',
          ).length,
        { timeout: 20_000 },
      )
      .toBeGreaterThan(eastLeaks.length + 5);
    const openFog = await readCellFog(page);
    expect(openFog).toHaveLength(COLUMNS * ROWS);
    await screenshot(page, 'phase1-2-east-revealed');
  });
});
