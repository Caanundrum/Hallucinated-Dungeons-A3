import { expect, test, type Page } from '@playwright/test';

import {
  awaitAdventureReady,
  recordDefaultSessionZero,
  enterAccountFromShell,
  joinTableWithFirstCharacter,
} from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

test.describe('PQA residual regressions', () => {
  test('User UI Regressions: smooth identity typing across debounce, scroll-to-top on Continue, no duplicate headings, ordered campaign sections', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await page.getByTestId('nav-characters').click();
    await page.getByTestId('start-character').click();
    const tutorialNo = page.getByTestId('tutorial-ask-no');
    if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();

    // Verify no duplicate <h3> step heading directly under <h2 id="step-heading">
    await expect(page.getByTestId('active-step-heading')).toHaveText('Class');
    await expect(page.locator('#step-heading + h3')).toHaveCount(0);

    // Pick Fighter + 2 skills, scroll down, click Continue, and verify scroll resets to top
    await page.getByTestId('option-fighter').click();
    await page.getByTestId('check-athletics').click();
    await page.getByTestId('check-perception').click();
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.getByTestId('wizard-continue').click();
    await expect(page.getByTestId('active-step-heading')).toHaveText('Background');
    const scrollAfterContinue = await page.evaluate(() => window.scrollY);
    expect(scrollAfterContinue).toBe(0);

    // Jump to Identity via quick-start and verify keystroke-by-keystroke typing across 300ms debounce
    await page.getByTestId('step-class').click();
    await page.getByTestId('open-quick-start').click();
    await page.getByTestId('option-stalwart-defender').click();
    const confirmQuickStart = page.getByTestId('confirm-quick-start-confirm');
    if (await confirmQuickStart.isVisible().catch(() => false)) {
      await confirmQuickStart.click();
    }
    await expect(page.getByTestId('active-step-heading')).toHaveText('Identity & Final Review');
    await expect(page.getByTestId('identity-appearance')).toHaveCount(0);
    await expect(page.getByTestId('identity-physical-appearance')).toHaveCount(1);

    const nameInput = page.getByTestId('identity-name');
    await nameInput.click();
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="identity-name"]');
      if (el) (el as HTMLElement).dataset.domIdentityMarker = 'original-node';
    });
    await nameInput.pressSequentially('Thrain', { delay: 60 });
    await page.waitForTimeout(450);
    await nameInput.pressSequentially(' Ironshield', { delay: 60 });
    await expect(nameInput).toHaveValue('Thrain Ironshield');
    // Verify the input node was NEVER detached/re-rendered while typing or autosaving
    const marker = await nameInput.getAttribute('data-dom-identity-marker');
    expect(marker).toBe('original-node');
    await expect(page.getByTestId('nothing-unresolved')).toBeVisible();

    // Verify Campaign creation sections 1..5 are in order and have only one premise input
    await page.getByTestId('nav-campaigns').click();
    await page.getByTestId('start-campaign').click();
    await expect(page.getByTestId('campaign-summary')).toHaveCount(1);
    await expect(page.getByTestId('campaign-premise-input')).toHaveCount(0);
    const sectionOrder = await page.evaluate(() => {
      const nameEl = document.querySelector('[data-testid="campaign-name"]');
      const identityEl = document.querySelector('[data-testid="director-identity-list"]');
      const personalityEl = document.querySelector('[data-testid="director-personality-list"]');
      const skeletonBtn = document.querySelector('[data-testid="draft-campaign-skeleton"]');
      const submitBtn = document.querySelector('[data-testid="create-campaign-submit"]');
      if (!nameEl || !identityEl || !personalityEl || !skeletonBtn || !submitBtn) return false;
      return Boolean(
        nameEl.compareDocumentPosition(identityEl) & Node.DOCUMENT_POSITION_FOLLOWING &&
          identityEl.compareDocumentPosition(personalityEl) & Node.DOCUMENT_POSITION_FOLLOWING &&
          personalityEl.compareDocumentPosition(skeletonBtn) & Node.DOCUMENT_POSITION_FOLLOWING &&
          skeletonBtn.compareDocumentPosition(submitBtn) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
    expect(sectionOrder).toBe(true);
  });

  test('PQA-061: switching ability method uses an in-app confirm dialog', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await page.getByTestId('nav-characters').click();
    await page.getByTestId('start-character').click();
    const tutorialNo = page.getByTestId('tutorial-ask-no');
    if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();
    await page.getByTestId('open-quick-start').click();
    await page.getByTestId('option-stalwart-defender').click();
    await expect(page.getByTestId('active-step-heading')).toHaveText('Identity & Final Review');
    // Ability Scores live under the Foundation carousel stage after quick-start.
    await page.getByTestId('carousel-stage-foundation').click();
    await page.getByTestId('step-abilities').click();
    await expect(page.getByTestId('ability-method-options')).toBeVisible();
    await page.locator('input[name="ability-method"][value="point-buy"]').check();
    await expect(page.getByTestId('confirm-ability-method')).toBeVisible();
    await expect(page.getByTestId('confirm-ability-method')).toContainText(
      /clears your current score assignments/i,
    );
    await page.getByTestId('confirm-ability-method-cancel').click();
    await expect(page.getByTestId('confirm-ability-method')).toHaveCount(0);
    await page.locator('input[name="ability-method"][value="point-buy"]').check();
    await page.getByTestId('confirm-ability-method-confirm').click();
    await expect(page.getByTestId('confirm-ability-method')).toHaveCount(0);
    await expect(page.locator('input[name="ability-method"][value="point-buy"]')).toBeChecked();
  });

  test('PQA-012/013/014: chronicle, director, and rules copy stay player-facing', async ({
    page,
  }) => {
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await page.getByTestId('nav-characters').click();
    await page.getByTestId('start-character').click();
    const tutorialNo = page.getByTestId('tutorial-ask-no');
    if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();
    await page.getByTestId('open-quick-start').click();
    await page.getByTestId('option-studious-mage').click();
    await page.getByTestId('identity-name').fill('Copy Scout');
    await page.getByTestId('identity-name').dispatchEvent('change');
    await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
    await page.getByTestId('create-character').click();
    await page.getByTestId('nav-campaigns').click();
    await page.getByTestId('start-campaign').click();
    await page.getByTestId('campaign-name').fill('Copy Scout Camp');
    await page.getByTestId('campaign-name').dispatchEvent('change');
    await page.getByTestId('identity-veyra').click();
    await page.getByTestId('personality-seasoned_host').click();
    await page.getByTestId('create-campaign-submit').click();
    await expect(page.getByTestId('join-table-heading')).toBeVisible();
    const match = page.url().match(/\/campaigns\/([A-Za-z0-9-]+)\/join/);
    expect(match).toBeTruthy();
    await joinTableWithFirstCharacter(page);
    await page.goto(`/campaigns/${match![1]}`);
    await expect(page.getByTestId('own-seat')).toBeVisible();
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('dm-play-thread')).toBeVisible({ timeout: 30_000 });
    const expandComms = page.getByTestId('expand-comms-rail');
    if (await expandComms.isVisible().catch(() => false)) {
      await expandComms.click();
    }
    await page.getByTestId('dock-tab-director_address').click();
    await expect(page.getByTestId('dock-tab-director_address')).toContainText('Ask the Director');
    const expandInfo = page.getByTestId('expand-info-rail');
    if (await expandInfo.isVisible().catch(() => false)) {
      await expandInfo.click();
    }
    await page.getByTestId('table-info-tab-rules').scrollIntoViewIfNeeded();
    await page.getByTestId('table-info-tab-rules').click();
    await expect(page.getByTestId('rules-catalog-meta')).toHaveText('SRD 5.2.1 reference');
    await expect(page.getByTestId('rules-catalog-meta')).not.toContainText('srd-5.2.1');
    await page.getByTestId('open-rules-modal').click();
    await expect(page.getByTestId('rules-search-modal')).toBeVisible();
    await page.getByTestId('rules-catalog-category').selectOption('core_mechanics');
    await page.getByTestId('rules-catalog-entry').filter({ hasText: 'XP-only Progression' }).click();
    await expect(page.getByTestId('rules-explanation')).toContainText(/Game Director awards XP/i);
    await expect(page.getByTestId('rules-explanation')).not.toContainText('server-validated');
    const explanationText = await page.getByTestId('rules-explanation').innerText();
    expect(explanationText).not.toMatch(/XP\.Each|slots\.Single/);
    await page.getByTestId('close-rules-modal').click();
    await expect(page.getByTestId('comms-story-tier')).toHaveCount(0);
    await expect(page.getByTestId('dm-play-thread')).toBeVisible();
  });

  test('Codex Retest [R26-01, F26-06, F26-01, R26-03, F26-02, R26-02]: 902x871 map/HUD layout, Rogue/Criminal overlap replacement, and table declarations', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 902, height: 871 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    await page.getByTestId('nav-characters').click();
    await page.getByTestId('start-character').click();
    const tutorialNo = page.getByTestId('tutorial-ask-no');
    if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();

    // F26-06: Rogue + 4 skills (including Stealth & Sleight of Hand), then Criminal background
    await page.getByTestId('option-rogue').click();
    for (const skill of ['stealth', 'sleight-of-hand', 'investigation', 'perception']) {
      await page.getByTestId(`check-${skill}`).click();
    }
    await expect(page.getByTestId('wizard-continue')).toHaveAttribute('aria-disabled', 'false');
    await page.getByTestId('wizard-continue').click();
    await page.getByTestId('option-criminal').click();
    // Replacement skill box renders directly on Background step!
    await expect(page.getByTestId('background-replacement-skills')).toBeVisible();
    await page.getByTestId('check-acrobatics').click();
    await page.getByTestId('check-insight').click();
    await page.getByTestId('bonus-pattern-plus-one-each').click();
    await expect(page.getByTestId('wizard-continue')).toHaveAttribute('aria-disabled', 'false');

    // Quick-start finish character to enter campaign table quickly
    await page.getByTestId('step-class').click();
    await page.getByTestId('open-quick-start').click();
    await page.getByTestId('option-stalwart-defender').click();
    const confirmQuickStart = page.getByTestId('confirm-quick-start-confirm');
    if (await confirmQuickStart.isVisible().catch(() => false)) {
      await confirmQuickStart.click();
    }
    await page.getByTestId('identity-name').fill('Kaelen Vance');
    await page.getByTestId('identity-name').dispatchEvent('change');
    await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
    await page.getByTestId('create-character').click();

    // Create Drowned Crow Tavern campaign
    await page.getByTestId('nav-campaigns').click();
    await page.getByTestId('start-campaign').click();
    await page.getByTestId('campaign-name').fill('Drowned Crow Investigation');
    await page.getByTestId('campaign-name').dispatchEvent('change');
    await page
      .getByTestId('campaign-summary')
      .fill(
        'In the Drowned Crow Tavern, Warden Elira is waiting with a lead on a vanished masked courier and the cellar key.',
      );
    await page.getByTestId('campaign-summary').dispatchEvent('change');
    await page.getByTestId('identity-veyra').click();
    await page.getByTestId('personality-seasoned_host').click();
    await page.getByTestId('create-campaign-submit').click();
    await expect(page.getByTestId('join-table-heading')).toBeVisible();
    const match = page.url().match(/\/campaigns\/([A-Za-z0-9-]+)\/join/);
    expect(match).toBeTruthy();
    await joinTableWithFirstCharacter(page);
    await page.goto(`/campaigns/${match![1]}`);
    await expect(page.getByTestId('own-seat')).toBeVisible();
    await page.getByTestId('open-campaign-table').click();
    await awaitAdventureReady(page);

    // R26-01: At 902x871 viewport, map stage and floating HUD must both be visible and non-zero height
    const stageBox = await page.locator('.table-stage-frame').boundingBox();
    expect(stageBox).not.toBeNull();
    expect(stageBox!.height).toBeGreaterThanOrEqual(190);
    await expect(page.getByTestId('table-floating-hud')).toBeVisible();

    // F26-01: Walk up beside the service counter, keeping an eye on the closed east doorway
    const actionInput = page.getByTestId('player-action-input');
    await actionInput.fill(
      'I walk up beside the service counter, keeping an eye on the closed east doorway.',
    );
    await actionInput.dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    const intercept1 = page.getByTestId('intent-intercept');
    if (await intercept1.isVisible({ timeout: 2_500 }).catch(() => false)) {
      await expect(intercept1).toContainText(/Service counter/i);
      await page.getByTestId('confirm-intent-intercept').click();
      await expect(intercept1).toHaveCount(0, { timeout: 15_000 });
    }
    // Closed doorway must remain closed!
    const doorHit = page.getByTestId('map-poi-door-1-hit');
    if (await doorHit.isVisible().catch(() => false)) {
      await doorHit.click();
      await expect(page.getByTestId('door-selection-detail')).toContainText(/closed/i);
    }

    // R26-03: Move beside the closed doorway without opening or crossing
    await actionInput.fill(
      'I move east to the closed wooden doorway and stop beside it without crossing.',
    );
    await actionInput.dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    const intercept2 = page.getByTestId('intent-intercept');
    if (await intercept2.isVisible({ timeout: 2_500 }).catch(() => false)) {
      await expect(intercept2).not.toContainText(/Open the door/i);
      await page.getByTestId('confirm-intent-intercept').click();
      await expect(intercept2).toHaveCount(0, { timeout: 15_000 });
    }

    // R26-02: Investigate chest without opening or unlocking it
    await actionInput.fill(
      'Quietly, I investigate the sturdy oak chest for clues without opening or unlocking it.',
    );
    await actionInput.dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    await expect(page.getByTestId('intent-intercept')).toContainText(/Investigation/i, {
      timeout: 20_000,
    });
  });
});
