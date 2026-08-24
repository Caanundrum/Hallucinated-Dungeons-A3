import { expect, test, type Page } from '@playwright/test';

import {
  enterAccountFromShell,
  joinTableWithFirstCharacter,
  openTableAdvancedControls,
  readCandidate,
} from './arena-page.js';

/**
 * Phase 5 campaign memory, session resume, and long-play settings on blank tables.
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

async function createBlankTable(page: Page, name: string): Promise<string> {
  await page.getByTestId('nav-campaigns').click();
  await page.getByTestId('start-campaign').click();
  await expect(page.getByTestId('visibility-private')).toHaveClass(/selected/);
  await page.getByTestId('campaign-name').fill(name);
  await page.getByTestId('campaign-name').dispatchEvent('change');
  await page.getByTestId('identity-veyra').click();
  await page.getByTestId('personality-seasoned_host').click();
  await page.getByTestId('create-campaign-submit').click();
  await expect(page.getByTestId('join-table-heading')).toBeVisible();
  const match = page.url().match(/\/campaigns\/([A-Za-z0-9-]+)\/join/);
  expect(match).toBeTruthy();
  return match![1]!;
}

test.describe('Phase 5 blank-table memory and session resume', () => {
  test('blank table memory stays empty and suspend/resume preserves session state', async ({
    page,
  }) => {
    await signIn(page);
    await createQuickCharacter(page, 'Blank Voyager');
    const campaignId = await createBlankTable(page, 'Blank Test Table');
    await joinTableWithFirstCharacter(page);
    await page.goto(`/campaigns/${campaignId}`);
    await expect(page.getByTestId('campaign-detail-heading')).toHaveText('Blank Test Table');
    await expect(page.getByTestId('current-chapter-empty')).toBeVisible();
    await expect(page.getByTestId('campaign-time')).toContainText('Session active');

    await page.getByTestId('suspend-session').click();
    await expect(page.getByTestId('campaign-time')).toContainText('suspended');
    await page.getByTestId('resume-session').click();
    await expect(page.getByTestId('campaign-time')).toContainText('Session active');

    const origin = new URL(page.url()).origin;
    const candidate = await readCandidate(page);
    const memoryResponse = await page.request.get(`/api/campaigns/${campaignId}/memory`, {
      headers: { origin, 'x-hd-candidate': candidate.candidateId },
    });
    expect(memoryResponse.status()).toBe(200);
    const memoryBody = (await memoryResponse.json()) as { chapters: unknown[] };
    expect(memoryBody.chapters.length).toBe(0);
  });

  test('narration density on Account applies to Director narration length on the table', async ({
    page,
  }) => {
    await signIn(page);
    await createQuickCharacter(page, 'Narration Density Scout');
    const campaignId = await createBlankTable(page, 'Narration Density Table');
    await joinTableWithFirstCharacter(page);

    await page.getByTestId('nav-account').click();
    await page.getByTestId('account-narration-density').selectOption('concise');

    await page.goto(`/campaigns/${campaignId}/table`);
    await expect(page.getByTestId('campaign-table-heading')).toBeVisible();
    await openTableAdvancedControls(page);
    await page.getByTestId('request-narration').click({ force: true });
    await expect(page.getByTestId('director-narration')).toBeVisible({ timeout: 15_000 });
    const conciseBody = (await page.getByTestId('director-narration').innerText()).trim();

    await page.getByTestId('nav-account').click();
    await page.getByTestId('account-narration-density').selectOption('cinematic');

    await page.goto(`/campaigns/${campaignId}/table`);
    await openTableAdvancedControls(page);
    await page.getByTestId('request-narration').click({ force: true });
    await expect(page.getByTestId('director-narration')).toBeVisible({ timeout: 15_000 });
    const cinematicBody = (await page.getByTestId('director-narration').innerText()).trim();
    expect(cinematicBody.length).toBeGreaterThan(conciseBody.length);
  });
});
