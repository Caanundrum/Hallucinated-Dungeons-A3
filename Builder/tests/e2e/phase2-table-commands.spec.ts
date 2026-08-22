import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { recordDefaultSessionZero, enterAccountFromShell, readCandidate, openTableAdvancedControls} from './arena-page.js';

/**
 * Phase 2 chunk 2a + 2d: command gateway gated by Timing Authority.
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

test.describe('Phase 2a table command gateway', () => {
  test('seated member claims turn, commits sync; Party Chat stays separate; Interpret Action uses intercept', async ({
    page,
  }) => {
    await signIn(page);
    await createQuickCharacter(page, 'Sync Scout');
    const campaignId = await createCampaign(page, 'Command Core Table');
    await seatOwnCharacter(page);

    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('communication-dock')).toBeVisible();
    await expect(page.getByTestId('action-composer')).toBeVisible();
    await openTableAdvancedControls(page);
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 0');
    await expect(page.getByTestId('timing-authority-meta')).toContainText('Exploration');
    await expect(page.getByTestId('interpret-action')).toHaveAttribute('aria-disabled', 'false');

    await page.getByTestId('dock-tab-party_chat').click();
    await page.getByTestId('party-chat-input').fill('I describe walking without submitting a command.');
    await page.getByTestId('party-chat-send').click();
    await expect(page.getByTestId('party-chat-message').first()).toContainText(
      'I describe walking without submitting a command.',
      { timeout: 20_000 },
    );
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 0');

    await openTableAdvancedControls(page);
    await page.getByTestId('commit-table-sync').click();
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 1');

    await page.getByTestId('interpret-action').click();
    await expect(page.getByTestId('intent-intercept')).toBeVisible();
    await expect(page.getByTestId('intent-intercept-summary')).toContainText('table sync');
    await page.getByTestId('confirm-intent-intercept').click();
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 2');

    await page.reload();
    await dismissIntroIfPresent(page);
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 2');
    await page.getByTestId('dock-tab-party_chat').click();
    await expect(page.getByTestId('party-chat-message').first()).toContainText(
      'I describe walking without submitting a command.',
    );

    expect(campaignId.length).toBeGreaterThan(0);
  });

  test('API rejects missing Timing Authority, recovers duplicates, and requires a seat', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page);
    await createQuickCharacter(page, 'Api Sync Scout');
    const campaignId = await createCampaign(page, 'Idempotency Gate');
    const origin = new URL(page.url()).origin;
    const candidate = await readCandidate(page);

    const unseated = await page.request.post(`/api/campaigns/${campaignId}/commands`, {
      headers: {
        origin,
        'content-type': 'application/json',
        'x-hd-candidate': candidate.candidateId,
      },
      data: {
        requestId: randomUUID(),
        commandType: 'table.sync',
        expectedStateVersion: 0,
      },
    });
    expect(unseated.status()).toBe(409);
    const unseatedBody = (await unseated.json()) as { error: string };
    expect(unseatedBody.error).toBe('NOT_SEATED');

    await seatOwnCharacter(page);

    const explorationSync = await page.request.post(`/api/campaigns/${campaignId}/commands`, {
      headers: {
        origin,
        'content-type': 'application/json',
        'x-hd-candidate': candidate.candidateId,
      },
      data: {
        requestId: randomUUID(),
        commandType: 'table.sync',
        expectedStateVersion: 0,
      },
    });
    expect(explorationSync.status()).toBe(201);

    await page.request.post(`/api/campaigns/${campaignId}/commands`, {
      headers: {
        origin,
        'content-type': 'application/json',
        'x-hd-candidate': candidate.candidateId,
      },
      data: {
        requestId: randomUUID(),
        commandType: 'encounter.begin',
        expectedStateVersion: 1,
      },
    });
    await page.request.post(`/api/campaigns/${campaignId}/commands`, {
      headers: {
        origin,
        'content-type': 'application/json',
        'x-hd-candidate': candidate.candidateId,
      },
      data: {
        requestId: randomUUID(),
        commandType: 'initiative.roll',
        expectedStateVersion: 2,
      },
    });

    const missingAuthority = await page.request.post(`/api/campaigns/${campaignId}/commands`, {
      headers: {
        origin,
        'content-type': 'application/json',
        'x-hd-candidate': candidate.candidateId,
      },
      data: {
        requestId: randomUUID(),
        commandType: 'combat.attack',
        expectedStateVersion: 3,
        targetCombatantId: 'training-dummy',
      },
    });
    expect(missingAuthority.status()).toBe(403);
    const missingBody = (await missingAuthority.json()) as { error: string };
    expect(missingBody.error).toBe('TIMING_AUTHORITY_REQUIRED');

    const authority = await page.request.get(`/api/campaigns/${campaignId}/timing-authority`, {
      headers: { origin, 'x-hd-candidate': candidate.candidateId },
    });
    const authorityBody = (await authority.json()) as {
      authority: { timingAuthorityId: string };
    };
    const timingAuthorityId = authorityBody.authority.timingAuthorityId;

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
        expectedStateVersion: 3,
        timingAuthorityId,
      },
    });
    expect(first.status()).toBe(201);
    const firstBody = (await first.json()) as {
      duplicate: boolean;
      commandId: string;
      table: { stateVersion: number };
      event: { eventSequence: number; resultStateVersion: number };
    };
    expect(firstBody.duplicate).toBe(false);
    expect(firstBody.table.stateVersion).toBe(4);
    expect(firstBody.event.resultStateVersion).toBe(4);

    const duplicate = await page.request.post(`/api/campaigns/${campaignId}/commands`, {
      headers: {
        origin,
        'content-type': 'application/json',
        'x-hd-candidate': candidate.candidateId,
      },
      data: {
        requestId,
        commandType: 'table.sync',
        expectedStateVersion: 3,
        timingAuthorityId,
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
    expect(duplicateBody.table.stateVersion).toBe(4);

    const stale = await page.request.post(`/api/campaigns/${campaignId}/commands`, {
      headers: {
        origin,
        'content-type': 'application/json',
        'x-hd-candidate': candidate.candidateId,
      },
      data: {
        requestId: randomUUID(),
        commandType: 'table.sync',
        expectedStateVersion: 0,
        timingAuthorityId,
      },
    });
    expect(stale.status()).toBe(409);
    const staleBody = (await stale.json()) as { error: string };
    expect(staleBody.error).toBe('STALE_STATE_VERSION');

    const state = await page.request.get(`/api/campaigns/${campaignId}/table-state`, {
      headers: {
        origin,
        'x-hd-candidate': candidate.candidateId,
      },
    });
    expect(state.status()).toBe(200);
    const stateBody = (await state.json()) as {
      stateVersion: number;
      lastEventSequence: number;
      recentEvents: { eventType: string }[];
    };
    expect(stateBody.stateVersion).toBe(1);
    expect(stateBody.lastEventSequence).toBe(1);
    expect(stateBody.recentEvents.some((event) => event.eventType === 'table.state_synced')).toBe(
      true,
    );

    await context.close();
  });
});
