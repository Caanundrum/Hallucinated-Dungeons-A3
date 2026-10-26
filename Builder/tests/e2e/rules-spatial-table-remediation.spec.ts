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

    // =========================================================================
    // PACKET 2: Campaign Creation Layout Polish & Notice Typography
    // =========================================================================
    await page.getByTestId('nav-campaigns').click();
    await page.getByTestId('start-campaign').click();
    await expect(page.getByTestId('create-campaign-heading')).toBeVisible();

    const outdoorPremise =
      'Beyond the mist-shrouded forest clearing of Elderwood, Ranger Venn asks Kaelen Windstep to follow the winding trail to the sunken watchtower ruin.';
    await page.getByTestId('campaign-name').fill('Elderwood Watchtower');
    await page.getByTestId('campaign-name').dispatchEvent('input');
    await page.getByTestId('campaign-summary').fill(outdoorPremise);
    await page.getByTestId('campaign-summary').dispatchEvent('input');
    await page.getByTestId('identity-veyra').click();
    await page.getByTestId('personality-seasoned_host').click();

    // Verify `.campaign-draft-actions-stack` and `p.message.notice` block typography
    const draftStack = page.locator('.campaign-draft-actions-stack');
    await expect(draftStack).toBeVisible();
    const noticeDisplay = await draftStack.locator('p.message.notice').first().evaluate((el) => {
      return window.getComputedStyle(el).display;
    });
    expect(noticeDisplay).toBe('block');

    await page.getByTestId('draft-campaign-skeleton').click();
    await expect(page.getByTestId('campaign-skeleton-preview')).toBeVisible({ timeout: 30_000 });
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
    // PACKETS 3, 4, & 5 + GUARDRAILS 1 & 2 ON THE PLAY TABLE
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

    // 1. Verify Scene 1 has perimeter exit on the outer grid border and no hardcoded 'Sturdy oak chest'
    const initialMap = await fetchMapBundle();
    const features = initialMap.notableFeatures ?? [];
    const labels = features.map((f) => f.label.toLowerCase());
    expect(labels).not.toContain('sturdy oak chest');
    expect(labels).not.toContain('iron lantern');

    const exitFeature = features.find((f) => f.objectKind === 'exit');
    expect(exitFeature).toBeDefined();
    const gridW = initialMap.coordinateSpace?.columns ?? 12;
    const gridH = initialMap.coordinateSpace?.rows ?? 8;
    const onPerimeter =
      exitFeature!.column === 0 ||
      exitFeature!.column === gridW - 1 ||
      exitFeature!.row === 0 ||
      exitFeature!.row === gridH - 1;
    expect(onPerimeter).toBe(true);

    // 2. Packet 3: Clicking a map square or doorway does NOT show intrusive banners
    const anyCell = page.locator('[data-testid^="map-cell-"]').first();
    if (await anyCell.isVisible().catch(() => false)) {
      await anyCell.click();
    }
    await expect(page.getByTestId('move-target-meta')).toHaveCount(0);
    await expect(page.getByTestId('door-selection-detail')).toHaveCount(0);

    // 3. Packet 3 & Guardrail 2: Two-Step Container Looting
    const containerFeature = features.find((f) => f.objectKind === 'container');
    expect(containerFeature).toBeDefined();
    const containerLabel = containerFeature!.label
      .replace(/\s*\((?:open|closed|locked|unlocked)\).*$/i, '')
      .trim();

    // Step 1: Open container -> lists contents in Chronicle without auto-looting
    await page.getByTestId('player-action-input').fill(`I open the ${containerLabel}`);
    await page.getByTestId('player-action-input').dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    await confirmDraftIfVisible(page);
    await expect(page.getByTestId('dm-play-thread')).toContainText(/Inside you see:/i, {
      timeout: 15_000,
    });

    // Step 2: Explicitly loot container -> transfers contents to inventory
    await page.getByTestId('player-action-input').fill(`I loot the ${containerLabel}`);
    await page.getByTestId('player-action-input').dispatchEvent('input');
    await page.getByTestId('submit-player-action').click();
    await confirmDraftIfVisible(page);
    await expect(page.getByTestId('dm-play-thread')).toContainText(/Took .* from/i, {
      timeout: 15_000,
    });

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
    expect(equipNames.some((n) => /healing draught/i.test(n))).toBe(true);

    // 4. Packet 4: Travel via perimeter exit ("I take the winding trail") transitions to Scene 2
    const exitLabel = exitFeature!.label
      .replace(/\s*—\s*(?:open|closed|locked|unlocked).*$/i, '')
      .trim();
    await page.getByTestId('player-action-input').fill(`I take the ${exitLabel}`);
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

    // 5. Packet 4 & Guardrail 1: Wall-lever mechanism lock in Scene 2
    const scene2Map = await fetchMapBundle();
    const scene2Features = scene2Map.notableFeatures ?? [];
    const leverFeature = scene2Features.find((f) => /lever|switch|chain/i.test(f.label));
    const scene2Exit = scene2Features.find(
      (f) => f.objectKind === 'exit' && !/return|back/i.test(f.label),
    );
    expect(leverFeature).toBeDefined();
    expect(scene2Exit).toBeDefined();
    const scene2ExitLabel = scene2Exit!.label
      .replace(/\s*—\s*(?:open|closed|locked|unlocked).*$/i, '')
      .trim();
    // Lever must be wall-anchored along the north perimeter (row <= 2)
    expect(leverFeature!.row).toBeLessThanOrEqual(2);
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
  });
});
