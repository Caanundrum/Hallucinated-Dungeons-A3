import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { recordDefaultSessionZero, enterAccountFromShell, readCandidate} from './arena-page.js';

/**
 * Phase 2 chunk 2d: exploration movement and initiative-driven combat turns.
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

async function openAdvancedControls(page: Page): Promise<void> {
  await page.getByTestId('table-info-tab-tools').click();
  const details = page.getByTestId('table-advanced-controls');
  if ((await details.getAttribute('open')) === null) {
    await details.locator('summary').click();
  }
}

async function advanceToOwnCombatTurn(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const title = await page.getByTestId('table-turn-title').innerText();
    if (/It'?s your turn/i.test(title)) {
      return;
    }
    await openAdvancedControls(page);
    const next = page.getByTestId('next-encounter-turn');
    if ((await next.getAttribute('aria-disabled')) !== 'false') {
      return;
    }
    await next.click();
  }
  await expect(page.getByTestId('table-turn-title')).toContainText(/It'?s your turn/i);
}

test.describe('Phase 2d exploration and initiative turns', () => {
  test('exploration sync needs no claim; initiative issues combat turn authority; chat stays social', async ({
    page,
  }) => {
    await signIn(page);
    await createQuickCharacter(page, 'Timing Scout');
    const campaignId = await createCampaign(page, 'Timing Authority Table');
    await seatOwnCharacter(page);
    await page.getByTestId('open-campaign-table').click();

    await expect(page.getByTestId('table-turn-title')).toContainText('Exploring freely');
    await expect(page.getByTestId('open-table-sheet-modal')).toBeVisible();
    await openAdvancedControls(page);
    await expect(page.getByTestId('timing-authority-meta')).toContainText('Exploration');
    await expect(page.getByTestId('commit-table-sync')).toHaveAttribute('aria-disabled', 'false');

    await page.getByTestId('dock-tab-party_chat').click();
    await page.getByTestId('party-chat-input').fill('Still talking, not commanding.');
    await page.getByTestId('party-chat-send').click();
    await expect(page.getByTestId('party-chat-message').first()).toContainText(
      'Still talking, not commanding.',
    );
    await openAdvancedControls(page);
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 0');

    await page.getByTestId('commit-table-sync').click();
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 1');

    await openAdvancedControls(page);
    await page.getByTestId('begin-encounter').click();
    await openAdvancedControls(page);
    await expect(page.getByTestId('combatant-training-dummy')).toBeVisible();
    await openAdvancedControls(page);
    await expect(page.getByTestId('roll-initiative')).toHaveAttribute('aria-disabled', 'false');
    await page.getByTestId('roll-initiative').click();
    await expect(page.getByTestId('encounter-meta')).toContainText('active');
    await expect(page.getByTestId('initiative-order')).toBeVisible();
    await advanceToOwnCombatTurn(page);
    await openAdvancedControls(page);
    await expect(page.getByTestId('timing-authority-meta')).toContainText('Initiative gave you');
    await expect(page.getByTestId('table-turn-title')).toContainText(/It'?s your turn/i);
    await expect(page.getByTestId('end-combat-turn')).toBeVisible();

    const origin = new URL(page.url()).origin;
    const candidate = await readCandidate(page);
    const stateText = await page.getByTestId('table-state-meta').getAttribute('data-state-version');
    const stateVersion = Number(stateText);
    const rejected = await page.request.post(`/api/campaigns/${campaignId}/commands`, {
      headers: {
        origin,
        'content-type': 'application/json',
        'x-hd-candidate': candidate.candidateId,
      },
      data: {
        requestId: randomUUID(),
        commandType: 'table.sync',
        expectedStateVersion: stateVersion,
        timingAuthorityId: 'revoked-or-missing',
      },
    });
    expect(rejected.status()).toBe(409);
    const rejectedBody = (await rejected.json()) as { error: string };
    expect(rejectedBody.error).toBe('TIMING_AUTHORITY_INVALID');
  });
});
