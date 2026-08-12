/**
 * Independent QA retest of the Phase 0 remediation, candidate cand-882c6c2fe4a3.
 *
 * Two jobs:
 *
 * 1. Decide whether each of P0-QA-001 … P0-QA-008 is actually fixed, judged by
 *    operating the rendered page rather than by reading the diff or trusting
 *    the Builder's remediation report.
 * 2. Hunt for defects the fixes introduced. The remediation touched the whole
 *    client render path, swapped the `disabled` attribute for `aria-disabled`,
 *    added a focus-restoring re-render, changed the projection shape, and added
 *    a restrictive Content-Security-Policy — all of which can break a page
 *    quietly.
 */

import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

const ARENA = 'http://127.0.0.1:5274';
const CANDIDATE = process.env.QA_CANDIDATE_ID ?? 'cand-882c6c2fe4a3';
const EVIDENCE = process.env.QA_EVIDENCE_DIR ?? '/workspace/QA/evidence/retest-cand-882c6c2fe4a3/ui';

const el = {
  candidateId: '[data-testid="candidate-id"]',
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
  truncation: '[data-testid="truncation-notice"]',
  liveRegion: '[data-testid="live-region"]',
};

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

/** Ends the session server-side while the tab keeps showing a signed-in page. */
async function endSessionServerSide(page: Page): Promise<number> {
  return page.evaluate(async (candidateId) => {
    const response = await fetch('/api/session', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'x-hd-candidate': candidateId },
    });
    return response.status;
  }, CANDIDATE);
}

/**
 * Proves a message is genuinely readable rather than parked in a clipped
 * offscreen region — the exact dodge that made P0-QA-001 invisible.
 */
async function visibilityOf(page: Page, selector: string) {
  return page.locator(selector).evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    return {
      text: (node.textContent ?? '').trim().replace(/\s+/g, ' '),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      clip: style.clip,
      clipPath: style.clipPath,
      opacity: style.opacity,
      visibility: style.visibility,
      display: style.display,
      className: node.className,
      insideVisuallyHidden: node.closest('.visually-hidden') !== null,
    };
  });
}

