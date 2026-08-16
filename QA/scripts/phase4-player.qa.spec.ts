/**
 * Independent QA browser validation for Phase 4.
 * Frozen origin only (default 5274). Not Builder's certify suite.
 */

import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const ARENA = process.env.QA_ARENA_URL ?? 'http://127.0.0.1:5274';
const CANDIDATE = process.env.QA_CANDIDATE_ID ?? 'cand-1de6ebed38c8';

async function dismissIntro(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
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
}

async function createCampaign(page: Page, name: string): Promise<string> {
  await page.getByTestId('nav-campaigns').click();
  await page.getByTestId('start-campaign').click();
  await page.getByTestId('campaign-name').fill(name);
  await page.getByTestId('campaign-name').dispatchEvent('change');
  await page.getByTestId('identity-veyra').click();
  await page.getByTestId('personality-sassy_companion').click();
  await page.getByTestId('create-campaign-submit').click();
  await expect(page.getByTestId('campaign-detail-heading')).toHaveText(name);
  const campaignId = page.url().split('/').pop()!;
  expect(campaignId).not.toBe('new');
  return campaignId;
}

async function seatOwnCharacter(page: Page): Promise<void> {
  const seatSelect = page.getByTestId('seat-character-select');
  const characterId = await seatSelect.locator('option').nth(1).getAttribute('value');
  expect(characterId).toBeTruthy();
  await seatSelect.selectOption(characterId!);
  await page.getByTestId('create-seat').click();
  await expect(page.getByTestId('own-seat')).toBeVisible();
}

