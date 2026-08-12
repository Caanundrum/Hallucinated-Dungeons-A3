/**
 * Independent QA browser validation of Phase 0 candidate cand-0f810c6c26d8.
 *
 * These scenarios are QA-authored and operate the rendered page the way a
 * suspicious player would. Nothing here reuses Builder test code, and no
 * verdict below is taken from reading source: each assertion is made against
 * what the running page actually did.
 */

import { expect, test, type Page, type Request } from '@playwright/test';

const ARENA = 'http://127.0.0.1:5274';
const CANDIDATE = 'cand-0f810c6c26d8';
const EVIDENCE = '/workspace/QA/evidence/ui';

const el = {
  candidateId: '[data-testid="candidate-id"]',
  environmentClass: '[data-testid="environment-class"]',
  enter: '[data-testid="enter-arena"]',
  leave: '[data-testid="leave-arena"]',
  accountId: '[data-testid="account-id"]',
  noteInput: '[data-testid="note-input"]',
  submit: '[data-testid="record-submit"]',
  refresh: '[data-testid="refresh-projection"]',
  retry: '[data-testid="retry-submission"]',
  recordItem: '[data-testid="record-item"]',
  recordNote: '[data-testid="record-note"]',
  error: '[data-testid="error-message"]',
  notice: '[data-testid="notice-message"]',
  emptyState: '[data-testid="empty-state"]',
  projectionVersion: '[data-testid="projection-version"]',
  staleBanner: '[data-testid="stale-candidate-banner"]',
  liveRegion: '[data-testid="live-region"]',
};

/** Opens the page and signs in through the real control, as a player would. */
async function enterArena(page: Page): Promise<string> {
  await page.goto(ARENA);
  await expect(page.locator(el.candidateId)).toHaveText(CANDIDATE);
  await page.click(el.enter);
  await expect(page.locator(el.accountId)).toBeVisible();
  return (await page.locator(el.accountId).innerText()).trim();
}

async function recordNote(page: Page, note: string): Promise<void> {
  await page.fill(el.noteInput, note);
  await page.click(el.submit);
}

/** Notes currently rendered in the stored-records list, newest first. */
async function renderedNotes(page: Page): Promise<string[]> {
  return page.locator(el.recordNote).allInnerTexts();
}

