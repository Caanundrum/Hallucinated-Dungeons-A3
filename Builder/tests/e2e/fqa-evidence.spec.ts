import { expect, test, type Page } from '@playwright/test';

import {
  enterAccountFromShell,
  joinTableWithFirstCharacter,
} from './arena-page.js';

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function seatAndOpenTable(page: Page, name: string): Promise<void> {
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
  await page.getByTestId('identity-veyra').click();
  await page.getByTestId('personality-seasoned_host').click();
  await page.getByTestId('create-campaign-submit').click();
  await expect(page.getByTestId('join-table-heading')).toBeVisible();
  await joinTableWithFirstCharacter(page);
}

test('FQA evidence screenshots', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await dismissIntroIfPresent(page);
  await enterAccountFromShell(page);
  await page.goto('/');
  await dismissIntroIfPresent(page);
  await expect(page.getByTestId('home-campaigns-link')).toContainText(/Open Tables/i);
  await expect(page.locator('#status-heading').locator('..')).toContainText(/create a table|join tables/i);
  await expect(page.locator('#status-heading').locator('..')).not.toContainText(/create a campaign|join campaigns/i);
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-home-tables-copy.png', fullPage: true });

  await page.goto('/account');
  await expect(page.getByTestId('account-sign-out')).toHaveCount(0);
  await expect(page.getByTestId('account-session-renewal-note')).toContainText(/characters and tables/i);
  await expect(page.getByTestId('account-session-renewal-note')).not.toContainText(/campaigns/i);
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-account-shell.png', fullPage: true });
  // FQA-040: Admin nav only when bootstrap admin; ordinary players keep it hidden.
  const bootstrap = page.getByTestId('account-is-bootstrap-admin');
  if (await bootstrap.isVisible().catch(() => false)) {
    await expect(page.getByTestId('nav-admin')).toBeVisible();
  } else {
    await expect(page.getByTestId('nav-admin')).toBeHidden();
  }

  await seatAndOpenTable(page, 'FQAEvidence');
  await expect(page.getByTestId('begin-adventure')).toBeVisible();
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-awaiting-first-scene.png', fullPage: true });

  const storyFilter = page.getByTestId('chronicle-kind-filter');
  await expect(storyFilter).toHaveValue('story');
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-story-filter.png' });

  await page.getByTestId('open-table-sheet-modal').click();
  await expect(page.getByTestId('sheet-modal-tab-equipment')).toHaveCount(0);
  await expect(page.getByTestId('sheet-modal-full-page-link')).toBeVisible();
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-sheet-modal.png' });
  await page.keyboard.press('Escape');

  await page.getByTestId('dice-fab').click();
  await expect(page.getByTestId('dice-tray')).toContainText(/Practice dice tray/i);
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-practice-dice.png' });
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('mobile-task-map').click();
  await expect(page.getByTestId('table-page-shell')).toHaveAttribute('data-mobile-task', 'map');
  await expect(page.getByTestId('map-stage-toolbar')).toBeVisible();
  await expect(page.getByRole('button', { name: /Reset zoom to 100%/i })).toBeVisible();
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-mobile-map-mode.png' });

  await page.getByTestId('mobile-task-play').click();
  await expect(page.getByTestId('table-page-shell')).toHaveAttribute('data-mobile-task', 'play');
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-mobile-play-mode.png' });

  await page.getByTestId('mobile-task-chat').click();
  await expect(page.getByTestId('table-page-shell')).toHaveAttribute('data-mobile-task', 'chat');
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-mobile-chat-mode.png' });

  await page.getByTestId('table-overflow-menu').locator('summary').click();
  await expect(page.getByTestId('table-overflow-tables')).toBeVisible();
  await expect(page.getByTestId('table-overflow-vault')).toBeVisible();
  await expect(page.getByTestId('table-overflow-account')).toBeVisible();
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-mobile-overflow.png' });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  await expect(page.getByRole('button', { name: /Reset zoom to 100%/i })).toBeVisible();
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-map-reset-zoom.png' });

  // FQA-023: full dock must fit banner + thread + composer; only the thread list scrolls.
  const dockProof = await page.evaluate(() => {
    const action = document.querySelector('[data-testid="action-composer"]') as HTMLElement | null;
    const thread = document.querySelector('[data-testid="dm-play-thread"]') as HTMLElement | null;
    const banner = document.querySelector('[data-testid="table-turn-banner"]') as HTMLElement | null;
    const composer = document.querySelector(
      '[data-testid="table-player-turn-composer"]',
    ) as HTMLElement | null;
    let list = document.querySelector('[data-testid="dm-play-thread-list"]') as HTMLElement | null;
    if (list === null && thread !== null) {
      const empty = thread.querySelector('[data-testid="dm-play-thread-list-empty"]');
      list = document.createElement('ol');
      list.className = 'record-list dm-thread-list';
      list.setAttribute('data-testid', 'dm-play-thread-list');
      if (empty !== null) {
        empty.replaceWith(list);
      } else {
        thread.appendChild(list);
      }
    }
    if (list === null || action === null || thread === null || composer === null) {
      return { ok: false as const, reason: 'missing-nodes' };
    }
    list.innerHTML = '';
    for (let i = 0; i < 48; i += 1) {
      const li = document.createElement('li');
      li.className = 'dm-thread-message dm-thread-dm';
      li.tabIndex = -1;
      li.setAttribute('data-testid', i === 47 ? 'fqa-023-latest-seed' : 'dm-thread-message');
      li.innerHTML = `<span class="record-note"><strong>Veyra</strong></span><p>Seeded timeline beat ${i + 1}. ${'Detail '.repeat(12)}</p><span class="record-meta" data-testid="dm-thread-timestamp">Just now</span>`;
      list.appendChild(li);
    }
    // Force layout after seeding.
    void action.offsetHeight;
    const actionBox = action.getBoundingClientRect();
    const composerBox = composer.getBoundingClientRect();
    const bannerBox = banner?.getBoundingClientRect() ?? null;
    const threadBox = thread.getBoundingClientRect();
    const listStyle = getComputedStyle(list);
    const actionStyle = getComputedStyle(action);
    list.scrollTop = list.scrollHeight;
    const latest = document.querySelector('[data-testid="fqa-023-latest-seed"]') as HTMLElement | null;
    const latestBox = latest?.getBoundingClientRect() ?? null;
    const listBox = list.getBoundingClientRect();
    // Focus an early entry — must NOT scroll the outer dock or hide the composer.
    const early = list.querySelector('[data-testid="dm-thread-message"]') as HTMLElement | null;
    early?.focus({ preventScroll: false });
    early?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const afterFocusScrollTop = action.scrollTop;
    const composerBoxAfter = composer.getBoundingClientRect();
    const bannerBoxAfter = banner?.getBoundingClientRect() ?? null;
    const actionBoxAfter = action.getBoundingClientRect();
    const composerVisible =
      composerBoxAfter.top >= actionBoxAfter.top - 1 &&
      composerBoxAfter.bottom <= actionBoxAfter.bottom + 1 &&
      composerBoxAfter.height > 20;
    const bannerVisible =
      bannerBoxAfter === null ||
      (bannerBoxAfter.top >= actionBoxAfter.top - 1 &&
        bannerBoxAfter.bottom <= actionBoxAfter.bottom + 1);
    return {
      ok: true as const,
      action: {
        client: action.clientHeight,
        scroll: action.scrollHeight,
        overflowY: actionStyle.overflowY,
        scrollTop: afterFocusScrollTop,
      },
      thread: { client: thread.clientHeight, top: threadBox.top, bottom: threadBox.bottom },
      list: {
        client: list.clientHeight,
        scroll: list.scrollHeight,
        overflowY: listStyle.overflowY,
        scrollTop: list.scrollTop,
      },
      composer: {
        top: composerBox.top,
        bottom: composerBox.bottom,
        height: composerBox.height,
        visible: composerVisible,
      },
      banner: bannerBox
        ? { top: bannerBox.top, bottom: bannerBox.bottom, height: bannerBox.height }
        : null,
      dockFitsContent: action.scrollHeight <= action.clientHeight + 2,
      composerInsideDock:
        composerBox.top >= actionBox.top - 1 && composerBox.bottom <= actionBox.bottom + 1,
      threadInsideDock:
        threadBox.top >= actionBox.top - 1 && threadBox.bottom <= actionBox.bottom + 1,
      latestVisible:
        latestBox !== null &&
        latestBox.top < listBox.bottom - 4 &&
        latestBox.bottom > listBox.top + 4,
      nearBottom: list.scrollHeight - list.scrollTop - list.clientHeight < 12,
      bannerStillVisible: bannerVisible,
      listScrollable:
        list.scrollHeight > list.clientHeight + 40 && /(auto|scroll)/.test(listStyle.overflowY),
      actionScrollable:
        action.scrollHeight > action.clientHeight + 1 &&
        /(auto|scroll)/.test(actionStyle.overflowY),
    };
  });
  expect(dockProof.ok).toBe(true);
  if (dockProof.ok) {
    expect(dockProof.action.overflowY).toMatch(/hidden|clip/);
    expect(dockProof.actionScrollable).toBe(false);
    expect(dockProof.dockFitsContent).toBe(true);
    expect(dockProof.composerInsideDock).toBe(true);
    expect(dockProof.composer.visible).toBe(true);
    expect(dockProof.threadInsideDock).toBe(true);
    expect(dockProof.list.overflowY).toMatch(/auto|scroll/);
    expect(dockProof.list.client).toBeLessThan(380);
    expect(dockProof.list.client).toBeGreaterThan(40);
    expect(dockProof.list.scroll).toBeGreaterThan(dockProof.list.client + 400);
    expect(dockProof.listScrollable).toBe(true);
    expect(dockProof.nearBottom || dockProof.latestVisible).toBe(true);
    expect(dockProof.action.scrollTop).toBe(0);
    expect(dockProof.bannerStillVisible).toBe(true);
  }
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-023-dock-fit.png' });
});

