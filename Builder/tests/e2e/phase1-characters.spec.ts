import { expect, test, type Page } from '@playwright/test';

import { enterArena } from './arena-page.js';

/**
 * Phase 1 chunk 1c actual-page journey: Character Vault, custom and
 * quick-start creation, draft resume, and account ownership.
 *
 * Blueprint ownership: Sections 1.5.8 / 1.5.8.2 (creation ordering), 6.4
 * (drafts and validation), and 7.7 (account-bound ownership).
 */

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
  }
}

async function enterArenaForCharacters(page: Page): Promise<string> {
  await page.goto('/');
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
  }
  await page.getByTestId('shell-enter-account').click();
  await expect(page.getByTestId('shell-account-link')).toBeVisible();
  // Resolve the account id from the Account page rather than diagnostics.
  await page.getByTestId('nav-account').click();
  await expect(page.getByTestId('account-page-id')).toBeVisible();
  return (await page.getByTestId('account-page-id').innerText()).trim();
}

async function openVault(page: Page): Promise<void> {
  await page.getByTestId('nav-characters').click();
  await expect(page.getByTestId('vault-heading')).toBeVisible();
}

/**
 * Choose a radio/checkbox option. The wizard re-renders after every confirmed
 * save, so Playwright's `.check()` (which waits to observe the checked state)
 * hangs when the control is replaced. Click the control, then wait for the
 * page to settle on the next rendered state.
 */
async function chooseOption(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).click();
  await expect(page.getByTestId('create-heading')).toBeVisible();
  await expect(page.locator('[data-testid="create-error"]')).toHaveCount(0);
}

async function assignStandardArray(page: Page): Promise<void> {
  const assignment: ReadonlyArray<[string, string]> = [
    ['strength', '15'],
    ['dexterity', '14'],
    ['constitution', '13'],
    ['intelligence', '12'],
    ['wisdom', '10'],
    ['charisma', '8'],
  ];
  for (const [ability, score] of assignment) {
    await page.getByTestId(`ability-select-${ability}`).selectOption(score);
    await expect(page.getByTestId(`ability-select-${ability}`)).toHaveValue(score);
  }
}

