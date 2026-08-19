import { expect, test, type Page } from '@playwright/test';

import { enterAccountFromShell } from './arena-page.js';

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

test.describe('Phase 1 settings and Communication Dock structure', () => {
  test('owner configures settings and Session Zero; dock keeps Party Chat separate from Action Composer', async ({
    page,
  }) => {
    await signIn(page);
    await createQuickCharacter(page, 'Settings Scout');
    const campaignId = await createCampaign(page, 'Dock and Settings Table');

    await expect(page.getByTestId('session-zero-summary')).toContainText('not recorded yet');
    await page.getByTestId('open-campaign-settings').click();
    await expect(page.getByTestId('campaign-settings-heading')).toBeVisible();
    await expect(page.getByTestId('settings-config-notice')).toContainText(
      'later AI-enabled table',
    );
    await expect(page.getByTestId('session-zero-status')).toContainText('Not completed yet');

    await page.getByTestId('content-profile-tense').click();
    await page.getByTestId('safety-boundaries').fill('No spiders. Lines and veils apply.');
    await page.getByTestId('group-decision-unanimous_consent').click();
    await page.getByTestId('reaction-window').fill('15');
    await page.getByTestId('session-tone').selectOption('grim');
    await page.getByTestId('complete-session-zero').click();
    await expect(page.getByTestId('settings-notice')).toContainText('Session Zero recorded');
    await expect(page.getByTestId('session-zero-status')).toContainText('Recorded');

    await page.getByTestId('settings-back').click();
    await expect(page.getByTestId('session-zero-summary')).toContainText('recorded');
    await expect(page.getByTestId('session-zero-summary')).toContainText('Tense');

    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('communication-dock')).toBeVisible();
    await expect(page.getByTestId('dock-tab-chronicle')).toBeVisible();
    await expect(page.getByTestId('dock-tab-party_chat')).toBeVisible();
    await expect(page.getByTestId('dock-tab-rules_desk')).toBeVisible();
    await expect(page.getByTestId('chronicle-list')).toBeVisible();
    await expect(page.getByTestId('chronicle-entry').first()).toContainText('created this campaign');

    await page.getByTestId('dock-tab-rules_desk').click();
    await expect(page.getByTestId('rules-desk-notice')).toContainText('cannot grant rulings');

    await page.getByTestId('dock-tab-party_chat').click();
    await expect(page.getByTestId('party-chat-composer')).toBeVisible();
    await expect(page.getByTestId('chat-send-clarity')).toContainText('cannot spend resources');
    await page.getByTestId('chat-mode-speak_as_character').click();
    await page.getByTestId('party-chat-input').fill('I raise my lantern toward the door.');
    await page.getByTestId('party-chat-send').click();
    await expect(page.getByTestId('party-chat-message').first()).toContainText(
      'I raise my lantern toward the door.',
    );
    await expect(page.getByTestId('party-chat-message').first()).toContainText(
      'Speak as Character',
    );

    await expect(page.getByTestId('action-composer')).toBeVisible();
    await expect(page.getByTestId('action-composer-notice')).toContainText('Click a square on the map');
    await expect(page.getByTestId('table-state-meta')).toContainText('Table state version');
    await expect(page.getByTestId('commit-table-sync')).toBeVisible();
    await expect(page.getByTestId('claim-active-turn')).toBeVisible();
    await expect(page.getByTestId('interpret-action')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('timing-authority-meta')).toContainText('No Active Turn');

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
    await expect(page.locator('html')).toHaveClass(/hd-reduced-motion/);
    await page.reload();
    await dismissIntroIfPresent(page);
    await page.getByTestId('nav-account').click();
    await expect(page.getByTestId('account-reduced-motion')).toBeChecked();
  });
});
