import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { recordDefaultSessionZero, enterAccountFromShell, readCandidate, openTableAdvancedControls} from './arena-page.js';

/**
 * Phase 2 chunk 2e: two-client table projection sync, reconnect, recovery.
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
    await recordDefaultSessionZero(page);
    await seatSelect.selectOption(characterId!);
  await page.getByTestId('create-seat').click();
  await expect(page.getByTestId('own-seat')).toBeVisible();
}

test.describe('Phase 2e two-client sync and recovery', () => {
  test('guest recovers owner sync/move via poll and both match after reload', async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signIn(ownerPage);
    await createQuickCharacter(ownerPage, 'Sync Owner Guard');
    const campaignId = await createCampaign(ownerPage, 'Two Client Sync Table');
    await seatOwnCharacter(ownerPage);

    await ownerPage.getByTestId('create-invite').click();
    const invitePath = (await ownerPage.getByTestId('invite-path').innerText()).trim();

    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await guestPage.goto(invitePath);
    await dismissIntroIfPresent(guestPage);
    await guestPage.getByTestId('invite-sign-in').click();
    await expect(guestPage.getByTestId('invite-accept')).toBeVisible();
    await guestPage.getByTestId('invite-accept').click();
    await expect(guestPage.getByTestId('campaign-detail-heading')).toHaveText(
      'Two Client Sync Table',
    );
    await createQuickCharacter(guestPage, 'Sync Guest Scout');
    await guestPage.goto(`/campaigns/${campaignId}`);
    await seatOwnCharacter(guestPage);

    await ownerPage.getByTestId('open-campaign-table').click();
    await guestPage.getByTestId('open-campaign-table').click();
    await openTableAdvancedControls(ownerPage);
    await openTableAdvancedControls(guestPage);
    await expect(ownerPage.getByTestId('table-state-meta')).toContainText('Table state version 0');
    await expect(guestPage.getByTestId('table-state-meta')).toContainText('Table state version 0');
    await expect(guestPage.getByTestId('refresh-table-projection')).toBeVisible();

    await expect(ownerPage.getByTestId('timing-authority-meta')).toContainText('Exploration');
    await ownerPage.getByTestId('commit-table-sync').click();
    await expect(ownerPage.getByTestId('table-state-meta')).toContainText('Table state version 1');

    // Guest poll (2s) or explicit refresh should recover the same version.
    await expect(guestPage.getByTestId('table-state-meta')).toContainText('Table state version 1', {
      timeout: 8000,
    });
    await expect(guestPage.getByTestId('timing-authority-meta')).toContainText('Exploration', {
      timeout: 8000,
    });

    const origin = new URL(ownerPage.url()).origin;
    const ownerCandidate = await readCandidate(ownerPage);

    const detail = await ownerPage.request.get(`/api/campaigns/${campaignId}`, {
      headers: { origin, 'x-hd-candidate': ownerCandidate.candidateId },
    });
    const detailBody = (await detail.json()) as {
      ownSeat: { seatId: string } | null;
    };
    expect(detailBody.ownSeat?.seatId).toBeTruthy();

    const mapBefore = await ownerPage.request.get(`/api/campaigns/${campaignId}/map`, {
      headers: { origin, 'x-hd-candidate': ownerCandidate.candidateId },
    });
    const mapBody = (await mapBefore.json()) as {
      tokens: { seatId: string; footprint: { anchor: { column: number; row: number } } }[];
    };
    const ownerToken = mapBody.tokens.find((token) => token.seatId === detailBody.ownSeat!.seatId);
    expect(ownerToken).toBeTruthy();
    const legalTarget = {
      column: ownerToken!.footprint.anchor.column + 1,
      row: ownerToken!.footprint.anchor.row,
    };

    const move = await ownerPage.request.post(`/api/campaigns/${campaignId}/commands`, {
      headers: {
        origin,
        'content-type': 'application/json',
        'x-hd-candidate': ownerCandidate.candidateId,
      },
      data: {
        requestId: randomUUID(),
        commandType: 'table.move',
        expectedStateVersion: 1,
        path: [legalTarget],
      },
    });
    expect(move.status()).toBe(201);

    await expect(ownerPage.getByTestId('table-state-meta')).toContainText('Table state version 2', {
      timeout: 8000,
    });
    await expect(guestPage.getByTestId('table-state-meta')).toContainText('Table state version 2', {
      timeout: 8000,
    });

    // Explicit refresh + reload recovery on both clients.
    await guestPage.getByTestId('refresh-table-projection').click();
    await expect(guestPage.getByTestId('table-state-meta')).toContainText('Table state version 2');

    await ownerPage.reload();
    await dismissIntroIfPresent(ownerPage);
    await guestPage.reload();
    await dismissIntroIfPresent(guestPage);
    await expect(ownerPage.getByTestId('table-state-meta')).toContainText('Table state version 2');
    await expect(guestPage.getByTestId('table-state-meta')).toContainText('Table state version 2');

    const guestCandidate = await readCandidate(guestPage);
    const ownerMap = await ownerPage.request.get(`/api/campaigns/${campaignId}/map`, {
      headers: { origin, 'x-hd-candidate': ownerCandidate.candidateId },
    });
    const guestMap = await guestPage.request.get(`/api/campaigns/${campaignId}/map`, {
      headers: {
        origin: new URL(guestPage.url()).origin,
        'x-hd-candidate': guestCandidate.candidateId,
      },
    });
    expect(ownerMap.status()).toBe(200);
    expect(guestMap.status()).toBe(200);
    const ownerMapBody = (await ownerMap.json()) as {
      tokens: { footprint: { anchor: { column: number; row: number } } }[];
      stateVersion?: number;
    };
    const guestMapBody = (await guestMap.json()) as {
      tokens: { footprint: { anchor: { column: number; row: number } } }[];
    };
    // Both clients recover the same moved token anchor from server projections.
    expect(ownerMapBody.tokens.some((token) => token.footprint.anchor.column === legalTarget.column)).toBe(
      true,
    );
    expect(guestMapBody.tokens.some((token) => token.footprint.anchor.column === legalTarget.column)).toBe(
      true,
    );

    await ownerContext.close();
    await guestContext.close();
  });
});
