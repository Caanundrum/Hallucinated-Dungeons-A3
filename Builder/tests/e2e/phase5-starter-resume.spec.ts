import { expect, test, type Page } from '@playwright/test';

import { recordDefaultSessionZero, enterAccountFromShell, openTableAdvancedControls, readCandidate} from './arena-page.js';

/**
 * Phase 5 starter campaign, memory, session resume, and long-play settings.
 *
 * Blueprint ownership: Section 25 Phase 5 build scope items 1 ("structured
 * campaign memory"), 2 ("Emberferry Crossing starter pack"), 5 ("multi-session
 * resume, absence/return personal recap"), 3 ("Director avatars", "Presentation
 * Cue Plans"), 6 ("narration density"), and 7 (map presentation upgrade).
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
  await expect(page.getByTestId('create-character')).toHaveAttribute('aria-disabled', 'false');
  await page.getByTestId('create-character').click();
  await expect(page.getByTestId('character-sheet-heading')).toHaveText(name);
}

/** Creates a campaign leaving the Emberferry Crossing starter template selected (the default). */
async function createEmberferryCampaign(page: Page, name: string): Promise<string> {
  await page.getByTestId('nav-campaigns').click();
  await page.getByTestId('start-campaign').click();
  await expect(page.getByTestId('adventure-template-emberferry_crossing')).toHaveClass(/selected/);
  await expect(page.getByTestId('adventure-template-recommended')).toBeVisible();
  await page.getByTestId('campaign-name').fill(name);
  await page.getByTestId('campaign-name').dispatchEvent('change');
  await page.getByTestId('identity-veyra').click();
  await page.getByTestId('personality-seasoned_host').click();
  await expect(page.getByTestId('preview-adventure-template')).toHaveText('Emberferry Crossing');
  await expect(page.getByTestId('preview-director-avatar')).toBeVisible();
  await page.getByTestId('create-campaign-submit').click();
  await expect(page.getByTestId('campaign-detail-heading')).toHaveText(name);
  return page.url().split('/').pop()!;
}

async function seatOwnCharacter(page: Page): Promise<void> {
  const seatSelect = page.getByTestId('seat-character-select');
  const characterId = await seatSelect.locator('option').nth(1).getAttribute('value');
  expect(characterId).toBeTruthy();
    await recordDefaultSessionZero(page);
    await seatSelect.selectOption(characterId!);
  await page.getByTestId('create-seat').click();
  await expect(page.getByTestId('own-seat')).toBeVisible();
}

