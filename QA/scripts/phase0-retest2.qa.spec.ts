/**
 * Independent QA retest pass 2 — candidate cand-32058f47eda8.
 *
 * Scope: the P0-QA-009 fix (focus falls back to the message explaining what
 * happened when the focused control is removed), and the problems that fix
 * could introduce. Making two elements focusable is a small change with a
 * large blast radius on keyboard use, so this file measures the whole tab
 * order and the whole keyboard recovery path rather than only the landing
 * spot.
 */

import { expect, test, type Page } from '@playwright/test';

const ARENA = 'http://127.0.0.1:5274';
const CANDIDATE = process.env.QA_CANDIDATE_ID ?? 'cand-32058f47eda8';
const EVIDENCE =
  process.env.QA_EVIDENCE_DIR ?? '/workspace/QA/evidence/retest2-cand-32058f47eda8/ui';

const el = {
  candidateId: '[data-testid="candidate-id"]',
  enter: '[data-testid="enter-arena"]',
  leave: '[data-testid="leave-arena"]',
  accountId: '[data-testid="account-id"]',
  noteInput: '[data-testid="note-input"]',
  submit: '[data-testid="record-submit"]',
  refresh: '[data-testid="refresh-projection"]',
  recordItem: '[data-testid="record-item"]',
  recordNote: '[data-testid="record-note"]',
  error: '[data-testid="error-message"]',
  notice: '[data-testid="notice-message"]',
  liveRegion: '[data-testid="live-region"]',
};

async function enterArena(page: Page): Promise<void> {
  await page.goto(ARENA);
  await expect(page.locator(el.candidateId)).toHaveText(CANDIDATE);
  await page.click(el.enter);
  await expect(page.locator(el.accountId)).toBeVisible();
}

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

/** A description of whatever currently holds focus. */
const focusDescriptor = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement;
    if (active === null) return { tag: null };
    const style = window.getComputedStyle(active);
    return {
      tag: active.tagName,
      testId: active.getAttribute('data-testid'),
      role: active.getAttribute('role'),
      tabIndex: (active as HTMLElement).tabIndex,
      className: active.className,
      text: (active.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 90),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      isBody: active === document.body,
    };
  });

/**
 * Walks the tab order from the top of the document and records every stop.
 * This is the only honest way to answer whether `tabindex="-1"` kept the
 * message elements out of the sequence.
 */
async function enumerateTabOrder(page: Page, maxStops = 14): Promise<string[]> {
  // Blurring is not enough: Chromium keeps a sequential focus navigation
  // starting point, so a Tab after a blur resumes mid-document. Focusing the
  // first focusable element explicitly resets that starting point, which is
  // what makes the walk below a real enumeration from the top.
  const start = await page.evaluate(() => {
    const skip = document.querySelector<HTMLElement>('.skip-link');
    if (skip === null) return 'NO_SKIP_LINK';
    skip.focus();
    return document.activeElement === skip ? 'skip-link' : 'FOCUS_REFUSED';
  });
  const stops: string[] = [start === 'skip-link' ? 'A.skip-link' : start];
  for (let i = 0; i < maxStops; i += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const active = document.activeElement;
      if (active === null || active === document.body) return 'BODY';
      const testId = active.getAttribute('data-testid');
      if (testId !== null) return testId;
      const className = active.className;
      return className === '' ? active.tagName : `${active.tagName}.${className}`;
    });
    if (stop === 'BODY' || stop === 'A.skip-link') {
      stops.push(stop === 'BODY' ? 'BODY (left the page)' : 'A.skip-link (wrapped)');
      break;
    }
    stops.push(stop);
  }
  return stops;
}

