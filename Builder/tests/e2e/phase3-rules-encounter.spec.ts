import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { enterAccountFromShell, readCandidate } from './arena-page.js';

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await enterAccountFromShell(page);
}

async function createMage(page: Page): Promise<void> {
  await page.getByTestId('nav-characters').click();
  await page.getByTestId('start-character').click();
  const tutorialNo = page.getByTestId('tutorial-ask-no');
  if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();
  await page.getByTestId('open-quick-start').click();
  await page.getByTestId('option-studious-mage').click();
  await expect(page.getByTestId('active-step-heading')).toHaveText('Identity & Final Review');
  await page.getByTestId('identity-name').fill('Phase Three Mage');
  await page.getByTestId('identity-name').dispatchEvent('change');
  await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
  await page.getByTestId('create-character').click();
  await expect(page.getByTestId('character-sheet-heading')).toHaveText('Phase Three Mage');
}

async function createCampaignAndSeat(page: Page): Promise<string> {
  await page.getByTestId('nav-campaigns').click();
  await page.getByTestId('start-campaign').click();
  await page.getByTestId('campaign-name').fill('Phase Three Rules Loop');
  await page.getByTestId('campaign-name').dispatchEvent('change');
  await page.getByTestId('identity-veyra').click();
  await page.getByTestId('personality-seasoned_host').click();
  await page.getByTestId('create-campaign-submit').click();
  const campaignId = page.url().split('/').pop()!;
  const seatSelect = page.getByTestId('seat-character-select');
  const characterId = await seatSelect.locator('option').nth(1).getAttribute('value');
  expect(characterId).toBeTruthy();
  await seatSelect.selectOption(characterId!);
  await page.getByTestId('create-seat').click();
  await expect(page.getByTestId('own-seat')).toBeVisible();
  return campaignId;
}

async function advanceToOwnAction(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if ((await page.getByTestId('rules-attack').getAttribute('aria-disabled')) === 'false') {
      return;
    }
    const before = await page.getByTestId('table-state-meta').innerText();
    await page.getByTestId('next-encounter-turn').click();
    await expect(page.getByTestId('table-state-meta')).not.toHaveText(before);
  }
  await expect(page.getByTestId('rules-attack')).toHaveAttribute('aria-disabled', 'false');
}

test.describe('Phase 3 deterministic rules encounter', () => {
  test('rendered journey covers initiative, combat, area spell, reaction, recovery, XP, and level-up', async ({
    page,
  }) => {
    await signIn(page);
    await createMage(page);
    await createCampaignAndSeat(page);
    await page.getByTestId('open-campaign-table').click();

    await page.getByTestId('claim-active-turn').click();
    await expect(page.getByTestId('timing-authority-meta')).toContainText('Active Turn');
    await page.getByTestId('begin-encounter').click();
    await expect(page.getByTestId('combatant-training-dummy')).toContainText('Training Dummy');
    await expect(page.getByTestId('combatant-practice-goblin')).toContainText('Practice Goblin');
    await expect(page.getByTestId('rules-last-result')).toContainText('Encounter began');

    await page.getByTestId('roll-initiative').click();
    await expect(page.getByTestId('encounter-meta')).toContainText('round 1');
    await advanceToOwnAction(page);

    await page.getByTestId('rules-spell').selectOption('burning-hands');
    await page.getByTestId('rules-cast-spell').click();
    await expect(page.getByTestId('rules-last-result')).toContainText('Burning Hands');
    await expect(page.getByTestId('rules-last-result')).toContainText('cells');

    await advanceToOwnAction(page);
    await page.getByTestId('rules-target').selectOption('practice-goblin');
    await page.getByTestId('rules-attack').click();
    await expect(page.getByTestId('rules-last-result')).toContainText(/hit|missed/);

    await advanceToOwnAction(page);
    await page.getByTestId('rules-target').selectOption('practice-goblin');
    await page.getByTestId('rules-ready').click();
    await expect(page.getByTestId('rules-last-result')).toContainText('readied');
    await expect(page.getByTestId('timing-authority-meta')).toContainText('Reaction');
    await page.getByTestId('rules-reaction').click();
    await expect(page.getByTestId('rules-last-result')).toContainText('Reaction');

    await advanceToOwnAction(page);
    await page.getByTestId('rules-use-potion').click();
    await expect(page.getByTestId('rules-last-result')).toContainText('Potion of Healing');

    await advanceToOwnAction(page);
    await page.getByTestId('rules-short-rest').click();
    await expect(page.getByTestId('rules-last-result')).toContainText('Short Rest');

    await advanceToOwnAction(page);
    await page.getByTestId('rules-long-rest').click();
    await expect(page.getByTestId('rules-last-result')).toContainText('Long Rest');

    await page.getByTestId('rules-award-xp').click();
    await expect(page.getByTestId('progression-meta')).toContainText('300 XP');
    await expect(page.getByTestId('progression-meta')).toContainText('Level Up available');
    await page.getByTestId('rules-level-up').click();
    await expect(page.getByTestId('progression-meta')).toContainText('Level 2');

    await page.getByTestId('dock-tab-rules_desk').click();
    await page.getByTestId('rules-desk-rule').selectOption('progression.xp');
    await page.getByTestId('rules-desk-explain').click();
    await expect(page.getByTestId('rules-explanation')).toContainText('XP-only Progression');
    await expect(page.getByTestId('rules-explanation')).toContainText('server-validated XP');
  });

  test('illegal mechanical command fails closed without advancing state', async ({ page }) => {
    await signIn(page);
    await createMage(page);
    const campaignId = await createCampaignAndSeat(page);
    await page.getByTestId('open-campaign-table').click();
    await page.getByTestId('claim-active-turn').click();
    await page.getByTestId('begin-encounter').click();
    await page.getByTestId('roll-initiative').click();
    const candidate = await readCandidate(page);
    const origin = new URL(page.url()).origin;
    const stateResponse = await page.request.get(`/api/campaigns/${campaignId}/table-state`, {
      headers: { origin, 'x-hd-candidate': candidate.candidateId },
    });
    const state = (await stateResponse.json()) as { stateVersion: number };
    const illegal = await page.request.post(`/api/campaigns/${campaignId}/commands`, {
      headers: {
        origin,
        'content-type': 'application/json',
        'x-hd-candidate': candidate.candidateId,
      },
      data: {
        requestId: randomUUID(),
        commandType: 'encounter.begin',
        expectedStateVersion: state.stateVersion,
      },
    });
    expect(illegal.status()).toBe(403);
    const body = (await illegal.json()) as { error: string; message: string };
    expect(body.error).toBe('TIMING_AUTHORITY_REQUIRED');
    expect(body.message).toContain('Timing Authority');

    const after = await page.request.get(`/api/campaigns/${campaignId}/table-state`, {
      headers: { origin, 'x-hd-candidate': candidate.candidateId },
    });
    expect(((await after.json()) as { stateVersion: number }).stateVersion).toBe(
      state.stateVersion,
    );
  });
});
