import { expect, test, type Page } from '@playwright/test';

import { enterAccountFromShell, enterArena, openArena } from './arena-page.js';

/**
 * Phase 1 chunk 1d: Development Test Identity projected as the ordinary
 * account surface (shell chip, Account page, in-page gates).
 */

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
  }
}

test.describe('Phase 1 account projection', () => {
  test('shell sign-in projects a development account without visiting diagnostics', async ({
    page,
  }) => {
    await page.goto('/');
    await dismissIntroIfPresent(page);

    await expect(page.getByTestId('shell-account-status')).toHaveText('Not signed in');
    await enterAccountFromShell(page);
    await expect(page.getByTestId('shell-account-link')).toBeVisible();

    await page.getByTestId('nav-account').click();
    await expect(page.getByTestId('account-heading')).toHaveText('Account');
    await expect(page.getByTestId('account-display-label')).not.toBeEmpty();
    await expect(page.getByTestId('account-page-id')).toContainText('dev-');
    await expect(page.getByTestId('account-identity-mode')).toHaveText(
      'Development Test Identity',
    );
  });

  test('Character Vault offers in-page sign-in instead of a diagnostics detour', async ({
    page,
  }) => {
    await page.goto('/characters');
    await expect(page.getByTestId('signed-out-heading')).toHaveText('Character Vault');
    await expect(page.getByTestId('gate-enter-account')).toBeVisible();

    await page.getByTestId('gate-enter-account').click();
    await expect(page.getByTestId('vault-heading')).toHaveText('Character Vault');
    await expect(page.getByTestId('vault-empty')).toBeVisible();
    await expect(page.getByTestId('shell-account-link')).toBeVisible();
  });

  test('after shell sign-in, character creation works without opening diagnostics', async ({
    page,
  }) => {
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);

    await page.getByTestId('nav-characters').click();
    await page.getByTestId('start-character').click();
    await expect(page.getByTestId('create-heading')).toBeVisible();
    await page.getByTestId('option-stalwart-defender').click();
    await expect(page.getByTestId('active-step-heading')).toHaveText('Identity & Final Review');
    await page.getByTestId('identity-name').fill('Account Surface Scout');
    await page.getByTestId('identity-name').dispatchEvent('change');
    await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
    await page.getByTestId('create-character').click();
    await expect(page.getByTestId('character-sheet-heading')).toHaveText('Account Surface Scout');
  });

  test('unauthenticated API still refuses account-owned reads', async ({ page }) => {
    await page.goto('/');
    const response = await page.request.get('/api/characters/vault');
    expect(response.status()).toBe(401);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe('NOT_AUTHENTICATED');
    expect(body.message).toContain('development account');
  });

  test('diagnostics enter/leave still syncs the shell account chip', async ({ page }) => {
    await openArena(page);
    await page.getByTestId('enter-arena').click();
    await expect(page.getByTestId('account-id')).toBeVisible();
    await expect(page.getByTestId('shell-account-link')).toBeVisible();

    await page.getByTestId('leave-arena').click();
    await expect(page.getByTestId('enter-arena')).toBeVisible();
    await expect(page.getByTestId('shell-enter-account')).toBeVisible();
  });
});