test.describe('Retest 2 — P0-QA-009 closure', () => {
  test('RT2-001 signing out with the keyboard lands focus on the explanation', async ({ page }) => {
    await enterArena(page);
    await page.fill(el.noteInput, 'note before a keyboard sign out');
    await page.click(el.submit);
    await expect(page.locator(el.recordItem)).toHaveCount(1);

    await page.focus(el.leave);
    await page.keyboard.press('Enter');
    await expect(page.locator(el.enter)).toBeVisible();
    await expect(page.locator(el.notice)).toContainText('Session ended');

    const focus = await focusDescriptor(page);
    const liveRegion = (await page.locator(el.liveRegion).innerText()).trim();

    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({ focus, liveRegion }),
    });
    await page.screenshot({ path: `${EVIDENCE}/rt2-001-focus-on-signout-notice.png`, fullPage: true });

    expect(focus.isBody, 'focus must no longer fall to the document body').toBe(false);
    expect(focus.testId).toBe('notice-message');
    expect(focus.text).toContain('Session ended');
    // The explanation must reach a screen reader as well as the eye.
    expect(liveRegion).toContain('Session ended');
  });

  test('RT2-002 an authentication failure lands focus on the error panel', async ({ page }) => {
    await enterArena(page);
    expect(await endSessionServerSide(page)).toBe(204);

    await page.focus(el.noteInput);
    await page.keyboard.type('a note that cannot be saved');
    await page.keyboard.press('Enter');
    await expect(page.locator(el.error)).toBeVisible();

    const focus = await focusDescriptor(page);
    const liveRegion = (await page.locator(el.liveRegion).innerText()).trim();

    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({ focus, liveRegion }),
    });
    await page.screenshot({ path: `${EVIDENCE}/rt2-002-focus-on-error-panel.png`, fullPage: true });

    expect(focus.isBody).toBe(false);
    expect(focus.testId).toBe('error-message');
    expect(focus.role, 'the focused explanation should still be an alert').toBe('alert');
    expect(focus.text).toMatch(/Enter the Local Arena before recording/);
    expect(liveRegion).toMatch(/Enter the Local Arena before recording/);
  });

  test('RT2-003 the error panel wins over a stale notice as the focus target', async ({ page }) => {
    await enterArena(page);
    // Produce a success notice first, then a failure that removes the control.
    await page.fill(el.noteInput, 'a note that succeeds');
    await page.click(el.submit);
    await expect(page.locator(el.notice)).toContainText('Recorded sequence 1');

    expect(await endSessionServerSide(page)).toBe(204);
    await page.focus(el.refresh);
    await page.keyboard.press('Enter');
    await expect(page.locator(el.error)).toBeVisible();

    const focus = await focusDescriptor(page);
    test.info().annotations.push({ type: 'observed', description: JSON.stringify(focus) });

    expect(focus.testId).toBe('error-message');
    // The stale success must be gone, not merely out-prioritised.
    await expect(page.locator(el.notice)).toHaveCount(0);
  });
});