test('FQA-R01/R04 correction reason and session action exclusivity', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await dismissIntroIfPresent(page);
  await enterAccountFromShell(page);
  await seatAndOpenTable(page, 'FQAGates');
  const campaignId = /\/campaigns\/([^/]+)/.exec(page.url())?.[1];
  expect(campaignId).toBeTruthy();

  await page.goto('/characters');
  await page.getByTestId('character-link').first().click();
  await expect(page.getByTestId('correction-reason-input')).toBeVisible();
  await expect(page.getByTestId('unlock-correction-mode')).toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('correction-reason-input').fill('QA audit reason for HP ledger');
  await expect(page.getByTestId('unlock-correction-mode')).toHaveAttribute('aria-disabled', 'false');
  await page.getByTestId('unlock-correction-mode').click();
  await expect(page.getByTestId('relock-correction-mode')).toBeVisible();
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-correction-reason.png', fullPage: true });
  await page.getByTestId('relock-correction-mode').click();
  await expect(page.getByTestId('correction-reason-input')).toBeVisible();

  await page.goto(`/campaigns/${campaignId}`);
  await expect(page.getByTestId('campaign-detail-heading')).toBeVisible();
  await expect(page.getByTestId('suspend-session')).toBeVisible();
  await expect(page.getByTestId('resume-session')).toHaveCount(0);
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-session-suspend-only.png', fullPage: true });
});