test.describe('Phase 4 Independent QA — presence, Admin, AI isolation', () => {
  test('QA-P4-01: candidate chrome + presence + Director Address nonmutation', async ({ page }) => {
    await signIn(page);
    await quickCharacter(page, 'QA P4 Scout');
    await createCampaign(page, 'QA P4 Presence');
    await seatOwnCharacter(page);
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('presence-panel')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('dock-tab-director_address').click();
    await page.getByTestId('director-address-input').fill('I pull the lever and duck.');
    await page.getByTestId('director-address-send').click();
    await expect(page.getByTestId('director-address-reply')).toContainText(/will not change|Action Draft|Veyra/i);
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 0');
  });

  test('QA-P4-02: Party Chat cannot become a command; NL Intent Intercept requires confirm', async ({
    page,
  }) => {
    await signIn(page);
    await quickCharacter(page, 'QA P4 Composer');
    await createCampaign(page, 'QA P4 Composer Table');
    await seatOwnCharacter(page);
    await page.getByTestId('open-campaign-table').click();
    await page.getByTestId('dock-tab-party_chat').click();
    await page.getByTestId('party-chat-input').fill('I attack the goblin');
    await page.getByTestId('party-chat-send').click();
    await expect(page.getByTestId('party-chat-message')).toContainText('I attack the goblin');
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 0');

    await page.getByTestId('claim-active-turn').click();
    await page.getByTestId('nl-intent-input').fill('I move toward the pillar');
    await page.getByTestId('interpret-nl-intent').click();
    await expect(page.getByTestId('intent-intercept')).toBeVisible();
    await page.getByTestId('cancel-intent-intercept').click();
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 0');
  });

  test('QA-P4-03: ordinary Admin denial; spoofed Google bootstrap can use kill switch', async ({
    page,
  }) => {
    await signIn(page);
    await page.getByTestId('nav-admin').click();
    await expect(page.getByTestId('admin-is-admin')).toHaveText('No');

    const origin = new URL(page.url()).origin;
    const google = await page.request.post(`${origin}/api/identity/google-emulator-session`, {
      data: { email: 'nick.donner@gmail.com' },
      headers: {
        origin,
        'x-hd-candidate': CANDIDATE,
        'content-type': 'application/json',
      },
    });
    expect(google.status()).toBe(201);
    await page.goto(`${ARENA}/admin`);
    await expect(page.getByTestId('admin-is-admin')).toHaveText('Yes');
    await page.getByTestId('admin-toggle-kill-switch').click();
    await expect(page.getByTestId('admin-ai-kill-switch')).toHaveText('enabled');
    await page.getByTestId('admin-toggle-kill-switch').click();
    await expect(page.getByTestId('admin-ai-kill-switch')).toHaveText('disabled');
  });

  test('QA-P4-04: two-client presence and Party Chat sync; out-of-turn command fails', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signIn(ownerPage);
    await quickCharacter(ownerPage, 'QA P4 Owner');
    const campaignId = await createCampaign(ownerPage, 'QA P4 Two Client');
    await seatOwnCharacter(ownerPage);
    await ownerPage.getByTestId('create-invite').click();
    const invitePath = (await ownerPage.getByTestId('invite-path').innerText()).trim();
    expect(invitePath).toMatch(/^\/invite\//);

    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await guestPage.goto(invitePath);
    await dismissIntro(guestPage);
    await guestPage.getByTestId('invite-sign-in').click();
    await expect(guestPage.getByTestId('invite-accept')).toBeVisible();
    await guestPage.getByTestId('invite-accept').click();
    await expect(guestPage.getByTestId('campaign-detail-heading')).toHaveText('QA P4 Two Client');
    await quickCharacter(guestPage, 'QA P4 Guest');
    await guestPage.goto(`/campaigns/${campaignId}`);
    await expect(guestPage.getByTestId('campaign-detail-heading')).toHaveText('QA P4 Two Client');
    await seatOwnCharacter(guestPage);

    await ownerPage.getByTestId('open-campaign-table').click();
    await guestPage.getByTestId('open-campaign-table').click();
    await expect(ownerPage.getByTestId('presence-panel')).toBeVisible({ timeout: 15_000 });
    await expect(guestPage.getByTestId('presence-panel')).toBeVisible({ timeout: 15_000 });

    await ownerPage.getByTestId('dock-tab-party_chat').click();
    await ownerPage.getByTestId('party-chat-input').fill(`sync-${randomUUID().slice(0, 6)}`);
    await ownerPage.getByTestId('party-chat-send').click();
    await guestPage.getByTestId('dock-tab-party_chat').click();
    await expect(guestPage.getByTestId('party-chat-message')).toBeVisible({ timeout: 15_000 });

    await ownerPage.getByTestId('claim-active-turn').click();
    await ownerPage.getByTestId('commit-table-sync').click();
    await expect(ownerPage.getByTestId('table-state-meta')).toContainText('Table state version 1');
    await expect(guestPage.getByTestId('table-state-meta')).toContainText('Table state version 1', {
      timeout: 10_000,
    });

    await expect(guestPage.getByTestId('commit-table-sync')).toHaveAttribute('aria-disabled', 'true');
    const origin = new URL(guestPage.url()).origin;
    const illegal = await guestPage.request.post(`${origin}/api/campaigns/${campaignId}/commands`, {
      data: {
        requestId: randomUUID(),
        commandType: 'table.sync',
        expectedStateVersion: 1,
      },
      headers: {
        origin,
        'x-hd-candidate': CANDIDATE,
        'content-type': 'application/json',
      },
    });
    expect(illegal.status()).toBeGreaterThanOrEqual(400);
    const illegalBody = (await illegal.json()) as { error?: string };
    expect(illegalBody.error).toMatch(/TIMING_AUTHORITY|NOT_SEATED|BAD_REQUEST|FORBIDDEN|STALE/);
  });

  test('QA-P4-05: speech prefs optional; STT control does not auto-send', async ({ page }) => {
    await signIn(page);
    await page.getByTestId('nav-account').click();
    await page.getByTestId('account-tts').check();
    await page.getByTestId('account-stt').check();
    await expect(page.getByTestId('account-tts')).toBeChecked();
    await expect(page.getByTestId('account-stt')).toBeChecked();
    await quickCharacter(page, 'QA P4 Speech');
    await createCampaign(page, 'QA P4 Speech Table');
    await seatOwnCharacter(page);
    await page.getByTestId('open-campaign-table').click();
    await page.getByTestId('dock-tab-party_chat').click();
    await expect(page.getByTestId('party-chat-dictate')).toBeVisible();
    await page.getByTestId('party-chat-dictate').click();
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version 0');
  });
});
