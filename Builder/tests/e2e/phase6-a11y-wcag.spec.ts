import { expect, test, type Page } from '@playwright/test';

import { recordDefaultSessionZero, enterAccountFromShell, openTableAdvancedControls} from './arena-page.js';

/**
 * Phase 6 core-loop a11y (automated WCAG-oriented checks — not real VoiceOver).
 *
 * Blueprint ownership: Section 25 Phase 6 build scope item 2 ("WCAG 2.2 AA
 * core-loop certification" via keyboard / high-zoom / reduced-motion /
 * low-effects). Real Safari / screen-reader AT remains
 * BLOCKED_FOR_FINAL_DEVICE_CERTIFICATION on this host.
 */

const TABLE_PRIMARY_CONTROLS = [
  'submit-player-action',
  'table-character-sheet-panel',
  'refresh-table-projection',
  'commit-table-sync',
  'commit-table-move',
  'open-adjacent-door',
  'interpret-action',
] as const;

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

/** Creates a campaign leaving the Private (invite only) starter template selected (the default). */
async function createEmberferryCampaign(page: Page, name: string): Promise<string> {
  await page.getByTestId('nav-campaigns').click();
  await page.getByTestId('start-campaign').click();
  await expect(page.getByTestId('visibility-private')).toHaveClass(/selected/);
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
    await recordDefaultSessionZero(page);
    await seatSelect.selectOption(characterId!);
  await page.getByTestId('create-seat').click();
  await expect(page.getByTestId('own-seat')).toBeVisible();
}

test.describe('Phase 6 core-loop a11y (automated WCAG)', () => {
  test('landmarks, keyboard Characters path, reduced motion/low effects, high zoom, named controls', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await signIn(page);

    // Shell landmarks from index.html + shell.ts (skip-link / #main / live-region).
    await expect(page.locator('a.skip-link')).toBeVisible();
    await expect(page.locator('a.skip-link')).toHaveAttribute('href', '#main');
    await expect(page.locator('#main')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByTestId('live-region')).toBeAttached();

    // Keyboard: reach primary nav Characters and activate it with Enter.
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    await page.getByTestId('nav-characters').focus();
    await expect(page.getByTestId('nav-characters')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('vault-heading')).toBeVisible();

    await createQuickCharacter(page, 'Phase6 A11y Scout');
    await createEmberferryCampaign(page, 'Phase6 A11y Table');
    await seatOwnCharacter(page);
    await page.getByTestId('open-campaign-table').click();
    await openTableAdvancedControls(page);
    await expect(page.getByTestId('player-action-input')).toBeVisible();

    await page.getByTestId('table-reduced-motion').check();
    await expect(page.locator('html')).toHaveClass(/hd-reduced-motion/);
    await page.getByTestId('table-low-effects').check();
    await expect(page.locator('html')).toHaveClass(/hd-low-effects/);

    // High zoom / large viewport: table primary control remains operable.
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await expect(page.getByTestId('submit-player-action')).toBeVisible();
    await expect(page.getByTestId('submit-player-action')).toHaveAttribute('aria-disabled', 'true');

    for (const testId of TABLE_PRIMARY_CONTROLS) {
      const control = page.getByTestId(testId);
      await expect(control).toBeVisible();
      await expect(control).toHaveAccessibleName(/.+/);
    }
  });
});
