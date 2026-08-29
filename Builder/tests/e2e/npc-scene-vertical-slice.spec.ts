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
  test('unknown Nib clarifies; Director NPC establish lists People; scene chronicles', async ({
    page,
  }) => {
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
      'Loophole Lantern calls into the chamber and waits for whoever is present.',
    );
    await page.getByTestId('interpret-nl-intent').click();
    await expect(page.getByTestId('intent-intercept-summary')).toContainText(
      /who is present|cannot invent NPCs/i,
    );
    await expect(page.getByTestId('intent-intercept-summary')).not.toContainText(
      /What is your character attempting/i,
    );
    await page.getByTestId('intent-intercept').screenshot({
      path: `${artifactDir}/npc-playpath-seek-presence.png`,
    });
    await page.getByTestId('cancel-intent-intercept').click();

    await page.getByTestId('nl-intent-input').fill(
      'Loophole Lantern pauses and surveys the current chamber, looking and listening carefully. Garrick, describe only what she can perceive and reveal any scene change only if the established fiction requires one.',
    );
    await page.getByTestId('interpret-nl-intent').click();
    await expect(page.getByTestId('intent-intercept-summary')).toContainText(
      /Looking and listening|perceptible/i,
    );
    await expect(page.getByTestId('intent-intercept-summary')).not.toContainText(
      /encounter|attack|Confirm to start/i,
    );
    await page.getByTestId('intent-intercept').screenshot({
      path: `${artifactDir}/npc-playpath-scene-survey.png`,
    });
    await page.getByTestId('cancel-intent-intercept').click();

    const candidate = await readCandidate(page);
    const origin = new URL(page.url()).origin;
    const headers = {
      origin,
      'content-type': 'application/json',
      'x-hd-candidate': candidate.candidateId,
    };

    const npcResponse = await page.request.post(`/api/campaigns/${campaignId}/director/npc`, {
      headers,
      data: {
        schemaVersion: 'play-authority-npc-v1',
        npcId: 'npc-nib',
        name: 'Nib',
        publicDescription: 'A wary goblin cartographer',
        disposition: 'wary',
        location: { column: 4, row: 3 },
        placeToken: true,
        firstDialogue: 'Keep your boots dry past the east door.',
        audience: 'public',
        causeActionId: null,
      },
    });
    expect(npcResponse.ok()).toBeTruthy();
    const npcBody = (await npcResponse.json()) as {
      created?: boolean;
      chronicleBody?: string | null;
      memory?: { npcs?: { name: string }[] };
    };
    expect(npcBody.created).toBe(true);
    expect(npcBody.chronicleBody ?? '').toMatch(/Nib:/);
    expect(npcBody.memory?.npcs?.some((npc) => npc.name === 'Nib')).toBe(true);

    await page.reload();
    await expect(page.getByTestId('campaign-table-heading')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('table-info-tab-people').click();
    await expect(page.getByTestId('table-npc-list')).toBeVisible();
    await expect(page.getByTestId('table-npc-item')).toContainText('Nib');
    await page.getByTestId('table-people-panel').screenshot({
      path: `${artifactDir}/npc-slice-people-nib.png`,
    });

    await openTableAdvancedControls(page);
    await page.getByTestId('nl-intent-input').fill('Nib, which door leads to the old archive?');
    await page.getByTestId('interpret-nl-intent').click();
    await expect(page.getByTestId('intent-intercept')).toBeVisible();
    await expect(page.getByTestId('intent-intercept-summary')).toContainText(/dialogue|Ask Nib/i);
    await expect(page.getByTestId('intent-intercept-summary')).not.toContainText(/not established/i);
    await page.getByTestId('intent-intercept').screenshot({
      path: `${artifactDir}/npc-slice-known-dialogue.png`,
    });
    await page.getByTestId('cancel-intent-intercept').click();

    const sceneResponse = await page.request.post(`/api/campaigns/${campaignId}/director/scene`, {
      headers,
      data: {
        schemaVersion: 'play-authority-scene-v1',
        sceneId: 'scene-quiet-chamber-r2',
        revision: 2,
        title: 'Quiet chamber — after Nib',
        displayMode: 'exploration',
        bounds: { columns: 8, rows: 8 },
        causeActionId: null,
        continuity: { previousSceneId: 'quiet-chamber', boundaryCrossed: false },
        structure: { edges: [] },
        markers: [],
        entities: [],
        visibility: 'public',
        rejectedMechanics: ['unsupported gravity well'],
      },
    });
    expect(sceneResponse.ok()).toBeTruthy();
    const sceneBody = (await sceneResponse.json()) as {
      ok?: boolean;
      mapApplied?: boolean;
      chronicleBody?: string;
    };
    expect(sceneBody.ok).toBe(true);
    expect(sceneBody.mapApplied).toBe(false);
    expect(sceneBody.chronicleBody ?? '').toMatch(/Scene established/i);
    expect(sceneBody.chronicleBody ?? '').toMatch(/unsupported gravity well/i);

    await page.getByTestId('dock-tab-chronicle').click();
    await expect(
      page.getByTestId('chronicle-entry').filter({ hasText: /Nib: Keep your boots dry/i }),
    ).toBeVisible();
    await expect(
      page.getByTestId('chronicle-entry').filter({ hasText: /Scene established: Quiet chamber/i }),
    ).toBeVisible();
    await page.getByTestId('chronicle-list').scrollIntoViewIfNeeded();
    await page.getByTestId('chronicle-list').screenshot({
      path: `${artifactDir}/npc-slice-chronicle.png`,
    });
  });
});