test.describe('Phase 0 independent QA — rendered page', () => {
  test('QA-S01 ordinary journey: enter, record, see server truth, refresh, recover', async ({
    page,
  }) => {
    await page.goto(ARENA);

    // The page must honestly identify what is running before anything else.
    await expect(page.locator(el.candidateId)).toHaveText(CANDIDATE);
    await expect(page.locator(el.environmentClass)).toHaveText('local');
    await expect(page.locator(el.enter)).toBeVisible();
    await expect(page.locator(el.noteInput)).toHaveCount(0);
    await page.screenshot({ path: `${EVIDENCE}/s01-01-first-visit.png`, fullPage: true });

    const accountId = await enterArena(page);
    expect(accountId).toMatch(/^dev-[0-9a-f-]{36}$/);
    await expect(page.locator(el.emptyState)).toBeVisible();
    await expect(page.locator(el.projectionVersion)).toHaveText('0');

    await recordNote(page, 'QA first foundation check');
    await expect(page.locator(el.recordItem)).toHaveCount(1);
    await expect(page.locator(el.recordNote).first()).toHaveText('QA first foundation check');
    await expect(page.locator(el.projectionVersion)).toHaveText('1');
    await expect(page.locator(el.notice)).toContainText('Recorded sequence 1');
    await expect(page.locator(el.noteInput)).toHaveValue('');

    // The rendered row must carry server-assigned facts the browser could not
    // have invented: a check id and a recorded timestamp.
    const meta = await page.locator(`${el.recordItem} .record-meta`).first().innerText();
    expect(meta).toMatch(/Sequence 1/);
    expect(meta).toMatch(/id [0-9a-f-]{36}/);

    await recordNote(page, 'QA second foundation check');
    await expect(page.locator(el.recordItem)).toHaveCount(2);
    await expect(page.locator(el.projectionVersion)).toHaveText('2');
    await page.screenshot({ path: `${EVIDENCE}/s01-02-two-records.png`, fullPage: true });

    // Refresh: same identity, same records, no re-entry required.
    await page.reload();
    await expect(page.locator(el.accountId)).toHaveText(accountId);
    await expect(page.locator(el.recordItem)).toHaveCount(2);
    await expect(page.locator(el.projectionVersion)).toHaveText('2');
    expect(await renderedNotes(page)).toEqual([
      'QA second foundation check',
      'QA first foundation check',
    ]);
    await page.screenshot({ path: `${EVIDENCE}/s01-03-after-refresh.png`, fullPage: true });

    // A brand-new tab in the same browser profile must recover the same state.
    const secondTab = await page.context().newPage();
    await secondTab.goto(ARENA);
    await expect(secondTab.locator(el.accountId)).toHaveText(accountId);
    await expect(secondTab.locator(el.recordItem)).toHaveCount(2);
    await secondTab.close();
  });

  test('QA-S02 duplicate submission: rapid double-click cannot commit twice', async ({ page }) => {
    await enterArena(page);

    const posts: Request[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/foundation-checks')) {
        posts.push(request);
      }
    });

    // Hold the write open so the double-click lands while it is in flight.
    await page.route('**/api/foundation-checks', async (route) => {
      if (route.request().method() === 'POST') {
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      await route.continue();
    });

    await page.fill(el.noteInput, 'QA rapid double click');
    // Two clicks in the same task, before any re-render can intervene.
    await page.$eval(el.submit, (button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await page.click(el.submit, { force: true, timeout: 3000 }).catch(() => undefined);
    await page.click(el.submit, { force: true, timeout: 3000 }).catch(() => undefined);

    await expect(page.locator(el.notice)).toContainText('Recorded sequence', { timeout: 20_000 });
    await page.unroute('**/api/foundation-checks');

    await page.click(el.refresh);
    await expect(page.locator(el.notice)).toContainText('Reloaded');
    const notes = await renderedNotes(page);
    expect(notes.filter((n) => n === 'QA rapid double click')).toHaveLength(1);
    expect(await page.locator(el.projectionVersion).innerText()).toBe('1');
    await page.screenshot({ path: `${EVIDENCE}/s02-01-double-click-one-record.png`, fullPage: true });

    // Whatever reached the network, the requestId must have been reused.
    const requestIds = posts.map((r) => {
      try {
        return JSON.parse(r.postData() ?? '{}').requestId as string;
      } catch {
        return 'unparsed';
      }
    });
    expect(new Set(requestIds).size).toBeLessThanOrEqual(1);
  });

  test('QA-S02b repeated Enter keypresses cannot commit twice', async ({ page }) => {
    await enterArena(page);
    await page.route('**/api/foundation-checks', async (route) => {
      if (route.request().method() === 'POST') {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      await route.continue();
    });

    await page.fill(el.noteInput, 'QA enter key spam');
    await page.focus(el.noteInput);
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Enter');
    }

    await expect(page.locator(el.notice)).toContainText('Recorded sequence', { timeout: 20_000 });
    await page.unroute('**/api/foundation-checks');
    await page.click(el.refresh);
    const notes = await renderedNotes(page);
    expect(notes.filter((n) => n === 'QA enter key spam')).toHaveLength(1);
  });

  test('QA-S02c a lost response plus retry commits exactly one record', async ({ page }) => {
    await enterArena(page);

    let interceptedOnce = false;
    let serverCommitted = false;
    await page.route('**/api/foundation-checks', async (route) => {
      if (route.request().method() === 'POST' && !interceptedOnce) {
        interceptedOnce = true;
        // Let the server really commit, then destroy the response so the page
        // sees a network failure and cannot know whether the write happened.
        const response = await route.fetch();
        serverCommitted = response.status() === 201;
        await route.abort('connectionfailed');
        return;
      }
      await route.continue();
    });

    await recordNote(page, 'QA lost response retry');
    await expect(page.locator(el.error)).toBeVisible();
    expect(serverCommitted).toBe(true);
    await expect(page.locator(el.retry)).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/s02-02-lost-response-retry-offered.png`, fullPage: true });

    await page.click(el.retry);
    await expect(page.locator(el.notice)).toBeVisible({ timeout: 20_000 });
    const notice = await page.locator(el.notice).innerText();
    expect(notice).toMatch(/already recorded|Nothing was written twice/i);

    await page.click(el.refresh);
    const notes = await renderedNotes(page);
    expect(notes.filter((n) => n === 'QA lost response retry')).toHaveLength(1);
    await expect(page.locator(el.projectionVersion)).toHaveText('1');
    await page.screenshot({ path: `${EVIDENCE}/s02-03-retry-no-duplicate.png`, fullPage: true });
  });

  test('QA-S02d submitting the same text twice as two separate intents', async ({ page }) => {
    await enterArena(page);
    await recordNote(page, 'identical text');
    await expect(page.locator(el.recordItem)).toHaveCount(1);
    await recordNote(page, 'identical text');
    await expect(page.locator(el.recordItem)).toHaveCount(2);

    // Two deliberate submissions are two records. That is the documented
    // contract (idempotency is per attempt, not per text), and the page says so.
    const hint = await page.locator('#note-hint').innerText();
    expect(hint).toMatch(/same attempt twice returns\s+the original record/i);
    await page.screenshot({ path: `${EVIDENCE}/s02-04-two-intents-two-records.png`, fullPage: true });
  });

  test('QA-S04 stale page: a submission naming another candidate is refused and explained', async ({
    page,
  }) => {
    await enterArena(page);
    await recordNote(page, 'before going stale');
    await expect(page.locator(el.recordItem)).toHaveCount(1);

    // Simulate a page left open across a candidate change.
    await page.route('**/api/foundation-checks', async (route) => {
      if (route.request().method() === 'POST') {
        const headers = { ...route.request().headers(), 'x-hd-candidate': 'cand-000000000000' };
        await route.continue({ headers });
        return;
      }
      await route.continue();
    });

    await recordNote(page, 'submitted from a stale page');
    await expect(page.locator(el.error)).toBeVisible();
    const errorCode = await page.locator(el.error).getAttribute('data-error-code');
    expect(errorCode).toBe('CANDIDATE_MISMATCH');
    const errorText = await page.locator(el.error).innerText();
    expect(errorText).toMatch(/different candidate/i);
    expect(errorText).toMatch(/reload/i);

    await expect(page.locator(el.staleBanner)).toBeVisible();
    // A retry would be dishonest here: reloading is the only real recovery.
    await expect(page.locator(el.retry)).toHaveCount(0);
    await page.screenshot({ path: `${EVIDENCE}/s04-01-stale-candidate-refused.png`, fullPage: true });

    await page.unroute('**/api/foundation-checks');
    await page.click(el.refresh);
    const notes = await renderedNotes(page);
    expect(notes).not.toContain('submitted from a stale page');
    expect(notes).toEqual(['before going stale']);
  });

  test('QA-S05 direct navigation to unlinked routes exposes nothing', async ({ page }) => {
    // A signed-in session makes this the dangerous case: if an unlinked route
    // leaked account state, it would leak it to a browser that has a cookie.
    const accountId = await enterArena(page);
    await recordNote(page, 'private note behind direct navigation');
    await expect(page.locator(el.recordItem)).toHaveCount(1);

    const paths = ['/admin', '/dist', '/api/foundation-checks', '/../../etc/passwd', '/.env', '/assets/../../../etc/passwd'];
    const observations: Array<{ path: string; status: number | undefined; leaked: boolean; hasFakeUi: boolean }> = [];

    for (const path of paths) {
      const response = await page.goto(`${ARENA}${path}`, { waitUntil: 'domcontentloaded' });
      const body = await page.content();
      const leaked =
        body.includes(accountId) ||
        body.includes('private note behind direct navigation') ||
        /root:x:0:0/.test(body);
      // A "fake page" would be an arena-looking UI with controls on a route
      // that has no behaviour behind it.
      const hasFakeUi = (await page.locator(`${el.enter}, ${el.submit}, ${el.noteInput}`).count()) > 0;
      observations.push({ path, status: response?.status(), leaked, hasFakeUi });
    }

    // /api/foundation-checks is the one route that legitimately returns this
    // account's own data as JSON to its own authenticated browser; it is not a
    // leak, but it must not be a rendered page either.
    for (const observation of observations) {
      expect.soft(observation.hasFakeUi, `${observation.path} rendered arena controls`).toBe(false);
      if (observation.path !== '/api/foundation-checks') {
        expect.soft(observation.leaked, `${observation.path} leaked account state`).toBe(false);
        expect.soft(observation.status, `${observation.path} returned a success status`).toBeGreaterThanOrEqual(400);
      }
    }

    await page.goto(`${ARENA}/admin`);
    await expect(page.locator('h1')).toContainText('No page exists at /admin');
    await expect(page.locator('a[href="/"]')).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/s05-01-unknown-route.png`, fullPage: true });

    // The 404 must offer a real way back, not a dead end.
    await page.click('a[href="/"]');
    await expect(page.locator(el.accountId)).toHaveText(accountId);
  });

  test('QA-S06 ownership: a second identity cannot see the first identity records', async ({
    browser,
  }) => {
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const accountA = await enterArena(pageA);
    await recordNote(pageA, 'account A confidential note');
    await expect(pageA.locator(el.recordItem)).toHaveCount(1);
    await pageA.screenshot({ path: `${EVIDENCE}/s06-01-account-a.png`, fullPage: true });

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    const accountB = await enterArena(pageB);
    expect(accountB).not.toBe(accountA);

    await expect(pageB.locator(el.emptyState)).toBeVisible();
    await expect(pageB.locator(el.projectionVersion)).toHaveText('0');
    expect(await pageB.content()).not.toContain('account A confidential note');
    expect(await pageB.content()).not.toContain(accountA);

    await recordNote(pageB, 'account B confidential note');
    await expect(pageB.locator(el.recordItem)).toHaveCount(1);
    expect(await renderedNotes(pageB)).toEqual(['account B confidential note']);
    await pageB.screenshot({ path: `${EVIDENCE}/s06-02-account-b-isolated.png`, fullPage: true });

    // B, from its own authenticated browser, still cannot read A's records.
    const bReadsApi = await pageB.evaluate(async () => {
      const response = await fetch('/api/foundation-checks', { credentials: 'same-origin' });
      return response.json();
    });
    expect(bReadsApi.accountId).toBe(accountB);
    expect(JSON.stringify(bReadsApi)).not.toContain('account A confidential note');

    // A is unaffected by B's activity.
    await pageA.reload();
    await expect(pageA.locator(el.recordItem)).toHaveCount(1);
    expect(await renderedNotes(pageA)).toEqual(['account A confidential note']);

    await contextA.close();
    await contextB.close();
  });

  test('QA-S07 an unauthenticated browser can neither read nor write', async ({ page }) => {
    await page.goto(ARENA);
    await expect(page.locator(el.enter)).toBeVisible();
    // No record surface exists at all before entering.
    await expect(page.locator(el.noteInput)).toHaveCount(0);
    await expect(page.locator(el.submit)).toHaveCount(0);

    const anonymous = await page.evaluate(async () => {
      const read = await fetch('/api/foundation-checks', { credentials: 'same-origin' });
      const write = await fetch('/api/foundation-checks', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-hd-candidate': 'cand-0f810c6c26d8' },
        body: JSON.stringify({
          requestId: '33333333-3333-4333-8333-333333333333',
          note: 'unauthenticated write from the browser',
        }),
      });
      return {
        readStatus: read.status,
        readBody: await read.json(),
        writeStatus: write.status,
        writeBody: await write.json(),
      };
    });

    expect(anonymous.readStatus).toBe(401);
    expect(anonymous.readBody.error).toBe('NOT_AUTHENTICATED');
    expect(anonymous.writeStatus).toBe(401);
    expect(anonymous.writeBody.error).toBe('NOT_AUTHENTICATED');
    await page.screenshot({ path: `${EVIDENCE}/s07-01-signed-out-surface.png`, fullPage: true });
  });

  test('QA-S08 input abuse: validation, over-length, and markup are handled as text', async ({
    page,
  }) => {
    await enterArena(page);

    // Empty submission.
    await page.click(el.submit);
    await expect(page.locator(el.error)).toBeVisible();
    expect(await page.locator(el.error).getAttribute('data-error-code')).toBe('NOTE_EMPTY');
    await expect(page.locator(el.emptyState)).toBeVisible();

    // Whitespace-only submission.
    await recordNote(page, '        ');
    await expect(page.locator(el.error)).toBeVisible();
    expect(await page.locator(el.error).getAttribute('data-error-code')).toBe('NOTE_EMPTY');
    await expect(page.locator(el.emptyState)).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/s08-01-empty-note-refused.png`, fullPage: true });

    // Over-length submission: refused with a specific message, nothing stored.
    await recordNote(page, 'L'.repeat(200));
    await expect(page.locator(el.error)).toBeVisible();
    expect(await page.locator(el.error).getAttribute('data-error-code')).toBe('NOTE_TOO_LONG');
    await expect(page.locator(el.error)).toContainText('120 characters');
    await expect(page.locator(el.emptyState)).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/s08-02-too-long-refused.png`, fullPage: true });

    // Exactly at the limit is accepted.
    await recordNote(page, 'B'.repeat(120));
    await expect(page.locator(el.recordItem)).toHaveCount(1);

    // Script injection. The page builds HTML, so this is the load-bearing check.
    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    await page.addInitScript(() => {
      (window as unknown as { __qaXssFired: boolean }).__qaXssFired = false;
    });

    const payloads = [
      '<img src=x onerror="window.__qaXssFired=true">',
      '<script>window.__qaXssFired=true</script>',
      '"><img src=x onerror="window.__qaXssFired=true">',
      "'><svg onload=\"window.__qaXssFired=true\">",
      '<a href="javascript:window.__qaXssFired=true">click</a>',
    ];

    for (const payload of payloads) {
      await recordNote(page, payload);
      await expect(page.locator(el.notice)).toContainText('Recorded sequence');
    }

    await page.reload();
    await page.waitForSelector(el.recordItem);

    const injection = await page.evaluate(() => ({
      fired: (window as unknown as { __qaXssFired?: boolean }).__qaXssFired === true,
      injectedImages: document.querySelectorAll('#app img').length,
      injectedSvg: document.querySelectorAll('#app svg').length,
      injectedAnchors: document.querySelectorAll('#app a[href^="javascript:"]').length,
      injectedScripts: document.querySelectorAll('#app script').length,
      onErrorAttributes: document.querySelectorAll('#app [onerror], #app [onload]').length,
    }));

    expect(injection.fired).toBe(false);
    expect(injection.injectedImages).toBe(0);
    expect(injection.injectedSvg).toBe(0);
    expect(injection.injectedAnchors).toBe(0);
    expect(injection.injectedScripts).toBe(0);
    expect(injection.onErrorAttributes).toBe(0);
    expect(dialogs).toHaveLength(0);

    // Each payload must be rendered back as literal, visible text.
    const notes = await renderedNotes(page);
    for (const payload of payloads) {
      expect(notes).toContain(payload);
    }
    await page.screenshot({ path: `${EVIDENCE}/s08-03-markup-rendered-as-text.png`, fullPage: true });

    // The payload also round-trips safely through the input value attribute,
    // which is re-rendered on every state change.
    await page.fill(el.noteInput, '"><img src=x onerror="window.__qaXssFired=true">');
    await page.click(el.refresh);
    await expect(page.locator(el.notice)).toBeVisible();
    const afterRerender = await page.evaluate(
      () => (window as unknown as { __qaXssFired?: boolean }).__qaXssFired === true,
    );
    expect(afterRerender).toBe(false);
  });

  test('QA-S09 sign out ends the session server-side and the cookie cannot be replayed', async ({
    page,
    context,
  }) => {
    const accountId = await enterArena(page);
    await recordNote(page, 'note that must survive sign out');
    await expect(page.locator(el.recordItem)).toHaveCount(1);

    const cookiesBefore = await context.cookies(ARENA);
    const sessionCookie = cookiesBefore.find((c) => c.name === 'hd_dev_session');
    expect(sessionCookie, 'a session cookie should exist while signed in').toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe('Strict');
    const stolenValue = sessionCookie!.value;

    await page.click(el.leave);
    await expect(page.locator(el.enter)).toBeVisible();
    await expect(page.locator(el.noteInput)).toHaveCount(0);
    await page.screenshot({ path: `${EVIDENCE}/s09-01-signed-out.png`, fullPage: true });

    // Whether the sign-out is confirmed on screen is asserted separately in
    // QA-S14; this scenario is about whether the session is really dead.
    test.info().annotations.push({
      type: 'post-sign-out-confirmation',
      description: JSON.stringify({
        visibleNoticeElements: await page.locator(el.notice).count(),
        liveRegionText: (await page.locator(el.liveRegion).innerText()).trim(),
      }),
    });

    const cookiesAfter = await context.cookies(ARENA);
    expect(cookiesAfter.find((c) => c.name === 'hd_dev_session')).toBeUndefined();

    // Refresh must not silently restore the session.
    await page.reload();
    await expect(page.locator(el.enter)).toBeVisible();
    await expect(page.locator(el.accountId)).toHaveCount(0);

    // Replant the exact pre-sign-out cookie and try to use it.
    await context.addCookies([
      {
        name: 'hd_dev_session',
        value: stolenValue,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    await page.reload();
    await expect(page.locator(el.enter)).toBeVisible();
    await expect(page.locator(el.accountId)).toHaveCount(0);

    const replay = await page.evaluate(async () => {
      const read = await fetch('/api/foundation-checks', { credentials: 'same-origin' });
      const write = await fetch('/api/foundation-checks', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-hd-candidate': 'cand-0f810c6c26d8' },
        body: JSON.stringify({
          requestId: '44444444-4444-4444-8444-444444444444',
          note: 'written with a revoked cookie',
        }),
      });
      return { readStatus: read.status, writeStatus: write.status };
    });
    expect(replay.readStatus).toBe(401);
    expect(replay.writeStatus).toBe(401);
    await page.screenshot({ path: `${EVIDENCE}/s09-02-revoked-cookie-refused.png`, fullPage: true });

    // A new sign-in is a genuinely new identity, not a resurrection of the old.
    await page.click(el.enter);
    await expect(page.locator(el.accountId)).toBeVisible();
    const newAccount = (await page.locator(el.accountId).innerText()).trim();
    expect(newAccount).not.toBe(accountId);
    await expect(page.locator(el.emptyState)).toBeVisible();
  });

  test('QA-S10 the whole journey is operable with the keyboard alone', async ({ page }) => {
    await page.goto(ARENA);
    await expect(page.locator(el.candidateId)).toHaveText(CANDIDATE);

    // Reach and use the skip link first, as a keyboard user would.
    await page.keyboard.press('Tab');
    const firstStop = await page.evaluate(() => document.activeElement?.className ?? '');
    expect(firstStop).toContain('skip-link');

    // Tab to "Enter the Local Arena" and activate it with the keyboard.
    const reachedEnter = await tabTo(page, '[data-testid="enter-arena"]');
    expect(reachedEnter, 'Enter the Local Arena should be reachable by Tab').toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.locator(el.accountId)).toBeVisible();

    // Type the note and submit, keyboard only.
    const reachedInput = await tabTo(page, '[data-testid="note-input"]');
    expect(reachedInput, 'the note field should be reachable by Tab').toBe(true);
    await page.keyboard.type('keyboard only submission');
    await page.keyboard.press('Enter');
    await expect(page.locator(el.recordItem)).toHaveCount(1);
    await expect(page.locator(el.recordNote).first()).toHaveText('keyboard only submission');
    await page.screenshot({ path: `${EVIDENCE}/s10-01-keyboard-record.png`, fullPage: true });

    // Where does focus land after the page re-renders itself?
    const focusAfterSubmit = await page.evaluate(() => ({
      tag: document.activeElement?.tagName ?? null,
      testId: document.activeElement?.getAttribute('data-testid') ?? null,
    }));

    // The confirmation must be perceivable, not only visual.
    const live = page.locator(el.liveRegion);
    await expect(live).toHaveAttribute('aria-live', 'polite');
    await expect(live).toContainText('Recorded sequence 1');
    await expect(page.locator(el.notice)).toBeVisible();

    // Sign out with the keyboard to close the loop.
    const reachedLeave = await tabTo(page, '[data-testid="leave-arena"]');
    expect(reachedLeave, 'Leave the Local Arena should be reachable by Tab').toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.locator(el.enter)).toBeVisible();

    // Recorded for the findings report rather than asserted as a pass/fail:
    // focus placement after a full re-render is an accessibility quality point.
    test.info().annotations.push({
      type: 'focus-after-submit',
      description: JSON.stringify(focusAfterSubmit),
    });
  });

  test('QA-S11 honesty: every rendered control does something real', async ({ page }) => {
    await page.goto(ARENA);

    const signedOutControls = await interactiveInventory(page);
    expect(signedOutControls.sort()).toEqual(
      ['a:Skip to main content', 'button:Enter the Local Arena'].sort(),
    );

    // The page must not promise the game it is not.
    const introText = await page.locator('header').innerText();
    expect(introText).toMatch(/Phase 0/i);
    expect(introText).toMatch(/not the game/i);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(/\b(create a character|start a campaign|roll dice|game director is (now )?(live|active))\b/i);

    await page.click(el.enter);
    await expect(page.locator(el.accountId)).toBeVisible();

    const signedInControls = await interactiveInventory(page);
    expect(signedInControls.sort()).toEqual(
      [
        'a:Skip to main content',
        'button:Leave the Local Arena',
        'button:Record foundation check',
        'button:Reload from server',
        'input:note-input',
      ].sort(),
    );

    // Each control must produce an observable effect.
    await page.click(el.refresh);
    await expect(page.locator(el.notice)).toContainText('Reloaded the stored projection');

    await recordNote(page, 'honesty check note');
    await expect(page.locator(el.recordItem)).toHaveCount(1);

    // The claim the page makes about itself: the list is server truth. Prove
    // it by deleting the rendered row locally and reloading from the server.
    await page.evaluate(() => document.querySelector('[data-testid="record-item"]')?.remove());
    await expect(page.locator(el.recordItem)).toHaveCount(0);
    await page.click(el.refresh);
    await expect(page.locator(el.recordItem)).toHaveCount(1);

    // Typing alone must never add a row.
    await page.fill(el.noteInput, 'typed but never submitted');
    await expect(page.locator(el.recordItem)).toHaveCount(1);
    expect(await renderedNotes(page)).not.toContain('typed but never submitted');

    const footer = await page.locator('footer').innerText();
    expect(footer).toMatch(/Local Execution Environment/i);
    expect(footer).toMatch(/disposable/i);
    await page.screenshot({ path: `${EVIDENCE}/s11-01-signed-in-controls.png`, fullPage: true });
  });

  test('QA-S12 a real cross-origin page cannot read or write arena data', async ({ page, context }) => {
    // Establish a genuine session first, so the browser has a cookie to abuse.
    await enterArena(page);
    await recordNote(page, 'cross origin target note');
    await expect(page.locator(el.recordItem)).toHaveCount(1);

    const attacker = await context.newPage();
    await attacker.route('http://evil.test/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><body><h1>attacker page</h1></body></html>',
      });
    });
    await attacker.goto('http://evil.test/');

    const attackResult = await attacker.evaluate(async () => {
      const attempt = async (init: RequestInit) => {
        try {
          const response = await fetch('http://127.0.0.1:5274/api/foundation-checks', init);
          return { blocked: false, status: response.status, body: await response.text() };
        } catch (error) {
          return { blocked: true, reason: String(error) };
        }
      };
      return {
        readWithCredentials: await attempt({ credentials: 'include' }),
        writeWithCredentials: await attempt({
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-hd-candidate': 'cand-0f810c6c26d8' },
          body: JSON.stringify({
            requestId: '55555555-5555-4555-8555-555555555555',
            note: 'written from evil.test',
          }),
        }),
      };
    });

    // Either the browser blocked it or the server refused it; in no case may
    // the attacker page obtain records.
    expect(JSON.stringify(attackResult)).not.toContain('cross origin target note');
    expect(
      attackResult.readWithCredentials.blocked || attackResult.readWithCredentials.status === 403,
    ).toBe(true);
    expect(
      attackResult.writeWithCredentials.blocked || attackResult.writeWithCredentials.status === 403,
    ).toBe(true);

    test.info().annotations.push({
      type: 'cross-origin-outcome',
      description: JSON.stringify(attackResult),
    });

    await attacker.close();

    // The victim account is untouched.
    await page.reload();
    await expect(page.locator(el.recordItem)).toHaveCount(1);
    expect(await renderedNotes(page)).toEqual(['cross origin target note']);
    await page.screenshot({ path: `${EVIDENCE}/s12-01-cross-origin-no-effect.png`, fullPage: true });
  });

  test('QA-S13 a server failure is explained on the page and offers a real retry', async ({
    page,
  }) => {
    await enterArena(page);

    let failNext = true;
    await page.route('**/api/foundation-checks', async (route) => {
      if (route.request().method() === 'POST' && failNext) {
        failNext = false;
        await route.abort('connectionfailed');
        return;
      }
      await route.continue();
    });

    await recordNote(page, 'note behind a broken connection');
    await expect(page.locator(el.error)).toBeVisible();
    const errorText = await page.locator(el.error).innerText();
    expect(errorText.length).toBeGreaterThan(20);
    expect(errorText).toMatch(/did not respond|Confirm it is running/i);
    // The failure must not leave a phantom row behind.
    await expect(page.locator(el.emptyState)).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/s13-01-failure-explained.png`, fullPage: true });

    await page.click(el.retry);
    await expect(page.locator(el.recordItem)).toHaveCount(1);
    await expect(page.locator(el.recordNote).first()).toHaveText('note behind a broken connection');
    await expect(page.locator(el.error)).toHaveCount(0);
    await page.screenshot({ path: `${EVIDENCE}/s13-02-retry-succeeded.png`, fullPage: true });
  });
});

test.describe('Phase 0 independent QA — failure explanation on the page', () => {
  test('QA-S14 signing out is confirmed on screen', async ({ page }) => {
    await enterArena(page);
    await recordNote(page, 'note before leaving');
    await expect(page.locator(el.recordItem)).toHaveCount(1);

    await page.click(el.leave);
    await expect(page.locator(el.enter)).toBeVisible();

    // The page composes a confirmation ("Session ended. The stored records
    // remain owned by that account."). A player should be able to read it.
    const visibleText = await page.locator('main').innerText();
    const liveRegionText = (await page.locator(el.liveRegion).innerText()).trim();

    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({ visibleText, liveRegionText }),
    });

    await page.screenshot({ path: `${EVIDENCE}/s14-01-sign-out-confirmation.png`, fullPage: true });
    expect(visibleText, 'the sign-out confirmation should be readable on the page').toContain(
      'Session ended',
    );
  });

  test('QA-S15 an expired session is explained on the page with a way forward', async ({ page }) => {
    await enterArena(page);
    await recordNote(page, 'note recorded while the session was alive');
    await expect(page.locator(el.recordItem)).toHaveCount(1);

    // Make the very next write look exactly like a session that aged out.
    await page.route('**/api/foundation-checks', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 401,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({
            error: 'SESSION_EXPIRED',
            message: 'This development session expired. Enter the Local Arena again.',
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.fill(el.noteInput, 'note the player is about to lose');
    await page.screenshot({ path: `${EVIDENCE}/s15-00-before-expiry.png`, fullPage: true });
    await page.click(el.submit);

    // Give the page time to settle into whatever it decided to show.
    await expect(page.locator(el.enter)).toBeVisible();
    await page.waitForTimeout(500);

    const observed = {
      visibleMainText: await page.locator('main').innerText(),
      errorElements: await page.locator(el.error).count(),
      noticeElements: await page.locator(el.notice).count(),
      retryButtons: await page.locator(el.retry).count(),
      noteInputs: await page.locator(el.noteInput).count(),
      liveRegionText: (await page.locator(el.liveRegion).innerText()).trim(),
      liveRegionVisibleToSightedUser: await page
        .locator(el.liveRegion)
        .evaluate((node) => {
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return {
            className: node.className,
            width: rect.width,
            height: rect.height,
            clip: style.clip,
            position: style.position,
          };
        }),
    };
    test.info().annotations.push({ type: 'observed', description: JSON.stringify(observed) });

    await page.screenshot({ path: `${EVIDENCE}/s15-01-session-expiry-outcome.png`, fullPage: true });

    // Phase 0 promises failures are explained on the page with a real retry
    // path. Both halves are asserted here.
    expect(
      observed.visibleMainText,
      'the expiry reason should be readable on the page',
    ).toMatch(/session expired/i);
    expect(observed.errorElements, 'an error message element should be rendered').toBeGreaterThan(0);
  });

  test('QA-S16 the same invisibility affects a read that hits an expired session', async ({
    page,
  }) => {
    await enterArena(page);
    await recordNote(page, 'note before the read fails');
    await expect(page.locator(el.recordItem)).toHaveCount(1);

    // End the session for real, server-side, while this tab still shows a
    // signed-in page. This is what a 4-hour expiry looks like to the tab.
    const ended = await page.evaluate(async () => {
      const response = await fetch('/api/session', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'x-hd-candidate': 'cand-0f810c6c26d8' },
      });
      return response.status;
    });
    expect(ended).toBe(204);

    // The player, unaware, presses the page's own reload control.
    await page.click(el.refresh);
    await expect(page.locator(el.enter)).toBeVisible();
    await page.waitForTimeout(300);

    const observed = {
      visibleMainText: await page.locator('main').innerText(),
      errorElements: await page.locator(el.error).count(),
      liveRegionText: (await page.locator(el.liveRegion).innerText()).trim(),
    };
    test.info().annotations.push({ type: 'observed', description: JSON.stringify(observed) });
    await page.screenshot({ path: `${EVIDENCE}/s16-01-expired-read-outcome.png`, fullPage: true });

    expect(
      observed.visibleMainText,
      'the page should say why it stopped showing the records',
    ).toMatch(/enter the local arena before|session expired/i);
  });
});

test.describe('Phase 0 independent QA — announcement and focus behaviour', () => {
  test('QA-S17 the polite live region survives a state change so it can announce', async ({
    page,
  }) => {
    await enterArena(page);

    // Tag the live region node, then cause a state change, then see whether the
    // tagged node is still the one on the page. A screen reader only announces
    // a polite region that already existed when its text changed.
    await page.evaluate(() => {
      const region = document.querySelector('[data-testid="live-region"]');
      (region as HTMLElement & { __qaTag?: string }).__qaTag = 'original';
    });

    await recordNote(page, 'live region persistence probe');
    await expect(page.locator(el.recordItem)).toHaveCount(1);

    const survived = await page.evaluate(() => {
      const region = document.querySelector('[data-testid="live-region"]');
      return {
        sameNode: (region as HTMLElement & { __qaTag?: string })?.__qaTag === 'original',
        text: (region?.textContent ?? '').trim(),
      };
    });
    test.info().annotations.push({ type: 'observed', description: JSON.stringify(survived) });
    expect(survived.sameNode, 'the live region should persist across renders').toBe(true);
  });

  test('QA-S18 focus is retained near the control the player just used', async ({ page }) => {
    await enterArena(page);
    await page.focus(el.noteInput);
    await page.keyboard.type('focus retention probe');
    await page.keyboard.press('Enter');
    await expect(page.locator(el.recordItem)).toHaveCount(1);

    const afterSubmit = await page.evaluate(() => ({
      tag: document.activeElement?.tagName ?? null,
      testId: document.activeElement?.getAttribute('data-testid') ?? null,
    }));

    await page.click(el.refresh);
    await expect(page.locator(el.notice)).toContainText('Reloaded');
    const afterRefresh = await page.evaluate(() => ({
      tag: document.activeElement?.tagName ?? null,
      testId: document.activeElement?.getAttribute('data-testid') ?? null,
    }));

    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({ afterSubmit, afterRefresh }),
    });

    expect(afterSubmit.tag, 'focus should not be dumped on <body> after submitting').not.toBe(
      'BODY',
    );
  });
});

test.describe('Phase 0 independent QA — completeness of what is shown', () => {
  test('QA-S19 a long record history is presented honestly', async ({ page }) => {
    test.setTimeout(120_000);
    await enterArena(page);

    for (let i = 1; i <= 23; i += 1) {
      await recordNote(page, `bulk note ${String(i).padStart(2, '0')}`);
      await expect(page.locator(el.notice)).toContainText(`Recorded sequence ${i}`);
    }

    await page.reload();
    await expect(page.locator(el.projectionVersion)).toHaveText('23');

    const shown = await page.locator(el.recordItem).count();
    const notes = await renderedNotes(page);
    const bodyText = await page.locator('main').innerText();
    const observed = {
      recordsWritten: 23,
      recordsRendered: shown,
      oldestRendered: notes[notes.length - 1],
      newestRendered: notes[0],
      mentionsTruncation: /showing|most recent|older|of 23|20 of/i.test(bodyText),
    };
    test.info().annotations.push({ type: 'observed', description: JSON.stringify(observed) });
    await page.screenshot({ path: `${EVIDENCE}/s19-01-long-history.png`, fullPage: true });

    // Either show everything, or say that the list is partial.
    expect(
      shown === 23 || observed.mentionsTruncation,
      'a truncated list should tell the player it is truncated',
    ).toBe(true);
  });
});

test.describe('Phase 0 independent QA — recovery after an expired session', () => {
  test('QA-S20 what recovery is actually available after the silent sign-out', async ({ page }) => {
    const firstAccount = await enterArena(page);
    await recordNote(page, 'note recorded before expiry');
    await expect(page.locator(el.recordItem)).toHaveCount(1);

    await page.evaluate(async () => {
      await fetch('/api/session', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'x-hd-candidate': 'cand-0f810c6c26d8' },
      });
    });

    await page.fill(el.noteInput, 'the note in flight');
    await page.click(el.submit);
    await expect(page.locator(el.enter)).toBeVisible();

    // The only control left is "Enter the Local Arena". Take it and see what
    // the player gets back.
    await page.click(el.enter);
    await expect(page.locator(el.accountId)).toBeVisible();
    const secondAccount = (await page.locator(el.accountId).innerText()).trim();

    const recovery = {
      sameAccount: secondAccount === firstAccount,
      noteInputRestoredTo: await page.locator(el.noteInput).inputValue(),
      recordsVisible: await page.locator(el.recordItem).count(),
      renderedNotes: await renderedNotes(page),
    };
    test.info().annotations.push({ type: 'observed', description: JSON.stringify(recovery) });
    await page.screenshot({ path: `${EVIDENCE}/s20-01-after-re-entering.png`, fullPage: true });

    // Documented, not asserted as a defect: a new development identity is the
    // designed behaviour. The finding is that none of this was explained.
    expect(recovery.sameAccount).toBe(false);
  });
});

/** Presses Tab until the given selector holds focus, or gives up. */
async function tabTo(page: Page, selector: string, maxPresses = 12): Promise<boolean> {
  for (let i = 0; i < maxPresses; i += 1) {
    const focused = await page.evaluate(
      (target) => document.activeElement === document.querySelector(target),
      selector,
    );
    if (focused) {
      return true;
    }
    await page.keyboard.press('Tab');
  }
  return page.evaluate(
    (target) => document.activeElement === document.querySelector(target),
    selector,
  );
}

/** Lists every focusable control the page currently renders. */
async function interactiveInventory(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const nodes = document.querySelectorAll('a[href], button, input, select, textarea');
    return Array.from(nodes).map((node) => {
      const tag = node.tagName.toLowerCase();
      const label =
        tag === 'input'
          ? (node.getAttribute('data-testid') ?? node.getAttribute('name') ?? 'unnamed')
          : (node.textContent ?? '').trim().replace(/\s+/g, ' ');
      return `${tag}:${label}`;
    });
  });
}
