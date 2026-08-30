import { expect, test, type Page } from '@playwright/test';

import { enterAccountFromShell, joinTableWithFirstCharacter } from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function openSeatedTable(page: Page, name: string): Promise<void> {
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
}

test.describe('Gemini cockpit UX-2 through UX-5', () => {
  test('story tier, mini-sheet, notes drawer, and rules spotlight', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await openSeatedTable(page, 'UxCockpit');

    // UX-4: Story pinned above interactive comms
    await expect(page.getByTestId('comms-story-tier')).toBeVisible();
    await expect(page.getByTestId('comms-interactive-tier')).toBeVisible();
    await expect(page.getByTestId('chronicle-pane')).toBeVisible();
    await expect(page.getByTestId('dock-tab-party_chat')).toBeVisible();
    await expect(page.getByTestId('dock-tab-director_address')).toBeVisible();
    await expect(page.getByTestId('dock-tab-rules_desk')).toBeVisible();
    await page.getByTestId('dock-tab-chronicle').click();
    await expect(page.getByTestId('chronicle-pane')).toBeVisible();

    // UX-5: mini-sheet HP bar
    await expect(page.getByTestId('table-character-compact')).toBeVisible();
    await expect(page.getByTestId('hero-hp-bar')).toBeVisible();
    await expect(page.getByTestId('hero-ac-badge')).toContainText(/AC/i);

    // UX-3: notes drawer
    await page.getByTestId('open-notes-drawer').click();
    await expect(page.getByTestId('notes-drawer')).toBeVisible();
    await page.getByTestId('notes-drawer-input').fill('Clue: wooden doorway faces east.');
    await page.getByTestId('close-notes-drawer').click();
    await expect(page.getByTestId('notes-drawer')).toHaveCount(0);

    // Stay on Character rail for sheet modal.
    await page.getByTestId('table-info-tab-character').click();
    await expect(page.getByTestId('open-table-sheet-modal')).toBeVisible();

    // UX-3: sheet modal
    await page.getByTestId('open-table-sheet-modal').click();
    await expect(page.getByTestId('table-sheet-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('table-sheet-modal')).toHaveCount(0);

    // UX-3: rules spotlight
    await page.getByTestId('dock-tab-rules_desk').click();
    await page.getByTestId('open-rules-modal').click();
    await expect(page.getByTestId('rules-search-modal')).toBeVisible();
    await page.getByTestId('close-rules-modal').click();
    await expect(page.getByTestId('rules-search-modal')).toHaveCount(0);

    await page.screenshot({ path: '/opt/cursor/artifacts/ux-cockpit-full-1440.png' });
    await page.getByTestId('comms-cockpit').screenshot({
      path: '/opt/cursor/artifacts/ux-story-comms-split.png',
    });
    await page.getByTestId('table-character-compact').screenshot({
      path: '/opt/cursor/artifacts/ux-hero-mini-sheet.png',
    });
  });
});
