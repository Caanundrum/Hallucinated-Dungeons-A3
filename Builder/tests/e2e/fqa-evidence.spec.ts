import { expect, test, type Page } from '@playwright/test';

import {
  enterAccountFromShell,
  joinTableWithFirstCharacter,
} from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function seatAndOpenTable(page: Page, name: string): Promise<void> {
  await page.getByTestId('nav-characters').click();
  await page.getByTestId('start-character').click();
  const tutorialNo = page.getByTestId('tutorial-ask-no');
  if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();
  await page.getByTestId('open-quick-start').click();
  await page.getByTestId('option-stalwart-defender').click();
  await page.getByTestId('identity-name').fill(name);
  await page.getByTestId('identity-name').dispatchEvent('change');
  await page.getByTestId('create-character').click();
  await page.getByTestId('nav-campaigns').click();
  await page.getByTestId('start-campaign').click();
  await page.getByTestId('campaign-name').fill(`${name} Camp`);
  await page.getByTestId('campaign-name').dispatchEvent('change');
  await page.getByTestId('identity-veyra').click();
  await page.getByTestId('personality-seasoned_host').click();
  await page.getByTestId('create-campaign-submit').click();
  await expect(page.getByTestId('join-table-heading')).toBeVisible();
  await joinTableWithFirstCharacter(page);
}

test('FQA evidence screenshots', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await dismissIntroIfPresent(page);
  await enterAccountFromShell(page);
  await page.goto('/');
  await dismissIntroIfPresent(page);
  await expect(page.getByTestId('home-campaigns-link')).toContainText(/Open Tables/i);
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-home-tables-copy.png', fullPage: true });

  await page.goto('/account');
  await expect(page.getByTestId('account-sign-out')).toHaveCount(0);
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-account-shell.png', fullPage: true });
  // FQA-040: Admin nav only when bootstrap admin; ordinary players keep it hidden.
  const bootstrap = page.getByTestId('account-is-bootstrap-admin');
  if (await bootstrap.isVisible().catch(() => false)) {
    await expect(page.getByTestId('nav-admin')).toBeVisible();
  } else {
    await expect(page.getByTestId('nav-admin')).toBeHidden();
  }

  await seatAndOpenTable(page, 'FQAEvidence');
  await expect(page.getByTestId('begin-adventure')).toBeVisible();
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-awaiting-first-scene.png', fullPage: true });

  const storyFilter = page.getByTestId('chronicle-kind-filter');
  await expect(storyFilter).toHaveValue('story');
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-story-filter.png' });

  await page.getByTestId('open-table-sheet-modal').click();
  await expect(page.getByTestId('sheet-modal-tab-equipment')).toHaveCount(0);
  await expect(page.getByTestId('sheet-modal-full-page-link')).toBeVisible();
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-sheet-modal.png' });
  await page.keyboard.press('Escape');

  await page.getByTestId('dice-fab').click();
  await expect(page.getByTestId('dice-tray')).toContainText(/Practice dice tray/i);
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-practice-dice.png' });
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('mobile-task-map').click();
  await expect(page.getByTestId('table-page-shell')).toHaveAttribute('data-mobile-task', 'map');
  await expect(page.getByTestId('map-stage-toolbar')).toBeVisible();
  await expect(page.getByRole('button', { name: /Reset zoom to 100%/i })).toBeVisible();
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-mobile-map-mode.png' });

  await page.getByTestId('mobile-task-play').click();
  await expect(page.getByTestId('table-page-shell')).toHaveAttribute('data-mobile-task', 'play');
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-mobile-play-mode.png' });

  await page.getByTestId('mobile-task-chat').click();
  await expect(page.getByTestId('table-page-shell')).toHaveAttribute('data-mobile-task', 'chat');
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-mobile-chat-mode.png' });

  await page.getByTestId('table-overflow-menu').locator('summary').click();
  await expect(page.getByTestId('table-overflow-tables')).toBeVisible();
  await expect(page.getByTestId('table-overflow-vault')).toBeVisible();
  await expect(page.getByTestId('table-overflow-account')).toBeVisible();
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-mobile-overflow.png' });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  await expect(page.getByRole('button', { name: /Reset zoom to 100%/i })).toBeVisible();
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-map-reset-zoom.png' });
});
