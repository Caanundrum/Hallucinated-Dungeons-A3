/**
 * Independent QA browser validation of the Phase 2 tactical player journey.
 *
 * Operates the rendered frozen page as a suspicious player — not Builder's
 * certify suite. Candidate id via QA_CANDIDATE_ID; arena URL via QA_ARENA_URL.
 */

import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

const ARENA = process.env.QA_ARENA_URL ?? 'http://127.0.0.1:5274';
const CANDIDATE = process.env.QA_CANDIDATE_ID ?? 'cand-e1c5d41b583b';
const EVIDENCE = process.env.QA_EVIDENCE_DIR ?? '/workspace/QA/evidence/phase-2/ui';

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
  await page.getByTestId('option-stalwart-defender').click();
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

test.beforeAll(async () => {
  await mkdir(EVIDENCE, { recursive: true });
});

test.describe('Phase 2 independent QA — rendered frozen tabletop', () => {
  test('QA-P2-01 novice: seat, open table, see semantic map stage', async ({ page }) => {
    await signIn(page);
    expect(await readCandidateHeader(page)).toBe(CANDIDATE);
    await quickCharacter(page, 'QA Map Novice');
    await createCampaign(page, 'QA Map Chamber');
    await seatOwnCharacter(page);
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('map-bundle-meta')).toContainText('5 ft/square');
    await expect(page.getByTestId('table-stage-semantic')).toBeVisible();
    await expect(page.getByTestId('table-stage-semantic').locator('[data-token]')).toHaveCount(1);
    await expect(page.getByTestId('table-a11y-panel')).toBeVisible();
    await expect(page.getByTestId('action-composer')).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/p2-01-table-map.png`, fullPage: true });
  });

  test('QA-P2-02 impatient: Party Chat stays social; claim turn then sync', async ({ page }) => {
    await signIn(page);
    await quickCharacter(page, 'QA Impatient Tactician');
    await createCampaign(page, 'QA Sync Table');
    await seatOwnCharacter(page);
    await page.getByTestId('open-campaign-table').click();

    await expect(page.getByTestId('commit-table-sync')).toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('dock-tab-party_chat').click();
    await page.getByTestId('party-chat-input').fill('I narrate a dash without claiming turn.');
    await page.getByTestId('party-chat-send').click();
    await expect(page.getByTestId('party-chat-message').first()).toContainText(
      'I narrate a dash without claiming turn.',
    );
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 0');

    await page.getByTestId('claim-active-turn').click();
    await expect(page.getByTestId('timing-authority-meta')).toContainText('You hold Active Turn');
    await page.getByTestId('commit-table-sync').click();
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 1');
    await page.screenshot({ path: `${EVIDENCE}/p2-02-claim-sync.png`, fullPage: true });
  });

  test('QA-P2-03 mover: legal one-step move commits; illegal path rejected by API', async ({
    page,
  }) => {
    await signIn(page);
    await quickCharacter(page, 'QA Mover');
    const campaignId = await createCampaign(page, 'QA Move Chamber');
    await seatOwnCharacter(page);
    await page.getByTestId('open-campaign-table').click();
    await page.getByTestId('claim-active-turn').click();
    await page.getByTestId('commit-table-sync').click();
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 1');

    const origin = new URL(page.url()).origin;
    const mapResponse = await page.request.get(`/api/campaigns/${campaignId}/map`, {
      headers: { origin, 'x-hd-candidate': CANDIDATE },
    });
    expect(mapResponse.status()).toBe(200);
    const mapBody = (await mapResponse.json()) as {
      tokens: { footprint: { anchor: { column: number; row: number } } }[];
    };
    const start = mapBody.tokens[0]!.footprint.anchor;
    const legal = { column: start.column + 1, row: start.row };

    await page.locator(`[data-square="${legal.column},${legal.row}"]`).click({ force: true });
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 2');

    const authority = await page.request.get(`/api/campaigns/${campaignId}/timing-authority`, {
      headers: { origin, 'x-hd-candidate': CANDIDATE },
    });
    const authorityBody = (await authority.json()) as {
      authority: { timingAuthorityId: string };
    };
    const illegal = await page.request.post(`/api/campaigns/${campaignId}/commands`, {
      headers: {
        origin,
        'content-type': 'application/json',
        'x-hd-candidate': CANDIDATE,
      },
      data: {
        requestId: randomUUID(),
        commandType: 'table.move',
        expectedStateVersion: 2,
        timingAuthorityId: authorityBody.authority.timingAuthorityId,
        path: [{ column: 0, row: 1 }],
      },
    });
    expect(illegal.status()).toBe(409);
    const illegalBody = (await illegal.json()) as { error: string };
    expect(illegalBody.error).toBe('ILLEGAL_PATH');
    await page.screenshot({ path: `${EVIDENCE}/p2-03-move.png`, fullPage: true });
  });

  test('QA-P2-04 accessibility: reduced motion and low effects on table, no voice UI', async ({
    page,
  }) => {
    await signIn(page);
    await quickCharacter(page, 'QA A11y Player');
    await createCampaign(page, 'QA A11y Chamber');
    await seatOwnCharacter(page);
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('table-presentation-meta')).toContainText('No voice-selection');
    await expect(page.getByTestId('table-presentation-meta')).toContainText('reduced motion off');
    await expect(page.getByTestId('account-voice-select')).toHaveCount(0);
    // Prefer click over check(): re-render during save can make check() race the
    // detached input while the live region already announces success.
    await page.getByTestId('table-reduced-motion').click();
    await expect(page.getByTestId('table-presentation-meta')).toContainText('reduced motion on');
    await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
    await expect(page.locator('html')).toHaveClass(/hd-reduced-motion/);
    await expect(page.getByTestId('table-stage-slot')).toHaveClass(/table-stage-low-effects/);
    await page.getByTestId('table-low-effects').click();
    await expect(page.getByTestId('table-presentation-meta')).toContainText('low effects on');
    await expect(page.locator('html')).toHaveAttribute('data-low-effects', 'true');
    await expect(page.locator('html')).toHaveClass(/hd-low-effects/);
    await page.screenshot({ path: `${EVIDENCE}/p2-04-a11y.png`, fullPage: true });
  });

  test('QA-P2-05 adversarial: table command without Timing Authority is refused', async ({
    page,
  }) => {
    await signIn(page);
    await quickCharacter(page, 'QA Authority Probe');
    const campaignId = await createCampaign(page, 'QA Authority Gate');
    await seatOwnCharacter(page);
    const origin = new URL(page.url()).origin;
    const rejected = await page.request.post(`/api/campaigns/${campaignId}/commands`, {
      headers: {
        origin,
        'content-type': 'application/json',
        'x-hd-candidate': CANDIDATE,
      },
      data: {
        requestId: randomUUID(),
        commandType: 'table.sync',
        expectedStateVersion: 0,
      },
    });
    expect(rejected.status()).toBe(403);
    const body = (await rejected.json()) as { error: string };
    expect(body.error).toBe('TIMING_AUTHORITY_REQUIRED');
  });

  test('QA-P2-06 reentry: reload recovers table state after sync', async ({ page }) => {
    await signIn(page);
    await quickCharacter(page, 'QA Table Reentry');
    await createCampaign(page, 'QA Reentry Chamber');
    await seatOwnCharacter(page);
    await page.getByTestId('open-campaign-table').click();
    await page.getByTestId('claim-active-turn').click();
    await page.getByTestId('commit-table-sync').click();
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 1');
    await page.reload();
    await dismissIntro(page);
    // Player proof is recovered table projection, not footer chrome.
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 1');
    await expect(page.getByTestId('table-stage-semantic')).toBeVisible();
    await expect(page.getByTestId('timing-authority-meta')).toContainText('You hold Active Turn');
    await page.screenshot({ path: `${EVIDENCE}/p2-06-reentry.png`, fullPage: true });
  });

  test('QA-P2-07 keyboard: reach Characters then Campaigns without relying on mouse nav', async ({
    page,
  }) => {
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
  });

  test('QA-P2-08 interpret: Intent Intercept confirms a real sync while chat stays separate', async ({
    page,
  }) => {
    await signIn(page);
    await quickCharacter(page, 'QA Intercept Player');
    await createCampaign(page, 'QA Intercept Chamber');
    await seatOwnCharacter(page);
    await page.getByTestId('open-campaign-table').click();
    await page.getByTestId('claim-active-turn').click();
    await expect(page.getByTestId('interpret-action')).toHaveAttribute('aria-disabled', 'false');
    await page.getByTestId('interpret-action').click();
    await expect(page.getByTestId('intent-intercept')).toBeVisible();
    await page.getByTestId('confirm-intent-intercept').click();
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 1');
    await page.getByTestId('dock-tab-party_chat').click();
    await page.getByTestId('party-chat-input').fill('Still only talk.');
    await page.getByTestId('party-chat-send').click();
    await expect(page.getByTestId('party-chat-message').first()).toContainText('Still only talk.');
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 1');
    await page.screenshot({ path: `${EVIDENCE}/p2-08-intercept.png`, fullPage: true });
  });
});
