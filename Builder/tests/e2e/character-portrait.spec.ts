import { expect, test } from '@playwright/test';

import { acceptAllLegalForPlay } from './arena-page.js';

/**
 * Phase 2.1 portrait pipeline: Physical Appearance guard, Forge Portrait with
 * curated fallback (no Gemini key in the Local Arena), persistence on create,
 * and the vault / sheet portrait surfaces.
 */
test.describe('Character portrait pipeline', () => {
  test('forge portrait falls back to curated archetype and persists to vault and sheet', async ({
    page,
  }) => {
    await page.goto('/');
    const skip = page.getByTestId('skip-intro');
    if (await skip.isVisible().catch(() => false)) {
      await skip.click();
    }
    await page.getByTestId('shell-enter-account').click();
    await expect(page.getByTestId('shell-account-link')).toBeVisible();
    await acceptAllLegalForPlay(page);

    await page.getByTestId('nav-characters').click();
    await page.getByTestId('start-character').click();
    await page.getByTestId('tutorial-ask-no').click();
    await page.getByTestId('open-quick-start').click();
    await page.getByTestId('option-stalwart-defender').click();
    await expect(page.getByTestId('active-step-heading')).toHaveText('Identity & Final Review');

    await page.getByTestId('identity-name').fill('Brannok Stone');
    await page.getByTestId('identity-name').dispatchEvent('change');
    await expect(page.getByTestId('portrait-section')).toBeVisible();

    const appearance = page.getByTestId('identity-physical-appearance');
    await appearance.fill('A cyberpunk dwarf with a laser rifle');
    await expect(page.getByTestId('portrait-error')).toBeVisible();
    await page.getByTestId('forge-portrait').click();
    await expect(page.getByTestId('portrait-error')).toContainText('medieval fantasy');

    await appearance.fill('Braided red beard, soot-stained plate, a notch in the left ear');
    await expect(page.getByTestId('portrait-error')).toBeHidden();
    await page.getByTestId('forge-portrait').click();
    await expect(page.getByTestId('portrait-preview')).toHaveAttribute(
      'src',
      '/assets/portraits/dwarf_fighter.jpg',
    );
    await expect(page.getByTestId('portrait-section')).toContainText('Portrait saved with this draft');
    await page.screenshot({ path: 'test-results/portrait-create.png', fullPage: true });

    await expect(page.getByTestId('create-character')).toHaveAttribute('aria-disabled', 'false');
    await page.getByTestId('create-character').click();
    await expect(page.getByTestId('character-sheet-heading')).toHaveText('Brannok Stone');
    await expect(page.getByTestId('character-portrait')).toHaveAttribute(
      'src',
      '/assets/portraits/dwarf_fighter.jpg',
    );
    await expect(page.getByTestId('portrait-credits')).toContainText('0');
    await expect(page.getByTestId('update-portrait')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/portrait-sheet.png', fullPage: true });

    await page.getByTestId('back-to-vault').click();
    await expect(page.getByTestId('vault-portrait').first()).toHaveAttribute(
      'src',
      '/assets/portraits/dwarf_fighter.jpg',
    );
    const natural = await page
      .getByTestId('vault-portrait')
      .first()
      .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
    expect(natural).toBe(true);
    await page.screenshot({ path: 'test-results/portrait-vault.png', fullPage: true });
  });
});
