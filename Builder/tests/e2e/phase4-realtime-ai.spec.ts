import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { enterAccountFromShell, readCandidate } from './arena-page.js';

/**
 * Phase 4: presence, Google emulator admin, Director Address, NL Intent Intercept,
 * speech prefs, and four simultaneous local player contexts.
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

test.describe('Phase 4 presence, Admin, AI, speech', () => {
  test('ordinary account is denied Admin; Google emulator bootstrap admin can toggle kill switch', async ({
    page,
  }) => {
    await signIn(page);
    await page.getByTestId('nav-admin').click();
    await expect(page.getByTestId('admin-heading')).toHaveText('Admin');
    await expect(page.getByTestId('admin-is-admin')).toHaveText('No');

    const candidate = await readCandidate(page);
    const origin = new URL(page.url()).origin;
    const google = await page.request.post('/api/identity/google-emulator-session', {
      data: { email: 'nick.donner@gmail.com' },
      headers: {
        origin,
        'x-hd-candidate': candidate.candidateId,
        'content-type': 'application/json',
      },
    });
    expect(google.status()).toBe(201);
    const body = (await google.json()) as { isBootstrapAdmin: boolean; email: string };
    expect(body.isBootstrapAdmin).toBe(true);
    expect(body.email).toBe('nick.donner@gmail.com');

    await page.goto('/admin');
    await expect(page.getByTestId('admin-is-admin')).toHaveText('Yes');
    await expect(page.getByTestId('admin-actor-email')).toHaveText('nick.donner@gmail.com');
    await page.getByTestId('admin-toggle-kill-switch').click();
    await expect(page.getByTestId('admin-ai-kill-switch')).toHaveText('enabled');
    await page.getByTestId('admin-toggle-kill-switch').click();
    await expect(page.getByTestId('admin-ai-kill-switch')).toHaveText('disabled');
  });

  test('table presence, Director Address, NL Intent Intercept, and speech prefs', async ({
    page,
  }) => {
    await signIn(page);
    await page.getByTestId('nav-account').click();
    await page.getByTestId('account-tts').check();
    await expect(page.getByTestId('account-tts')).toBeChecked();
    await page.getByTestId('account-stt').check();
    await expect(page.getByTestId('account-stt')).toBeChecked();

    await createQuickCharacter(page, 'Phase4 Presence Scout');
    const campaignId = await createCampaign(page, 'Phase4 Presence Table');
    await seatOwnCharacter(page);
    await page.getByTestId('open-campaign-table').click();

    await expect(page.getByTestId('presence-panel')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('presence-meta')).toContainText('online');

    await page.getByTestId('dock-tab-director_address').click();
    await page.getByTestId('director-address-input').fill('What do I see in this room?');
    await page.getByTestId('director-address-send').click();
    await expect(page.getByTestId('director-address-reply')).toContainText(/without changing state|Veyra/i);

    await page.getByTestId('claim-active-turn').click();
    await expect(page.getByTestId('timing-authority-meta')).toContainText('Active Turn');
    await page.getByTestId('nl-intent-input').fill('I move carefully toward the pillar.');
    await page.getByTestId('interpret-nl-intent').click();
    await expect(page.getByTestId('intent-intercept')).toBeVisible();
    await expect(page.getByTestId('intent-intercept-summary')).toContainText(/Intent Intercept/i);

    await page.getByTestId('request-narration').click();
    await expect(page.getByTestId('director-narration')).toContainText(/table|Director/i);

    await page.getByTestId('cancel-intent-intercept').click();
    await expect(page.getByTestId('intent-intercept')).toHaveCount(0);

    // Party Chat still cannot become a command by implication.
    await page.getByTestId('dock-tab-party_chat').click();
    await page.getByTestId('party-chat-input').fill('I attack the goblin');
    await page.getByTestId('party-chat-send').click();
    await expect(page.getByTestId('party-chat-message')).toContainText('I attack the goblin');
    await expect(page.getByTestId('intent-intercept')).toHaveCount(0);
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 0');

    void campaignId;
  });

  test('four simultaneous local players share presence and social surfaces', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signIn(ownerPage);
    await createQuickCharacter(ownerPage, 'P4 Owner');
    const campaignId = await createCampaign(ownerPage, 'Phase4 Four Player Table');
    await seatOwnCharacter(ownerPage);
    await ownerPage.getByTestId('create-invite').click();
    const invitePath = (await ownerPage.getByTestId('invite-path').innerText()).trim();

    async function joinGuest(label: string): Promise<Page> {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(invitePath);
      await dismissIntroIfPresent(page);
      await page.getByTestId('invite-sign-in').click();
      await expect(page.getByTestId('invite-accept')).toBeVisible();
      await page.getByTestId('invite-accept').click();
      await createQuickCharacter(page, label);
      await page.goto(`/campaigns/${campaignId}`);
      await seatOwnCharacter(page);
      await page.getByTestId('open-campaign-table').click();
      return page;
    }

    const guestA = await joinGuest('P4 Guest A');
    const guestB = await joinGuest('P4 Guest B');
    const guestC = await joinGuest('P4 Guest C');

    await ownerPage.getByTestId('open-campaign-table').click();
    await expect(ownerPage.getByTestId('presence-panel')).toBeVisible({ timeout: 15_000 });

    for (const page of [ownerPage, guestA, guestB, guestC]) {
      await expect(page.getByTestId('presence-list')).toBeVisible();
      await page.getByTestId('dock-tab-party_chat').click();
      await page.getByTestId('party-chat-input').fill(`Hello from ${randomUUID().slice(0, 6)}`);
      await page.getByTestId('party-chat-send').click();
    }

    await expect(ownerPage.getByTestId('party-chat-list').locator('[data-testid="party-chat-message"]')).toHaveCount(
      4,
      { timeout: 15_000 },
    );
    await expect(guestC.getByTestId('party-chat-list').locator('[data-testid="party-chat-message"]')).toHaveCount(
      4,
      { timeout: 15_000 },
    );

    await ownerPage.getByTestId('claim-active-turn').click();
    await ownerPage.getByTestId('commit-table-sync').click();
    await expect(ownerPage.getByTestId('table-state-meta')).toContainText('Table state version 1');
    await expect(guestA.getByTestId('table-state-meta')).toContainText('Table state version 1', {
      timeout: 10_000,
    });
  });
});