test.describe('Retest — closure of the reported findings', () => {
  test('RT-001a P0-QA-001: a submission into a dead session is explained on screen', async ({
    page,
  }) => {
    await enterArena(page);
    await recordNote(page, 'note recorded while the session was alive');
    await expect(page.locator(el.recordItem)).toHaveCount(1);

    expect(await endSessionServerSide(page)).toBe(204);

    await page.fill(el.noteInput, 'note the player would have lost');
    await page.screenshot({ path: `${EVIDENCE}/rt001-00-before-expiry.png`, fullPage: true });
    await page.click(el.submit);

    // The error must exist, be visible, and not be hidden away.
    await expect(page.locator(el.error)).toBeVisible();
    const errorVisibility = await visibilityOf(page, el.error);
    const mainText = await page.locator('main').innerText();

    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({ errorVisibility, mainText }),
    });
    await page.screenshot({ path: `${EVIDENCE}/rt001-01-expiry-explained.png`, fullPage: true });

    expect(errorVisibility.insideVisuallyHidden).toBe(false);
    expect(errorVisibility.width).toBeGreaterThan(50);
    expect(errorVisibility.height).toBeGreaterThan(10);
    expect(errorVisibility.visibility).toBe('visible');
    expect(mainText).toMatch(/Enter the Local Arena before recording|session expired/i);
    expect(await page.locator(el.error).getAttribute('data-error-code')).toBe('NOT_AUTHENTICATED');

    // The page must still say what to do next.
    await expect(page.locator(el.enter)).toBeVisible();
  });

  test('RT-001b P0-QA-001: a read against a dead session explains itself', async ({ page }) => {
    await enterArena(page);
    await recordNote(page, 'note before the read fails');
    await expect(page.locator(el.recordItem)).toHaveCount(1);

    expect(await endSessionServerSide(page)).toBe(204);
    await page.click(el.refresh);

    await expect(page.locator(el.error)).toBeVisible();
    const errorVisibility = await visibilityOf(page, el.error);
    const mainText = await page.locator('main').innerText();
    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({ errorVisibility, mainText }),
    });
    await page.screenshot({ path: `${EVIDENCE}/rt001-02-dead-read-explained.png`, fullPage: true });

    expect(errorVisibility.insideVisuallyHidden).toBe(false);
    expect(mainText).toMatch(/Enter the Local Arena before recording|session expired/i);
    // The list must not silently persist as though it were still true.
    await expect(page.locator(el.recordItem)).toHaveCount(0);
  });

  test('RT-001c P0-QA-001: the typed note is not thrown away by the failure', async ({ page }) => {
    await enterArena(page);
    expect(await endSessionServerSide(page)).toBe(204);

    await page.fill(el.noteInput, 'text the player typed');
    await page.click(el.submit);
    await expect(page.locator(el.error)).toBeVisible();

    // Signed out, so the field is gone; the text must come back on re-entry
    // rather than being silently discarded.
    await page.click(el.enter);
    await expect(page.locator(el.accountId)).toBeVisible();
    const restored = await page.locator(el.noteInput).inputValue();
    test.info().annotations.push({ type: 'observed', description: JSON.stringify({ restored }) });
    expect(restored).toBe('text the player typed');

    // And it must still be submittable under the new identity.
    await page.click(el.submit);
    await expect(page.locator(el.recordItem)).toHaveCount(1);
    await expect(page.locator(el.recordNote).first()).toHaveText('text the player typed');
    await page.screenshot({ path: `${EVIDENCE}/rt001-03-note-preserved.png`, fullPage: true });
  });

  test('RT-002 P0-QA-002: signing out is confirmed on screen', async ({ page }) => {
    await enterArena(page);
    await recordNote(page, 'note before leaving');
    await expect(page.locator(el.recordItem)).toHaveCount(1);

    await page.click(el.leave);
    await expect(page.locator(el.enter)).toBeVisible();
    await expect(page.locator(el.notice)).toBeVisible();

    const noticeVisibility = await visibilityOf(page, el.notice);
    const mainText = await page.locator('main').innerText();
    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({ noticeVisibility, mainText }),
    });
    await page.screenshot({ path: `${EVIDENCE}/rt002-01-sign-out-confirmed.png`, fullPage: true });

    expect(noticeVisibility.insideVisuallyHidden).toBe(false);
    expect(mainText).toContain('Session ended');
  });

  test('RT-003 P0-QA-003: the live region survives every re-render', async ({ page }) => {
    await enterArena(page);

    await page.evaluate(() => {
      const region = document.querySelector('[data-testid="live-region"]');
      (region as HTMLElement & { __qaTag?: string }).__qaTag = 'original';
    });

    // Put the page through several distinct renders.
    await recordNote(page, 'live region probe one');
    await expect(page.locator(el.recordItem)).toHaveCount(1);
    await page.click(el.refresh);
    await expect(page.locator(el.notice)).toContainText('Reloaded');
    await recordNote(page, 'live region probe two');
    await expect(page.locator(el.recordItem)).toHaveCount(2);
    await page.click(el.submit); // empty note, produces an error render
    await expect(page.locator(el.error)).toBeVisible();

    const survived = await page.evaluate(() => {
      const region = document.querySelector('[data-testid="live-region"]');
      return {
        sameNode: (region as HTMLElement & { __qaTag?: string })?.__qaTag === 'original',
        regionCount: document.querySelectorAll('[data-testid="live-region"]').length,
        text: (region?.textContent ?? '').trim(),
        ariaLive: region?.getAttribute('aria-live'),
        role: region?.getAttribute('role'),
      };
    });
    test.info().annotations.push({ type: 'observed', description: JSON.stringify(survived) });

    expect(survived.sameNode).toBe(true);
    expect(survived.regionCount).toBe(1);
    expect(survived.ariaLive).toBe('polite');
    expect(survived.role).toBe('status');
  });

  test('RT-004 P0-QA-004: a failure replaces the earlier success announcement', async ({ page }) => {
    await enterArena(page);
    await recordNote(page, 'a note that succeeds');
    await expect(page.locator(el.recordItem)).toHaveCount(1);
    const afterSuccess = (await page.locator(el.liveRegion).innerText()).trim();
    expect(afterSuccess).toMatch(/Recorded sequence 1/);

    expect(await endSessionServerSide(page)).toBe(204);
    await page.click(el.refresh);
    await expect(page.locator(el.error)).toBeVisible();

    const afterFailure = (await page.locator(el.liveRegion).innerText()).trim();
    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({ afterSuccess, afterFailure }),
    });

    expect(afterFailure).not.toMatch(/Recorded sequence/);
    expect(afterFailure).toMatch(/Enter the Local Arena before recording|session expired/i);
  });

  test('RT-005 P0-QA-005: focus is preserved across actions', async ({ page }) => {
    await enterArena(page);

    // Submit from the text field with the keyboard.
    await page.focus(el.noteInput);
    await page.keyboard.type('focus retention probe');
    await page.keyboard.press('Enter');
    await expect(page.locator(el.recordItem)).toHaveCount(1);
    const afterSubmit = await page.evaluate(() => ({
      tag: document.activeElement?.tagName ?? null,
      testId: document.activeElement?.getAttribute('data-testid') ?? null,
    }));

    // Activate a button with the keyboard.
    await page.focus(el.refresh);
    await page.keyboard.press('Enter');
    await expect(page.locator(el.notice)).toContainText('Reloaded');
    const afterRefresh = await page.evaluate(() => ({
      tag: document.activeElement?.tagName ?? null,
      testId: document.activeElement?.getAttribute('data-testid') ?? null,
    }));

    // Caret position must survive a re-render that happens while the field
    // still holds focus. A rejected over-length note is the honest way to get
    // one: the page re-renders, keeps the text, and never moves focus away.
    const longNote = 'C'.repeat(200);
    await page.fill(el.noteInput, longNote);
    await page.focus(el.noteInput);
    await page.locator(el.noteInput).evaluate((node) => {
      (node as HTMLInputElement).setSelectionRange(37, 37);
    });
    await page.keyboard.press('Enter');
    await expect(page.locator(el.error)).toBeVisible();
    const caret = await page.locator(el.noteInput).evaluate((node) => ({
      valueLength: (node as HTMLInputElement).value.length,
      selectionStart: (node as HTMLInputElement).selectionStart,
      focused: document.activeElement === node,
    }));

    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({ afterSubmit, afterRefresh, caret }),
    });

    expect(afterSubmit.tag).not.toBe('BODY');
    expect(afterSubmit.testId).toBe('note-input');
    expect(afterRefresh.tag).not.toBe('BODY');
    expect(afterRefresh.testId).toBe('refresh-projection');
    expect(caret.focused, 'the field should still hold focus after a rejected submit').toBe(true);
    expect(caret.selectionStart, 'the caret should not jump to the start or end').toBe(37);
  });

  test('RT-006 P0-QA-006: a partial list says how many records exist', async ({ page }) => {
    test.setTimeout(180_000);
    await enterArena(page);

    for (let i = 1; i <= 23; i += 1) {
      await recordNote(page, `retest bulk note ${String(i).padStart(2, '0')}`);
      await expect(page.locator(el.notice)).toContainText(`Recorded sequence ${i}`);
    }

    await page.reload();
    await expect(page.locator(el.truncation)).toBeVisible();
    const notice = await page.locator(el.truncation).innerText();
    const rendered = await page.locator(el.recordItem).count();
    const visibility = await visibilityOf(page, el.truncation);

    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({ notice, rendered, visibility }),
    });
    await page.screenshot({ path: `${EVIDENCE}/rt006-01-truncation-disclosed.png`, fullPage: true });

    expect(rendered).toBe(20);
    expect(notice).toMatch(/Showing the 20 most recent of 23 stored checks/i);
    expect(visibility.insideVisuallyHidden).toBe(false);
    await expect(page.locator(el.projectionVersion)).toHaveText('23');
  });

  test('RT-007 P0-QA-006 boundary: exactly 20 records claims no truncation', async ({ page }) => {
    test.setTimeout(180_000);
    await enterArena(page);
    for (let i = 1; i <= 20; i += 1) {
      await recordNote(page, `boundary note ${String(i).padStart(2, '0')}`);
      await expect(page.locator(el.notice)).toContainText(`Recorded sequence ${i}`);
    }
    await page.reload();
    await expect(page.locator(el.recordItem)).toHaveCount(20);
    await expect(page.locator(el.truncation)).toHaveCount(0);

    // One more record must flip the disclosure on.
    await recordNote(page, 'boundary note 21');
    await expect(page.locator(el.truncation)).toBeVisible();
    await expect(page.locator(el.truncation)).toContainText('20 most recent of 21');
  });

  test('RT-008 P0-QA-008: the hardening headers are live in a real browser', async ({ page }) => {
    const response = await page.goto(ARENA);
    const headers = response?.headers() ?? {};
    await expect(page.locator(el.candidateId)).toHaveText(CANDIDATE);

    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({
        csp: headers['content-security-policy'] ?? null,
        xfo: headers['x-frame-options'] ?? null,
        referrer: headers['referrer-policy'] ?? null,
        nosniff: headers['x-content-type-options'] ?? null,
      }),
    });

    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['x-content-type-options']).toBe('nosniff');
  });
});

