import { expect, test, type Page } from '@playwright/test';

import { joinTableWithFirstCharacter, enterAccountFromShell, readCandidate} from './arena-page.js';

/**
 * Phase 1 chunk 1e: campaign creation with locked Director configuration,
 * invitations, membership, and seats.
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

async function createCampaignWithDirector(
  page: Page,
  options: {
    readonly name: string;
    readonly identityTestId: string;
    readonly personalityTestId: string;
  },
): Promise<string> {
  await page.getByTestId('nav-campaigns').click();
  await expect(page.getByTestId('campaigns-heading')).toBeVisible();
  await page.getByTestId('start-campaign').click();
  await expect(page.getByTestId('create-campaign-heading')).toBeVisible();
  await expect(page.getByTestId('director-config-notice')).toContainText('later AI-enabled table');
  await expect(page.getByTestId('create-campaign-submit')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('personality-gated')).toBeVisible();
  await expect(page.getByTestId('personality-seasoned_host').locator('input')).toBeDisabled();

  await page.getByTestId('campaign-name').fill(options.name);
  await page.getByTestId('campaign-name').dispatchEvent('change');
  await page.getByTestId(options.identityTestId).click();
  await expect(page.getByTestId('personality-gated')).toHaveCount(0);
  await expect(page.getByTestId('personality-seasoned_host').locator('input')).toBeEnabled();
  await page.getByTestId(options.personalityTestId).click();
  await expect(page.getByTestId('campaign-preview')).toBeVisible();
  await expect(page.getByTestId('preview-sample-scene')).not.toBeEmpty();
  await expect(page.getByTestId('preview-play-rhythm')).not.toBeEmpty();
  await expect(page.getByTestId('create-campaign-submit')).toHaveAttribute('aria-disabled', 'false');
  await page.getByTestId('create-campaign-submit').click();
  await expect(page.getByTestId('join-table-heading')).toBeVisible();
  const match = page.url().match(/\/campaigns\/([A-Za-z0-9-]+)\/join/);
  expect(match).toBeTruthy();
  return match![1]!;
}

test.describe('Phase 1 campaigns, Director lock, invitations, and seats', () => {
  test('create locks Director config, invites a second account, and seats owned characters only', async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signIn(ownerPage);
    await createQuickCharacter(ownerPage, 'Campaign Owner Scout');
    const campaignId = await createCampaignWithDirector(ownerPage, {
      name: 'Ember Gate Table',
      identityTestId: 'identity-veyra',
      personalityTestId: 'personality-dry_storyteller',
    });

    await expect(ownerPage.getByTestId('director-identity-label')).toHaveText('Veyra');
    await expect(ownerPage.getByTestId('director-personality-label')).toHaveText('Dry Storyteller');
    await expect(ownerPage.getByTestId('director-identity-label')).toHaveText('Veyra');
    await expect(ownerPage.getByTestId('director-locked-notice')).toContainText('Fixed after creation');
    await expect(ownerPage.getByTestId('director-lock-badge')).toHaveText('Fixed');
    await expect(ownerPage.getByTestId('campaign-next-step')).toBeVisible();

    const origin = new URL(ownerPage.url()).origin;
    const candidate = await readCandidate(ownerPage);
    const locked = await ownerPage.request.patch(`/api/campaigns/${campaignId}`, {
      headers: {
        origin,
        'content-type': 'application/json',
        'x-hd-candidate': candidate.candidateId,
      },
      data: { directorIdentity: 'garrick', directorPersonality: 'friendly_adventurer' },
    });
    expect(locked.status()).toBe(409);
    const lockedBody = (await locked.json()) as { error: string };
    expect(lockedBody.error).toBe('DIRECTOR_CONFIG_LOCKED');

    await ownerPage.goto(`/campaigns/${campaignId}`);
    await expect(ownerPage.getByTestId('campaign-detail-heading')).toHaveText('Ember Gate Table');

    await ownerPage.getByTestId('create-invite').click();
    await expect(ownerPage.getByTestId('invite-path')).toBeVisible();
    const invitePath = (await ownerPage.getByTestId('invite-path').innerText()).trim();
    expect(invitePath).toMatch(/^\/invite\/[A-Za-z0-9]{8,32}$/);

    await joinTableWithFirstCharacter(ownerPage);
    await ownerPage.goto(`/campaigns/${campaignId}`);
    await expect(ownerPage.getByTestId('own-seat')).toContainText('Campaign Owner Scout');

    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();

    await guestPage.goto(invitePath);
    await expect(guestPage.getByTestId('invite-heading')).toHaveText('Campaign invitation');
    await expect(guestPage.getByTestId('invite-campaign-name')).toHaveText('Ember Gate Table');
    await expect(guestPage.getByTestId('invite-director')).toContainText('Veyra');
    await expect(guestPage.getByTestId('invite-config-notice')).toContainText('later AI-enabled table');
    await expect(guestPage.getByTestId('invite-sign-in')).toBeVisible();

    await guestPage.getByTestId('invite-sign-in').click();
    await expect(guestPage.getByTestId('invite-joining-as')).toBeVisible();
    await expect(guestPage.getByTestId('invite-accept')).toBeVisible();
    await guestPage.getByTestId('invite-accept').click();
    await expect(guestPage.getByTestId('campaign-detail-heading')).toHaveText('Ember Gate Table');
    await expect(guestPage.getByTestId('director-identity-label')).toHaveText('Veyra');

    await createQuickCharacter(guestPage, 'Guest Blade');
    await guestPage.goto(`/campaigns/${campaignId}/join`);
    await joinTableWithFirstCharacter(guestPage);
    await guestPage.goto(`/campaigns/${campaignId}`);
    await expect(guestPage.getByTestId('own-seat')).toContainText('Guest Blade');

    // Reentry recovers the same locked Director configuration.
    await guestPage.reload();
    await expect(guestPage.getByTestId('director-identity-label')).toHaveText('Veyra');
    await expect(guestPage.getByTestId('director-personality-label')).toHaveText('Dry Storyteller');
    await expect(guestPage.getByTestId('own-seat')).toContainText('Guest Blade');

    await ownerPage.reload();
    await expect(ownerPage.getByTestId('member-list')).toBeVisible();
    await expect(ownerPage.getByTestId('member-item')).toHaveCount(2);
    await expect(ownerPage.getByTestId('seat-item')).toHaveCount(2);

    await guestContext.close();
    await ownerContext.close();
  });

  test('Seasoned Host is recommended but never silently selected', async ({ page }) => {
    await signIn(page);
    await page.getByTestId('nav-campaigns').click();
    await page.getByTestId('start-campaign').click();
    await expect(page.getByTestId('personality-recommended')).toBeVisible();
    await expect(page.getByTestId('personality-seasoned_host')).toContainText('Seasoned Host');
    await expect(page.getByTestId('personality-gated')).toBeVisible();
    await expect(page.locator('input[name="director-personality"]:checked')).toHaveCount(0);
    await expect(page.locator('input[name="director-identity"]:checked')).toHaveCount(0);
    await expect(page.getByTestId('create-campaign-submit')).toHaveAttribute('aria-disabled', 'true');

    await page.getByTestId('identity-veyra').click();
    await expect(page.getByTestId('personality-gated')).toHaveCount(0);
    await expect(page.locator('input[name="director-personality"]:checked')).toHaveCount(0);
    await expect(page.getByTestId('campaign-preview-pending')).toBeVisible();
    await expect(page.getByTestId('identity-veyra')).toContainText('Woman');
    await expect(page.getByTestId('identity-garrick')).toContainText('Man');
  });

  test('foreign account cannot read another account campaign', async ({ browser }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signIn(ownerPage);
    const campaignId = await createCampaignWithDirector(ownerPage, {
      name: 'Private Table',
      identityTestId: 'identity-garrick',
      personalityTestId: 'personality-seasoned_host',
    });

    const strangerContext = await browser.newContext();
    const strangerPage = await strangerContext.newPage();
    await signIn(strangerPage);
    await strangerPage.goto(`/campaigns/${campaignId}`);
    await expect(strangerPage.getByTestId('campaign-detail-heading')).toHaveText(
      'Campaign unavailable',
    );
    const denied = await strangerPage.request.get(`/api/campaigns/${campaignId}`);
    expect(denied.status()).toBe(404);

    await strangerContext.close();
    await ownerContext.close();
  });

  test('campaign title input enables Create without blur, and seat return soft-nav keeps the query', async ({
    page,
  }) => {
    await signIn(page);
    const campaignId = await createCampaignWithDirector(page, {
      name: 'Return Seat Table',
      identityTestId: 'identity-veyra',
      personalityTestId: 'personality-seasoned_host',
    });

    await expect(page.getByTestId('seat-vault-link')).toBeVisible();
    await page.getByTestId('seat-vault-link').click();
    await expect(page).toHaveURL(new RegExp(`/characters/new\\?returnCampaign=${campaignId}`));
    await expect(page.getByTestId('create-heading')).toBeVisible();

    await page.getByTestId('nav-campaigns').click();
    await page.getByTestId('start-campaign').click();
    await page.getByTestId('identity-veyra').click();
    await page.getByTestId('personality-seasoned_host').click();
    await expect(page.getByTestId('create-campaign-submit')).toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('campaign-name').fill('Typed Last Title');
    await expect(page.getByTestId('create-campaign-submit')).toHaveAttribute('aria-disabled', 'false');
    await expect(page.getByTestId('preview-campaign-name')).toHaveText('Typed Last Title');
  });
});
