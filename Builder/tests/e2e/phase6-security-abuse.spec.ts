import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { enterAccountFromShell, readCandidate } from './arena-page.js';

/**
 * Phase 6 security / privacy hardening:
 * foreign-origin mutation refusal, rate limits, Admin kill-switch gate,
 * and Local Arena account deletion-request surface.
 *
 * Rate-limit e2e: tighten the server via env before starting the arena, e.g.
 *   HD_RATE_LIMIT_COMMANDS_PER_WINDOW=5
 *   HD_RATE_LIMIT_CHAT_PER_WINDOW=5
 *   HD_RATE_LIMIT_WINDOW_MS=60000
 * Without overrides the defaults (commands 60/min, chat 30/min) still trip after
 * enough rapid-fire POSTs; the test stops at the first RATE_LIMITED.
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

test.describe('Phase 6 security and privacy hardening', () => {
  test('foreign Origin on a mutating table command is refused', async ({ page, baseURL }) => {
    await signIn(page);
    await createQuickCharacter(page, 'Phase6 Origin Scout');
    const campaignId = await createCampaign(page, 'Phase6 Origin Table');
    await seatOwnCharacter(page);
    const candidate = await readCandidate(page);

    const response = await page.request.post(`${baseURL}/api/campaigns/${campaignId}/commands`, {
      headers: {
        origin: 'http://attacker.invalid',
        'x-hd-candidate': candidate.candidateId,
        'content-type': 'application/json',
      },
      data: {
        requestId: randomUUID(),
        commandType: 'table.move',
        expectedStateVersion: 0,
        path: [{ column: 0, row: 0 }],
      },
      failOnStatusCode: false,
    });

    expect(response.status()).toBe(403);
    expect((await response.json()).error).toBe('FORBIDDEN_ORIGIN');
  });

  test('rapid-fire party chat eventually returns RATE_LIMITED', async ({ page }) => {
    await signIn(page);
    await createQuickCharacter(page, 'Phase6 Rate Scout');
    const campaignId = await createCampaign(page, 'Phase6 Rate Table');
    await seatOwnCharacter(page);
    const candidate = await readCandidate(page);
    const origin = new URL(page.url()).origin;

    // Defaults are 30 chat / window; env may lower to 5 for faster certify runs.
    const maxAttempts = 80;
    let sawRateLimited = false;
    for (let i = 0; i < maxAttempts; i += 1) {
      const response = await page.request.post(`/api/campaigns/${campaignId}/party-chat`, {
        headers: {
          origin,
          'content-type': 'application/json',
          'x-hd-candidate': candidate.candidateId,
        },
        data: { mode: 'table_talk', body: `rate-limit probe ${i}` },
        failOnStatusCode: false,
      });
      if (response.status() === 429) {
        const body = (await response.json()) as { error: string; message: string };
        expect(body.error).toBe('RATE_LIMITED');
        expect(body.message.length).toBeGreaterThan(0);
        sawRateLimited = true;
        break;
      }
      expect([201, 429]).toContain(response.status());
    }
    expect(sawRateLimited).toBe(true);
  });

  test('ordinary user cannot open Admin kill switch', async ({ page }) => {
    await signIn(page);
    await page.getByTestId('nav-admin').click();
    await expect(page.getByTestId('admin-heading')).toHaveText('Admin');
    await expect(page.getByTestId('admin-is-admin')).toHaveText('No');
    await expect(page.getByTestId('admin-toggle-kill-switch')).toHaveCount(0);
  });

  test('account deletion request is visible on Account page', async ({ page }) => {
    await signIn(page);
    await page.getByTestId('nav-account').click();
    await expect(page.getByTestId('account-heading')).toHaveText('Account');
    await expect(page.getByTestId('account-deletion-status')).toBeVisible();
    await expect(page.getByTestId('account-deletion-status')).toContainText(/Local Arena/i);
    await page.getByTestId('request-account-deletion').click();
    await expect(page.getByTestId('account-deletion-status')).toContainText(/Deletion requested/i);
    await expect(page.getByTestId('request-account-deletion')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});
