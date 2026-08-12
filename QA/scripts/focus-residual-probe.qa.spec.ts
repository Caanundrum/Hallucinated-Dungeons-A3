/**
 * Measures where keyboard focus lands when the control the player just used
 * ceases to exist — sign-out and an authentication failure both remove the
 * control that was focused.
 *
 * P0-QA-005 covered focus after ordinary actions, where the control survives
 * the re-render. This probe checks the remaining case rather than assuming the
 * fix covers it.
 */

import { expect, test, type Page } from '@playwright/test';

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
  error: '[data-testid="error-message"]',
  notice: '[data-testid="notice-message"]',
};

async function enterArena(page: Page): Promise<void> {
  await page.goto(ARENA);
  await expect(page.locator(el.candidateId)).toHaveText(CANDIDATE);
  await page.click(el.enter);
  await expect(page.locator(el.accountId)).toBeVisible();
}

const activeElement = (page: Page) =>
  page.evaluate(() => ({
    tag: document.activeElement?.tagName ?? null,
    testId: document.activeElement?.getAttribute('data-testid') ?? null,
    className: document.activeElement?.className ?? null,
  }));

test('FR-01 focus after signing out with the keyboard', async ({ page }) => {
  await enterArena(page);
  await page.focus(el.leave);
  await page.keyboard.press('Enter');
  await expect(page.locator(el.enter)).toBeVisible();
  await expect(page.locator(el.notice)).toContainText('Session ended');

  const focus = await activeElement(page);
  test.info().annotations.push({ type: 'observed', description: JSON.stringify(focus) });

  // Recorded rather than asserted as a defect on its own: the control that had
  // focus no longer exists, so something has to happen. What matters for the
  // player is whether the journey can continue from the keyboard.
  await page.keyboard.press('Tab');
  const firstTabStop = await activeElement(page);
  test.info().annotations.push({
    type: 'first-tab-stop-after-sign-out',
    description: JSON.stringify(firstTabStop),
  });
});

test('FR-02 focus after a submission fails because the session died', async ({ page }) => {
  await enterArena(page);
  await page.evaluate(async (candidateId) => {
    await fetch('/api/session', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'x-hd-candidate': candidateId },
    });
  }, CANDIDATE);

  await page.focus(el.noteInput);
  await page.keyboard.type('a note that cannot be saved');
  await page.keyboard.press('Enter');
  await expect(page.locator(el.error)).toBeVisible();

  const focus = await activeElement(page);
  test.info().annotations.push({ type: 'observed', description: JSON.stringify(focus) });

  // The player must still be able to reach the recovery control by keyboard.
  let reachedEnter = false;
  for (let i = 0; i < 10 && !reachedEnter; i += 1) {
    await page.keyboard.press('Tab');
    reachedEnter = await page.evaluate(
      () => document.activeElement === document.querySelector('[data-testid="enter-arena"]'),
    );
  }
  test.info().annotations.push({
    type: 'keyboard-recovery',
    description: JSON.stringify({ reachedEnterByTabbing: reachedEnter }),
  });
  await page.screenshot({ path: `${EVIDENCE}/fr02-01-focus-after-auth-failure.png`, fullPage: true });

  expect(reachedEnter, 'the recovery control must be reachable by keyboard').toBe(true);
});
