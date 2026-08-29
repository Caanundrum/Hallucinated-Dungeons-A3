import { expect, test, type Page } from '@playwright/test';

import { enterAccountFromShell, joinTableWithFirstCharacter } from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function seatBlankCampaign(page: Page, name: string): Promise<string> {
  await page.getByTestId('nav-characters').click();
  await page.getByTestId('start-character').click();
  const tutorialNo = page.getByTestId('tutorial-ask-no');
  if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();
  await page.getByTestId('open-quick-start').click();
  await page.getByTestId('option-stalwart-defender').click();
  await page.getByTestId('identity-name').fill(name);
  await page.getByTestId('identity-name').dispatchEvent('change');
  await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
  await page.getByTestId('create-character').click();
  await page.getByTestId('nav-campaigns').click();
  await page.getByTestId('start-campaign').click();
  await page.getByTestId('campaign-name').fill(`${name} Camp`);
  await page.getByTestId('campaign-name').dispatchEvent('change');
  await page.getByTestId('identity-garrick').click();
  await page.getByTestId('personality-seasoned_host').click();
  await page.getByTestId('create-campaign-submit').click();
  await expect(page.getByTestId('join-table-heading')).toBeVisible();
  const match = page.url().match(/\/campaigns\/([A-Za-z0-9-]+)\/join/);
  expect(match).toBeTruthy();
  await joinTableWithFirstCharacter(page);
  await page.goto(`/campaigns/${match![1]}`);
  await expect(page.getByTestId('own-seat')).toBeVisible();
  return match![1]!;
}

test.describe('Open + step-through doorway cross', () => {
  test('adjacent open+step-through opens door and moves token across', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await seatBlankCampaign(page, 'OpenCross');
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('map-scene-banner')).toContainText(/Quiet chamber/i);

    const token = page.locator('[data-token][data-anchor-column][data-anchor-row]').first();
    await expect(token).toBeVisible();
    const startColumn = Number(await token.getAttribute('data-anchor-column'));

    // Approach until adjacent open draft, confirming each closer-only step.
    for (let step = 0; step < 12; step += 1) {
      await page.getByTestId('player-action-input').fill(
        'I open the unlocked doorway and step through.',
      );
      await page.getByTestId('player-action-input').dispatchEvent('input');
      await page.getByTestId('submit-player-action').click();
      await expect(page.getByTestId('intent-intercept')).toBeVisible({ timeout: 15_000 });
      const summary = await page.getByTestId('intent-intercept-summary').innerText();
      if (/closer only/i.test(summary)) {
        await page.getByTestId('confirm-intent-intercept').click();
        await expect(page.getByTestId('intent-intercept')).toHaveCount(0, { timeout: 15_000 });
        continue;
      }
      expect(summary).toMatch(/Ready to open.*step through|cross the doorway/i);
      await page.getByTestId('confirm-intent-intercept').click();
      await expect(page.getByTestId('intent-intercept')).toHaveCount(0, { timeout: 20_000 });
      break;
    }

    // Quiet chamber east door passage is column 5 — token must cross, not stop adjacent at 4.
    await expect
      .poll(async () => {
        const el = page.locator('[data-token][data-anchor-column][data-anchor-row]').first();
        return Number(await el.getAttribute('data-anchor-column'));
      }, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(5);

    const endColumn = Number(
      await page.locator('[data-token][data-anchor-column]').first().getAttribute('data-anchor-column'),
    );
    expect(endColumn).toBeGreaterThan(startColumn);

    // Already beyond: clarification goes to Story so far (no phantom Confirm draft).
    await page.getByTestId('player-action-input').fill('I step through the open doorway.');
    await page.getByTestId('player-action-input').dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    await expect(page.getByTestId('intent-intercept')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('dm-play-thread')).toContainText(/already through the doorway/i, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('dm-play-thread')).not.toContainText(/confirm when you are ready/i);

    // Director passage narration should appear once, not twice.
    const threadText = await page.getByTestId('dm-play-thread').innerText();
    const openedCrossMatches = threadText.match(/Opened the door and stepped through/gi) ?? [];
    expect(openedCrossMatches.length).toBeLessThanOrEqual(1);
  });
});
