import { expect, test, type Page } from '@playwright/test';

import {
  acceptAllLegalForPlay,
  enterAccountFromShell,
  joinTableWithFirstCharacter,
} from './arena-page.js';

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
  await page.getByTestId('tutorial-ask-no').click();
  await page.getByTestId('open-quick-start').click();
  await page.getByTestId('option-stalwart-defender').click();
  await expect(page.getByTestId('active-step-heading')).toHaveText('Identity & Final Review');
  await page.getByTestId('identity-name').fill(name);
  await page.getByTestId('identity-name').dispatchEvent('change');
  await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
  await page.getByTestId('create-character').click();
  await expect(page.getByTestId('character-sheet-heading')).toHaveText(name);
}

async function createPublicTable(
  page: Page,
  options: {
    readonly name: string;
    readonly password?: string;
  },
): Promise<string> {
  await page.getByTestId('nav-campaigns').click();
  await page.getByTestId('start-campaign').click();
  await expect(page.getByTestId('create-campaign-heading')).toBeVisible();
  await page.getByTestId('visibility-public').click();
  if (options.password !== undefined) {
    await expect(page.getByTestId('join-password')).toBeVisible();
    await page.getByTestId('join-password').fill(options.password);
  }
  await page.getByTestId('campaign-name').fill(options.name);
  await page.getByTestId('campaign-name').dispatchEvent('change');
  await page.getByTestId('identity-veyra').click();
  await page.getByTestId('personality-seasoned_host').click();
  await page.getByTestId('create-campaign-submit').click();
  await expect(page.getByTestId('join-table-heading')).toBeVisible();
  const match = page.url().match(/\/campaigns\/([A-Za-z0-9-]+)\/join/);
  expect(match).toBeTruthy();
  return match![1]!;
}