test.describe('Phase 1 character creation and Character Vault', () => {
  test('home and nav reach an empty Character Vault after entering the Local Arena', async ({
    page,
  }) => {
    await enterArenaForCharacters(page);
    await page.goto('/');
    await dismissIntroIfPresent(page);

    await page.getByTestId('home-characters-link').click();
    await expect(page.getByTestId('vault-heading')).toHaveText('Character Vault');
    await expect(page.getByTestId('vault-empty')).toBeVisible();
    await expect(page.getByTestId('nav-characters')).toHaveAttribute('aria-current', 'page');
  });

  test('quick-start creates an owned character visible in the vault and sheet', async ({
    page,
  }) => {
    await enterArenaForCharacters(page);
    await openVault(page);

    await page.getByTestId('start-character').click();
    await expect(page.getByTestId('create-heading')).toBeVisible();
    await expect(page.getByTestId('quick-start-options')).toBeVisible();

    await chooseOption(page, 'option-stalwart-defender');
    await expect(page.getByTestId('active-step-heading')).toHaveText('Identity & Final Review');
    await expect(page.getByTestId('sheet-hit-points')).not.toBeEmpty();

    await page.getByTestId('identity-name').fill('Brannok Stone');
    await page.getByTestId('identity-name').dispatchEvent('change');
    await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
    await expect(page.getByTestId('create-character')).toHaveAttribute('aria-disabled', 'false');

    await page.getByTestId('create-character').click();
    await expect(page.getByTestId('character-sheet-heading')).toHaveText('Brannok Stone');
    await expect(page.getByTestId('character-summary')).toContainText('Fighter');
    await expect(page.getByTestId('sheet-hit-points')).not.toBeEmpty();
    await expect(page.getByText('Why is this number?').first()).toBeVisible();

    await page.getByTestId('back-to-vault').click();
    await expect(page.getByTestId('character-list')).toBeVisible();
    await expect(page.getByTestId('character-link')).toContainText('Brannok Stone');
    await expect(page.getByTestId('vault-empty')).toHaveCount(0);
    await expect(page.getByTestId('draft-list')).toHaveCount(0);
  });

  test('custom creation walks identity-last steps and resumes one draft', async ({ page }) => {
    await enterArenaForCharacters(page);
    await openVault(page);
    await page.getByTestId('start-character').click();
    await expect(page.getByTestId('create-heading')).toBeVisible();

    await chooseOption(page, 'option-fighter');
    await chooseOption(page, 'check-athletics');
    await chooseOption(page, 'check-perception');
    await expect(page.getByTestId('wizard-continue')).toHaveAttribute('aria-disabled', 'false');
    await page.getByTestId('wizard-continue').click();
    await expect(page.getByTestId('active-step-heading')).toContainText('Background');

    await page.getByTestId('nav-characters').click();
    await expect(page.getByTestId('draft-list')).toBeVisible();
    await expect(page.getByTestId('resume-draft')).toContainText('Fighter');

    await page.getByTestId('resume-draft').click();
    await expect(page.getByTestId('create-heading')).toBeVisible();
    // Resume lands on the first unresolved step; open Class to confirm the
    // earlier choice persisted on the same draft.
    await page.getByTestId('step-class').click();
    await expect(page.getByTestId('option-fighter')).toBeChecked();

    const draftBefore = await page.request.get('/api/characters/vault');
    expect(draftBefore.ok()).toBeTruthy();
    const vaultBefore = (await draftBefore.json()) as {
      drafts: Array<{ draftId: string }>;
    };
    expect(vaultBefore.drafts).toHaveLength(1);
    const draftId = vaultBefore.drafts[0]!.draftId;

    await page.getByTestId('nav-characters').click();
    await page.getByTestId('start-character').click();
    await page.getByTestId('step-class').click();
    await expect(page.getByTestId('option-fighter')).toBeChecked();
    const draftAfter = await page.request.get('/api/characters/vault');
    const vaultAfter = (await draftAfter.json()) as {
      drafts: Array<{ draftId: string }>;
    };
    expect(vaultAfter.drafts).toHaveLength(1);
    expect(vaultAfter.drafts[0]!.draftId).toBe(draftId);

    await page.getByTestId('step-background').click();
    await chooseOption(page, 'option-soldier');
    await page.getByTestId('bonus-strength').selectOption('2');
    await expect(page.getByTestId('bonus-strength')).toHaveValue('2');
    await page.getByTestId('bonus-constitution').selectOption('1');
    await expect(page.getByTestId('bonus-constitution')).toHaveValue('1');
    await page.getByTestId('wizard-continue').click();

    await expect(page.getByTestId('active-step-heading')).toContainText('Species');
    await chooseOption(page, 'option-dwarf');
    await page.getByTestId('wizard-continue').click();

    await expect(page.getByTestId('active-step-heading')).toContainText('Ability');
    await chooseOption(page, 'option-standard-array');
    await assignStandardArray(page);
    await page.getByTestId('wizard-continue').click();

    await expect(page.getByTestId('active-step-heading')).toContainText('Equipment');
    await chooseOption(page, 'option-fighter-a');
    await chooseOption(page, 'option-soldier-kit');
    await page.getByTestId('wizard-continue').click();

    await expect(page.getByTestId('active-step-heading')).toContainText('Class Features');
    await chooseOption(page, 'check-defense');
    await expect(page.getByTestId('no-spellcasting')).toBeVisible();
    await page.getByTestId('wizard-continue').click();

    await expect(page.getByTestId('active-step-heading')).toContainText('Identity');
    await page.getByTestId('identity-name').fill('Kara Ironwake');
    await page.getByTestId('identity-name').dispatchEvent('change');
    await expect(page.getByTestId('nothing-unresolved')).toBeVisible();

    await page.getByTestId('create-character').click();
    await expect(page.getByTestId('character-sheet-heading')).toHaveText('Kara Ironwake');
    await expect(page.getByTestId('character-summary')).toContainText('Dwarf');
    await expect(page.getByTestId('character-summary')).toContainText('Fighter');
  });

  test('another account cannot read a character by id or see it in the vault', async ({
    page,
  }) => {
    await enterArenaForCharacters(page);
    await openVault(page);
    await page.getByTestId('start-character').click();
    await chooseOption(page, 'option-shadow-scout');
    await expect(page.getByTestId('active-step-heading')).toHaveText('Identity & Final Review');
    await page.getByTestId('identity-name').fill('Private Scout');
    await page.getByTestId('identity-name').dispatchEvent('change');
    await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
    await page.getByTestId('create-character').click();
    await expect(page.getByTestId('character-sheet-heading')).toHaveText('Private Scout');

    const characterUrl = page.url();
    const characterId = characterUrl.split('/').pop();
    expect(characterId).toMatch(/^[A-Za-z0-9-]{1,64}$/);

    await page.getByTestId('nav-diagnostics').click();
    await page.getByTestId('leave-arena').click();
    await expect(page.getByTestId('enter-arena')).toBeVisible();
    await enterArena(page);

    await openVault(page);
    await expect(page.getByTestId('vault-empty')).toBeVisible();
    await expect(page.getByTestId('character-link')).toHaveCount(0);

    await page.goto(`/characters/${characterId}`);
    await expect(page.getByTestId('character-error')).toBeVisible();
    await expect(page.getByTestId('character-sheet-heading')).toHaveText('Character unavailable');

    const denied = await page.request.get(`/api/characters/${characterId}`);
    expect(denied.status()).toBe(404);
  });
});
