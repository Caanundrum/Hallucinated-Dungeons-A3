import { expect, test, type Page } from '@playwright/test';

import { enterAccountFromShell, readCandidate } from './arena-page.js';

/**
 * Phase 2 chunk 2b: map schemas projected by the server and rendered by a
 * Vanilla PixiJS stage inside the campaign table shell.
 */

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
  }
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await dismissIntroIfPresent(page);
  await enterAccountFromShell(page);
}

async function createQuickCharacter(page: Page, name: string): Promise<void> {
  await page.getByTestId('nav-characters').click();
  await expect(page.getByTestId('vault-heading')).toBeVisible();
  await page.getByTestId('start-character').click();
  await page.getByTestId('tutorial-ask-no').click();
  await page.getByTestId('open-quick-start').click();
  await page.getByTestId('option-stalwart-defender').click();
  await expect(page.getByTestId('active-step-heading')).toHaveText('Identity & Final Review');
  await page.getByTestId('identity-name').fill(name);
  await page.getByTestId('identity-name').dispatchEvent('change');
  await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
  await page.getByTestId('create-character').click();
  await expect(page.getByTestId('character-sheet-heading')).toHaveText(name);
}

async function createCampaign(page: Page, name: string): Promise<string> {
  await page.getByTestId('nav-campaigns').click();
  await page.getByTestId('start-campaign').click();
  await page.getByTestId('campaign-name').fill(name);
  await page.getByTestId('campaign-name').dispatchEvent('change');
  await page.getByTestId('identity-veyra').click();
  await page.getByTestId('personality-seasoned_host').click();
  await page.getByTestId('create-campaign-submit').click();
  await expect(page.getByTestId('campaign-detail-heading')).toHaveText(name);
  return page.url().split('/').pop()!;
}

async function seatOwnCharacter(page: Page): Promise<void> {
  const seatSelect = page.getByTestId('seat-character-select');
  const characterId = await seatSelect.locator('option').nth(1).getAttribute('value');
  expect(characterId).toBeTruthy();
  await seatSelect.selectOption(characterId!);
  await page.getByTestId('create-seat').click();
  await expect(page.getByTestId('own-seat')).toBeVisible();
}

test.describe('Phase 2b map schemas and Pixi stage', () => {
  test('server map projection mounts a Vanilla Pixi canvas with seated token metadata', async ({
    page,
  }) => {
    await signIn(page);
    await createQuickCharacter(page, 'Map Stage Scout');
    const campaignId = await createCampaign(page, 'Pixi Chamber');
    await seatOwnCharacter(page);

    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('map-bundle-meta')).toContainText('Local starter chamber');
    await expect(page.getByTestId('map-bundle-meta')).toContainText('12×8 squares');
    await expect(page.getByTestId('map-bundle-meta')).toContainText('5 ft/square');
    await expect(page.getByTestId('map-bundle-meta')).toContainText('procedural local placeholder');

    await expect(page.getByTestId('table-stage-canvas')).toBeVisible();
    await expect(page.getByTestId('table-stage-error')).toHaveCount(0);

    const origin = new URL(page.url()).origin;
    const candidate = await readCandidate(page);
    const mapResponse = await page.request.get(`/api/campaigns/${campaignId}/map`, {
      headers: {
        origin,
        'x-hd-candidate': candidate.candidateId,
      },
    });
    expect(mapResponse.status()).toBe(200);
    const mapBody = (await mapResponse.json()) as {
      coordinateSpace: { schemaVersion: string; columns: number; rows: number };
      cells: unknown[];
      edges: { kind: string }[];
      tokens: { label: string; footprint: { size: string } }[];
      artProvenance: string;
    };
    expect(mapBody.coordinateSpace.schemaVersion).toBe('phase2-map-v1');
    expect(mapBody.coordinateSpace.columns).toBe(12);
    expect(mapBody.coordinateSpace.rows).toBe(8);
    expect(mapBody.cells.length).toBe(96);
    expect(mapBody.edges.some((edge) => edge.kind === 'door')).toBe(true);
    expect(mapBody.tokens.some((token) => token.label === 'Map Stage Scout')).toBe(true);
    expect(mapBody.artProvenance).toBe('procedural_local_placeholder');

    // Prove we did not pull in the banned React-Pixi bridge.
    const banned = await page.evaluate(() => {
      return Boolean(
        (window as unknown as { __PIXI_REACT__?: unknown }).__PIXI_REACT__ ||
          document.querySelector('[data-pixi-react]'),
      );
    });
    expect(banned).toBe(false);
  });
});
