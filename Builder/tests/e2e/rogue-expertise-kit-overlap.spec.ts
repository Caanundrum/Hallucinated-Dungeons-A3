import { expect, test, type Page } from '@playwright/test';

import { acceptAllLegalForPlay, enterAccountFromShell } from './arena-page.js';

async function dismissIntro(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function chooseOption(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).click();
  await expect(page.getByTestId('create-heading')).toBeVisible();
  await expect(page.locator('[data-testid="create-error"]')).toHaveCount(0);
}

async function assignStandardArray(page: Page): Promise<void> {
  const assignment: ReadonlyArray<[string, string]> = [
    ['dexterity', '15'],
    ['constitution', '14'],
    ['wisdom', '13'],
    ['intelligence', '12'],
    ['charisma', '10'],
    ['strength', '8'],
  ];
  for (const [ability, score] of assignment) {
    await page.getByTestId(`ability-select-${ability}`).selectOption(score);
    await expect(page.getByTestId(`ability-select-${ability}`)).toHaveValue(score);
  }
}

test.describe('Rogue Expertise and kit overlap', () => {
  test('Features shows Expertise controls before mastery; tools do not stack to 2', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1294, height: 912 });
    await page.goto('/');
    await dismissIntro(page);
    await enterAccountFromShell(page);
    await acceptAllLegalForPlay(page);
    await page.getByTestId('nav-characters').click();
    await page.getByTestId('start-character').click();
    await page.getByTestId('tutorial-ask-no').click();

    await chooseOption(page, 'option-rogue');
    await expect(page.getByTestId('class-skill-options')).toBeVisible();
    for (const skill of ['acrobatics', 'deception', 'investigation', 'perception']) {
      await chooseOption(page, `check-${skill}`);
    }
    await page.getByTestId('wizard-continue').click();

    await chooseOption(page, 'option-wayfarer');
    await chooseOption(page, 'bonus-pattern-plus-one-each');
    await page.getByTestId('wizard-continue').click();

    await chooseOption(page, 'option-halfling');
    await page.getByTestId('wizard-continue').click();

    await expect(page.getByTestId('active-step-heading')).toContainText('Ability');
    await chooseOption(page, 'option-standard-array');
    await assignStandardArray(page);
    await page.getByTestId('wizard-continue').click();

    await expect(page.getByTestId('active-step-heading')).toContainText('Equipment');
    await chooseOption(page, 'option-rogue-a');
    await chooseOption(page, 'option-wayfarer-kit');
    await expect(page.getByTestId('equipment-overlap-note')).toContainText(/Thieves/i);
    await expect(page.getByTestId('equipment-overlap-note')).toContainText(/kept ×1/i);
    await page.getByTestId('wizard-continue').click();

    await expect(page.getByTestId('active-step-heading')).toContainText(/Features/i);
    await expect(page.getByTestId('expertise-panel')).toBeVisible();
    await expect(page.getByTestId('expertise-options')).toBeVisible();
    await expect(page.getByTestId('expertise-check-investigation')).toBeVisible();
    await page.getByTestId('expertise-check-investigation').click();
    await page.getByTestId('expertise-check-stealth').click();
    await expect(page.getByTestId('weapon-mastery-panel')).toBeVisible();
    await page.getByTestId('mastery-check-Dagger').click();
    await page.getByTestId('mastery-check-Shortsword').click();
    await page.screenshot({
      path: '/opt/cursor/artifacts/recheck-expertise-controls.png',
      fullPage: true,
    });
    await page.getByTestId('wizard-continue').click();

    await expect(page.getByTestId('active-step-heading')).toContainText(/Identity/i);
    await page.getByTestId('identity-name').fill('Pip Recheck');
    await page.getByTestId('identity-name').dispatchEvent('change');
    await expect(page.getByTestId('nothing-unresolved')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('create-character').click();
    await expect(page.getByTestId('character-sheet-heading')).toHaveText('Pip Recheck');
    await expect(page.getByTestId('sheet-equipment-list')).toContainText(/Thieves' Tools/);
    await expect(page.getByTestId('sheet-equipment-qty-thieves-tools')).toHaveCount(0);
    await expect(page.getByTestId('sheet-equipment-list')).toContainText(/kept ×1|Shared by Class/i);
  });
});
