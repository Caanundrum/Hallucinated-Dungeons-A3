import { expect, test, type Page } from '@playwright/test';

import {enterAccountFromShell, readCandidate, recordDefaultSessionZero} from './arena-page.js';

/**
 * Phase 1 chunk 1g: certified player reentry journey.
 *
 * Blueprint / pack: enter → character → campaign with locked Director → invite
 * second identity into membership + seat → confirm lock → configure settings →
 * leave/return and recover the same character and campaign state.
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
  await page.getByTestId('identity-garrick').click();
  await page.getByTestId('personality-friendly_adventurer').click();
  await page.getByTestId('create-campaign-submit').click();
  await expect(page.getByTestId('campaign-detail-heading')).toHaveText(name);
  return page.url().split('/').pop()!;
}

test.describe('Phase 1 reentry journey', () => {
  test('full pack journey recovers character, campaign, lock, seat, and settings after reload', async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signIn(ownerPage);
    await createQuickCharacter(ownerPage, 'Reentry Owner Guard');
    const campaignId = await createCampaign(ownerPage, 'Reentry Continuity Table');

    await expect(ownerPage.getByTestId('director-identity-label')).toHaveText('Garrick');
    await expect(ownerPage.getByTestId('director-personality-label')).toHaveText(
      'Friendly Adventurer',
    );

    const origin = new URL(ownerPage.url()).origin;
    const candidate = await readCandidate(ownerPage);
    const locked = await ownerPage.request.patch(`/api/campaigns/${campaignId}`, {
      headers: {
        origin,
        'content-type': 'application/json',
        'x-hd-candidate': candidate.candidateId,
      },
      data: { directorIdentity: 'veyra', directorPersonality: 'seasoned_host' },
    });
    expect(locked.status()).toBe(409);

    await ownerPage.getByTestId('create-invite').click();
    const invitePath = (await ownerPage.getByTestId('invite-path').innerText()).trim();

    // Second local development identity joins and seats.
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await guestPage.goto(invitePath);
    await dismissIntroIfPresent(guestPage);
    await guestPage.getByTestId('invite-sign-in').click();
    await expect(guestPage.getByTestId('invite-accept')).toBeVisible();
    await guestPage.getByTestId('invite-accept').click();
    await expect(guestPage.getByTestId('campaign-detail-heading')).toHaveText(
      'Reentry Continuity Table',
    );
    await createQuickCharacter(guestPage, 'Reentry Guest Scout');
    // Owner must record Session Zero before anyone can seat (PQA-086).
    await recordDefaultSessionZero(ownerPage);
    await guestPage.goto(`/campaigns/${campaignId}`);
    const guestSeatSelect = guestPage.getByTestId('seat-character-select');
    const guestCharacterId = await guestSeatSelect.locator('option').nth(1).getAttribute('value');
    expect(guestCharacterId).toBeTruthy();
    await guestSeatSelect.selectOption(guestCharacterId!);
    await guestPage.getByTestId('create-seat').click();
    await expect(guestPage.getByTestId('own-seat')).toContainText('Reentry Guest Scout');

    // Owner configures settings + Session Zero.
    await ownerPage.getByTestId('open-campaign-settings').click();
    await ownerPage.getByTestId('content-profile-custom_restricted').click();
    await ownerPage.getByTestId('safety-boundaries').fill('Reentry lines and veils.');
    await ownerPage.getByTestId('complete-session-zero').click();
    await expect(ownerPage.getByTestId('settings-notice')).toContainText(/Session Zero (recorded|updated)/);

    // Owner seats their character for continuity proof.
    await ownerPage.getByTestId('settings-back').click();
    const ownerSeatSelect = ownerPage.getByTestId('seat-character-select');
    const ownerCharacterId = await ownerSeatSelect.locator('option').nth(1).getAttribute('value');
    expect(ownerCharacterId).toBeTruthy();
    await ownerSeatSelect.selectOption(ownerCharacterId!);
    await ownerPage.getByTestId('create-seat').click();
    await expect(ownerPage.getByTestId('own-seat')).toContainText('Reentry Owner Guard');

    // Leave and return: hard reload with the same session cookie.
    await ownerPage.reload();
    await dismissIntroIfPresent(ownerPage);
    await ownerPage.getByTestId('nav-characters').click();
    await expect(ownerPage.getByTestId('character-link')).toContainText('Reentry Owner Guard');
    await ownerPage.getByTestId('nav-campaigns').click();
    await expect(ownerPage.getByTestId('campaign-link')).toContainText('Reentry Continuity Table');
    await ownerPage.getByTestId('campaign-link').filter({ hasText: 'Reentry Continuity Table' }).click();
    await expect(ownerPage.getByTestId('campaign-detail-heading')).toHaveText(
      'Reentry Continuity Table',
    );
    await expect(ownerPage.getByTestId('director-identity-label')).toHaveText('Garrick');
    await expect(ownerPage.getByTestId('own-seat')).toContainText('Reentry Owner Guard');
    await expect(ownerPage.getByTestId('session-zero-summary')).toContainText('recorded');
    await expect(ownerPage.getByTestId('session-zero-summary')).toContainText('Custom Restricted');

    await ownerPage.getByTestId('open-campaign-settings').click();
    await expect(ownerPage.getByTestId('content-profile-custom_restricted')).toBeChecked();
    await expect(ownerPage.getByTestId('safety-boundaries')).toHaveValue('Reentry lines and veils.');

    // Guest recovers membership and seat after reload.
    await guestPage.reload();
    await dismissIntroIfPresent(guestPage);
    await guestPage.goto(`/campaigns/${campaignId}`);
    await expect(guestPage.getByTestId('campaign-detail-heading')).toHaveText(
      'Reentry Continuity Table',
    );
    await expect(guestPage.getByTestId('own-seat')).toContainText('Reentry Guest Scout');
    await guestPage.getByTestId('open-campaign-settings').click();
    await expect(guestPage.getByTestId('settings-read-only')).toBeVisible();
    await expect(guestPage.getByTestId('content-profile-custom_restricted')).toBeChecked();

    await guestContext.close();
    await ownerContext.close();
  });
});
