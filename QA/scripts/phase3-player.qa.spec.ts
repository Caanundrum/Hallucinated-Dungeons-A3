/**
 * Independent QA browser validation of the Phase 3 rules encounter player journey.
 *
 * Operates the rendered frozen page as a suspicious player — not Builder's
 * certify suite. Candidate id via QA_CANDIDATE_ID; arena URL via QA_ARENA_URL.
 */

import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

const ARENA = process.env.QA_ARENA_URL ?? 'http://127.0.0.1:5274';
const CANDIDATE = process.env.QA_CANDIDATE_ID ?? 'cand-15b87da88704';
const EVIDENCE = process.env.QA_EVIDENCE_DIR ?? '/workspace/QA/evidence/phase-3/ui';

async function dismissIntro(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
  }
}

async function signIn(page: Page): Promise<void> {
  await page.goto(ARENA);
  await dismissIntro(page);
  await expect(page.getByTestId('candidate-id').first()).toHaveText(CANDIDATE);
  await page.getByTestId('shell-enter-account').click();
  await expect(page.getByTestId('shell-account-link')).toBeVisible();
}

async function quickCharacter(page: Page, name: string): Promise<void> {
  await page.getByTestId('nav-characters').click();
  await page.getByTestId('start-character').click();
  await page.getByTestId('tutorial-ask-no').click();
  await page.getByTestId('open-quick-start').click();
  await page.getByTestId('option-studious-mage').click();
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

async function readCandidateHeader(page: Page): Promise<string> {
  const origin = new URL(page.url()).origin;
  const response = await page.request.get(`${origin}/api/candidate`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { candidateId: string };
  return body.candidateId;
}

async function readStateVersion(page: Page): Promise<number> {
  const text = await page.getByTestId('table-state-meta').innerText();
  const match = /Table state version (\d+)/.exec(text);
  expect(match).toBeTruthy();
  return Number(match![1]);
}

async function advanceEncounterTurn(page: Page): Promise<void> {
  const before = await readStateVersion(page);
  const next = page.getByTestId('next-encounter-turn');
  await expect(next).toHaveAttribute('aria-disabled', 'false');
  await next.click();
  await expect
    .poll(async () => readStateVersion(page), { timeout: 15_000 })
    .toBeGreaterThan(before);
}

async function advanceToOwnAction(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const hpText = await page.getByTestId('own-combatant-hp').innerText().catch(() => '');
    const match = /^HP (\d+)\//.exec(hpText);
    if (
      match !== null &&
      Number(match[1]) > 0 &&
      Number(match[1]) <= 4 &&
      (await page.getByTestId('rules-use-potion').getAttribute('aria-disabled')) === 'false'
    ) {
      const beforeHeal = await readStateVersion(page);
      await page.getByTestId('rules-use-potion').click();
      await expect
        .poll(async () => readStateVersion(page), { timeout: 15_000 })
        .toBeGreaterThan(beforeHeal);
    }
    if ((await page.getByTestId('rules-attack').getAttribute('aria-disabled')) === 'false') {
      return;
    }
    await advanceEncounterTurn(page);
  }
  await expect(page.getByTestId('rules-attack')).toHaveAttribute('aria-disabled', 'false');
}

async function openTableWithEncounterControls(page: Page): Promise<void> {
  await page.getByTestId('open-campaign-table').click();
  await page.getByTestId('claim-active-turn').click();
  await expect(page.getByTestId('timing-authority-meta')).toContainText('Active Turn');
  await expect(page.getByTestId('begin-encounter')).toBeVisible();
  await expect(page.getByTestId('roll-initiative')).toBeVisible();
}

test.beforeAll(async () => {
  await mkdir(EVIDENCE, { recursive: true });
});

test.describe('Phase 3 independent QA — rules encounter on rendered frozen tabletop', () => {
  test('QA-P3-01 novice: candidate chrome matches, seat, open table, encounter controls visible', async ({
    page,
  }) => {
    await signIn(page);
    expect(await readCandidateHeader(page)).toBe(CANDIDATE);
    await expect(page.getByTestId('footer-build-info')).toContainText(CANDIDATE);
    await expect(page.getByTestId('footer-build-info')).toContainText('ALPHA_3_V1');

    await quickCharacter(page, 'QA Rules Novice');
    await createCampaign(page, 'QA Rules Chamber');
    await seatOwnCharacter(page);
    await openTableWithEncounterControls(page);

    await page.getByTestId('begin-encounter').click();
    await expect(page.getByTestId('combatant-training-dummy')).toContainText('Training Dummy');
    await expect(page.getByTestId('combatant-practice-goblin')).toContainText('Practice Goblin');
    await expect(page.getByTestId('rules-last-result')).toContainText('Encounter began');
    await expect(page.getByTestId('roll-initiative')).toHaveAttribute('aria-disabled', 'false');
    await page.screenshot({ path: `${EVIDENCE}/p3-01-encounter-controls.png`, fullPage: true });
  });

  test('QA-P3-02 integrated: initiative through spell, attack, reaction, rest, XP, Rules Desk', async ({
    page,
  }) => {
    await signIn(page);
    await quickCharacter(page, 'QA Rules Mage');
    await createCampaign(page, 'QA Rules Loop');
    await seatOwnCharacter(page);
    await page.getByTestId('open-campaign-table').click();

    await page.getByTestId('claim-active-turn').click();
    await expect(page.getByTestId('timing-authority-meta')).toContainText('Active Turn');
    await page.getByTestId('begin-encounter').click();
    await page.getByTestId('roll-initiative').click();
    await expect(page.getByTestId('encounter-meta')).toContainText('round 1');
    await page.screenshot({ path: `${EVIDENCE}/p3-02-initiative.png`, fullPage: true });

    await advanceToOwnAction(page);
    await page.getByTestId('rules-spell').selectOption('burning-hands');
    await page.getByTestId('rules-cast-spell').click();
    await expect(page.getByTestId('rules-last-result')).toContainText('Burning Hands');
    await expect(page.getByTestId('rules-last-result')).toContainText('cells');
    await page.screenshot({ path: `${EVIDENCE}/p3-02-burning-hands.png`, fullPage: true });

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
    await page.screenshot({ path: `${EVIDENCE}/p3-02-reaction.png`, fullPage: true });

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
    await page.screenshot({ path: `${EVIDENCE}/p3-02-progression.png`, fullPage: true });

    await page.getByTestId('dock-tab-rules_desk').click();
    await page.getByTestId('rules-desk-rule').selectOption('progression.xp');
    await page.getByTestId('rules-desk-explain').click();
    await expect(page.getByTestId('rules-explanation')).toContainText('XP-only Progression');
    await expect(page.getByTestId('rules-explanation')).toContainText('server-validated XP');
    await page.screenshot({ path: `${EVIDENCE}/p3-02-rules-desk.png`, fullPage: true });
  });

  test('QA-P3-03 adversarial: Party Chat stays social; illegal encounter.begin refused', async ({
    page,
  }) => {
    await signIn(page);
    await quickCharacter(page, 'QA Authority Probe');
    const campaignId = await createCampaign(page, 'QA Authority Gate');
    await seatOwnCharacter(page);
    await page.getByTestId('open-campaign-table').click();
    await page.getByTestId('claim-active-turn').click();
    await page.getByTestId('begin-encounter').click();
    await page.getByTestId('roll-initiative').click();
    await expect(page.getByTestId('encounter-meta')).toContainText('round 1');

    const stateVersion = await readStateVersion(page);
    expect(stateVersion).toBeGreaterThan(0);

    await page.getByTestId('dock-tab-party_chat').click();
    await page.getByTestId('party-chat-input').fill('I narrate a fireball without claiming mechanics.');
    await page.getByTestId('party-chat-send').click();
    await expect(page.getByTestId('party-chat-message').first()).toContainText(
      'I narrate a fireball without claiming mechanics.',
    );
    await expect(page.getByTestId('table-state-meta')).toContainText(
      `Table state version ${stateVersion}`,
    );
    await page.screenshot({ path: `${EVIDENCE}/p3-03-party-chat.png`, fullPage: true });

    const origin = new URL(page.url()).origin;
    const rejected = await page.request.post(`/api/campaigns/${campaignId}/commands`, {
      headers: {
        origin,
        'content-type': 'application/json',
        'x-hd-candidate': CANDIDATE,
      },
      data: {
        requestId: randomUUID(),
        commandType: 'encounter.begin',
        expectedStateVersion: stateVersion,
      },
    });
    expect(rejected.status()).toBe(403);
    const body = (await rejected.json()) as { error: string; message: string };
    expect(body.error).toBe('TIMING_AUTHORITY_REQUIRED');
    expect(body.message).toContain('Timing Authority');

    await page.getByTestId('refresh-table-projection').click();
    await expect(page.getByTestId('table-state-meta')).toContainText(
      `Table state version ${stateVersion}`,
    );
    await page.screenshot({ path: `${EVIDENCE}/p3-03-authority-gate.png`, fullPage: true });
  });

  test('QA-P3-04 death/recovery: training drop, death save, long rest recovery', async ({ page }) => {
    await signIn(page);
    await quickCharacter(page, 'QA Dying Mage');
    await createCampaign(page, 'QA Death Chamber');
    await seatOwnCharacter(page);
    await page.getByTestId('open-campaign-table').click();
    await page.getByTestId('claim-active-turn').click();
    await expect(page.getByTestId('timing-authority-meta')).toContainText('Active Turn');
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
    await page.screenshot({ path: `${EVIDENCE}/p3-04-unconscious.png`, fullPage: true });

    for (let attempt = 0; attempt < 8; attempt += 1) {
      if ((await page.getByTestId('rules-death-save').getAttribute('aria-disabled')) === 'false') {
        break;
      }
      await advanceEncounterTurn(page);
    }
    await expect(page.getByTestId('rules-death-save')).toHaveAttribute('aria-disabled', 'false');
    const beforeSave = await readStateVersion(page);
    await page.getByTestId('rules-death-save').click();
    await expect
      .poll(async () => readStateVersion(page), { timeout: 15_000 })
      .toBeGreaterThan(beforeSave);
    await expect(page.getByTestId('rules-last-result')).toContainText(/Death Save/i);
    await page.screenshot({ path: `${EVIDENCE}/p3-04-death-save.png`, fullPage: true });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const conditions = await page.getByTestId('own-combatant-conditions').innerText();
      if (!/Unconscious/i.test(conditions)) {
        break;
      }
      if ((await page.getByTestId('rules-death-save').getAttribute('aria-disabled')) === 'false') {
        const before = await readStateVersion(page);
        await page.getByTestId('rules-death-save').click();
        await expect
          .poll(async () => readStateVersion(page), { timeout: 15_000 })
          .toBeGreaterThan(before);
        continue;
      }
      await advanceEncounterTurn(page);
    }

    if ((await page.getByTestId('rules-long-rest').getAttribute('aria-disabled')) === 'false') {
      const beforeRest = await readStateVersion(page);
      await page.getByTestId('rules-long-rest').click();
      await expect
        .poll(async () => readStateVersion(page), { timeout: 15_000 })
        .toBeGreaterThan(beforeRest);
      await expect(page.getByTestId('rules-last-result')).toContainText('Long Rest');
      await expect(page.getByTestId('own-combatant-hp')).not.toContainText(/^HP 0\//);
      await page.screenshot({ path: `${EVIDENCE}/p3-04-recovery.png`, fullPage: true });
    }
  });

  test('QA-P3-05 keyboard: reach Characters then Campaigns without mouse nav', async ({ page }) => {
    await page.goto(ARENA);
    await dismissIntro(page);
    await page.getByTestId('shell-enter-account').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('shell-account-link')).toBeVisible();
    await page.getByTestId('nav-characters').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('vault-heading')).toBeVisible();
    await page.getByTestId('nav-campaigns').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('campaigns-heading')).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/p3-05-keyboard-nav.png`, fullPage: true });
  });
});
