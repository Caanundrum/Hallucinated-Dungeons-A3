import { expect, test, type Page } from '@playwright/test';

import { enterAccountFromShell, joinTableWithFirstCharacter } from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

test('fables-inspired shell evidence screenshots', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await dismissIntroIfPresent(page);
  await enterAccountFromShell(page);

  await page.getByTestId('nav-characters').click();
  await page.getByTestId('start-character').click();
  const tutorialNo = page.getByTestId('tutorial-ask-no');
  if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();
  await page.getByTestId('open-quick-start').click();
  await page.getByTestId('option-stalwart-defender').click();
  await page.getByTestId('identity-name').fill('ShellQuiet');
  await page.getByTestId('identity-name').dispatchEvent('change');
  await page.getByTestId('create-character').click();
  await page.getByTestId('nav-campaigns').click();
  await page.getByTestId('start-campaign').click();
  await page.getByTestId('campaign-name').fill('Shell Quiet Camp');
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
  await page.getByTestId('open-campaign-table').click();
  await expect(page.getByTestId('table-ambient-hud')).toBeVisible();
  await expect(page.getByTestId('submit-player-action')).toBeVisible();
  await expect(page.getByTestId('play-attack')).toHaveCount(0);
  await expect(page.getByTestId('floating-combat-bar')).toBeHidden();
  await expect(page.getByTestId('dock-tab-rules_desk')).toHaveCount(0);
  await expect(page.getByTestId('comms-story-tier')).toHaveCount(0);
  await expect(page.getByTestId('chat-mode-table_talk')).toHaveCount(0);
  await expect(page.getByTestId('chat-mode-speak_as_character')).toBeVisible();
  await expect(page.getByTestId('chat-mode-speak_as_character')).not.toBeChecked();

  await page.screenshot({ path: '/opt/cursor/artifacts/fables-shell-desktop-1440.png', fullPage: false });
  await page.getByTestId('table-info-tab-rules').scrollIntoViewIfNeeded();
  await page.getByTestId('table-info-tab-rules').click();
  await page.screenshot({ path: '/opt/cursor/artifacts/fables-shell-rules-left-rail.png', fullPage: false });
  await page.getByTestId('dock-tab-party_chat').click();
  await page.getByTestId('communication-dock').screenshot({
    path: '/opt/cursor/artifacts/fables-shell-chat-speak-toggle.png',
  });
  await page.getByTestId('table-player-actions').screenshot({
    path: '/opt/cursor/artifacts/fables-shell-composer-attack.png',
  });
  await page.getByTestId('map-stage-toolbar').screenshot({
    path: '/opt/cursor/artifacts/fables-shell-slim-toolbar.png',
  });
});
