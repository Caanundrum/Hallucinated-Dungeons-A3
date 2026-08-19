import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { enterAccountFromShell, readCandidate } from './arena-page.js';

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

test.describe('Phase 2c movement, collision, and visibility', () => {
  test('legal move commits; illegal door cross rejects; fog fields are present', async ({
    page,
  }) => {
    await signIn(page);
    await createQuickCharacter(page, 'Mover Scout');
    const campaignId = await createCampaign(page, 'Movement Chamber');
    await seatOwnCharacter(page);
    await page.getByTestId('open-campaign-table').click();

    await expect(page.getByTestId('table-stage-semantic')).toBeVisible();
    await expect(page.getByTestId('table-turn-title')).toContainText('Exploring freely');
    await page.getByTestId('table-advanced-controls').locator('summary').click();
    await page.getByTestId('commit-table-sync').click();
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 1');

    const origin = new URL(page.url()).origin;
    const candidate = await readCandidate(page);

    const mapBefore = await page.request.get(`/api/campaigns/${campaignId}/map`, {
      headers: { origin, 'x-hd-candidate': candidate.candidateId },
    });
    expect(mapBefore.status()).toBe(200);
    const mapBody = (await mapBefore.json()) as {
      tokens: { footprint: { anchor: { column: number; row: number } } }[];
      visibleSquareIds: string[];
      exploredSquareIds: string[];
      cells: { known: boolean }[];
    };
    expect(mapBody.tokens.length).toBe(1);
    expect(mapBody.visibleSquareIds.length).toBeGreaterThan(0);
    expect(mapBody.exploredSquareIds.length).toBeGreaterThan(0);
    expect(mapBody.cells.some((cell) => cell.known === false)).toBe(true);

    const start = mapBody.tokens[0]!.footprint.anchor;
    const legalTarget = { column: start.column + 1, row: start.row };

    const preview = await page.request.post(`/api/campaigns/${campaignId}/move-preview`, {
      headers: {
        origin,
        'content-type': 'application/json',
        'x-hd-candidate': candidate.candidateId,
      },
      data: { path: [legalTarget] },
    });
    expect(preview.status()).toBe(200);
    const previewBody = (await preview.json()) as { legal: boolean; totalCostFeet: number };
    expect(previewBody.legal).toBe(true);
    expect(previewBody.totalCostFeet).toBe(5);

    const move = await page.request.post(`/api/campaigns/${campaignId}/commands`, {
      headers: {
        origin,
        'content-type': 'application/json',
        'x-hd-candidate': candidate.candidateId,
      },
      data: {
        requestId: randomUUID(),
        commandType: 'table.move',
        expectedStateVersion: 1,
        path: [legalTarget],
      },
    });
    expect(move.status()).toBe(201);
    const moveBody = (await move.json()) as {
      event: { eventType: string };
      table: { stateVersion: number };
    };
    expect(moveBody.event.eventType).toBe('table.token_moved');
    expect(moveBody.table.stateVersion).toBe(2);

    const illegal = await page.request.post(`/api/campaigns/${campaignId}/commands`, {
      headers: {
        origin,
        'content-type': 'application/json',
        'x-hd-candidate': candidate.candidateId,
      },
      data: {
        requestId: randomUUID(),
        commandType: 'table.move',
        expectedStateVersion: 2,
        path: [{ column: 0, row: 1 }],
      },
    });
    expect(illegal.status()).toBe(409);
    const illegalBody = (await illegal.json()) as { error: string };
    expect(illegalBody.error).toBe('ILLEGAL_PATH');

    await page.reload();
    await dismissIntroIfPresent(page);
    await page.getByTestId('table-advanced-controls').locator('summary').click();
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 2');
    await expect(page.getByTestId('commit-table-move')).toBeVisible();
    await expect(page.getByTestId('open-adjacent-door')).toBeVisible();
  });
});