test.describe('Phase 5 starter campaign, memory, and session resume', () => {
  test('Emberferry Crossing seeds memory, and suspend/resume preserves chapter and campaign-time continuity', async ({
    page,
  }) => {
    await signIn(page);
    await createQuickCharacter(page, 'Emberferry Voyager');
    const campaignId = await createEmberferryCampaign(page, 'Emberferry Test Table');

    // Director avatar renders as a real image, not the accessible text fallback.
    await expect(page.getByTestId('director-avatar')).toBeVisible();
    await expect(page.getByTestId('director-avatar-fallback')).toHaveCount(0);
    await expect(page.getByTestId('director-identity-label')).toHaveText('Veyra');

    // Campaign memory seeded from the starter pack.
    await expect(page.getByTestId('campaign-time')).toContainText('Day 1');
    await expect(page.getByTestId('campaign-time')).toContainText('Session active');
    await expect(page.getByTestId('current-chapter')).toContainText('Dockside at Emberferry');
    await expect(page.getByTestId('current-chapter')).toContainText('Harbor Warden');
    await expect(page.getByTestId('chapter-item')).toHaveCount(3);
    // Both public and private quests/NPCs/factions/threads reach the member
    // projection; the Bellkeeper's secret-audience knowledge never does
    // (audience filter — Section 25 Phase 5 invariant kernel).
    await expect(page.getByTestId('quest-item')).toHaveCount(3);
    await expect(page.getByTestId('npc-item')).toHaveCount(3);
    await expect(page.getByTestId('faction-item')).toHaveCount(2);
    await expect(page.getByTestId('social-link-item')).toHaveCount(2);
    await expect(page.getByTestId('open-thread-item')).toHaveCount(2);
    await expect(page.getByTestId('npc-list')).toContainText('Lysa Quill');
    await expect(page.getByTestId('npc-list')).toContainText('Old Bram Halyard');
    await expect(page.getByTestId('campaign-memory-panel')).not.toContainText('Bellkeeper');

    // The server-side memory projection itself never carries the secret NPC.
    const origin = new URL(page.url()).origin;
    const candidate = await readCandidate(page);
    const memoryResponse = await page.request.get(`/api/campaigns/${campaignId}/memory`, {
      headers: { origin, 'x-hd-candidate': candidate.candidateId },
    });
    expect(memoryResponse.status()).toBe(200);
    const memoryBody = (await memoryResponse.json()) as { npcs: { npcId: string }[] };
    expect(memoryBody.npcs.some((npc) => npc.npcId === 'the-bellkeeper')).toBe(false);
    expect(memoryBody.npcs.some((npc) => npc.npcId === 'lysa-quill')).toBe(true);
    expect(memoryBody.npcs.some((npc) => npc.npcId === 'old-bram-halyard')).toBe(true);

    // Suspend an untouched session: pause only — Day 1 does not advance without table play.
    await expect(page.getByTestId('suspend-session')).toHaveAttribute('aria-disabled', 'false');
    await expect(page.getByTestId('resume-session')).toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('suspend-session').click();
    await expect(page.getByTestId('session-action-message')).toContainText('Session suspended');
    await expect(page.getByTestId('campaign-time')).toContainText('Day 1');
    await expect(page.getByTestId('campaign-time')).toContainText('suspended');
    await expect(page.getByTestId('suspend-session')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('resume-session')).toHaveAttribute('aria-disabled', 'false');

    // A personal recap is available while suspended, and never leaks the secret NPC.
    await page.getByTestId('view-recap').click();
    await expect(page.getByTestId('personal-recap-panel')).toBeVisible();
    await expect(page.getByTestId('recap-headline')).toContainText('Dockside at Emberferry');
    await expect(page.getByTestId('personal-recap-panel')).not.toContainText('Bellkeeper');

    // Resume: chapter/current-chapter continuity survives, campaign time does not reset.
    await page.getByTestId('resume-session').click();
    await expect(page.getByTestId('session-action-message')).toContainText('Session resumed');
    await expect(page.getByTestId('campaign-time')).toContainText('Day 1');
    await expect(page.getByTestId('campaign-time')).toContainText('Session active');
    await expect(page.getByTestId('current-chapter')).toContainText('Dockside at Emberferry');
    await expect(page.getByTestId('personal-recap-panel')).toBeVisible();

    // Reloading the page re-fetches memory from the server and still agrees.
    await page.reload();
    await expect(page.getByTestId('campaign-time')).toContainText('Day 1');
    await expect(page.getByTestId('campaign-time')).toContainText('Session active');
    await expect(page.getByTestId('current-chapter')).toContainText('Dockside at Emberferry');

    // Starter map presentation upgrade: honest title/art/scene banner, not the blank placeholder.
    await seatOwnCharacter(page);
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('map-bundle-meta')).toContainText('Emberferry Mist Dock');
    await expect(page.getByTestId('map-bundle-meta')).toContainText('original phase5 starter v1');
    await expect(page.getByTestId('map-scene-banner')).toContainText('Ember-mist');
    // Notable feature labels live in the collapsed Table details panel; stage markers stay visible.
    await expect(page.getByTestId('map-notable-feature')).toHaveCount(3);
    await expect(page.getByTestId('table-stage-notable-features').locator('[data-notable-feature]')).toHaveCount(3);

    // Token is visible on the dock; a committed one-step move changes its anchor on the SVG stage.
    const token = page.locator('[data-testid="table-stage-semantic"] [data-token]').first();
    await expect(token).toBeVisible();
    const beforeCol = await token.getAttribute('data-anchor-column');
    const beforeRow = await token.getAttribute('data-anchor-row');
    expect(beforeCol).toBeTruthy();
    expect(beforeRow).toBeTruthy();
    
    const targetCol = Number(beforeCol) + 1;
    const targetRow = Number(beforeRow);
    await page.locator(`[data-square="${targetCol},${targetRow}"]`).click();
    await expect(token).toHaveAttribute('data-anchor-column', String(targetCol), { timeout: 10_000 });
    await expect(token).toHaveAttribute('data-anchor-row', String(targetRow));
  });

  test('closing a chapter travels to the Mist-Cut Caves map scene', async ({ page }) => {
    await signIn(page);
    await createQuickCharacter(page, 'Chapter Traveler');
    await createEmberferryCampaign(page, 'Chapter Travel Table');
    await expect(page.getByTestId('current-chapter')).toContainText('Dockside at Emberferry');
    await seatOwnCharacter(page);
    await page.getByTestId('open-campaign-table').click();
    const token = page.locator('[data-testid="table-stage-semantic"] [data-token]').first();
    await expect(token).toBeVisible();
    const beforeCol = await token.getAttribute('data-anchor-column');
    const beforeRow = await token.getAttribute('data-anchor-row');
    const targetCol = Number(beforeCol) + 1;
    const targetRow = Number(beforeRow);
    await page.locator(`[data-square="${targetCol},${targetRow}"]`).click();
    await expect(token).toHaveAttribute('data-anchor-column', String(targetCol), { timeout: 10_000 });
    await page.getByTestId('table-back').click();
    await page.getByTestId('close-chapter').click();
    await page.getByTestId('confirm-close-chapter-confirm').click();
    await expect(page.getByTestId('session-action-message')).toContainText(/Mist-Cut Caves|chapter closed/i);
    await expect(page.getByTestId('current-chapter')).toContainText('The Mist-Cut Caves');
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('map-bundle-meta')).toContainText('Mist-Cut Caves');
    await expect(page.getByTestId('map-scene-banner')).toContainText(/caves|Bluff/i);
  });

  test('narration density on Account applies to Director narration length on the table', async ({
    page,
  }) => {
    await signIn(page);
    await createQuickCharacter(page, 'Narration Density Scout');
    const campaignId = await createEmberferryCampaign(page, 'Narration Density Table');
    await seatOwnCharacter(page);

    await page.getByTestId('nav-account').click();
    await expect(page.getByTestId('account-narration-density')).toBeVisible();
    await page.getByTestId('account-narration-density').selectOption('concise');
    await expect(page.getByTestId('narration-density-summary')).toContainText('mechanics-first');

    await page.goto(`/campaigns/${campaignId}/table`);
    await expect(page.getByTestId('campaign-table-heading')).toBeVisible();
    await openTableAdvancedControls(page);
    await page.getByTestId('request-narration').click({ force: true });
    await expect(page.getByTestId('director-narration')).toBeVisible({ timeout: 15_000 });
    const conciseBody = (await page.getByTestId('director-narration').innerText()).trim();
    expect(conciseBody).toMatch(/gathered at the table|The table is quiet/i);

    await page.getByTestId('nav-account').click();
    await page.getByTestId('account-narration-density').selectOption('cinematic');

    await page.goto(`/campaigns/${campaignId}/table`);
    await expect(page.getByTestId('campaign-table-heading')).toBeVisible();
    await openTableAdvancedControls(page);
    await page.getByTestId('request-narration').click({ force: true });
    await expect(page.getByTestId('director-narration')).toBeVisible({ timeout: 15_000 });
    const cinematicBody = (await page.getByTestId('director-narration').innerText()).trim();
    expect(cinematicBody.length).toBeGreaterThan(conciseBody.length);
    expect(cinematicBody.startsWith(conciseBody)).toBe(true);
  });
});
