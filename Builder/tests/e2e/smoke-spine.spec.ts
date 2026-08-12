import { expect, test } from '@playwright/test';

import {
  enterArena,
  openArena,
  projectionVersion,
  recordCheck,
  renderedNotes,
} from './arena-page.js';

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
});
