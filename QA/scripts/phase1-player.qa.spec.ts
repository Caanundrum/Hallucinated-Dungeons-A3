/**
 * Independent QA browser validation of the Phase 1 player journey.
 *
 * Operates the rendered frozen (or Rapid) page as a suspicious player.
 * Candidate id is supplied via QA_CANDIDATE_ID; arena URL via QA_ARENA_URL.
 */

import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const ARENA = process.env.QA_ARENA_URL ?? 'http://127.0.0.1:5274';
const CANDIDATE = process.env.QA_CANDIDATE_ID ?? '';
const EVIDENCE = process.env.QA_EVIDENCE_DIR ?? '/workspace/QA/evidence/phase-1/ui';

async function dismissIntro(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
  }
}

async function signIn(page: Page): Promise<void> {
  await page.goto(ARENA);
  await dismissIntro(page);
  if (CANDIDATE) {
    await expect(page.getByTestId('candidate-id').first()).toHaveText(CANDIDATE);
  } else {
    await expect(page.getByTestId('shell-enter-account').or(page.getByTestId('shell-account-link'))).toBeVisible();
  }
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

test.beforeAll(async () => {
  await mkdir(EVIDENCE, { recursive: true });
});

test.describe('Phase 1 independent QA — rendered page', () => {
  test('QA-P1-01 novice: enter, create character and campaign, understand Director lock copy', async ({
    page,
  }) => {
    await signIn(page);
    await quickCharacter(page, 'QA Novice Hero');
    await page.getByTestId('nav-campaigns').click();
    await page.getByTestId('start-campaign').click();
    await expect(page.getByTestId('director-config-notice')).toContainText('later AI-enabled table');
    await page.getByTestId('campaign-name').fill('QA Novice Table');
    await page.getByTestId('campaign-name').dispatchEvent('change');
    await page.getByTestId('identity-veyra').click();
    await page.getByTestId('personality-seasoned_host').click();
    await page.getByTestId('create-campaign-submit').click();
    await expect(page.getByTestId('director-locked-notice')).toContainText('Fixed after creation');
    await expect(page.getByTestId('open-campaign-settings')).toBeVisible();
    await expect(page.getByTestId('open-campaign-table')).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/p1-01-campaign-detail.png`, fullPage: true });
  });

  test('QA-P1-02 impatient: settings and Session Zero without fake AI controls', async ({ page }) => {
    await signIn(page);
    await quickCharacter(page, 'QA Impatient');
    await page.getByTestId('nav-campaigns').click();
    await page.getByTestId('start-campaign').click();
    await page.getByTestId('campaign-name').fill('QA Settings Table');
    await page.getByTestId('campaign-name').dispatchEvent('change');
    await page.getByTestId('identity-garrick').click();
    await page.getByTestId('personality-dry_storyteller').click();
    await page.getByTestId('create-campaign-submit').click();
    await page.getByTestId('open-campaign-settings').click();
    await expect(page.getByTestId('settings-config-notice')).toContainText('later AI-enabled table');
    await page.getByTestId('content-profile-tense').click();
    await page.getByTestId('complete-session-zero').click();
    await expect(page.getByTestId('settings-notice')).toContainText('Session Zero recorded');
    await expect(page.getByText('Address the Director')).toHaveCount(0);
    await page.screenshot({ path: `${EVIDENCE}/p1-02-settings.png`, fullPage: true });
  });

  test('QA-P1-03 dock: peer tabs and Action Composer stay separate', async ({ page }) => {
    await signIn(page);
    await quickCharacter(page, 'QA Dock User');
    await page.getByTestId('nav-campaigns').click();
    await page.getByTestId('start-campaign').click();
    await page.getByTestId('campaign-name').fill('QA Dock Table');
    await page.getByTestId('campaign-name').dispatchEvent('change');
    await page.getByTestId('identity-veyra').click();
    await page.getByTestId('personality-encouraging_guide').click();
    await page.getByTestId('create-campaign-submit').click();
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('dock-tab-chronicle')).toBeVisible();
    await expect(page.getByTestId('dock-tab-party_chat')).toBeVisible();
    await expect(page.getByTestId('dock-tab-rules_desk')).toBeVisible();
    await page.getByTestId('dock-tab-party_chat').click();
    await page.getByTestId('party-chat-input').fill('QA table talk only.');
    await page.getByTestId('party-chat-send').click();
    await expect(page.getByTestId('party-chat-message').first()).toContainText('QA table talk only.');
    await expect(page.getByTestId('action-composer-disabled')).toHaveAttribute('aria-disabled', 'true');
    await page.screenshot({ path: `${EVIDENCE}/p1-03-dock.png`, fullPage: true });
  });

  test('QA-P1-04 keyboard: primary shell navigation without a mouse', async ({ page }) => {
    await page.goto(ARENA);
    await dismissIntro(page);
    await page.keyboard.press('Tab');
    await page.getByTestId('shell-enter-account').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('shell-account-link')).toBeVisible();
    await page.getByTestId('nav-characters').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('vault-heading')).toBeVisible();
  });

  test('QA-P1-05 adversarial: foreign campaign id looks missing', async ({ page }) => {
    await signIn(page);
    await page.goto(`${ARENA}/campaigns/00000000-0000-4000-8000-000000000099`);
    await expect(page.getByTestId('campaign-detail-heading').or(page.getByRole('heading'))).toBeVisible();
    // Either honest empty/error copy — must not reveal foreign ownership details.
    const body = await page.locator('main').innerText();
    expect(body.toLowerCase()).not.toMatch(/owneraccountid|another player's private/);
    await page.screenshot({ path: `${EVIDENCE}/p1-05-foreign.png`, fullPage: true });
  });

  test('QA-P1-06 reentry: reload recovers character and campaign list', async ({ page }) => {
    await signIn(page);
    await quickCharacter(page, 'QA Reentry');
    await page.getByTestId('nav-campaigns').click();
    await page.getByTestId('start-campaign').click();
    await page.getByTestId('campaign-name').fill('QA Reentry Table');
    await page.getByTestId('campaign-name').dispatchEvent('change');
    await page.getByTestId('identity-veyra').click();
    await page.getByTestId('personality-sassy_companion').click();
    await page.getByTestId('create-campaign-submit').click();
    await page.reload();
    await dismissIntro(page);
    await page.getByTestId('nav-characters').click();
    await expect(page.getByTestId('character-link')).toContainText('QA Reentry');
    await page.getByTestId('nav-campaigns').click();
    await expect(page.getByTestId('campaign-link')).toContainText('QA Reentry Table');
    await page.screenshot({ path: `${EVIDENCE}/p1-06-reentry.png`, fullPage: true });
  });
});