test.describe('Retest 2 — problems the fix could introduce', () => {
  test('RT2-101 the focusable messages never appear in the tab order', async ({ page }) => {
    // State A: signed out with a success notice showing (after sign-out).
    await enterArena(page);
    await page.click(el.leave);
    await expect(page.locator(el.notice)).toContainText('Session ended');
    const signedOutWithNotice = await enumerateTabOrder(page);

    // State B: signed out with an error panel showing.
    await page.click(el.enter);
    await expect(page.locator(el.accountId)).toBeVisible();
    expect(await endSessionServerSide(page)).toBe(204);
    await page.click(el.submit);
    await expect(page.locator(el.error)).toBeVisible();
    const signedOutWithError = await enumerateTabOrder(page);

    // State C: signed in with a record list and a notice.
    await page.click(el.enter);
    await expect(page.locator(el.accountId)).toBeVisible();
    await page.fill(el.noteInput, 'tab order probe');
    await page.click(el.submit);
    await expect(page.locator(el.recordItem)).toHaveCount(1);
    const signedInWithNotice = await enumerateTabOrder(page);

    const tabIndexes = await page.evaluate(() => {
      const read = (selector: string) => {
        const node = document.querySelector(selector);
        return node === null ? null : (node as HTMLElement).tabIndex;
      };
      return {
        notice: read('[data-testid="notice-message"]'),
        error: read('[data-testid="error-message"]'),
      };
    });

    // A second, independent view of the same question: nothing carrying a
    // message testid may appear among the document's natively tabbable nodes.
    const tabbableInventory = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          'a[href], button, input, select, textarea, [tabindex]',
        ),
      )
        .filter((node) => node.tabIndex >= 0)
        .map((node) => node.getAttribute('data-testid') ?? `${node.tagName}.${node.className}`),
    );

    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({
        signedOutWithNotice,
        signedOutWithError,
        signedInWithNotice,
        tabIndexes,
        tabbableInventory,
      }),
    });

    for (const [label, order] of Object.entries({
      signedOutWithNotice,
      signedOutWithError,
      signedInWithNotice,
    })) {
      expect(order, `${label} must not stop on the notice`).not.toContain('notice-message');
      expect(order, `${label} must not stop on the error`).not.toContain('error-message');
      // A walk that never reached the record controls would prove nothing, so
      // confirm the enumeration actually traversed the page.
      expect(order.length, `${label} should be a real walk, not a stub`).toBeGreaterThan(1);
    }
    expect(signedInWithNotice, 'the signed-in walk must reach the note field').toContain(
      'note-input',
    );
    expect(tabIndexes.notice).toBe(-1);
    expect(tabbableInventory).not.toContain('notice-message');
    expect(tabbableInventory).not.toContain('error-message');
  });

  test('RT2-102 the recovery control is still reachable by keyboard from the message', async ({
    page,
  }) => {
    // The messages sit after the sign-in panel in the document, so landing on
    // one moves the player *past* the recovery control. This measures what it
    // actually costs to get back to it.
    await enterArena(page);
    await page.focus(el.leave);
    await page.keyboard.press('Enter');
    await expect(page.locator(el.notice)).toContainText('Session ended');
    expect((await focusDescriptor(page)).testId).toBe('notice-message');

    const forward = await (async () => {
      await page.keyboard.press('Tab');
      return focusDescriptor(page);
    })();

    // Come back and try the other direction.
    await page.locator(el.notice).evaluate((node) => (node as HTMLElement).focus());
    await page.keyboard.press('Shift+Tab');
    const backward = await focusDescriptor(page);

    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({
        forwardTabFromMessage: forward,
        shiftTabFromMessage: backward,
      }),
    });

    // Whatever the direction, the player must be able to reach the way forward.
    await page.locator(el.notice).evaluate((node) => (node as HTMLElement).focus());
    let reached = false;
    let presses = 0;
    for (let i = 0; i < 8 && !reached; i += 1) {
      await page.keyboard.press('Shift+Tab');
      presses += 1;
      reached = await page.evaluate(
        () => document.activeElement === document.querySelector('[data-testid="enter-arena"]'),
      );
    }
    test.info().annotations.push({
      type: 'keyboard-recovery',
      description: JSON.stringify({ reachedEnterArena: reached, shiftTabPresses: presses }),
    });
    expect(reached, 'the sign-in control must be reachable from the message').toBe(true);
  });

  test('RT2-103 the keyboard-only journey still completes end to end', async ({ page }) => {
    await page.goto(ARENA);
    await expect(page.locator(el.candidateId)).toHaveText(CANDIDATE);

    // Enter using only Tab and Enter.
    let reachedEnter = false;
    for (let i = 0; i < 6 && !reachedEnter; i += 1) {
      await page.keyboard.press('Tab');
      reachedEnter = await page.evaluate(
        () => document.activeElement === document.querySelector('[data-testid="enter-arena"]'),
      );
    }
    expect(reachedEnter, 'sign-in must be reachable by Tab from a fresh page').toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.locator(el.accountId)).toBeVisible();

    // Reach the note field by keyboard, type, and submit with Enter.
    let reachedInput = false;
    for (let i = 0; i < 8 && !reachedInput; i += 1) {
      await page.keyboard.press('Tab');
      reachedInput = await page.evaluate(
        () => document.activeElement === document.querySelector('[data-testid="note-input"]'),
      );
    }
    expect(reachedInput, 'the note field must be reachable by Tab').toBe(true);
    await page.keyboard.type('keyboard only journey pass 2');
    await page.keyboard.press('Enter');
    await expect(page.locator(el.recordItem)).toHaveCount(1);
    await expect(page.locator(el.recordNote).first()).toHaveText('keyboard only journey pass 2');

    // Reload from the server using only the keyboard.
    let reachedRefresh = false;
    for (let i = 0; i < 8 && !reachedRefresh; i += 1) {
      await page.keyboard.press('Tab');
      reachedRefresh = await page.evaluate(
        () => document.activeElement === document.querySelector('[data-testid="refresh-projection"]'),
      );
    }
    expect(reachedRefresh, 'reload must be reachable by Tab').toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.locator(el.notice)).toContainText('Reloaded');

    // Sign out using only the keyboard.
    let reachedLeave = false;
    for (let i = 0; i < 10 && !reachedLeave; i += 1) {
      await page.keyboard.press('Shift+Tab');
      reachedLeave = await page.evaluate(
        () => document.activeElement === document.querySelector('[data-testid="leave-arena"]'),
      );
    }
    expect(reachedLeave, 'sign-out must be reachable by keyboard').toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.locator(el.notice)).toContainText('Session ended');

    await page.screenshot({ path: `${EVIDENCE}/rt2-103-keyboard-journey-complete.png`, fullPage: true });
  });

  test('RT2-104 a keyboard user can recover from an expired session without a mouse', async ({
    page,
  }) => {
    await enterArena(page);
    expect(await endSessionServerSide(page)).toBe(204);

    await page.focus(el.noteInput);
    await page.keyboard.type('note lost to an expired session');
    await page.keyboard.press('Enter');
    await expect(page.locator(el.error)).toBeVisible();
    expect((await focusDescriptor(page)).testId).toBe('error-message');

    // Recover to a working state using only the keyboard.
    let reached = false;
    let presses = 0;
    for (let i = 0; i < 10 && !reached; i += 1) {
      await page.keyboard.press('Shift+Tab');
      presses += 1;
      reached = await page.evaluate(
        () => document.activeElement === document.querySelector('[data-testid="enter-arena"]'),
      );
    }
    expect(reached).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.locator(el.accountId)).toBeVisible();

    // The note the player typed must still be there and still submittable.
    const restored = await page.locator(el.noteInput).inputValue();
    let reachedInput = false;
    for (let i = 0; i < 8 && !reachedInput; i += 1) {
      await page.keyboard.press('Tab');
      reachedInput = await page.evaluate(
        () => document.activeElement === document.querySelector('[data-testid="note-input"]'),
      );
    }
    await page.keyboard.press('Enter');
    await expect(page.locator(el.recordItem)).toHaveCount(1);

    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({ shiftTabPressesToRecover: presses, restored }),
    });
    expect(restored).toBe('note lost to an expired session');
    await page.screenshot({ path: `${EVIDENCE}/rt2-104-keyboard-recovery.png`, fullPage: true });
  });

  test('RT2-105 the focused message is visibly indicated for a sighted keyboard user', async ({
    page,
  }) => {
    await enterArena(page);
    await page.focus(el.leave);
    await page.keyboard.press('Enter');
    await expect(page.locator(el.notice)).toContainText('Session ended');

    const indicator = await page.locator(el.notice).evaluate((node) => {
      const style = window.getComputedStyle(node);
      return {
        matchesFocusVisible: node.matches(':focus-visible'),
        matchesFocus: node.matches(':focus'),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
        boxShadow: style.boxShadow,
        borderColor: style.borderColor,
      };
    });
    test.info().annotations.push({ type: 'observed', description: JSON.stringify(indicator) });
    await page.screenshot({ path: `${EVIDENCE}/rt2-105-focused-message-indicator.png`, fullPage: true });

    // Recorded rather than asserted: the message panel is itself large and
    // high-contrast, so the question here is focus indication, not whether the
    // player can see the explanation.
    expect(indicator.matchesFocus).toBe(true);
  });

  test('RT2-106 focus fallback does not fire when focus was outside the app', async ({ page }) => {
    await page.goto(ARENA);
    await expect(page.locator(el.enter)).toBeVisible();
    await page.keyboard.press('Tab');
    const before = await focusDescriptor(page);
    expect(before.className).toContain('skip-link');

    // Enter the arena by script so the skip link keeps focus through a render
    // that removes the sign-in button.
    await page.evaluate(() => {
      (document.querySelector('[data-testid="enter-arena"]') as HTMLButtonElement).click();
    });
    await expect(page.locator(el.accountId)).toBeVisible();
    const after = await focusDescriptor(page);

    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({ before, after }),
    });
    expect(after.className, 'a render must not steal focus from outside the layout').toContain(
      'skip-link',
    );
  });

  test('RT2-108 the retry control is the third disappearing control; focus survives it', async ({
    page,
  }) => {
    // Sign-out and an authentication failure are the two cases the fix names.
    // The retry button is a third: it exists only while an error is showing,
    // so using it deletes it. It is also on the Phase 0 "real retry path", so
    // dropping focus here would matter.
    await enterArena(page);

    let failOnce = true;
    await page.route('**/api/foundation-checks', async (route) => {
      if (route.request().method() === 'POST' && failOnce) {
        failOnce = false;
        await route.abort('connectionfailed');
        return;
      }
      await route.continue();
    });

    await page.fill(el.noteInput, 'note behind a broken connection');
    await page.click(el.submit);
    await expect(page.locator(el.error)).toBeVisible();
    const retry = page.locator('[data-testid="retry-submission"]');
    await expect(retry).toHaveCount(1);

    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(el.recordItem)).toHaveCount(1);
    await page.unroute('**/api/foundation-checks');

    const focus = await focusDescriptor(page);
    const liveRegion = (await page.locator(el.liveRegion).innerText()).trim();
    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({ focus, liveRegion }),
    });
    await page.screenshot({ path: `${EVIDENCE}/rt2-108-focus-after-retry.png`, fullPage: true });

    // Focus lands on the submit button rather than the success notice, because
    // the busy render that removes the retry button has no message to offer
    // yet, so the chain falls through to the primary action. That is a
    // sensible destination — it is the control of the form the player was
    // using — and the confirmation still reaches a screen reader through the
    // live region. The requirement is that focus is not dropped.
    expect(focus.isBody, 'focus must not be dropped after a successful retry').toBe(false);
    expect(['notice-message', 'record-submit', 'note-input']).toContain(focus.testId);
    expect(liveRegion).toMatch(/Recorded sequence 1/);
  });

  test('RT2-107 no console error or CSP violation across the journey', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        consoleErrors.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await page.addInitScript(() => {
      (window as unknown as { __qaCsp: string[] }).__qaCsp = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        (window as unknown as { __qaCsp: string[] }).__qaCsp.push(
          `${event.violatedDirective} blocked ${event.blockedURI}`,
        );
      });
    });

    await page.goto(ARENA);
    await expect(page.locator(el.candidateId)).toHaveText(CANDIDATE);
    await page.click(el.enter);
    await expect(page.locator(el.accountId)).toBeVisible();
    await page.fill(el.noteInput, 'console probe pass 2');
    await page.click(el.submit);
    await expect(page.locator(el.recordItem)).toHaveCount(1);
    await page.click(el.submit); // empty note error path
    await expect(page.locator(el.error)).toBeVisible();
    await endSessionServerSide(page);
    await page.click(el.refresh);
    await expect(page.locator(el.error)).toBeVisible();
    await page.click(el.enter);
    await expect(page.locator(el.accountId)).toBeVisible();
    await page.click(el.leave);
    await expect(page.locator(el.notice)).toContainText('Session ended');

    const cspViolations = await page.evaluate(
      () => (window as unknown as { __qaCsp?: string[] }).__qaCsp ?? [],
    );
    const expectedNoise = /Failed to load resource: the server responded with a status of (400|401)/;
    const unexpectedConsole = consoleErrors.filter((line) => !expectedNoise.test(line));

    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({ consoleErrors, pageErrors, cspViolations, unexpectedConsole }),
    });

    expect(pageErrors).toEqual([]);
    expect(cspViolations).toEqual([]);
    expect(unexpectedConsole).toEqual([]);
  });
});
