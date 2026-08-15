import { expect, test } from '@playwright/test';

import {
  enterArena,
  openArena,
  projectionVersion,
  readCandidate,
  recordCheck,
  renderedNotes,
} from './arena-page.js';

/**
 * The permanent smoke spine.
 *
 * Blueprint ownership: Section 25.3 — "Every phase candidate runs a permanent
 * smoke spine covering startup, development/public identity as applicable,
 * character/campaign continuity, one canonical write/read, one tactical
 * interaction after Phase 2, one rules action after Phase 3, multiplayer
 * synchronization after Phase 4, and campaign resume after Phase 5."
 *
 * Through Phase 0 the applicable spine is startup, development identity, and
 * one canonical write/read. Later phases append their segments to this file
 * rather than starting a parallel spine.
 */
test.describe('Permanent smoke spine', () => {
  test('startup: the page loads and reports its candidate and environment', async ({ page }) => {
    await openArena(page);

    await expect(page.getByRole('heading', { name: 'Local Arena diagnostics' })).toBeVisible();
    await expect(page.getByTestId('environment-class')).toHaveText('local');
    await expect(page.getByTestId('candidate-id')).toContainText('cand-');
  });

  test('development identity: the server mints an identity the page renders', async ({ page }) => {
    await openArena(page);
    const accountId = await enterArena(page);

    expect(accountId).toMatch(/^dev-[0-9a-f-]{36}$/);
    await expect(page.getByTestId('record-form')).toBeVisible();
  });

  test('canonical write and read: a submitted note is persisted and rendered back', async ({
    page,
  }) => {
    await openArena(page);
    await enterArena(page);

    await expect(page.getByTestId('empty-state')).toBeVisible();
    expect(await projectionVersion(page)).toBe(0);

    await recordCheck(page, 'smoke spine canonical write');

    await expect(page.getByTestId('notice-message')).toContainText('Recorded sequence 1');
    expect(await renderedNotes(page)).toEqual(['smoke spine canonical write']);
    expect(await projectionVersion(page)).toBe(1);
  });

  test('character continuity: quick-start creates a vault character owned by this account', async ({
    page,
  }) => {
    await openArena(page);
    await enterArena(page);

    await page.getByTestId('nav-characters').click();
    await expect(page.getByTestId('vault-heading')).toBeVisible();
    await page.getByTestId('start-character').click();
    // Click rather than check: the wizard re-renders after the save and
    // replaces the radio, which makes Playwright's checked-state wait hang.
    const tutorialNo = page.getByTestId('tutorial-ask-no');
    if (await tutorialNo.isVisible().catch(() => false)) {
      await tutorialNo.click();
    }
    await page.getByTestId('open-quick-start').click();
    await page.getByTestId('option-devoted-healer').click();
    await expect(page.getByTestId('active-step-heading')).toHaveText('Identity & Final Review');
    await page.getByTestId('identity-name').fill('Smoke Spine Healer');
    await page.getByTestId('identity-name').dispatchEvent('change');
    await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
    await page.getByTestId('create-character').click();

    await expect(page.getByTestId('character-sheet-heading')).toHaveText('Smoke Spine Healer');
    await page.getByTestId('back-to-vault').click();
    await expect(page.getByTestId('character-link')).toContainText('Smoke Spine Healer');
  });

  test('campaign continuity: create, configure settings, reload, and recover the same campaign', async ({
    page,
  }) => {
    await openArena(page);
    await enterArena(page);

    await page.getByTestId('nav-characters').click();
    await page.getByTestId('start-character').click();
    const tutorialNo = page.getByTestId('tutorial-ask-no');
    if (await tutorialNo.isVisible().catch(() => false)) {
      await tutorialNo.click();
    }
    await page.getByTestId('open-quick-start').click();
    await page.getByTestId('option-stalwart-defender').click();
    await expect(page.getByTestId('active-step-heading')).toHaveText('Identity & Final Review');
    await page.getByTestId('identity-name').fill('Smoke Spine Warden');
    await page.getByTestId('identity-name').dispatchEvent('change');
    await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
    await page.getByTestId('create-character').click();
    await expect(page.getByTestId('character-sheet-heading')).toHaveText('Smoke Spine Warden');

    await page.getByTestId('nav-campaigns').click();
    await page.getByTestId('start-campaign').click();
    await page.getByTestId('campaign-name').fill('Smoke Spine Continuity');
    await page.getByTestId('campaign-name').dispatchEvent('change');
    await page.getByTestId('identity-veyra').click();
    await page.getByTestId('personality-seasoned_host').click();
    await page.getByTestId('create-campaign-submit').click();
    await expect(page.getByTestId('campaign-detail-heading')).toHaveText('Smoke Spine Continuity');
    await expect(page.getByTestId('director-avatar-key')).toHaveText('veyra__seasoned_host');

    await page.getByTestId('open-campaign-settings').click();
    await page.getByTestId('content-profile-tense').click();
    await page.getByTestId('complete-session-zero').click();
    await expect(page.getByTestId('settings-notice')).toContainText('Session Zero recorded');

    const campaignUrl = page.url().replace(/\/settings$/, '');
    await page.reload();
    await page.goto(campaignUrl);
    await expect(page.getByTestId('campaign-detail-heading')).toHaveText('Smoke Spine Continuity');
    await expect(page.getByTestId('director-avatar-key')).toHaveText('veyra__seasoned_host');
    await expect(page.getByTestId('session-zero-summary')).toContainText('recorded');
    await expect(page.getByTestId('session-zero-summary')).toContainText('Tense');

    await page.getByTestId('nav-characters').click();
    await expect(page.getByTestId('character-link')).toContainText('Smoke Spine Warden');
  });

  test('tactical interaction: claim Active Turn, sync, and commit a legal move', async ({
    page,
  }) => {
    await openArena(page);
    await enterArena(page);

    await page.getByTestId('nav-characters').click();
    await page.getByTestId('start-character').click();
    const tutorialNo = page.getByTestId('tutorial-ask-no');
    if (await tutorialNo.isVisible().catch(() => false)) {
      await tutorialNo.click();
    }
    await page.getByTestId('open-quick-start').click();
    await page.getByTestId('option-stalwart-defender').click();
    await expect(page.getByTestId('active-step-heading')).toHaveText('Identity & Final Review');
    await page.getByTestId('identity-name').fill('Smoke Spine Tactician');
    await page.getByTestId('identity-name').dispatchEvent('change');
    await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
    await page.getByTestId('create-character').click();
    await expect(page.getByTestId('character-sheet-heading')).toHaveText('Smoke Spine Tactician');

    await page.getByTestId('nav-campaigns').click();
    await page.getByTestId('start-campaign').click();
    await page.getByTestId('campaign-name').fill('Smoke Spine Tactical');
    await page.getByTestId('campaign-name').dispatchEvent('change');
    await page.getByTestId('identity-veyra').click();
    await page.getByTestId('personality-seasoned_host').click();
    await page.getByTestId('create-campaign-submit').click();
    await expect(page.getByTestId('campaign-detail-heading')).toHaveText('Smoke Spine Tactical');
    const campaignId = page.url().split('/').pop()!;

    const seatSelect = page.getByTestId('seat-character-select');
    const characterId = await seatSelect.locator('option').nth(1).getAttribute('value');
    expect(characterId).toBeTruthy();
    await seatSelect.selectOption(characterId!);
    await page.getByTestId('create-seat').click();
    await expect(page.getByTestId('own-seat')).toBeVisible();

    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('table-stage-semantic')).toBeVisible();
    await expect(page.getByTestId('table-a11y-panel')).toBeVisible();
    await page.getByTestId('claim-active-turn').click();
    await expect(page.getByTestId('timing-authority-meta')).toContainText('You hold Active Turn');
    await page.getByTestId('commit-table-sync').click();
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 1');

    const origin = new URL(page.url()).origin;
    const candidate = await readCandidate(page);
    const mapResponse = await page.request.get(`/api/campaigns/${campaignId}/map`, {
      headers: { origin, 'x-hd-candidate': candidate.candidateId },
    });
    expect(mapResponse.status()).toBe(200);
    const mapBody = (await mapResponse.json()) as {
      tokens: { footprint: { anchor: { column: number; row: number } } }[];
    };
    const start = mapBody.tokens[0]!.footprint.anchor;
    const target = { column: start.column + 1, row: start.row };
    await page.locator(`[data-square="${target.column},${target.row}"]`).click({ force: true });
    await expect(page.getByTestId('move-target-meta')).toContainText(
      `column ${target.column}, row ${target.row}`,
    );
    await page.getByTestId('commit-table-move').click();
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 2');

    await page.reload();
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 2');
    await expect(page.getByTestId('table-stage-semantic')).toBeVisible();
  });
});
