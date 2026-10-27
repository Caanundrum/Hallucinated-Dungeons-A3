import { expect, type Page, test } from '@playwright/test';
import {
  awaitAdventureReady,
  enterAccountFromShell,
  joinTableWithFirstCharacter,
} from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function chooseOption(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).click();
  await expect(page.getByTestId('create-heading')).toBeVisible();
  await expect(page.locator('[data-testid="create-error"]')).toHaveCount(0);
}

async function waitForWizardContinue(page: Page): Promise<void> {
  await expect(page.getByTestId('wizard-continue')).toHaveAttribute('aria-disabled', 'false', {
    timeout: 30_000,
  });
}

async function confirmDraftIfVisible(page: Page): Promise<void> {
  const confirm = page.getByTestId('confirm-intent-intercept');
  const visible = await confirm
    .waitFor({ state: 'visible', timeout: 6_000 })
    .then(() => true)
    .catch(() => false);
  if (visible) {
    await expect(confirm).toHaveAttribute('aria-disabled', 'false', { timeout: 10_000 });
    await confirm.click();
    await expect(confirm).toHaveCount(0, { timeout: 15_000 });
  }
}

test.describe('Rules Audit, Spatial Topology, & Table UX Remediation (Packets 1–6)', () => {
  test('Packet 1–5 end-to-end: Monk Unarmored Defense & Magic Initiate attribution, 2-step Portrait Lightbox, Campaign Create notice layout, banner-free map clicks, 2-step container looting, perimeter exit travel, and wall-lever mechanism lock', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);

    // =========================================================================
    // PACKET 1: Monk Unarmored Defense AC Formula, Origin Feat Spell Attribution,
    //           & Two-Step Portrait Preview Lightbox Modal
    // =========================================================================
    await page.getByTestId('nav-characters').click();
    await page.getByTestId('start-character').click();
    const tutorialNo = page.getByTestId('tutorial-ask-no');
    if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();

    // Step 1: Class -> Select Monk and 2 class skills
    await chooseOption(page, 'option-monk');
    await expect(page.getByTestId('class-skill-options')).toBeVisible();
    await chooseOption(page, 'check-acrobatics');
    await chooseOption(page, 'check-insight');
    await waitForWizardContinue(page);
    await page.getByTestId('wizard-continue').click();

    // Step 2: Background -> Select Guide (grants Magic Initiate (Druid)) + +2 DEX / +1 WIS
    await expect(page.getByTestId('background-options')).toBeVisible();
    await chooseOption(page, 'option-guide');
    await expect(page.getByTestId('background-detail')).toBeVisible();
    await chooseOption(page, 'bonus-pattern-plus-two-plus-one');
    await page.getByTestId('bonus-plus-two').selectOption('dexterity');
    await expect(page.getByTestId('bonus-plus-two')).toHaveValue('dexterity');
    await page.getByTestId('bonus-plus-one').selectOption('wisdom');
    await expect(page.getByTestId('bonus-plus-one')).toHaveValue('wisdom');
    await waitForWizardContinue(page);
    await page.getByTestId('wizard-continue').click();

    // Step 3: Species -> Select Dwarf
    await expect(page.getByTestId('species-options')).toBeVisible();
    await chooseOption(page, 'option-dwarf');
    await waitForWizardContinue(page);
    await page.getByTestId('wizard-continue').click();

    // Step 4: Abilities -> Standard Array (DEX 14 +2 = 16 (+3), WIS 15 +1 = 16 (+3))
    await expect(page.getByTestId('active-step-heading')).toContainText('Ability');
    await chooseOption(page, 'option-standard-array');
    const assignment: ReadonlyArray<[string, string]> = [
      ['wisdom', '15'],
      ['dexterity', '14'],
      ['constitution', '13'],
      ['strength', '12'],
      ['intelligence', '10'],
      ['charisma', '8'],
    ];
    for (const [ability, score] of assignment) {
      await page.getByTestId(`ability-select-${ability}`).selectOption(score);
      await expect(page.getByTestId(`ability-select-${ability}`)).toHaveValue(score);
    }
    await waitForWizardContinue(page);
    await page.getByTestId('wizard-continue').click();

    // Step 5: Gear (Equipment) -> Verify live Unarmored Defense AC formula breakdown
    await expect(page.getByTestId('equipment-ac-derivation')).toBeVisible();
    await expect(page.getByTestId('equipment-ac-formula')).toContainText(
      '10 base + 3 DEX + 3 WIS (Unarmored Defense)',
    );
    await expect(page.getByTestId('preview-ac-formula-breakdown')).toContainText(
      '10 base + 3 DEX + 3 WIS (Unarmored Defense)',
    );
    await page.locator('[data-testid="class-equipment-options"] input[type="radio"]').first().click();
    await page
      .locator('[data-testid="background-equipment-options"] input[type="radio"]')
      .first()
      .click();
    await waitForWizardContinue(page);
    await page.getByTestId('wizard-continue').click();

    // Step 6: Features -> Verify Monk class spellcasting status appears BEFORE Origin Feat spell picker
    const noSpellcasting = page.getByTestId('no-spellcasting');
    const originSpellSource = page.getByTestId('origin-feat-spell-source').first();
    await expect(noSpellcasting).toBeVisible();
    await expect(noSpellcasting).toContainText('Monk does not cast spells at level 1.');
    await expect(originSpellSource).toBeVisible();
    await expect(originSpellSource).toContainText('Granted by Origin Feat: Magic Initiate (Druid)');

    // Verify DOM ordering: no-spellcasting appears above origin-feat-spell-source
    const noSpellY = (await noSpellcasting.boundingBox())?.y ?? 0;
    const originSpellY = (await originSpellSource.boundingBox())?.y ?? 0;
    expect(noSpellY).toBeLessThan(originSpellY);

    // Complete Monk class choices (if any) + Guide Magic Initiate (Druid) spell picks
    const classChoiceCheckbox = page
      .locator('[data-testid^="class-choice-"] input[type="checkbox"]')
      .first();
    if (await classChoiceCheckbox.isVisible().catch(() => false)) {
      await classChoiceCheckbox.click();
    }
    const bgCantrips = page.locator(
      '[data-testid="background-feat-cantrip-options"] input[type="checkbox"]',
    );
    await bgCantrips.nth(0).click();
    await bgCantrips.nth(1).click();
    const bgSpells = page.locator(
      '[data-testid="background-feat-spell-options"] input[type="checkbox"]',
    );
    await bgSpells.nth(0).click();
    await waitForWizardContinue(page);
    await page.getByTestId('wizard-continue').click();

    // Step 7: Identity & Two-Step Portrait Preview Lightbox Modal
    await expect(page.getByTestId('active-step-heading')).toHaveText('Identity & Final Review');
    await page.getByTestId('identity-name').fill('Kaelen Windstep');
    await page.getByTestId('identity-name').dispatchEvent('change');
    await expect(page.getByTestId('nothing-unresolved')).toBeVisible({ timeout: 20_000 });

    const appearance = page.getByTestId('identity-physical-appearance');
    await appearance.fill(
      'Lean dwarf monk in simple linen wraps with carved oak prayer beads and calm amber eyes',
    );
    await page.getByTestId('forge-portrait').click();

    // All 3 portrait option cards must be visible
    await expect(page.getByTestId('portrait-options-picker')).toBeVisible();
    await expect(page.getByTestId('portrait-option-0')).toBeVisible();
    await expect(page.getByTestId('portrait-option-1')).toBeVisible();
    await expect(page.getByTestId('portrait-option-2')).toBeVisible();

    // Clicking thumbnail 0 opens the full-size Lightbox Modal without discarding other options
    await page.getByTestId('portrait-preview-option-0').click();
    const lightbox = page.getByTestId('portrait-lightbox-modal');
    await expect(lightbox).toBeVisible();
    await expect(lightbox).toContainText('Portrait Option 1 of 3');

    // Navigate to Portrait Option 2 inside the lightbox and click "Choose This Portrait"
    await page.getByTestId('lightbox-next-portrait').click();
    await expect(lightbox).toContainText('Portrait Option 2 of 3');
    await page.getByTestId('confirm-lightbox-portrait').click();
    await expect(lightbox).toHaveCount(0);

    // All 3 portrait cards remain visible so the player can still compare, and option 1 is marked selected
    await expect(page.getByTestId('portrait-option-0')).toBeVisible();
    await expect(page.getByTestId('portrait-option-1')).toHaveClass(/selected/);
    await expect(page.getByTestId('portrait-option-2')).toBeVisible();

    await expect(page.getByTestId('nothing-unresolved')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('create-character').click();
    await expect(page.getByTestId('character-sheet-heading')).toHaveText('Kaelen Windstep');
    await expect(page.getByTestId('ac-formula-breakdown')).toContainText(
      '10 base + 3 DEX + 3 WIS (Unarmored Defense)',
    );
    // RS-05 & Guardrail 2: Verify Monk Martial Arts attack bonus (+5 to hit) and 1d6+3 damage on Spear and Unarmed Strike
    await expect(page.getByTestId('attack-list')).toContainText(/Spear[\s\S]*?\+5[\s\S]*?to hit[\s\S]*?1d6\+3 piercing/i);
    await expect(page.getByTestId('attack-list')).toContainText(/Unarmed Strike[\s\S]*?\+5[\s\S]*?to hit[\s\S]*?1d6\+3 bludgeoning/i);

    // =========================================================================
    // PACKET 2 & RS-01: Campaign Creation Layout Polish, Syntactic Place vs.
    //                   Person Entity Classification, & Setting Fidelity
    // =========================================================================
    await page.getByTestId('nav-campaigns').click();
    await page.getByTestId('start-campaign').click();
    await expect(page.getByTestId('create-campaign-heading')).toBeVisible();

    const outdoorPremise =
      'At Clockhouse, a stilted lantern station on the edge of Glimmerfen, Conservator Corin Vale asks Kaelen Windstep to investigate why Apprentice Talia vanished after sealing a brass astrolabe inside a reinforced supply locker.';
    await page.getByTestId('campaign-name').fill('Clockhouse Lantern Mystery');
    await page.getByTestId('campaign-name').dispatchEvent('input');
    await page.getByTestId('campaign-summary').fill(outdoorPremise);
    await page.getByTestId('campaign-summary').dispatchEvent('input');
    await page.getByTestId('identity-veyra').click();
    await page.getByTestId('personality-seasoned_host').click();

    // RS-01: Verify committed facts preview classifies Clockhouse as Location (never NPC)
    const committedFacts = page.getByTestId('premise-committed-facts');
    await expect(committedFacts).toContainText('Location: Clockhouse');
    await expect(committedFacts).not.toContainText('NPC: Clockhouse');
    await expect(committedFacts).not.toContainText('NPC: Glimmerfen');

    // Verify `.campaign-draft-actions-stack` and `p.message.notice` block typography
    const draftStack = page.locator('.campaign-draft-actions-stack');
    await expect(draftStack).toBeVisible();
    const noticeDisplay = await draftStack.locator('p.message.notice').first().evaluate((el) => {
      return window.getComputedStyle(el).display;
    });
    expect(noticeDisplay).toBe('block');

    await page.getByTestId('draft-campaign-skeleton').click();
    await expect(page.getByTestId('campaign-skeleton-preview')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('campaign-skeleton-preview')).toContainText('Clockhouse');
    const approveBtn = page.getByTestId('approve-rough-outline');
    if (await approveBtn.isVisible().catch(() => false)) {
      await approveBtn.click();
    }

    await page.getByTestId('create-campaign-submit').click();
    await expect(page.getByTestId('join-table-heading')).toBeVisible({ timeout: 30_000 });
    const match = page.url().match(/\/campaigns\/([A-Za-z0-9-]+)\/join/);
    expect(match).toBeTruthy();
    const campaignId = match![1]!;

    await joinTableWithFirstCharacter(page);
    await page.goto(`/campaigns/${campaignId}`);
    await expect(page.getByTestId('own-seat')).toBeVisible();
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('table-ambient-hud')).toBeVisible({ timeout: 20_000 });
    await awaitAdventureReady(page);

    // =========================================================================
    // PACKETS 3, 4, & 5 + RS-01..RS-07 + GUARDRAILS 1 & 2 ON THE PLAY TABLE
    // =========================================================================
    const candidateId = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="hd-candidate-id"]');
      return meta?.getAttribute('content') ?? null;
    });
    const origin = new URL(page.url()).origin;
    const fetchMapBundle = async () => {
      const res = await page.request.get(`${origin}/api/campaigns/${campaignId}/map`, {
        headers: {
          origin,
          ...(candidateId !== null ? { 'x-hd-candidate': candidateId } : {}),
        },
      });
      expect(res.ok()).toBeTruthy();
      return (await res.json()) as {
        mapBundleId: string;
        title: string;
        coordinateSpace: { columns: number; rows: number };
        cells: readonly { column: number; row: number; terrain: string; known?: boolean }[];
        tokens: readonly {
          seatId: string | null;
          footprint: { anchor: { column: number; row: number } };
        }[];
        notableFeatures: readonly {
          column: number;
          row: number;
          label: string;
          objectId?: string;
          objectKind?: string;
          objectState?: string;
          lockState?: string;
          contents?: readonly string[];
          targetEdgeOrObjectId?: string | null;
        }[];
      };
    };

    // 1. RS-01 & RS-02: Verify Scene 1 is titled "Clockhouse", has Warden Corin Vale as the NPC (never Clockhouse or Apprentice Talia), and has no duplicate container labels
    const initialMap = await fetchMapBundle();
    expect(initialMap.title).toBe('Clockhouse');
    const features = initialMap.notableFeatures ?? [];
    const labels = features.map((f) => f.label.toLowerCase());
    expect(labels).not.toContain('sturdy oak chest');
    expect(labels).not.toContain('iron lantern');
    const npcFeatures = features.filter((f) => f.objectKind === 'npc');
    expect(npcFeatures.some((f) => /corin/i.test(f.label))).toBe(true);
    expect(npcFeatures.some((f) => /clockhouse/i.test(f.label))).toBe(false);
    expect(npcFeatures.some((f) => /talia/i.test(f.label))).toBe(false);

    const containerFeatures = features.filter((f) => f.objectKind === 'container');
    const uniqueContainerBaseLabels = new Set(
      containerFeatures.map((f) =>
        f.label.replace(/\s*\((?:open|closed|locked|unlocked)\).*$/i, '').trim().toLowerCase(),
      ),
    );
    expect(uniqueContainerBaseLabels.size).toBe(containerFeatures.length);

    const exitFeature = features.find((f) => f.objectKind === 'exit');
    expect(exitFeature).toBeDefined();
    expect(exitFeature!.label).toMatch(/\bExit\b/i);
    const gridW = initialMap.coordinateSpace?.columns ?? 12;
    const gridH = initialMap.coordinateSpace?.rows ?? 8;
    const onPerimeter =
      exitFeature!.column === 0 ||
      exitFeature!.column === gridW - 1 ||
      exitFeature!.row === 0 ||
      exitFeature!.row === gridH - 1;
    expect(onPerimeter).toBe(true);

    // Packet 3 & Packet 4: Single Map Tooltip (0 <title> SVG nodes and 0 [title] attributes in map stage)
    // and top-down object icon sprites (image.map-poi-sprite[data-sprite-key])
    await expect(page.locator('[data-testid="table-stage-svg"] title')).toHaveCount(0);
    await expect(page.locator('[data-testid="table-stage-host"] [title]')).toHaveCount(0);
    const containerMarkerLoc = page.getByTestId('map-container-marker').first();
    await expect(containerMarkerLoc).toBeVisible();
    await expect(containerMarkerLoc.locator('image.map-poi-sprite')).toHaveCount(1);
    const initialSpriteKey = await containerMarkerLoc.getAttribute('data-sprite-key');
    expect(initialSpriteKey ?? '').toMatch(/:closed$/);
    await containerMarkerLoc.hover();
    await expect(page.getByTestId('map-poi-tooltip')).toBeVisible();

    // 2. Packet 3: Clicking a map square or doorway does NOT show intrusive banners
    const anyCell = page.locator('[data-testid^="map-cell-"]').first();
    if (await anyCell.isVisible().catch(() => false)) {
      await anyCell.click();
    }
    await expect(page.getByTestId('move-target-meta')).toHaveCount(0);
    await expect(page.getByTestId('door-selection-detail')).toHaveCount(0);

    // 3. RS-07, CV-02, & Universal Rules 4 & 6: Ask DM Pane Non-Overlapping Flex Layout, Multi-Viewport Bounding Boxes, & Canonical Units
    const expandCommsBtn = page.getByTestId('expand-comms-rail');
    if (await expandCommsBtn.isVisible().catch(() => false)) {
      await expandCommsBtn.click();
    }
    const askTab = page.getByTestId('dock-tab-director_address');
    await expect(askTab).toBeVisible({ timeout: 10_000 });
    await askTab.click();
    await expect(page.getByTestId('director-address-pane')).toBeVisible();
    await expect(page.getByTestId('director-address-notice')).toBeVisible();
    await page.getByTestId('collapse-director-address').click({ force: false });
    // Clicking the info toggle hides the notice without closing the Ask DM pane!
    await expect(page.getByTestId('director-address-pane')).toBeVisible();
    await expect(page.getByTestId('director-address-notice')).toBeHidden();
    await page.getByTestId('collapse-director-address').click({ force: false });
    await expect(page.getByTestId('director-address-notice')).toBeVisible();

    // Universal Rule 4: Ask the Director cites canonical SRD units at Level 1 ("30 feet", "10 HP", "120 feet", "14 GP")
    const askInput = page.getByTestId('director-address-input');
    await askInput.click({ force: false });
    await askInput.fill('What is my current walking speed and unarmed strike attack bonus and damage?');
    await askInput.dispatchEvent('input');
    await page.getByTestId('director-address-send').click({ force: false });
    await expect(page.getByTestId('ask-dm-thread')).toContainText(/30\s+feet/i, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('ask-dm-thread')).toContainText(/10\s+HP/i);
    await expect(page.getByTestId('ask-dm-thread')).toContainText(/120\s+feet/i);
    await expect(page.getByTestId('ask-dm-thread')).toContainText(/14\s+GP/i);

    // CV-02 & Rule 3a: Verify single reply is unclipped (replyEl.scrollHeight <= replyEl.clientHeight + 2,
    // replyRect.top >= threadRect.top - 2, replyRect.bottom <= composerRect.top + 2) across both 902x871 and 1280x800
    for (const vp of [
      { width: 902, height: 871 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(vp);
      const expandRail = page.getByTestId('expand-comms-rail');
      if (await expandRail.isVisible().catch(() => false)) {
        await expandRail.click();
      }
      const askTabVp = page.getByTestId('dock-tab-director_address');
      if (await askTabVp.isVisible().catch(() => false)) {
        await askTabVp.click();
      }
      const replyEl = page.getByTestId('director-address-reply');
      const threadEl = page.getByTestId('ask-dm-thread');
      const composerEl = page.getByTestId('director-address-composer');
      await expect(replyEl).toBeVisible();
      const replyMetrics = await replyEl.evaluate((el) => ({
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      }));
      expect(replyMetrics.scrollHeight).toBeLessThanOrEqual(replyMetrics.clientHeight + 2);
      const replyRect = await replyEl.boundingBox();
      const threadRect = await threadEl.boundingBox();
      const composerRect = await composerEl.boundingBox();
      expect(replyRect).not.toBeNull();
      expect(threadRect).not.toBeNull();
      expect(composerRect).not.toBeNull();
      expect(replyRect!.y).toBeGreaterThanOrEqual(threadRect!.y - 2);
      expect(replyRect!.y + replyRect!.height).toBeLessThanOrEqual(composerRect!.y + 2);
    }

    // CV-02 & Rule 3b: Reload persistence — reloading and re-opening Ask the Director keeps #ask-dm-info-copy hidden
    // (askDmHeaderCollapsed === true when askDmThread.length > 0) and keeps the restored reply unclipped
    await page.setViewportSize({ width: 902, height: 871 });
    await page.reload();
    await expect(page.getByTestId('table-ambient-hud')).toBeVisible({ timeout: 20_000 });
    for (const vp of [
      { width: 902, height: 871 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(vp);
      const expandAfterReload = page.getByTestId('expand-comms-rail');
      if (await expandAfterReload.isVisible().catch(() => false)) {
        await expandAfterReload.click();
      }
      await page.getByTestId('dock-tab-director_address').click();
      await expect(page.getByTestId('director-address-notice')).toBeHidden();
      const restoredReply = page.getByTestId('director-address-reply');
      const restoredThread = page.getByTestId('ask-dm-thread');
      const restoredComposer = page.getByTestId('director-address-composer');
      await expect(restoredReply).toBeVisible();
      const rReplyRect = await restoredReply.boundingBox();
      const rThreadRect = await restoredThread.boundingBox();
      const rComposerRect = await restoredComposer.boundingBox();
      expect(rReplyRect).not.toBeNull();
      expect(rThreadRect).not.toBeNull();
      expect(rComposerRect).not.toBeNull();
      expect(rReplyRect!.y).toBeGreaterThanOrEqual(rThreadRect!.y - 2);
      expect(rReplyRect!.y + rReplyRect!.height).toBeLessThanOrEqual(rComposerRect!.y + 2);
    }

    // CV-02 & Rule 3c: Submit a 2nd question so ask-dm-thread has 4 entries and assert unconditionally
    // that scrollHeight > clientHeight and mouse.wheel(0, 250) scrolls scrollTop > 0 across 902x871 and 1280x800
    const askInputSecond = page.getByTestId('director-address-input');
    await askInputSecond.click({ force: false });
    await askInputSecond.fill('Can I climb a wall and make an unarmed strike in the same turn?');
    await askInputSecond.dispatchEvent('input');
    await page.getByTestId('director-address-send').click({ force: false });
    await expect(page.locator('[data-testid="ask-dm-thread"] > li')).toHaveCount(4, {
      timeout: 15_000,
    });

    for (const vp of [
      { width: 902, height: 871 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(vp);
      const expandRail = page.getByTestId('expand-comms-rail');
      if (await expandRail.isVisible().catch(() => false)) {
        await expandRail.click();
      }
      const askTabVp = page.getByTestId('dock-tab-director_address');
      if (await askTabVp.isVisible().catch(() => false)) {
        await askTabVp.click();
      }
      const threadEl = page.getByTestId('ask-dm-thread');
      await expect(threadEl).toBeVisible();
      const scrollMetrics = await threadEl.evaluate((el) => {
        el.scrollTop = 0;
        return {
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          initialScrollTop: el.scrollTop,
        };
      });
      expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
      expect(scrollMetrics.initialScrollTop).toBe(0);
      const threadBoxForWheel = await threadEl.boundingBox();
      expect(threadBoxForWheel).not.toBeNull();
      await page.mouse.move(
        threadBoxForWheel!.x + threadBoxForWheel!.width / 2,
        threadBoxForWheel!.y + threadBoxForWheel!.height / 2,
      );
      await page.mouse.wheel(0, 250);
      await expect
        .poll(async () => threadEl.evaluate((el) => el.scrollTop), { timeout: 5_000 })
        .toBeGreaterThan(0);
    }

    // CV-02 & Universal Rule 6: Verify zero vertical boundingBox() overlap and unobstructed pointer clicks across viewports
    for (const vp of [
      { width: 1280, height: 800 },
      { width: 1072, height: 900 },
      { width: 902, height: 871 },
      { width: 768, height: 1024 },
    ]) {
      await page.setViewportSize(vp);
      if (vp.width <= 900) {
        const mobileChatBtn = page.locator('[data-testid="mobile-task-chat"]:visible').first();
        if (await mobileChatBtn.isVisible().catch(() => false)) {
          await mobileChatBtn.click();
        }
      } else {
        const expandRail = page.getByTestId('expand-comms-rail');
        if (await expandRail.isVisible().catch(() => false)) {
          await expandRail.click();
        }
      }
      const askTabVp = page.getByTestId('dock-tab-director_address');
      if (await askTabVp.isVisible().catch(() => false)) {
        await askTabVp.click();
      }
      const toggleBtn = page.getByTestId('collapse-director-address');
      const noticeEl = page.getByTestId('director-address-notice');
      const threadEl = page.getByTestId('ask-dm-thread');
      const composerEl = page.getByTestId('director-address-composer');
      await expect(toggleBtn).toBeVisible();
      if (await noticeEl.isHidden()) {
        await toggleBtn.click({ force: false });
      }
      await expect(noticeEl).toBeVisible();

      const headerBox = await page.locator('.director-address-header').boundingBox();
      const noticeBox = await noticeEl.boundingBox();
      const threadBox = await threadEl.boundingBox();
      const composerBox = await composerEl.boundingBox();
      expect(headerBox).not.toBeNull();
      expect(noticeBox).not.toBeNull();
      expect(threadBox).not.toBeNull();
      expect(composerBox).not.toBeNull();
      expect(headerBox!.y + headerBox!.height).toBeLessThanOrEqual(noticeBox!.y + 1.5);
      expect(noticeBox!.y + noticeBox!.height).toBeLessThanOrEqual(threadBox!.y + 1.5);
      expect(threadBox!.y + threadBox!.height).toBeLessThanOrEqual(composerBox!.y + 1.5);

      // Real mouse pointer click hides notice again cleanly
      await toggleBtn.click({ force: false });
      await expect(noticeEl).toBeHidden();
    }
    const mobilePlayBtn = page.locator('[data-testid="mobile-task-play"]:visible').first();
    if (await mobilePlayBtn.isVisible().catch(() => false)) {
      await mobilePlayBtn.click();
    }
    const collapseCommsBtn = page.getByTestId('collapse-comms-rail');
    if (await collapseCommsBtn.isVisible().catch(() => false)) {
      await collapseCommsBtn.click();
    }

    // FC-01 & CV-01: Addressing a 3-word NPC with an unlisted title ("Conservator Corin Vale") by given name alone ("Corin")
    // while mentioning the missing NPC ("Apprentice Talia") + "leave" inside single quotes routes to present NPC dialogue
    // across both 902x871 and 1280x800 without "not an established NPC" or travel hijacking!
    await page.setViewportSize({ width: 902, height: 871 });
    await page
      .getByTestId('player-action-input')
      .fill(
        "I ask Corin, 'Did Apprentice Talia leave any warning before the dawn inspection?'",
      );
    await page.getByTestId('player-action-input').dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    await confirmDraftIfVisible(page);
    const afterGivenNameAskMap = await fetchMapBundle();
    expect(afterGivenNameAskMap.title).toBe('Clockhouse');
    await expect(page.getByTestId('dm-play-thread')).toContainText(/Corin Vale/i, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('dm-play-thread')).not.toContainText(
      /not an established NPC|Ready to travel to|Moved to Side Passage/i,
    );

    await page.setViewportSize({ width: 1280, height: 800 });
    await page
      .getByTestId('player-action-input')
      .fill(
        "I ask Conservator Corin Vale, 'Where did Apprentice Talia go after sealing the locker?'",
      );
    await page.getByTestId('player-action-input').dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    await confirmDraftIfVisible(page);
    const afterNpcQuestionMap = await fetchMapBundle();
    expect(afterNpcQuestionMap.title).toBe('Clockhouse');
    await expect(page.getByTestId('dm-play-thread')).toContainText(/Corin Vale/i, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('dm-play-thread')).not.toContainText(
      /not an established NPC|Ready to travel to|Moved to Side Passage/i,
    );

    // 4. Packet 3, RS-02, RS-03, & Guardrail 2: Two-Step Container Looting & Locative Prepositional Stripping
    const containerFeature = features.find((f) => f.objectKind === 'container');
    expect(containerFeature).toBeDefined();
    const containerLabel = containerFeature!.label
      .replace(/\s*(?:\([^)]*\)|—\s*.*)$/i, '')
      .trim();

    // Step 1: Open container -> lists contents in Chronicle without auto-looting and swaps sprite key to :open
    await page.getByTestId('player-action-input').fill(`I open the ${containerLabel}`);
    await page.getByTestId('player-action-input').dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    await confirmDraftIfVisible(page);
    await expect(page.getByTestId('dm-play-thread')).toContainText(/Inside you see:/i, {
      timeout: 15_000,
    });
    await expect
      .poll(
        async () =>
          await page.getByTestId('map-container-marker').first().getAttribute('data-sprite-key'),
        { timeout: 10_000 },
      )
      .toMatch(/:open$/);

    // RS-02: Inspect the item inside the container using locative phrasing ("in the <container>")
    await page
      .getByTestId('player-action-input')
      .fill(`I inspect the brass astrolabe in the ${containerLabel}`);
    await page.getByTestId('player-action-input').dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    await confirmDraftIfVisible(page);

    // RV-02: Opening a document on a support surface ("I open the station logbook on the oak table")
    // narrates reading the document without mutating any furniture prop to (open)
    await page
      .getByTestId('player-action-input')
      .fill('I open the station logbook on the oak table');
    await page.getByTestId('player-action-input').dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    await confirmDraftIfVisible(page);
    await expect(page.getByTestId('dm-play-thread')).toContainText(
      /Inspecting the station logbook closely in Clockhouse/i,
      { timeout: 15_000 },
    );

    // Step 2 (RV-01): Whole-container loot on the already-open container ("I loot the open <container>")
    // routes to table.take_scene_prop, transfers all contents to inventory, and logs "Took ... from <container>."
    await page
      .getByTestId('player-action-input')
      .fill(`I loot the open ${containerLabel}`);
    await page.getByTestId('player-action-input').dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    await confirmDraftIfVisible(page);
    await expect(page.getByTestId('dm-play-thread')).toContainText(
      new RegExp(`Took .* from ${containerLabel}`, 'i'),
      {
        timeout: 15_000,
      },
    );

    const rulesRes = await page.request.get(`${origin}/api/campaigns/${campaignId}/rules-state`, {
      headers: {
        origin,
        ...(candidateId !== null ? { 'x-hd-candidate': candidateId } : {}),
      },
    });
    expect(rulesRes.ok()).toBeTruthy();
    const rulesData = (await rulesRes.json()) as {
      progression?: { sheet?: { equipment?: readonly { name: string }[] } };
    };
    const equipNames = (rulesData.progression?.sheet?.equipment ?? []).map((e) =>
      e.name.toLowerCase(),
    );
    expect(equipNames.some((n) => /brass astrolabe/i.test(n))).toBe(true);

    // 5. Packet 4 & RS-04: Doorway passage travel ("I head east through the doorway into the next area") transitions to Scene 2
    await page
      .getByTestId('player-action-input')
      .fill('I head east through the doorway into the next area');
    await page.getByTestId('player-action-input').dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    await confirmDraftIfVisible(page);

    await expect
      .poll(
        async () => {
          const proj = await fetchMapBundle();
          return proj.mapBundleId;
        },
        { timeout: 15_000 },
      )
      .toContain('scene-m1-r2');

    // 6. Packet 4, RS-06, & Guardrail 1: Gate-adjacent walkable mechanism lock in Scene 2
    const scene2Map = await fetchMapBundle();
    expect(scene2Map.title).not.toContain('Side Passage');
    const scene2Features = scene2Map.notableFeatures ?? [];
    const leverFeature = scene2Features.find((f) => /lever|switch|chain/i.test(f.label));
    const scene2Exit = scene2Features.find(
      (f) => f.objectKind === 'exit' && !/return|back/i.test(f.label),
    );
    expect(leverFeature).toBeDefined();
    expect(scene2Exit).toBeDefined();
    expect(leverFeature!.label).not.toMatch(/wall lever/i);
    const scene2ExitLabel = scene2Exit!.label
      .replace(/\s*—\s*(?:open|closed|locked|unlocked).*$/i, '')
      .trim();
    // RS-06: Lever must be on a walkable cell within Manhattan distance <= 2 of the target exit
    const leverCell = (scene2Map.cells ?? []).find(
      (c) => c.column === leverFeature!.column && c.row === leverFeature!.row,
    );
    expect(leverCell?.terrain).not.toBe('blocked');
    const manhattanToExit =
      Math.abs(leverFeature!.column - scene2Exit!.column) +
      Math.abs(leverFeature!.row - scene2Exit!.row);
    expect(manhattanToExit).toBeLessThanOrEqual(2);
    // Scene 2 exit starts locked by the lever mechanism
    expect(scene2Exit!.lockState).toBe('locked');

    // Attempting to travel through the locked exit before pulling the lever must be rejected
    await page.getByTestId('player-action-input').fill(`I go through the ${scene2ExitLabel}`);
    await page.getByTestId('player-action-input').dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    await confirmDraftIfVisible(page);
    const dismissBtn = page.getByTestId('cancel-intent-intercept');
    if (await dismissBtn.isVisible().catch(() => false)) {
      await dismissBtn.click();
    }

    const stillScene2 = await fetchMapBundle();
    expect(stillScene2.mapBundleId).toContain('scene-m1-r2');

    // Pull the wall lever -> unlocks the exit
    const leverLabel = leverFeature!.label
      .replace(/\s*\((?:open|closed|locked|unlocked|intact|broken|lit|unlit)\).*$/i, '')
      .trim();

    // RV-03 & Universal Rules 1, 2, 3: Approaching an in-room feature ("I walk up to the <lever>")
    // resolves and commits the full walkable path to an adjacent square beside the lever, moving the token!
    const beforeApproachToken = stillScene2.tokens[0]?.footprint.anchor;
    expect(beforeApproachToken).toBeDefined();
    await page.getByTestId('player-action-input').fill(`I walk up to the ${leverLabel}`);
    await page.getByTestId('player-action-input').dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    await confirmDraftIfVisible(page);
    await expect(page.getByTestId('dm-play-thread')).not.toContainText(
      /Mark an adjacent square on the map|Movement within a room is controlled by clicking/i,
    );
    await expect
      .poll(
        async () => {
          const proj = await fetchMapBundle();
          const anchor = proj.tokens[0]?.footprint.anchor;
          if (!anchor) return 999;
          return (
            Math.abs(anchor.column - leverFeature!.column) +
            Math.abs(anchor.row - leverFeature!.row)
          );
        },
        { timeout: 15_000 },
      )
      .toBe(1);
    const afterApproachScene2 = await fetchMapBundle();
    expect(afterApproachScene2.mapBundleId).toContain('scene-m1-r2');

    await page.getByTestId('player-action-input').fill(`I pull the ${leverLabel}`);
    await page.getByTestId('player-action-input').dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    await confirmDraftIfVisible(page);

    await expect
      .poll(
        async () => {
          const proj = await fetchMapBundle();
          return proj.notableFeatures.find(
            (f) => f.objectKind === 'exit' && !/return|back/i.test(f.label),
          )?.lockState;
        },
        { timeout: 15_000 },
      )
      .toBe('unlocked');

    // Now travel through the unlocked exit -> transitions to Scene 3 ('scene-m1-r3')
    await page.getByTestId('player-action-input').fill(`I go through the ${scene2ExitLabel}`);
    await page.getByTestId('player-action-input').dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    await confirmDraftIfVisible(page);

    await expect
      .poll(
        async () => {
          const proj = await fetchMapBundle();
          return proj.mapBundleId;
        },
        { timeout: 15_000 },
      )
      .toContain('scene-m1-r3');

    // Upon reaching Scene 3, the Monk has earned 350 XP (>= 300 XP for Level 2) and Unarmored Movement raises speed to 40 feet.
    // Verify Ask the Director cites "40 feet" at Level 2.
    const expandCommsScene3 = page.getByTestId('expand-comms-rail');
    if (await expandCommsScene3.isVisible().catch(() => false)) {
      await expandCommsScene3.click();
    }
    await page.getByTestId('dock-tab-director_address').click();
    await page
      .getByTestId('director-address-input')
      .fill('What is my current walking speed and unarmed strike attack bonus and damage at level 2?');
    await page.getByTestId('director-address-input').dispatchEvent('input');
    await page.getByTestId('director-address-send').click({ force: false });
    await expect(page.getByTestId('ask-dm-thread')).toContainText(/40\s+feet/i, {
      timeout: 15_000,
    });
  });
});
