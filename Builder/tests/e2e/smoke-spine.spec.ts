import { expect, test } from '@playwright/test';

import {enterArena, openArena, openTableAdvancedControls, openTablePresencePanel, closeTablePresencePanel, projectionVersion, readCandidate, recordCheck, renderedNotes} from './arena-page.js';

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
    await expect(page.getByTestId('director-identity-label')).toHaveText('Veyra');

    await page.getByTestId('open-campaign-settings').click();
    await page.getByTestId('content-profile-tense').click();
    await page.getByTestId('complete-session-zero').click();
    await expect(page.getByTestId('settings-notice')).toContainText('Session Zero recorded');

    const campaignUrl = page.url().replace(/\/settings$/, '');
    await page.reload();
    await page.goto(campaignUrl);
    await expect(page.getByTestId('campaign-detail-heading')).toHaveText('Smoke Spine Continuity');
    await expect(page.getByTestId('director-identity-label')).toHaveText('Veyra');
    await expect(page.getByTestId('session-zero-summary')).toContainText('recorded');
    await expect(page.getByTestId('session-zero-summary')).toContainText('Tense');

    await page.getByTestId('nav-characters').click();
    await expect(page.getByTestId('character-link')).toContainText('Smoke Spine Warden');
  });

  test('tactical interaction: exploration sync and one-click move', async ({
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
    await openTableAdvancedControls(page);
    await expect(page.getByTestId('table-a11y-panel')).toBeVisible();
    await expect(page.getByTestId('timing-authority-meta')).toContainText('Exploration');
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
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 2');

    await page.reload();
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 2');
    await expect(page.getByTestId('table-stage-semantic')).toBeVisible();
  });

  test('rules action: begin a training encounter, roll initiative, and resolve one attack', async ({
    page,
  }) => {
    await openArena(page);
    await enterArena(page);

    await page.getByTestId('nav-characters').click();
    await page.getByTestId('start-character').click();
    const tutorialNo = page.getByTestId('tutorial-ask-no');
    if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();
    await page.getByTestId('open-quick-start').click();
    await page.getByTestId('option-stalwart-defender').click();
    await page.getByTestId('identity-name').fill('Smoke Spine Rules Fighter');
    await page.getByTestId('identity-name').dispatchEvent('change');
    await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
    await page.getByTestId('create-character').click();

    await page.getByTestId('nav-campaigns').click();
    await page.getByTestId('start-campaign').click();
    await page.getByTestId('campaign-name').fill('Smoke Spine Rules');
    await page.getByTestId('campaign-name').dispatchEvent('change');
    await page.getByTestId('identity-veyra').click();
    await page.getByTestId('personality-seasoned_host').click();
    await page.getByTestId('create-campaign-submit').click();
    const seatSelect = page.getByTestId('seat-character-select');
    const characterId = await seatSelect.locator('option').nth(1).getAttribute('value');
    expect(characterId).toBeTruthy();
    await seatSelect.selectOption(characterId!);
    await page.getByTestId('create-seat').click();

    await page.getByTestId('open-campaign-table').click();
    await openTableAdvancedControls(page);
    await page.getByTestId('begin-encounter').click();
    await expect(page.getByTestId('combatant-practice-goblin')).toBeVisible();
    await page.getByTestId('roll-initiative').click();
    await expect(page.getByTestId('encounter-meta')).toContainText('round 1');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      if ((await page.getByTestId('rules-attack').getAttribute('aria-disabled')) === 'false') {
        break;
      }
      const before = await page.getByTestId('table-state-meta').innerText();
      await page.getByTestId('next-encounter-turn').click();
      await expect(page.getByTestId('table-state-meta')).not.toHaveText(before);
    }
    await expect(page.getByTestId('rules-attack')).toHaveAttribute('aria-disabled', 'false');
    await page.getByTestId('rules-target').selectOption('practice-goblin');
    await page.getByTestId('rules-attack').click();
    await expect(page.getByTestId('rules-last-result')).toContainText(/hit|missed/);
  });

  test('multiplayer and AI: presence, Director Address, and Party Chat stay isolated from commands', async ({
    page,
  }) => {
    await openArena(page);
    await enterArena(page);

    await page.getByTestId('nav-characters').click();
    await page.getByTestId('start-character').click();
    const tutorialNo = page.getByTestId('tutorial-ask-no');
    if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();
    await page.getByTestId('open-quick-start').click();
    await page.getByTestId('option-stalwart-defender').click();
    await page.getByTestId('identity-name').fill('Smoke Spine Presence');
    await page.getByTestId('identity-name').dispatchEvent('change');
    await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
    await page.getByTestId('create-character').click();

    await page.getByTestId('nav-campaigns').click();
    await page.getByTestId('start-campaign').click();
    await page.getByTestId('campaign-name').fill('Smoke Spine Phase4');
    await page.getByTestId('campaign-name').dispatchEvent('change');
    await page.getByTestId('identity-garrick').click();
    await page.getByTestId('personality-dry_storyteller').click();
    await page.getByTestId('create-campaign-submit').click();
    const seatSelect = page.getByTestId('seat-character-select');
    const characterId = await seatSelect.locator('option').nth(1).getAttribute('value');
    expect(characterId).toBeTruthy();
    await seatSelect.selectOption(characterId!);
    await page.getByTestId('create-seat').click();

    await page.getByTestId('open-campaign-table').click();
    await openTablePresencePanel(page);
    await closeTablePresencePanel(page);
    await page.getByTestId('dock-tab-director_address').click();
    await page.getByTestId('director-address-input').fill('Is the door trapped?');
    await page.getByTestId('director-address-send').click();
    await expect(page.getByTestId('director-address-reply')).toContainText(
      /Garrick|visible scene|Actions thread|without changing state/i,
    );
    await page.getByTestId('dock-tab-party_chat').click();
    await page.getByTestId('party-chat-input').fill('I open the door');
    await page.getByTestId('party-chat-send').click();
    await expect(page.getByTestId('party-chat-message')).toContainText('I open the door');
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 0');
  });

  test('campaign resume: suspend and resume restores chapter continuity', async ({ page }) => {
    await openArena(page);
    await enterArena(page);

    await page.getByTestId('nav-characters').click();
    await page.getByTestId('start-character').click();
    const tutorialNo = page.getByTestId('tutorial-ask-no');
    if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();
    await page.getByTestId('open-quick-start').click();
    await page.getByTestId('option-stalwart-defender').click();
    await page.getByTestId('identity-name').fill('Smoke Spine Voyager');
    await page.getByTestId('identity-name').dispatchEvent('change');
    await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
    await page.getByTestId('create-character').click();

    await page.getByTestId('nav-campaigns').click();
    await page.getByTestId('start-campaign').click();
    // Emberferry Crossing is the Phase 5 default starter template.
    await expect(page.getByTestId('adventure-template-emberferry_crossing')).toHaveClass(/selected/);
    await page.getByTestId('campaign-name').fill('Smoke Spine Resume');
    await page.getByTestId('campaign-name').dispatchEvent('change');
    await page.getByTestId('identity-veyra').click();
    await page.getByTestId('personality-seasoned_host').click();
    await page.getByTestId('create-campaign-submit').click();
    await expect(page.getByTestId('campaign-detail-heading')).toHaveText('Smoke Spine Resume');

    await expect(page.getByTestId('current-chapter')).toContainText('Dockside at Emberferry');
    await expect(page.getByTestId('campaign-time')).toContainText('Day 1');

    await page.getByTestId('suspend-session').click();
    await expect(page.getByTestId('session-action-message')).toContainText('Session suspended');
    await expect(page.getByTestId('campaign-time')).toContainText('Day 2');

    await page.getByTestId('resume-session').click();
    await expect(page.getByTestId('session-action-message')).toContainText('Session resumed');
    await expect(page.getByTestId('current-chapter')).toContainText('Dockside at Emberferry');
    await expect(page.getByTestId('recap-headline')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('campaign-time')).toContainText('Day 2');
    await expect(page.getByTestId('current-chapter')).toContainText('Dockside at Emberferry');
  });

  test('public identity and legal: Gold Master package is local, legal V2 names Google Sign-In', async ({
    page,
  }) => {
    await page.goto('/');
    const skip = page.getByTestId('skip-intro');
    if (await skip.isVisible().catch(() => false)) {
      await skip.click();
    }
    await expect(page.getByTestId('public-surface')).toHaveText('local_arena');
    const pack = await page.request.get('/api/release/gold-master');
    expect(pack.ok()).toBeTruthy();
    const body = (await pack.json()) as {
      launchProduction: string;
      legalDocuments: readonly { version: string }[];
    };
    expect(body.launchProduction).toBe('NOT_DEPLOYED');
    expect(body.legalDocuments.every((document) => document.version === 'V2')).toBeTruthy();

    await page.goto('/legal/privacy');
    await expect(page.getByTestId('legal-version')).toHaveText('V2');
    await expect(page.locator('body')).toContainText('Google Sign-In');
  });
});
