import { expect, test, type Page } from '@playwright/test';

import {
  awaitAdventureReady,
  enterAccountFromShell,
  joinTableWithFirstCharacter,
  openTableAdvancedControls,
} from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function seedMageAtTable(page: Page): Promise<void> {
  await page.goto('/');
  await dismissIntroIfPresent(page);
  await enterAccountFromShell(page);
  await page.getByTestId('nav-characters').click();
  await page.getByTestId('start-character').click();
  const tutorialNo = page.getByTestId('tutorial-ask-no');
  if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();
  await page.getByTestId('open-quick-start').click();
  await page.getByTestId('option-studious-mage').click();
  await page.getByTestId('identity-name').fill('Declare First Mage');
  await page.getByTestId('identity-name').dispatchEvent('change');
  await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
  await page.getByTestId('create-character').click();
  await page.getByTestId('nav-campaigns').click();
  await page.getByTestId('start-campaign').click();
  await page.getByTestId('campaign-name').fill('Declare First Camp');
  await page.getByTestId('campaign-name').dispatchEvent('change');
  await page.getByTestId('identity-veyra').click();
  await page.getByTestId('personality-seasoned_host').click();
  await page.getByTestId('create-campaign-submit').click();
  await expect(page.getByTestId('join-table-heading')).toBeVisible();
  await joinTableWithFirstCharacter(page);
  await awaitAdventureReady(page);
}

async function advanceToOwnAction(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await openTableAdvancedControls(page);
    const cast = await page.getByTestId('rules-cast-spell').getAttribute('aria-disabled');
    const attack = await page.getByTestId('rules-attack').getAttribute('aria-disabled');
    if (cast === 'false' || attack === 'false') {
      return;
    }
    const before = await page.getByTestId('encounter-meta').innerText();
    const next = page.getByTestId('next-encounter-turn');
    await expect(next).toHaveAttribute('aria-disabled', 'false');
    await next.click();
    await expect
      .poll(async () => page.getByTestId('encounter-meta').innerText(), { timeout: 15_000 })
      .not.toBe(before);
  }
  await expect(page.getByTestId('rules-attack')).toHaveAttribute('aria-disabled', 'false');
}

test.describe('Declaration-first Intent Intercept', () => {
  test('NL attack draft confirms through the rules engine without Tools', async ({ page }) => {
    await seedMageAtTable(page);
    await openTableAdvancedControls(page);
    await page.getByTestId('begin-encounter').click();
    await expect(page.getByTestId('rules-last-result')).toContainText(
      /Encounter began|Training Dummy|Practice Goblin/i,
    );
    await page.getByTestId('roll-initiative').click();
    await expect(page.getByTestId('encounter-meta')).toContainText(/round [1-9]/i, {
      timeout: 15_000,
    });
    await advanceToOwnAction(page);

    await page.getByTestId('player-action-input').fill(
      'I leap in and strike the Practice Goblin with my warhammer',
    );
    await page.getByTestId('submit-player-action').click();
    await expect(page.getByTestId('intent-intercept-summary')).toContainText(/Practice Goblin/i, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('intent-intercept-summary')).toContainText(/Confirm to let the engine|attack/i);
    await page.getByTestId('confirm-intent-intercept').click();
    await expect
      .poll(async () => page.getByTestId('rules-last-result').innerText(), { timeout: 20_000 })
      .toMatch(/hit|missed|Practice Goblin/i);
    await expect(page.getByTestId('dm-beat-queue-hint')).toBeAttached();
  });

  test('beginning encounter marks an open free-roam draft stale', async ({ page }) => {
    await seedMageAtTable(page);
    await page.getByTestId('player-action-input').fill('I attack the Practice Goblin');
    await page.getByTestId('submit-player-action').click();
    await expect(page.getByTestId('intent-intercept')).toBeVisible({ timeout: 15_000 });

    await openTableAdvancedControls(page);
    await page.getByTestId('begin-encounter').click();
    await expect(page.getByTestId('rules-last-result')).toContainText(
      /Encounter began|Training Dummy|Practice Goblin/i,
    );
    await expect(page.getByTestId('intent-intercept')).toHaveAttribute('data-intercept-state', 'stale');
    await expect(page.getByTestId('intent-intercept-stale')).toContainText(/Scene changed|stale/i);
  });
});
