/**
 * Independent QA browser validation for Phase 5.
 * Frozen origin only (default 5274). Not Builder's certify suite.
 *
 * Run from QA/ with Builder Playwright on NODE_PATH:
 *   NODE_PATH=/workspace/Builder/node_modules \
 *   QA_CANDIDATE_ID=cand-bf752b208fb6 QA_ARENA_URL=http://127.0.0.1:5274 \
 *   /workspace/Builder/node_modules/.bin/playwright test -c playwright.phase5.config.ts
 */

import { expect, test, type Page } from '@playwright/test';

const ARENA = process.env.QA_ARENA_URL ?? 'http://127.0.0.1:5274';
const CANDIDATE = process.env.QA_CANDIDATE_ID ?? 'cand-bf752b208fb6';

async function dismissIntro(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function signIn(page: Page): Promise<void> {
  await page.goto(ARENA);
  await dismissIntro(page);
  await expect(page.getByTestId('candidate-id').first()).toHaveText(CANDIDATE);
  await page.getByTestId('shell-enter-account').click();
  await expect(page.getByTestId('shell-account-link')).toBeVisible();
}

async function quickCharacter(page: Page, name: string): Promise<void> {
  await page.getByTestId('nav-characters').click();
  await page.getByTestId('start-character').click();
  const tutorialNo = page.getByTestId('tutorial-ask-no');
  if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();
  await page.getByTestId('open-quick-start').click();
  await page.getByTestId('option-studious-mage').click();
  await page.getByTestId('identity-name').fill(name);
  await page.getByTestId('identity-name').dispatchEvent('change');
  await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
  await page.getByTestId('create-character').click();
  await expect(page.getByTestId('character-sheet-heading')).toHaveText(name);
}

async function createEmberferry(page: Page, name: string): Promise<string> {
  await page.getByTestId('nav-campaigns').click();
  await page.getByTestId('start-campaign').click();
  await expect(page.getByTestId('adventure-template-emberferry_crossing')).toHaveClass(/selected/);
  await expect(page.getByTestId('adventure-template-recommended')).toBeVisible();
  await page.getByTestId('campaign-name').fill(name);
  await page.getByTestId('campaign-name').dispatchEvent('change');
  await page.getByTestId('identity-veyra').click();
  await page.getByTestId('personality-seasoned_host').click();
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

test.describe('Phase 5 Independent QA — starter, memory, resume, presentation', () => {
  test('QA-P5-01: Emberferry Crossing seeds memory; secret NPCs stay hidden', async ({ page }) => {
    await signIn(page);
    await quickCharacter(page, 'QA P5 Scout');
    await createEmberferry(page, 'QA P5 Emberferry');

    await expect(page.getByTestId('director-avatar')).toBeVisible();
    await expect(page.getByTestId('campaign-memory-panel')).toBeVisible();
    await expect(page.getByTestId('current-chapter')).toContainText(/Dockside at Emberferry/i);
    await expect(page.getByTestId('chapter-item')).toHaveCount(3);
    await expect(page.getByTestId('quest-item').first()).toBeVisible();
    await expect(page.getByTestId('npc-item').first()).toBeVisible();
    // Secret-audience content must never appear in the member projection.
    await expect(page.getByTestId('campaign-memory-panel')).not.toContainText(/Bellkeeper|hidden cult|secret master/i);
  });

  test('QA-P5-02: suspend and resume preserve chapter continuity with personal recap', async ({
    page,
  }) => {
    await signIn(page);
    await quickCharacter(page, 'QA P5 Voyager');
    await createEmberferry(page, 'QA P5 Resume Table');

    await expect(page.getByTestId('campaign-time')).toContainText(/Session active/i);
    await page.getByTestId('suspend-session').click();
    await expect(page.getByTestId('session-action-message')).toContainText(/Session suspended/i);
    await expect(page.getByTestId('campaign-time')).toContainText(/suspended/i);

    await page.getByTestId('view-recap').click();
    await expect(page.getByTestId('personal-recap-panel')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('recap-headline')).toContainText(/Dockside at Emberferry/i);

    await page.getByTestId('resume-session').click();
    await expect(page.getByTestId('session-action-message')).toContainText(/Session resumed/i);
    await expect(page.getByTestId('campaign-time')).toContainText(/Session active/i);
    await expect(page.getByTestId('current-chapter')).toContainText(/Dockside at Emberferry/i);
    await expect(page.getByTestId('personal-recap-panel')).toBeVisible();
  });

  test('QA-P5-03: Mist Dock looks like a dock scene; token move changes stage anchor', async ({
    page,
  }) => {
    await signIn(page);
    await quickCharacter(page, 'QA P5 Dockhand');
    await createEmberferry(page, 'QA P5 Dock Table');
    await seatOwnCharacter(page);
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('map-bundle-meta')).toContainText(/Emberferry Mist Dock/i);
    await expect(page.getByTestId('map-bundle-meta')).toContainText(/original phase5 starter v1/i);
    await expect(page.getByTestId('map-scene-banner')).toBeVisible();
    // Dock scene uses distinct river/dock terrain, not a uniform chamber.
    await expect(
      page.locator('[data-testid="table-stage-semantic"] rect[data-terrain="blocked"]').first(),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="table-stage-semantic"] rect[data-terrain="floor"]').first(),
    ).toBeVisible();

    const token = page.locator('[data-testid="table-stage-semantic"] [data-token]').first();
    await expect(token).toBeVisible();
    const beforeCol = Number(await token.getAttribute('data-anchor-column'));
    const beforeRow = Number(await token.getAttribute('data-anchor-row'));
    await page.getByTestId('claim-active-turn').click();
    await expect(page.getByTestId('timing-authority-meta')).toContainText(/Active Turn/i);
    await page.locator(`[data-square="${beforeCol + 1},${beforeRow}"]`).click();
    await page.getByTestId('commit-table-move').click();
    await expect(token).toHaveAttribute('data-anchor-column', String(beforeCol + 1), {
      timeout: 10_000,
    });
  });

  test('QA-P5-06: closing a chapter travels the table to Mist-Cut Caves', async ({ page }) => {
    await signIn(page);
    await quickCharacter(page, 'QA P5 Traveler');
    await createEmberferry(page, 'QA P5 Travel Table');
    await page.getByTestId('close-chapter').click();
    await expect(page.getByTestId('current-chapter')).toContainText(/Mist-Cut Caves/i);
    await seatOwnCharacter(page);
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('map-bundle-meta')).toContainText(/Mist-Cut Caves/i);
  });

  test('QA-P5-04: narration density preference is operable on Account', async ({ page }) => {
    await signIn(page);
    await page.getByTestId('nav-account').click();
    await expect(page.getByTestId('account-narration-density')).toBeVisible();
    await page.getByTestId('account-narration-density').selectOption('cinematic');
    await expect(page.getByTestId('account-narration-density')).toHaveValue('cinematic');
  });

  test('QA-P5-05: blank template remains honest empty table (no fake sandbox worldgen)', async ({
    page,
  }) => {
    await signIn(page);
    await quickCharacter(page, 'QA P5 Blank Mage');
    await page.getByTestId('nav-campaigns').click();
    await page.getByTestId('start-campaign').click();
    await page.getByTestId('adventure-template-blank').click();
    await page.getByTestId('campaign-name').fill('QA P5 Blank Table');
    await page.getByTestId('campaign-name').dispatchEvent('change');
    await page.getByTestId('identity-garrick').click();
    await page.getByTestId('personality-dry_storyteller').click();
    await page.getByTestId('create-campaign-submit').click();
    await expect(page.getByTestId('campaign-detail-heading')).toHaveText('QA P5 Blank Table');
    await expect(page.getByTestId('campaign-memory-panel')).toBeVisible();
    await expect(page.getByTestId('current-chapter-empty')).toBeVisible();
    await expect(page.getByTestId('campaign-memory-panel')).not.toContainText(/Emberferry Crossing|Dockside at Emberferry/i);
  });
});
