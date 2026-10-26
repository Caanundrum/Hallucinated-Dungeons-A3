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

async function confirmDraftIfVisible(page: Page): Promise<void> {
  const confirm = page.getByTestId('confirm-intent-intercept');
  if (await confirm.isVisible({ timeout: 3_500 }).catch(() => false)) {
    await confirm.click();
    await expect(confirm).toHaveCount(0, { timeout: 15_000 });
  }
}

test.describe('Post-Deploy Systemic Remediation (Packets 1–5)', () => {
  test('Premise live sync, PC exclusion from NPCs, intent translation, grounded improvisation, equipment mechanics, Chronicle auto-scroll, and single-scroll Rules Consult', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);

    // 1. Create a player character ("Brenna Ashveil")
    const heroName = 'Brenna Ashveil';
    await page.getByTestId('nav-characters').click();
    await page.getByTestId('start-character').click();
    const tutorialNo = page.getByTestId('tutorial-ask-no');
    if (await tutorialNo.isVisible().catch(() => false)) await tutorialNo.click();
    await page.getByTestId('open-quick-start').click();
    await page.getByTestId('option-stalwart-defender').click();
    await page.getByTestId('identity-name').fill(heroName);
    await page.getByTestId('identity-name').dispatchEvent('change');
    await page.getByTestId('create-character').click();

    // 2. Packet 2: Navigate to Campaign Create, verify player character is excluded from premise Named facts,
    //    and verify editing the premise after drafting outlines re-enables Draft Rough Campaign Outlines.
    await page.getByTestId('nav-campaigns').click();
    await page.getByTestId('start-campaign').click();
    await expect(page.getByTestId('create-campaign-heading')).toBeVisible();

    const initialPremise =
      'Warden Theron asks Brenna Ashveil to investigate the sunken cistern beneath Watchtower Keep and recover the brass chronometer.';
    await page.getByTestId('campaign-name').fill('Watchtower Cistern');
    await page.getByTestId('campaign-name').dispatchEvent('input');
    await page.getByTestId('campaign-summary').fill(initialPremise);
    await page.getByTestId('campaign-summary').dispatchEvent('input');

    const committedFacts = page.getByTestId('premise-committed-facts');
    await expect(committedFacts).toBeVisible();
    await expect(committedFacts).toContainText(/Warden Theron/i);
    await expect(committedFacts).not.toContainText(/Brenna/i);

    await page.getByTestId('identity-veyra').click();
    await page.getByTestId('personality-seasoned_host').click();

    // Draft Rough Campaign Outlines
    const draftBtn = page.getByTestId('draft-campaign-skeleton');
    await expect(draftBtn).toBeEnabled();
    await draftBtn.click();
    await expect(page.getByTestId('campaign-skeleton-preview')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('campaign-skeleton-preview')).not.toContainText(
      /across the frontier across the frontier/i,
    );
    await expect(page.getByTestId('outline-options-list')).not.toContainText(/Brenna Ashveil/i);
    await expect(page.getByTestId('rough-outline-acts')).toContainText(/Warden Theron/i);
    await expect(page.getByTestId('rough-outline-acts')).not.toContainText(/Brenna Ashveil/i);
    await expect(draftBtn).toBeDisabled();

    // Edit premise after outlines were drafted -> Draft button must re-enable immediately
    const updatedPremise =
      'Warden Theron and Archivist Corin ask Brenna Ashveil to investigate the sunken cistern beneath Watchtower Keep and recover the brass chronometer.';
    await page.getByTestId('campaign-summary').fill(updatedPremise);
    await page.getByTestId('campaign-summary').dispatchEvent('input');

    await expect(draftBtn).toBeEnabled();
    await expect(draftBtn).toContainText(/Regenerate Rough Campaign Outlines/i);

    // Regenerate outlines with the edited premise and approve
    await draftBtn.click();
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

    // Scene 1 title must not be literally "Campaign"
    const bannerText = (await page.getByTestId('map-scene-banner').innerText()).trim();
    expect(bannerText).not.toMatch(/^Campaign$/i);

    // Verify player character is never listed in campaign memory NPCs
    const candidateId = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="hd-candidate-id"]');
      return meta?.getAttribute('content') ?? null;
    });
    const origin = new URL(page.url()).origin;
    const memoryRes = await page.request.get(`${origin}/api/campaigns/${campaignId}/memory`, {
      headers: {
        origin,
        ...(candidateId !== null ? { 'x-hd-candidate': candidateId } : {}),
      },
    });
    if (memoryRes.ok()) {
      const memBody = (await memoryRes.json()) as {
        memory?: { npcs?: readonly { name: string }[] };
      };
      const npcNames = (memBody.memory?.npcs ?? []).map((n) => n.name);
      expect(npcNames.some((n) => /brenna/i.test(n))).toBe(false);
    }

    // 3. Packets 1 & 3: Submit natural-language and imperative declarations
    const declarations = [
      'I read the label on my rations',
      'Tap the flagstones with my pole',
      'Examine the stone workbench in the corner',
    ];
    for (const declaration of declarations) {
      await page.getByTestId('player-action-input').fill(declaration);
      await page.getByTestId('player-action-input').dispatchEvent('input');
      await page.getByTestId('submit-player-action').click();
      await confirmDraftIfVisible(page);
      await expect(page.getByTestId('dm-play-thread')).not.toContainText(
        /Say one clear action your character attempts/i,
      );
    }

    // 4. Packet 5: Verify Chronicle auto-scrolls to the bottom after narration updates
    await expect
      .poll(
        async () => {
          return page.evaluate(() => {
            const list =
              document.querySelector<HTMLElement>('[data-testid="dm-play-thread-list"]') ??
              document.querySelector<HTMLElement>('[data-testid="dm-play-thread"]');
            if (!list) return 999;
            return Math.max(0, list.scrollHeight - list.scrollTop - list.clientHeight);
          });
        },
        { timeout: 15_000 },
      )
      .toBeLessThanOrEqual(24);

    // 5. Packet 4: Verify carried equipment has mechanical statsSummary metadata on rules-state & sheet modal
    const rulesResponse = await page.request.get(
      `${origin}/api/campaigns/${campaignId}/rules-state`,
      {
        headers: {
          origin,
          ...(candidateId !== null ? { 'x-hd-candidate': candidateId } : {}),
        },
      },
    );
    expect(rulesResponse.ok()).toBeTruthy();
    const rulesBody = (await rulesResponse.json()) as {
      progression?: {
        sheet?: { equipment?: readonly { name: string; statsSummary?: string }[] };
      };
    };
    const equipment = rulesBody.progression?.sheet?.equipment ?? [];
    expect(equipment.length).toBeGreaterThan(0);
    expect(equipment.every((item) => (item.statsSummary ?? '').trim().length > 0)).toBe(true);

    // 6. Packet 5: Verify single-scroll collapsible Rules Consult (Ask the Director) pane
    const expandComms = page.getByTestId('expand-comms-rail');
    if (await expandComms.isVisible().catch(() => false)) {
      await expandComms.click();
    }
    const askTab = page.getByTestId('dock-tab-director_address');
    await expect(askTab).toBeVisible({ timeout: 10_000 });
    await askTab.click();

    const addressPane = page.getByTestId('director-address-pane');
    await expect(addressPane).toBeVisible();

    const addressInput = page.getByTestId('director-address-input');
    await addressInput.fill('How does advantage on an ability check work?');
    await addressInput.dispatchEvent('input');
    await page.getByTestId('director-address-send').click();
    await expect(page.getByTestId('ask-dm-thread')).toBeVisible({ timeout: 15_000 });

    // Assert zero descendant elements inside director-address-pane have overflow-y: auto or scroll
    const nestedScrollableCount = await addressPane.evaluate((pane) => {
      const descendants = Array.from(pane.querySelectorAll<HTMLElement>('*'));
      return descendants.filter((el) => {
        const style = window.getComputedStyle(el);
        return style.overflowY === 'auto' || style.overflowY === 'scroll';
      }).length;
    });
    expect(nestedScrollableCount).toBe(0);

    // Sending a question auto-compacts the header notice; clicking the toggle button expands/collapses only the notice while keeping the pane open
    const collapseBtn = page.getByTestId('collapse-director-address');
    const notice = page.getByTestId('director-address-notice');
    await expect(collapseBtn).toBeVisible();
    await expect(notice).toBeHidden();
    await collapseBtn.click();
    await expect(notice).toBeVisible();
    await collapseBtn.click();
    await expect(notice).toBeHidden();
    await expect(addressPane).toBeVisible();
  });
});
