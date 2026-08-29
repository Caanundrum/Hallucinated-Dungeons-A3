import { expect, test, type Page } from '@playwright/test';

import {
  enterAccountFromShell,
  joinTableWithFirstCharacter,
  openTableAdvancedControls,
  readCandidate,
} from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function seatFreshCampaign(page: Page, name: string): Promise<string> {
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
  await page.getByTestId('identity-veyra').click();
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

test.describe('DM NPC + thin scene vertical slice', () => {
  test('Director narrates survey/presence; Quiet chamber seek introduces Nib', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await enterAccountFromShell(page);
    const campaignId = await seatFreshCampaign(page, 'NpcSlice');
    await page.getByTestId('open-campaign-table').click();
    await expect(page.getByTestId('map-scene-banner')).toBeVisible();

    const artifactDir = process.env.HD_E2E_ARTIFACT_DIR ?? '/opt/cursor/artifacts';

    await page.getByTestId('table-info-tab-people').click();
    await expect(page.getByTestId('table-npc-empty')).toBeVisible();
    await page.getByTestId('table-people-panel').screenshot({
      path: `${artifactDir}/npc-slice-people-empty.png`,
    });

    await openTableAdvancedControls(page);
    await page.getByTestId('nl-intent-input').fill(
      'Loophole Lantern asks Nib, “Who are you, and what lies beyond the wooden door?”',
    );
    await page.getByTestId('interpret-nl-intent').click();
    await expect(page.getByTestId('intent-intercept')).toBeVisible();
    await expect(page.getByTestId('intent-intercept-summary')).toContainText(
      /not an established NPC|not established/i,
    );
    await expect(page.getByTestId('intent-intercept-summary')).not.toContainText(/Say who you ask/i);
    await page.getByTestId('intent-intercept').screenshot({
      path: `${artifactDir}/npc-playpath-asks-nib-clarify.png`,
    });
    await page.getByTestId('cancel-intent-intercept').click();

    await page.getByTestId('nl-intent-input').fill(
      'Loophole Lantern pauses and surveys the current chamber, looking and listening carefully. Garrick, describe only what she can perceive and reveal any scene change only if the established fiction requires one.',
    );
    await page.getByTestId('interpret-nl-intent').click();
    await expect(page.getByTestId('intent-intercept-summary')).toContainText(
      /Quiet chamber|doorway|Wall sconce|Damp stones|look and listen|visible scene/i,
    );
    await expect(page.getByTestId('intent-intercept-summary')).not.toContainText(
      /encounter|attack|Confirm to start|Game Director narrates what is perceptible here/i,
    );
    await page.getByTestId('intent-intercept').screenshot({
      path: `${artifactDir}/npc-playpath-scene-survey.png`,
    });
    await page.getByTestId('cancel-intent-intercept').click();

    await page.getByTestId('dock-tab-chronicle').click();
    await expect(
      page.getByTestId('chronicle-entry').filter({ hasText: /Scene established/i }),
    ).toBeVisible();
    await expect(
      page
        .getByTestId('chronicle-entry')
        .filter({ hasText: /Quiet chamber — walls|Wall sconce|wooden doorway/i })
        .first(),
    ).toBeVisible();
    await page.getByTestId('chronicle-list').screenshot({
      path: `${artifactDir}/npc-playpath-survey-chronicle.png`,
    });

    await openTableAdvancedControls(page);
    await page.getByTestId('nl-intent-input').fill(
      'Loophole Lantern calls into the chamber and waits for whoever is present.',
    );
    await page.getByTestId('interpret-nl-intent').click();
    await expect(page.getByTestId('intent-intercept-summary')).toContainText(/Nib/i);
    await expect(page.getByTestId('intent-intercept-summary')).not.toContainText(
      /What is your character attempting|Looking and listening — the Game Director narrates/i,
    );
    await page.getByTestId('intent-intercept').screenshot({
      path: `${artifactDir}/npc-playpath-seek-presence.png`,
    });
    await page.getByTestId('cancel-intent-intercept').click();

    await page.reload();
    await expect(page.getByTestId('campaign-table-heading')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('table-info-tab-people').click();
    await expect(page.getByTestId('table-npc-list')).toBeVisible();
    await expect(page.getByTestId('table-npc-item')).toContainText('Nib');
    await page.getByTestId('table-people-panel').screenshot({
      path: `${artifactDir}/npc-slice-people-nib.png`,
    });

    await openTableAdvancedControls(page);
    await page.getByTestId('nl-intent-input').fill(
      'Loophole Lantern asks Nib, “What is past the east door, and why should I keep my boots dry?”',
    );
    await page.getByTestId('interpret-nl-intent').click();
    await expect(page.getByTestId('intent-intercept')).toBeVisible();
    await expect(page.getByTestId('intent-intercept-summary')).toContainText(
      /Nib:.*"|(?:wet|boots dry|pooling)/i,
    );
    await expect(page.getByTestId('intent-intercept-summary')).not.toContainText(
      /A wary goblin cartographer/i,
    );
    await expect(page.getByTestId('intent-intercept-summary')).not.toContainText(/not established/i);
    await page.getByTestId('intent-intercept').screenshot({
      path: `${artifactDir}/npc-slice-known-dialogue.png`,
    });
    await page.getByTestId('cancel-intent-intercept').click();

    await page.getByTestId('dock-tab-chronicle').click();
    const introSpeech = page
      .getByTestId('chronicle-entry')
      .filter({ hasText: /Keep your boots dry/i });
    await expect(introSpeech).toHaveCount(1);
    await expect(
      page.getByTestId('chronicle-entry').filter({ hasText: /calls into the chamber/i }),
    ).toBeVisible();
    await expect(
      page
        .getByTestId('chronicle-entry')
        .filter({ hasText: /past the east door|boots dry|pooling|wet/i })
        .first(),
    ).toBeVisible();
    await page.getByTestId('chronicle-list').screenshot({
      path: `${artifactDir}/npc-slice-chronicle.png`,
    });

    void campaignId;
    void readCandidate;
  });
});
