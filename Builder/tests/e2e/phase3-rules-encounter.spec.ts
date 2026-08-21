import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import {enterAccountFromShell, readCandidate, openTableAdvancedControls} from './arena-page.js';

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
  const seatSelect = page.getByTestId('seat-character-select');
  const characterId = await seatSelect.locator('option').nth(1).getAttribute('value');
  expect(characterId).toBeTruthy();
  await seatSelect.selectOption(characterId!);
  await page.getByTestId('create-seat').click();
  await expect(page.getByTestId('own-seat')).toBeVisible();
  return page.url().split('/').pop()!;
}

async function readStateVersion(page: Page): Promise<number> {
  const text = await page.getByTestId('table-state-meta').evaluate((el) => el.textContent ?? '');
  const match = /Table state version (\d+)/.exec(text);
  expect(match).toBeTruthy();
  return Number(match![1]);
}

async function advanceEncounterTurn(page: Page): Promise<void> {
  const before = await page.getByTestId('encounter-meta').innerText();
  const next = page.getByTestId('next-encounter-turn');
  await expect(next).toHaveAttribute('aria-disabled', 'false');
  await next.click();
  await expect
    .poll(async () => page.getByTestId('encounter-meta').innerText(), { timeout: 15_000 })
    .not.toBe(before);
}

async function ownActionReady(page: Page): Promise<boolean> {
  // Prefer action-economy signals that do not require a selected target.
  const cast = await page.getByTestId('rules-cast-spell').getAttribute('aria-disabled');
  const rest = await page.getByTestId('rules-short-rest').getAttribute('aria-disabled');
  const attack = await page.getByTestId('rules-attack').getAttribute('aria-disabled');
  return cast === 'false' || rest === 'false' || attack === 'false';
}

async function advanceToOwnAction(page: Page): Promise<void> {
  // Training foe auto-attacks are nonlethal (floor at 1 HP), so this helper does not
  // consume the journey's Potion of Healing — that remains an explicit journey step.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await ownActionReady(page)) {
      return;
    }
    await advanceEncounterTurn(page);
  }
  await expect(page.getByTestId('rules-cast-spell')).toHaveAttribute('aria-disabled', 'false');
}

