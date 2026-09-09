import { expect, test, type Page } from '@playwright/test';

import { enterAccountFromShell, openTableAdvancedControls } from './arena-page.js';

/**
 * Phase 1 chunk 1f: campaign settings / Session Zero and Communication Dock
 * structure with a separate Action Composer.
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
  const tutorialNo = page.getByTestId('tutorial-ask-no');
  if (await tutorialNo.isVisible().catch(() => false)) {
    await tutorialNo.click();
  }
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
  await expect(page.getByTestId('join-table-heading')).toBeVisible();
  const match = page.url().match(/\/campaigns\/([A-Za-z0-9-]+)\/join/);
  expect(match).toBeTruthy();
  const campaignId = match![1];
  await page.goto(`/campaigns/${campaignId}`);
  await expect(page.getByTestId('campaign-detail-heading')).toHaveText(name);
  return campaignId;
}

test.describe('Phase 1 settings and Communication Dock structure', () => {
  test('owner configures settings and Session Zero; dock keeps Party Chat separate from Action Composer', async ({
    page,
  }) => {
    await signIn(page);
    await createQuickCharacter(page, 'Settings Scout');
    const campaignId = await createCampaign(page, 'Dock and Settings Table');

    // Campaign create already records Session Zero defaults — open settings to refine tone.
    await expect(page.getByTestId('session-zero-summary')).toContainText(/Session Zero|recorded/i);
    await page.getByTestId('open-campaign-settings').click();
    await expect(page.getByTestId('campaign-settings-heading')).toBeVisible();
    await expect(page.getByTestId('settings-config-notice')).toContainText(
      /Game Director may enforce tone|durable campaign configuration/i,
    );
    await expect(page.getByTestId('session-zero-status')).toContainText(/Recorded|recorded/i);

    await page.getByTestId('content-profile-tense').click();
    await page.getByTestId('safety-boundaries').fill('No spiders. Lines and veils apply.');
    await page.getByTestId('reaction-window').fill('15');
    await page.getByTestId('session-tone').selectOption({ index: 1 });
    await page.getByTestId('session-length').fill('3–5 sessions');
    await page.getByTestId('save-settings').click();
    await expect(page.getByTestId('settings-notice')).toContainText(/settings saved|Session Zero/i);

    await page.getByTestId('settings-back').click();
    await expect(page.getByTestId('session-zero-summary')).toContainText(/recorded|Session Zero/i);
    await expect(page.getByTestId('session-zero-summary')).toContainText(/Tense|Adventure/i);

    await page.getByTestId('seat-character-select').selectOption({ index: 1 });
    await page.getByTestId('create-seat').click();
    await expect(page.getByTestId('own-seat')).toBeVisible();

    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('communication-dock')).toBeVisible();
    await expect(page.getByTestId('dock-tab-party_chat')).toBeVisible();
    await expect(page.getByTestId('dock-tab-rules_desk')).toHaveCount(0);
    await expect(page.getByTestId('comms-story-tier')).toHaveCount(0);
    await expect(page.getByTestId('dm-play-thread')).toBeVisible();

    await page.getByTestId('table-info-tab-rules').scrollIntoViewIfNeeded();
    await page.getByTestId('table-info-tab-rules').click();
    await expect(page.getByTestId('rules-desk-notice')).toContainText(
      /Browse the SRD|does not make rulings|never changes the table/i,
    );

    await page.getByTestId('dock-tab-party_chat').click();
    await expect(page.getByTestId('party-chat-composer')).toBeVisible();
    await expect(page.getByTestId('chat-mode-table_talk')).toHaveCount(0);
    await expect(page.getByTestId('chat-mode-speak_as_character')).toBeVisible();
    await page.getByTestId('party-chat-input').fill('I raise my lantern toward the door.');
    await page.getByTestId('party-chat-input').dispatchEvent('input');
    await expect(page.getByTestId('party-chat-send')).toHaveAttribute('aria-disabled', 'false');
    await page.getByTestId('party-chat-send').click();
    await expect(page.getByTestId('party-chat-message').first()).toContainText(
      'I raise my lantern toward the door.',
    );

    await expect(page.getByTestId('action-composer')).toBeVisible();
    await expect(page.getByTestId('action-composer-notice')).toContainText('initiative');
    await openTableAdvancedControls(page);
    await expect(page.getByTestId('table-state-meta')).toHaveAttribute('data-state-version', /\d+/);
    await expect(page.getByTestId('commit-table-sync')).toBeVisible();
    await expect(page.getByTestId('player-action-input')).toBeVisible();
    await expect(page.getByTestId('interpret-action')).toHaveAttribute('aria-disabled', 'false');
    await expect(page.getByTestId('timing-authority-meta')).toContainText('Exploration');

    // Reload recovers settings and Party Chat.
    await page.goto(`/campaigns/${campaignId}/settings`);
    await expect(page.getByTestId('campaign-settings-heading')).toBeVisible();
    await expect(page.getByTestId('content-profile-tense')).toBeChecked();
    await expect(page.getByTestId('safety-boundaries')).toHaveValue(
      'No spiders. Lines and veils apply.',
    );
    await expect(page.getByTestId('session-zero-status')).toContainText('Recorded');

    await page.goto(`/campaigns/${campaignId}/table`);
    await page.getByTestId('dock-tab-party_chat').click();
    await expect(page.getByTestId('party-chat-message').first()).toContainText(
      'I raise my lantern toward the door.',
    );
  });

  test('account reduced-motion preference persists and speech prefs stay optional defaults', async ({
    page,
  }) => {
    await signIn(page);
    await page.getByTestId('nav-account').click();
    await expect(page.getByTestId('account-heading')).toBeVisible();
    await expect(page.getByTestId('account-reduced-motion')).toBeVisible();
    await expect(page.getByTestId('account-tts')).toBeVisible();
    await expect(page.getByTestId('account-stt')).toBeVisible();
    await expect(page.getByTestId('account-tts')).not.toBeChecked();
    await expect(page.getByTestId('account-stt')).not.toBeChecked();
    await page.getByTestId('account-reduced-motion').check();
    await page.getByTestId('save-presentation').click();
    await expect(page.getByTestId('presentation-settings-saved')).toBeVisible();
    await expect(page.locator('html')).toHaveClass(/hd-reduced-motion/);
    await page.reload();
    await dismissIntroIfPresent(page);
    await page.getByTestId('nav-account').click();
    await expect(page.getByTestId('account-reduced-motion')).toBeChecked();
  });
});
