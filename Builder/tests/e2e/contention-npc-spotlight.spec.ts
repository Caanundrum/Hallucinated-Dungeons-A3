import { expect, test, type Page } from '@playwright/test';

import {
  enterAccountFromShell,
  joinTableWithFirstCharacter,
  readCandidate,
} from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function seedPublicNpc(page: Page, campaignId: string): Promise<void> {
  const origin = new URL(page.url()).origin;
  const candidate = await readCandidate(page);
  const response = await page.request.post(`/api/campaigns/${campaignId}/director/npc`, {
    headers: {
      origin,
      'content-type': 'application/json',
      'x-hd-candidate': candidate.candidateId,
    },
    data: {
      schemaVersion: 'play-authority-npc-v1',
      npcId: 'lysa-quill',
      name: 'Lysa Quill',
      publicDescription: 'Harbor Warden watching the barges.',
      disposition: 'wary',
      location: null,
      placeToken: false,
      firstDialogue: null,
      audience: 'public',
      causeActionId: null,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function seedSeatedTable(page: Page, label: string): Promise<string> {
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
  await joinTableWithFirstCharacter(page);
  const match = page.url().match(/\/campaigns\/([A-Za-z0-9-]+)(?:\/table)?/);
  expect(match).toBeTruthy();
  return match![1]!;
}

test.describe('NPC spotlight floor', () => {
  test('Speak as Character claims Lysa Quill floor and can yield it', async ({ page }) => {
    test.setTimeout(90_000);
    const campaignId = await seedSeatedTable(page, 'Spotlight Mage');
    await seedPublicNpc(page, campaignId);
    await page.reload();
    await expect(page.getByTestId('campaign-table-heading')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('dock-tab-party_chat').click();
    await page.getByTestId('chat-mode-speak_as_character').check();
    await expect(page.getByTestId('speak-as-npc-select')).toBeVisible();
    await page.getByTestId('speak-as-npc-select').selectOption({ label: 'Lysa Quill' });
    await page.getByTestId('party-chat-input').fill('Hey Lysa Quill, what happened to the barges?');
    await page.getByTestId('party-chat-input').dispatchEvent('input');
    await expect(page.getByTestId('party-chat-send')).toHaveAttribute('aria-disabled', 'false');
    await page.getByTestId('party-chat-send').click();
    await expect(page.getByTestId('npc-spotlight-banner')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('npc-spotlight-meta')).toContainText(/Lysa Quill/i);
    await expect(page.getByTestId('party-chat-message')).toContainText(/to Lysa Quill/i);
    await page.getByTestId('yield-npc-spotlight').click();
    await expect(page.getByTestId('npc-spotlight-empty')).toBeVisible({ timeout: 10_000 });
  });
});