test.describe('Phase 3 deterministic rules encounter', () => {
  test('rendered journey covers initiative, combat, area spell, reaction, recovery, XP, and level-up', async ({
    page,
  }) => {
    await signIn(page);
    await createMage(page);
    await createCampaignAndSeat(page);
    await page.getByTestId('open-campaign-table').click();

    await openTableAdvancedControls(page);
    await page.getByTestId('begin-encounter').click();
    await expect(page.getByTestId('combatant-training-dummy')).toContainText('Training Dummy');
    await expect(page.getByTestId('combatant-practice-goblin')).toContainText('Practice Goblin');
    await expect(page.getByTestId('rules-last-result')).toContainText('Encounter began');

    await expect
      .poll(
        async () => {
          await openTableAdvancedControls(page);
          const roll = page.getByTestId('roll-initiative');
          if ((await roll.getAttribute('aria-disabled')) === 'false') {
            await roll.click();
          }
          return page.getByTestId('encounter-meta').innerText();
        },
        { timeout: 20_000 },
      )
      .toMatch(/round [1-9]/);
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
    await page.getByTestId('rules-catalog-category').selectOption('core_mechanics');
    await page.getByTestId('rules-catalog-entry').filter({ hasText: 'XP-only Progression' }).click();
    await expect(page.getByTestId('rules-explanation')).toContainText('XP-only Progression');
    await expect(page.getByTestId('rules-explanation')).toContainText('server-validated XP');
  });

  test('illegal mechanical command fails closed without advancing state', async ({ page }) => {
    await signIn(page);
    await createMage(page);
    const campaignId = await createCampaignAndSeat(page);
    await page.getByTestId('open-campaign-table').click();
    await openTableAdvancedControls(page);
    await page.getByTestId('begin-encounter').click();
    await page.getByTestId('roll-initiative').click();
    await expect(page.getByTestId('encounter-meta')).toContainText('round 1');
    await advanceToOwnAction(page);
    const candidate = await readCandidate(page);
    const stateText = await page.getByTestId('table-state-meta').innerText();
    const stateVersion = Number(/Table state version (\d+)/.exec(stateText)?.[1]);
    expect(stateVersion).toBeGreaterThan(0);
    const illegal = await page.evaluate(
      async ({ campaignId, candidateId, requestId, stateVersion }) => {
        const response = await fetch(`/api/campaigns/${campaignId}/commands`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-hd-candidate': candidateId,
          },
          body: JSON.stringify({
            requestId,
            commandType: 'combat.attack',
            expectedStateVersion: stateVersion,
            targetCombatantId: 'training-dummy',
          }),
        });
        return {
          status: response.status,
          body: (await response.json()) as { error: string; message: string },
        };
      },
      {
        campaignId,
        candidateId: candidate.candidateId,
        requestId: randomUUID(),
        stateVersion,
      },
    );
    expect(illegal.status).toBe(403);
    expect(illegal.body.error).toBe('TIMING_AUTHORITY_REQUIRED');
    expect(illegal.body.message).toContain('Timing Authority');

    await page.getByTestId('refresh-table-projection').click();
    await expect(page.getByTestId('table-state-meta')).toContainText(
      `Table state version ${stateVersion}`,
    );
  });

  test('rendered death and recovery path: 0 HP enables Death Save then Long Rest clears dying', async ({
    page,
  }) => {
    await signIn(page);
    await createMage(page);
    await createCampaignAndSeat(page);
    await page.getByTestId('open-campaign-table').click();
    await openTableAdvancedControls(page);
    await page.getByTestId('begin-encounter').click();
    await page.getByTestId('roll-initiative').click();
    await expect(page.getByTestId('encounter-meta')).toContainText('round 1');
    await advanceToOwnAction(page);

    await expect(page.getByTestId('rules-training-drop')).toHaveAttribute('aria-disabled', 'false');
    const beforeDrop = await readStateVersion(page);
    await page.getByTestId('rules-training-drop').click();
    await expect
      .poll(async () => readStateVersion(page), { timeout: 15_000 })
      .toBeGreaterThan(beforeDrop);
    await expect(page.getByTestId('own-combatant-hp')).toContainText(/^HP 0\//);
    await expect(page.getByTestId('own-combatant-conditions')).toContainText(/Unconscious/i);
    await expect(page.getByTestId('rules-last-result')).toContainText(/0 Hit Points/i);

    // Training drop keeps the combatant's turn so one Death Save can resolve immediately.
    await expect(page.getByTestId('rules-death-save')).toHaveAttribute('aria-disabled', 'false');
    const beforeSave = await readStateVersion(page);
    await page.getByTestId('rules-death-save').click();
    await expect
      .poll(async () => readStateVersion(page), { timeout: 15_000 })
      .toBeGreaterThan(beforeSave);
    await expect(page.getByTestId('rules-last-result')).toContainText(/Death Save/i);
    // Death Saves are once per turn — the control must disable after resolving.
    await expect(page.getByTestId('rules-death-save')).toHaveAttribute('aria-disabled', 'true');

    // Long Rest remains available while dying/stable so training recovery can clear 0 HP.
    await expect(page.getByTestId('rules-long-rest')).toHaveAttribute('aria-disabled', 'false');
    const beforeRest = await readStateVersion(page);
    await page.getByTestId('rules-long-rest').click();
    await expect
      .poll(async () => readStateVersion(page), { timeout: 15_000 })
      .toBeGreaterThan(beforeRest);
    await expect(page.getByTestId('rules-last-result')).toContainText('Long Rest');
    await expect(page.getByTestId('own-combatant-hp')).not.toContainText(/^HP 0\//);
    await expect(page.getByTestId('own-combatant-conditions')).not.toContainText(/Unconscious/i);
  });
});