test('FQA-R06 confirm clears draft UI before slow narration', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await dismissIntroIfPresent(page);
  await enterAccountFromShell(page);
  await seatAndOpenTable(page, 'FQAR06');
  await expect(page.getByTestId('begin-adventure')).toBeVisible();
  await page.getByTestId('begin-adventure').click();
  await expect(page.getByTestId('confirm-intent-intercept')).toBeVisible();
  await expect(page.getByTestId('cancel-intent-intercept')).toBeVisible();
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-batch3-r06-before-confirm.png' });
  const started = Date.now();
  await page.getByTestId('confirm-intent-intercept').click();
  await expect
    .poll(
      async () => {
        const cancel = await page.getByTestId('cancel-intent-intercept').count();
        const resolving = await page.getByTestId('intent-intercept-resolving').count();
        const confirm = page.getByTestId('confirm-intent-intercept');
        const confirmCount = await confirm.count();
        if (cancel > 0) return 'cancel-still-visible';
        if (resolving > 0) return 'resolving';
        if (confirmCount === 0) return 'cleared';
        const label = await confirm.innerText();
        const disabled = await confirm.getAttribute('aria-disabled');
        if (disabled === 'true' && /Resolving/i.test(label)) return 'resolving';
        return 'pending';
      },
      { timeout: 3_000 },
    )
    .toMatch(/^(resolving|cleared)$/);
  const clearMs = Date.now() - started;
  expect(clearMs).toBeLessThan(2_500);
  await page.screenshot({ path: '/opt/cursor/artifacts/fqa-batch3-r06-confirm-clear.png' });
  await page.waitForTimeout(2_000);
  await expect(page.getByTestId('cancel-intent-intercept')).toHaveCount(0);
});
