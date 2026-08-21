import { expect, test, type Page } from '@playwright/test';

import { enterAccountFromShell } from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function seedSeatedTable(page: Page, label: string): Promise<void> {
  await page.goto('/');
  await dismissIntroIfPresent(page);
  await enterAccountFromShell(page);
  await page.getByTestId('nav-characters').click();
  await page.getByTestId('start-character').click();
  const tutorialNo = page.getByTestId('tutorial-ask-no');
  if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();
  await page.getByTestId('open-quick-start').click();
  await page.getByTestId('option-studious-mage').click();
  await page.getByTestId('identity-name').fill(label);
  await page.getByTestId('identity-name').dispatchEvent('change');
  await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
  await page.getByTestId('create-character').click();
  await page.getByTestId('nav-campaigns').click();
  await page.getByTestId('start-campaign').click();
  await page.getByTestId('campaign-name').fill(`${label} Camp`);
  await page.getByTestId('campaign-name').dispatchEvent('change');
  await page.getByTestId('identity-veyra').click();
  await page.getByTestId('personality-seasoned_host').click();
  await page.getByTestId('create-campaign-submit').click();
  const seatSelect = page.getByTestId('seat-character-select');
  const characterId = await seatSelect.locator('option').nth(1).getAttribute('value');
  await seatSelect.selectOption(characterId!);
  await page.getByTestId('create-seat').click();
  await page.getByTestId('open-campaign-table').click();
}

test.describe('NPC spotlight floor', () => {
  test('Speak as Character claims Lysa Quill floor and can yield it', async ({ page }) => {
    await seedSeatedTable(page, 'Spotlight Mage');
    await page.getByTestId('dock-tab-party_chat').click();
    await page.getByTestId('chat-mode-speak_as_character').check();
    await page.getByTestId('party-chat-input').fill('Hey Lysa Quill, what happened to the barges?');
    await page.getByTestId('party-chat-send').click();
    await expect(page.getByTestId('npc-spotlight-banner')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('npc-spotlight-meta')).toContainText(/Lysa Quill/i);
    await expect(page.getByTestId('party-chat-message')).toContainText(/to Lysa Quill/i);
    await page.getByTestId('yield-npc-spotlight').click();
    await expect(page.getByTestId('npc-spotlight-empty')).toBeVisible({ timeout: 10_000 });
  });
});