test.describe('Retest — defects the fixes could have introduced', () => {
  test('RT-101 the whole journey runs with no console error and no CSP violation', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on('console', (message: ConsoleMessage) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        consoleErrors.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('requestfailed', (request) =>
      failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText}`),
    );
    // Chromium reports a blocked resource as a securitypolicyviolation event.
    await page.addInitScript(() => {
      (window as unknown as { __qaCsp: string[] }).__qaCsp = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        (window as unknown as { __qaCsp: string[] }).__qaCsp.push(
          `${event.violatedDirective} blocked ${event.blockedURI}`,
        );
      });
    });

    // Walk the entire journey, including the failure paths.
    await page.goto(ARENA);
    await expect(page.locator(el.candidateId)).toHaveText(CANDIDATE);
    await page.click(el.enter);
    await expect(page.locator(el.accountId)).toBeVisible();
    await recordNote(page, 'console cleanliness probe');
    await expect(page.locator(el.recordItem)).toHaveCount(1);
    await page.click(el.refresh);
    await expect(page.locator(el.notice)).toContainText('Reloaded');
    await page.click(el.submit); // empty note error path
    await expect(page.locator(el.error)).toBeVisible();
    await recordNote(page, '<img src=x onerror="window.__qaXss=1">');
    await expect(page.locator(el.recordItem)).toHaveCount(2);
    await page.reload();
    await expect(page.locator(el.recordItem)).toHaveCount(2);
    await page.click(el.leave);
    await expect(page.locator(el.notice)).toBeVisible();

    const cspViolations = await page.evaluate(
      () => (window as unknown as { __qaCsp?: string[] }).__qaCsp ?? [],
    );

    // This journey deliberately exercises failure paths, and Chromium logs
    // every non-2xx response and every 204 as a network event of its own
    // accord. Those entries are the browser narrating what the test asked for,
    // not page defects, so they are separated out rather than ignored: the
    // assertions below are about JavaScript errors, blocked resources, and
    // policy violations.
    const expectedNetworkNoise =
      /Failed to load resource: the server responded with a status of (400|401)/;
    const unexpectedConsole = consoleErrors.filter((line) => !expectedNetworkNoise.test(line));
    const unexpectedFailedRequests = failedRequests.filter(
      (line) => !(line.includes('/api/session') && line.includes('net::ERR_ABORTED')),
    );

    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({
        consoleErrors,
        pageErrors,
        failedRequests,
        cspViolations,
        unexpectedConsole,
        unexpectedFailedRequests,
      }),
    });
    await page.screenshot({ path: `${EVIDENCE}/rt101-01-journey-clean.png`, fullPage: true });

    expect(pageErrors).toEqual([]);
    expect(cspViolations).toEqual([]);
    expect(unexpectedConsole).toEqual([]);
    expect(unexpectedFailedRequests).toEqual([]);

    // Nothing may be blocked by the policy: every request the page made must
    // have produced a response.
    expect(consoleErrors.filter((line) => /Content Security Policy|Refused to/i.test(line))).toEqual(
      [],
    );
  });

  test('RT-102 the stylesheet really loaded and the page is actually styled', async ({ page }) => {
    await page.goto(ARENA);
    await expect(page.locator(el.enter)).toBeVisible();

    const styling = await page.evaluate(() => {
      const body = window.getComputedStyle(document.body);
      const button = document.querySelector('[data-testid="enter-arena"]');
      const buttonStyle = button === null ? null : window.getComputedStyle(button);
      const skip = document.querySelector('.skip-link');
      return {
        bodyBackground: body.backgroundColor,
        bodyColor: body.color,
        bodyFont: body.fontFamily,
        buttonBackground: buttonStyle?.backgroundColor ?? null,
        buttonCursor: buttonStyle?.cursor ?? null,
        skipLinkPosition: skip === null ? null : window.getComputedStyle(skip).position,
        styleSheetCount: document.styleSheets.length,
        styleSheetRules: Array.from(document.styleSheets).reduce((total, sheet) => {
          try {
            return total + sheet.cssRules.length;
          } catch {
            return total;
          }
        }, 0),
      };
    });
    test.info().annotations.push({ type: 'observed', description: JSON.stringify(styling) });
    await page.screenshot({ path: `${EVIDENCE}/rt102-01-styled-page.png`, fullPage: true });

    // An unstyled page would be white-on-black default with no rules at all.
    expect(styling.styleSheetCount).toBeGreaterThan(0);
    expect(styling.styleSheetRules).toBeGreaterThan(20);
    expect(styling.bodyBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(styling.bodyBackground).not.toBe('rgb(255, 255, 255)');
  });

  test('RT-103 aria-disabled controls cannot be hammered into a duplicate record', async ({
    page,
  }) => {
    await enterArena(page);

    const posts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/foundation-checks')) {
        try {
          posts.push(JSON.parse(request.postData() ?? '{}').requestId as string);
        } catch {
          posts.push('unparsed');
        }
      }
    });

    // Hold the write open so every extra activation lands mid-flight.
    await page.route('**/api/foundation-checks', async (route) => {
      if (route.request().method() === 'POST') {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      await route.continue();
    });

    await page.fill(el.noteInput, 'aria-disabled hammer');

    // The button is no longer `disabled`, so the browser will happily deliver
    // every one of these. Mix real clicks, synthetic clicks and Enter presses.
    await page.$eval(el.submit, (button) => {
      const target = button as HTMLButtonElement;
      target.click();
      target.click();
      target.click();
    });
    for (let i = 0; i < 4; i += 1) {
      await page.click(el.submit, { force: true, timeout: 2500 }).catch(() => undefined);
    }
    await page.focus(el.noteInput).catch(() => undefined);
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Enter').catch(() => undefined);
    }
    await page.click(el.refresh, { force: true, timeout: 2500 }).catch(() => undefined);

    await expect(page.locator(el.notice)).toContainText('Recorded sequence', { timeout: 25_000 });
    await page.unroute('**/api/foundation-checks');

    await page.click(el.refresh);
    await expect(page.locator(el.notice)).toContainText('Reloaded');
    const notes = await page.locator(el.recordNote).allInnerTexts();

    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({
        postRequests: posts.length,
        distinctRequestIds: [...new Set(posts)].length,
        storedCopies: notes.filter((n) => n === 'aria-disabled hammer').length,
      }),
    });
    await page.screenshot({ path: `${EVIDENCE}/rt103-01-hammer-one-record.png`, fullPage: true });

    expect(notes.filter((n) => n === 'aria-disabled hammer')).toHaveLength(1);
    expect(await page.locator(el.projectionVersion).innerText()).toBe('1');
    expect(new Set(posts).size).toBeLessThanOrEqual(1);
  });

  test('RT-104 a busy control is marked aria-disabled and its activation does nothing', async ({
    page,
  }) => {
    await enterArena(page);
    await page.route('**/api/foundation-checks', async (route) => {
      if (route.request().method() === 'POST') {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      await route.continue();
    });

    await page.fill(el.noteInput, 'busy state probe');
    await page.click(el.submit);

    // Mid-flight the control must advertise its busy state to assistive tech.
    const busyState = await page.locator(el.submit).evaluate((node) => ({
      ariaDisabled: node.getAttribute('aria-disabled'),
      hasDisabledAttribute: node.hasAttribute('disabled'),
      label: (node.textContent ?? '').trim(),
      focusable: node.tabIndex >= 0,
    }));
    test.info().annotations.push({ type: 'observed', description: JSON.stringify(busyState) });

    await expect(page.locator(el.notice)).toContainText('Recorded sequence', { timeout: 25_000 });
    await page.unroute('**/api/foundation-checks');

    const idleState = await page.locator(el.submit).evaluate((node) => ({
      ariaDisabled: node.getAttribute('aria-disabled'),
    }));

    expect(busyState.ariaDisabled).toBe('true');
    expect(busyState.hasDisabledAttribute).toBe(false);
    expect(busyState.focusable).toBe(true);
    expect(idleState.ariaDisabled).toBe('false');
  });

  test('RT-105 hammering "Enter the Local Arena" does not mint two identities', async ({ page }) => {
    const mints: number[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/api/identity/development-session')) {
        mints.push(response.status());
      }
    });

    await page.goto(ARENA);
    await expect(page.locator(el.candidateId)).toHaveText(CANDIDATE);

    await page.route('**/api/identity/development-session', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });

    await page.$eval(el.enter, (button) => {
      const target = button as HTMLButtonElement;
      target.click();
      target.click();
      target.click();
    });
    for (let i = 0; i < 3; i += 1) {
      await page.click(el.enter, { force: true, timeout: 2000 }).catch(() => undefined);
    }

    await expect(page.locator(el.accountId)).toBeVisible({ timeout: 20_000 });
    await page.unroute('**/api/identity/development-session');

    const accountId = (await page.locator(el.accountId).innerText()).trim();
    await page.reload();
    await expect(page.locator(el.accountId)).toHaveText(accountId);

    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({ mintResponses: mints.length, accountId }),
    });
    expect(mints.length).toBe(1);
  });

  test('RT-106 hammering "Leave the Local Arena" ends the session cleanly once', async ({
    page,
  }) => {
    await enterArena(page);
    await recordNote(page, 'note before a hammered sign out');
    await expect(page.locator(el.recordItem)).toHaveCount(1);

    const deletes: number[] = [];
    page.on('response', (response) => {
      if (response.url().endsWith('/api/session') && response.request().method() === 'DELETE') {
        deletes.push(response.status());
      }
    });

    await page.route('**/api/session', async (route) => {
      if (route.request().method() === 'DELETE') {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      await route.continue();
    });

    await page.$eval(el.leave, (button) => {
      const target = button as HTMLButtonElement;
      target.click();
      target.click();
    });
    for (let i = 0; i < 3; i += 1) {
      await page.click(el.leave, { force: true, timeout: 2000 }).catch(() => undefined);
    }

    await expect(page.locator(el.enter)).toBeVisible({ timeout: 20_000 });
    await page.unroute('**/api/session');
    await expect(page.locator(el.notice)).toContainText('Session ended');

    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({ deleteResponses: deletes.length }),
    });
    expect(deletes.length).toBe(1);
    expect(await page.locator(el.error).count()).toBe(0);
  });

  test('RT-107 the retry control is offered only where retrying is honest', async ({ page }) => {
    await enterArena(page);

    // A rejected note must not offer to resend the same rejected note.
    await recordNote(page, 'T'.repeat(200));
    await expect(page.locator(el.error)).toBeVisible();
    expect(await page.locator(el.error).getAttribute('data-error-code')).toBe('NOTE_TOO_LONG');
    const retryAfterValidation = await page.locator(el.retry).count();

    // An unknown outcome must offer a retry.
    let failOnce = true;
    await page.route('**/api/foundation-checks', async (route) => {
      if (route.request().method() === 'POST' && failOnce) {
        failOnce = false;
        await route.abort('connectionfailed');
        return;
      }
      await route.continue();
    });
    await recordNote(page, 'note behind a broken connection');
    await expect(page.locator(el.error)).toBeVisible();
    const retryAfterNetwork = await page.locator(el.retry).count();

    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({ retryAfterValidation, retryAfterNetwork }),
    });

    expect(retryAfterValidation).toBe(0);
    expect(retryAfterNetwork).toBe(1);

    await page.click(el.retry);
    await expect(page.locator(el.recordItem)).toHaveCount(1);
    await expect(page.locator(el.recordNote).first()).toHaveText('note behind a broken connection');
    await page.screenshot({ path: `${EVIDENCE}/rt107-01-retry-succeeded.png`, fullPage: true });
  });

  test('RT-108 escaping still holds through the rebuilt render path', async ({ page }) => {
    await enterArena(page);
    await page.addInitScript(() => {
      (window as unknown as { __qaXssFired: boolean }).__qaXssFired = false;
    });

    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });

    const payloads = [
      '<img src=x onerror="window.__qaXssFired=true">',
      '<script>window.__qaXssFired=true</script>',
      '"><img src=x onerror="window.__qaXssFired=true">',
      '</span><svg onload="window.__qaXssFired=true">',
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
      images: document.querySelectorAll('#app img').length,
      svg: document.querySelectorAll('#app svg').length,
      scripts: document.querySelectorAll('#app script').length,
      jsHrefs: document.querySelectorAll('#app a[href^="javascript:"]').length,
      handlers: document.querySelectorAll('#app [onerror], #app [onload]').length,
    }));

    const notes = await page.locator(el.recordNote).allInnerTexts();
    test.info().annotations.push({ type: 'observed', description: JSON.stringify(injection) });
    await page.screenshot({ path: `${EVIDENCE}/rt108-01-escaping-holds.png`, fullPage: true });

    expect(injection.fired).toBe(false);
    expect(injection.images).toBe(0);
    expect(injection.svg).toBe(0);
    expect(injection.scripts).toBe(0);
    expect(injection.jsHrefs).toBe(0);
    expect(injection.handlers).toBe(0);
    expect(dialogs).toEqual([]);
    for (const payload of payloads) {
      expect(notes).toContain(payload);
    }
  });

  test('RT-109 repeating the same action still announces it each time', async ({ page }) => {
    await enterArena(page);
    await recordNote(page, 'announcement repetition probe');
    await expect(page.locator(el.recordItem)).toHaveCount(1);

    const announcements: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      await page.click(el.refresh);
      await expect(page.locator(el.notice)).toContainText('Reloaded');
      announcements.push((await page.locator(el.liveRegion).innerText()).trim());
    }

    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({ announcements }),
    });
    // The dedupe guard must not swallow a repeated action's confirmation.
    for (const announcement of announcements) {
      expect(announcement).toMatch(/Reloaded the stored projection/);
    }
  });

  test('RT-110 focus restoration does not steal focus from outside the app', async ({ page }) => {
    await page.goto(ARENA);
    await expect(page.locator(el.enter)).toBeVisible();

    // The skip link lives outside the re-rendered layout. A re-render must not
    // yank focus away from it.
    await page.keyboard.press('Tab');
    const beforeClass = await page.evaluate(() => document.activeElement?.className ?? '');
    expect(beforeClass).toContain('skip-link');

    // Force a re-render from outside the layout by ending an unrelated request.
    await page.evaluate(() => {
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(200);
    const afterClass = await page.evaluate(() => document.activeElement?.className ?? '');

    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({ beforeClass, afterClass }),
    });
    expect(afterClass).toContain('skip-link');

    // And the skip link still does its job.
    await page.keyboard.press('Enter');
    const target = await page.evaluate(() => window.location.hash);
    expect(target).toBe('#main');
  });
});
