import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { enterAccountFromShell, readCandidate } from './arena-page.js';

/**
 * Phase 2 chunk 2d: Timing Authority + Action Composer Intent Intercept.
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

test.describe('Phase 2d Timing Authority', () => {
  test('claim unlocks commands; end turn revokes; Party Chat never mutates table', async ({
    page,
  }) => {
    await signIn(page);
    await createQuickCharacter(page, 'Timing Scout');
    const campaignId = await createCampaign(page, 'Timing Authority Table');
    await seatOwnCharacter(page);
    await page.getByTestId('open-campaign-table').click();

    await expect(page.getByTestId('commit-table-sync')).toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('claim-active-turn').click();
    await expect(page.getByTestId('timing-authority-meta')).toContainText('You hold Active Turn');
    await expect(page.getByTestId('commit-table-sync')).toHaveAttribute('aria-disabled', 'false');

    await page.getByTestId('dock-tab-party_chat').click();
    await page.getByTestId('party-chat-input').fill('Still talking, not commanding.');
    await page.getByTestId('party-chat-send').click();
    await expect(page.getByTestId('party-chat-message').first()).toContainText(
      'Still talking, not commanding.',
    );
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 0');

    await page.getByTestId('commit-table-sync').click();
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 1');

    await page.getByTestId('end-active-turn').click();
    await expect(page.getByTestId('timing-authority-meta')).toContainText('No Active Turn');
    await expect(page.getByTestId('commit-table-sync')).toHaveAttribute('aria-disabled', 'true');

    const origin = new URL(page.url()).origin;
    const candidate = await readCandidate(page);
    const rejected = await page.request.post(`/api/campaigns/${campaignId}/commands`, {
      headers: {
        origin,
        'content-type': 'application/json',
        'x-hd-candidate': candidate.candidateId,
      },
      data: {
        requestId: randomUUID(),
        commandType: 'table.sync',
        expectedStateVersion: 1,
        timingAuthorityId: 'revoked-or-missing',
      },
    });
    expect(rejected.status()).toBe(409);
    const rejectedBody = (await rejected.json()) as { error: string };
    expect(rejectedBody.error).toBe('TIMING_AUTHORITY_INVALID');
  });
});