test.describe('Lobby simplification — tables hub, join, and seat rules', () => {
  test('public table appears in open lobby and stranger can join without invite', async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signIn(ownerPage);
    await createQuickCharacter(ownerPage, 'Tavern Host');
    const tableName = `Open Tavern ${Date.now()}`;
    const campaignId = await createPublicTable(ownerPage, { name: tableName });

    const strangerContext = await browser.newContext();
    const strangerPage = await strangerContext.newPage();
    await signIn(strangerPage);
    await strangerPage.getByTestId('nav-campaigns').click();
    await strangerPage.getByTestId('tables-tab-open').click();
    await expect(strangerPage.getByTestId('open-table-list')).toBeVisible();
    await expect(strangerPage.getByTestId('open-table-link').filter({ hasText: tableName })).toBeVisible();

    await createQuickCharacter(strangerPage, 'Wandering Hero');
    await strangerPage.goto(`/campaigns/${campaignId}/join`);
    await joinTableWithFirstCharacter(strangerPage);
    await strangerPage.goto(`/campaigns/${campaignId}`);
    await expect(strangerPage.getByTestId('own-seat')).toContainText('Wandering Hero');

    await ownerContext.close();
    await strangerContext.close();
  });

  test('password-protected public table rejects wrong password then accepts correct one', async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signIn(ownerPage);
    await createQuickCharacter(ownerPage, 'Gate Keeper');
    const campaignId = await createPublicTable(ownerPage, {
      name: 'Locked Lounge',
      password: 'table-secret',
    });

    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await signIn(guestPage);
    await createQuickCharacter(guestPage, 'Password Guest');
    await guestPage.goto(`/campaigns/${campaignId}/join`);
    if (await guestPage.getByTestId('legal-play-gate-heading').isVisible().catch(() => false)) {
      await acceptAllLegalForPlay(guestPage);
      await guestPage.goto(`/campaigns/${campaignId}/join`);
    }
    await expect(guestPage.getByTestId('join-table-password')).toBeVisible();

    const select = guestPage.getByTestId('join-character-select');
    const characterId = await select.locator('option').nth(1).getAttribute('value');
    await select.selectOption(characterId!);
    await guestPage.getByTestId('join-table-submit').click();
    await expect(guestPage.getByTestId('join-table-error')).toContainText('password');

    await guestPage.getByTestId('join-table-password').fill('table-secret');
    await guestPage.getByTestId('join-table-submit').click();
    await expect(guestPage.getByTestId('campaign-table-heading')).toBeVisible({ timeout: 20_000 });

    await ownerContext.close();
    await guestContext.close();
  });

  test('one active seat globally — switch tables confirms and moves the seat', async ({ page }) => {
    await signIn(page);
    await createQuickCharacter(page, 'Switcher Hero');

    const tableA = await createPublicTable(page, { name: 'First Table' });
    await joinTableWithFirstCharacter(page);
    await page.getByTestId('nav-campaigns').click();
    await expect(page.getByTestId('return-to-table')).toContainText('First Table');

    const tableB = await createPublicTable(page, { name: 'Second Table' });
    await expect(page.getByTestId('join-table-heading')).toBeVisible();
    const select = page.getByTestId('join-character-select');
    const characterId = await select.locator('option').nth(1).getAttribute('value');
    await select.selectOption(characterId!);
    await page.getByTestId('join-table-submit').click();
    await expect(page.getByTestId('confirm-switch-table')).toBeVisible();
    await page.getByTestId('confirm-switch-table-confirm').click();
    await expect(page.getByTestId('campaign-table-heading')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('nav-campaigns').click();
    await expect(page.getByTestId('return-to-table')).toContainText('Second Table');
    await page.goto(`/campaigns/${tableB}/join`);
    await expect(page.getByTestId('join-already-seated')).toBeVisible();
    await expect(page.getByTestId('join-open-table')).toBeVisible();
    await page.goto(`/campaigns/${tableA}/join`);
    if (await page.getByTestId('legal-play-gate-heading').isVisible().catch(() => false)) {
      await acceptAllLegalForPlay(page);
      await page.goto(`/campaigns/${tableA}/join`);
    }
    await expect(page.getByTestId('join-table-heading')).toBeVisible();
    const selectAgain = page.getByTestId('join-character-select');
    await selectAgain.selectOption(characterId!);
    await page.getByTestId('join-table-submit').click();
    await expect(page.getByTestId('confirm-switch-table')).toBeVisible();
    await page.getByTestId('confirm-switch-table-cancel').click();
    await expect(page.getByTestId('join-table-error')).toHaveCount(0);
    await page.getByTestId('nav-campaigns').click();
    await expect(page.getByTestId('return-to-table')).toContainText('Second Table');
  });

  test('four active seats cap blocks a fifth join', async ({ browser }) => {
    test.setTimeout(120_000);

    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signIn(ownerPage);
    await createQuickCharacter(ownerPage, 'Full Table Host');
    const campaignId = await createPublicTable(ownerPage, { name: 'Four Top Table' });
    await ownerPage.getByTestId('nav-campaigns').click();

    const guestNames = ['Seat One', 'Seat Two', 'Seat Three'];
    const contexts = [];
    for (const name of guestNames) {
      const ctx = await browser.newContext();
      const guestPage = await ctx.newPage();
      await signIn(guestPage);
      await createQuickCharacter(guestPage, name);
      await guestPage.goto(`/campaigns/${campaignId}/join`);
      await joinTableWithFirstCharacter(guestPage);
      contexts.push(ctx);
    }
    await ownerPage.goto(`/campaigns/${campaignId}/join`);
    await joinTableWithFirstCharacter(ownerPage);

    const fifthContext = await browser.newContext();
    const fifthPage = await fifthContext.newPage();
    await signIn(fifthPage);
    await createQuickCharacter(fifthPage, 'Seat Five');
    await fifthPage.goto(`/campaigns/${campaignId}/join`);
    const select = fifthPage.getByTestId('join-character-select');
    const characterId = await select.locator('option').nth(1).getAttribute('value');
    await select.selectOption(characterId!);
    await fifthPage.getByTestId('join-table-submit').click();
    await expect(fifthPage.getByTestId('join-table-error')).toContainText('four active players');

    await fifthContext.close();
    for (const ctx of contexts) {
      await ctx.close();
    }
    await ownerContext.close();
  });

  test('active My-tables link opens table; opening prompt is Just now; Session Zero copy stays open', async ({
    page,
  }) => {
    await signIn(page);
    await createQuickCharacter(page, 'Timestamp Hero');
    const tableName = `Timestamp Table ${Date.now()}`;
    await createPublicTable(page, { name: tableName });
    await joinTableWithFirstCharacter(page);
    await expect(page.getByTestId('campaign-table-heading')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('dm-play-thread-list')).toBeVisible();
    const timestamps = page.getByTestId('dm-thread-timestamp');
    await expect(timestamps.first()).toHaveText('Just now');
    await expect(page.getByTestId('dm-play-thread')).not.toContainText('1969');
    await expect(page.getByTestId('dm-play-thread')).not.toContainText('1970');

    await page.getByTestId('nav-campaigns').click();
    await expect(page.getByTestId('my-table-open')).toContainText(tableName);
    await page.getByTestId('my-table-open').click();
    await expect(page.getByTestId('campaign-table-heading')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('join-table-heading')).toHaveCount(0);

    await page.getByTestId('table-settings').click();
    await expect(page.getByTestId('session-zero-status')).toContainText('Recorded');
    await expect(page.getByTestId('settings-save-hint')).not.toContainText(
      'required before seating',
    );
    await expect(page.getByTestId('session-zero-defaults-notice')).toContainText(
      'seating and live play stay open',
    );
  });

  test('legal acceptance is recorded once and play routes stay open after reload', async ({
    page,
  }) => {
    await page.goto('/');
    await dismissIntroIfPresent(page);
    await page.getByTestId('shell-enter-account').click();
    await expect(page.getByTestId('shell-account-link')).toBeVisible();

    await page.getByTestId('nav-campaigns').click();
    await expect(page.getByTestId('campaigns-heading')).toBeVisible();

    await page.getByTestId('start-campaign').click();
    await expect(page.getByTestId('legal-play-gate-heading')).toBeVisible();
    await acceptAllLegalForPlay(page);
    await page.goto('/campaigns/new');
    await expect(page.getByTestId('create-campaign-heading')).toBeVisible();

    await page.reload();
    await page.getByTestId('nav-characters').click();
    await expect(page.getByTestId('vault-heading')).toBeVisible();
    await expect(page.getByTestId('legal-play-gate-heading')).toHaveCount(0);
  });
});
