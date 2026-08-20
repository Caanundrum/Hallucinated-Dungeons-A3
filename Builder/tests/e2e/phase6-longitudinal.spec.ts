import { expect, test, type Page } from '@playwright/test';

import {enterAccountFromShell, openTableAdvancedControls} from './arena-page.js';

/**
 * Phase 6 longitudinal multi-session Emberferry journey.
 *
 * Blueprint ownership: Section 25 Phase 6 build scope item 4 ("Longitudinal
 * multi-session QA through Emberferry and beyond planned climax").
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

/** Creates a campaign leaving the Emberferry Crossing starter template selected (the default). */
async function createEmberferryCampaign(page: Page, name: string): Promise<string> {
  await page.getByTestId('nav-campaigns').click();
  await page.getByTestId('start-campaign').click();
  await expect(page.getByTestId('adventure-template-emberferry_crossing')).toHaveClass(/selected/);
  await page.getByTestId('campaign-name').fill(name);
  await page.getByTestId('campaign-name').dispatchEvent('change');
  await page.getByTestId('identity-veyra').click();
  await page.getByTestId('personality-seasoned_host').click();
  await expect(page.getByTestId('preview-adventure-template')).toHaveText('Emberferry Crossing');
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

test.describe('Phase 6 longitudinal Emberferry multi-session journey', () => {
  test('chapter travel, suspend/resume, caves table move, Bell Tower climax continuity', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await signIn(page);
    await createQuickCharacter(page, 'Phase6 Longitudinal Voyager');
    const campaignId = await createEmberferryCampaign(page, 'Phase6 Longitudinal Table');

    await expect(page.getByTestId('current-chapter')).toContainText('Dockside at Emberferry');
    await page.getByTestId('close-chapter').click();
    await expect(page.getByTestId('session-action-message')).toContainText(
      /Mist-Cut Caves|chapter closed/i,
    );
    await expect(page.getByTestId('current-chapter')).toContainText('The Mist-Cut Caves');

    // Suspend + resume: chapter stays Mist-Cut Caves.
    await expect(page.getByTestId('suspend-session')).toHaveAttribute('aria-disabled', 'false');
    await page.getByTestId('suspend-session').click();
    await expect(page.getByTestId('session-action-message')).toContainText('Session suspended');
    await page.getByTestId('resume-session').click();
    await expect(page.getByTestId('session-action-message')).toContainText('Session resumed');
    await expect(page.getByTestId('current-chapter')).toContainText('The Mist-Cut Caves');

    await seatOwnCharacter(page);
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('map-bundle-meta')).toContainText('Mist-Cut Caves');

    const token = page.locator('[data-testid="table-stage-semantic"] [data-token]').first();
    await expect(token).toBeVisible();
    const beforeCol = await token.getAttribute('data-anchor-column');
    const beforeRow = await token.getAttribute('data-anchor-row');
    expect(beforeCol).toBeTruthy();
    expect(beforeRow).toBeTruthy();

    
    const targetCol = Number(beforeCol) + 1;
    const targetRow = Number(beforeRow);
    await page.locator(`[data-square="${targetCol},${targetRow}"]`).click();
    await expect(token).toHaveAttribute('data-anchor-column', String(targetCol), {
      timeout: 10_000,
    });
    await expect(token).toHaveAttribute('data-anchor-row', String(targetRow));

    // Optional training encounter when controls are enabled without flake risk.
    await openTableAdvancedControls(page);
    const beginEncounter = page.getByTestId('begin-encounter');
    if (
      (await beginEncounter.isVisible().catch(() => false)) &&
      (await beginEncounter.getAttribute('aria-disabled')) === 'false'
    ) {
      await beginEncounter.click();
      await expect(page.getByTestId('combatant-practice-goblin')).toBeVisible();
    }

    await page.goto(`/campaigns/${campaignId}`);
    await dismissIntroIfPresent(page);
    await expect(page.getByTestId('current-chapter')).toContainText('The Mist-Cut Caves');
    await page.getByTestId('close-chapter').click();
    await expect(page.getByTestId('current-chapter')).toContainText('The Drowned Bell Tower');
    await expect(page.getByTestId('session-action-message')).toContainText(
      /Bell Tower|chapter closed/i,
    );

    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('map-bundle-meta')).toContainText('Drowned Bell Tower');
  });
});
