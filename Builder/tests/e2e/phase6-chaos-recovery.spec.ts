import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { enterAccountFromShell, readCandidate } from './arena-page.js';

/**
 * Phase 6 chaos / interruption recovery for table commands and AI surfaces.
 *
 * Blueprint ownership: Section 25 Phase 6 build scope item 3 ("Chaos and
 * interruption testing: reconnect, duplicate commands, AI kill switch…").
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
  const tutorialNo = page.getByTestId('tutorial-ask-no');
  if (await tutorialNo.isVisible().catch(() => false)) {
    await tutorialNo.click();
  }
  await page.getByTestId('open-quick-start').click();
  await page.getByTestId('option-stalwart-defender').click();
  await expect(page.getByTestId('active-step-heading')).toHaveText('Identity & Final Review');
  await page.getByTestId('identity-name').fill(name);
  await page.getByTestId('identity-name').dispatchEvent('change');
  await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
  await page.getByTestId('create-character').click();
  await expect(page.getByTestId('character-sheet-heading')).toHaveText(name);
}

/** Creates a campaign leaving the Emberferry Crossing starter template selected (the default). */
async function createEmberferryCampaign(page: Page, name: string): Promise<string> {
  await page.getByTestId('nav-campaigns').click();
  await page.getByTestId('start-campaign').click();
  await expect(page.getByTestId('adventure-template-emberferry_crossing')).toHaveClass(/selected/);
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

async function claimActiveTurnViaApi(
  page: Page,
  campaignId: string,
  candidateId: string,
): Promise<string> {
  const origin = new URL(page.url()).origin;
  const claimed = await page.request.post(`/api/campaigns/${campaignId}/timing-authority`, {
    headers: {
      origin,
      'content-type': 'application/json',
      'x-hd-candidate': candidateId,
    },
    data: {},
  });
  expect(claimed.status()).toBe(201);
  const body = (await claimed.json()) as {
    authority: { timingAuthorityId: string };
  };
  return body.authority.timingAuthorityId;
}

test.describe('Phase 6 chaos and recovery', () => {
  test('reload after sync keeps seat/authority path; duplicate requestId; foreign origin; Director Address is non-mutating', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await signIn(page);
    await createQuickCharacter(page, 'Phase6 Chaos Scout');
    const campaignId = await createEmberferryCampaign(page, 'Phase6 Chaos Table');
    await seatOwnCharacter(page);
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 0');

    await page.getByTestId('table-advanced-controls').locator('summary').click();
    await page.getByTestId('commit-table-sync').click();
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 1');

    await page.reload();
    await dismissIntroIfPresent(page);
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 1');
    await page.getByTestId('table-advanced-controls').locator('summary').click();
    await expect(page.getByTestId('commit-table-sync')).toHaveAttribute('aria-disabled', 'false');

    const origin = new URL(page.url()).origin;
    const candidate = await readCandidate(page);

    const requestId = randomUUID();
    const first = await page.request.post(`/api/campaigns/${campaignId}/commands`, {
      headers: {
        origin,
        'content-type': 'application/json',
        'x-hd-candidate': candidate.candidateId,
      },
      data: {
        requestId,
        commandType: 'table.sync',
        expectedStateVersion: 1,
      },
    });
    expect(first.status()).toBe(201);
    const firstBody = (await first.json()) as {
      duplicate: boolean;
      commandId: string;
      table: { stateVersion: number };
    };
    expect(firstBody.duplicate).toBe(false);
    expect(firstBody.table.stateVersion).toBe(2);

    const duplicate = await page.request.post(`/api/campaigns/${campaignId}/commands`, {
      headers: {
        origin,
        'content-type': 'application/json',
        'x-hd-candidate': candidate.candidateId,
      },
      data: {
        requestId,
        commandType: 'table.sync',
        expectedStateVersion: 1,
      },
    });
    expect(duplicate.status()).toBe(200);
    const duplicateBody = (await duplicate.json()) as {
      duplicate: boolean;
      commandId: string;
      table: { stateVersion: number };
    };
    expect(duplicateBody.duplicate).toBe(true);
    expect(duplicateBody.commandId).toBe(firstBody.commandId);
    expect(duplicateBody.table.stateVersion).toBe(2);

    const foreign = await page.request.post(`/api/campaigns/${campaignId}/commands`, {
      headers: {
        origin: 'http://attacker.invalid',
        'content-type': 'application/json',
        'x-hd-candidate': candidate.candidateId,
      },
      data: {
        requestId: randomUUID(),
        commandType: 'table.sync',
        expectedStateVersion: 2,
      },
      failOnStatusCode: false,
    });
    expect(foreign.status()).toBe(403);
    expect((await foreign.json()).error).toBe('FORBIDDEN_ORIGIN');

    // AI kill switch needs Admin; ordinary path: Director Address must not mutate table state.
    await page.goto(`/campaigns/${campaignId}/table`);
    await dismissIntroIfPresent(page);
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 2');
    const versionBefore = (await page.getByTestId('table-state-meta').innerText()).trim();
    await page.getByTestId('dock-tab-director_address').click();
    await page.getByTestId('director-address-input').fill('Does this change table state?');
    await page.getByTestId('director-address-send').click();
    await expect(page.getByTestId('director-address-reply')).toContainText(
      /without changing state|Veyra/i,
    );
    await expect(page.getByTestId('table-state-meta')).toHaveText(versionBefore);
  });
});
