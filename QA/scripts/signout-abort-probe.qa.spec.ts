/**
 * Focused investigation of a `net::ERR_ABORTED` seen on the sign-out request
 * during the retest of cand-882c6c2fe4a3.
 *
 * The question that matters is not whether the browser logged an abort, but
 * whether the session is genuinely dead server-side afterwards. A sign-out
 * that looks successful but leaves a live session would be a security
 * regression.
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
  notice: '[data-testid="notice-message"]',
  error: '[data-testid="error-message"]',
  recordItem: '[data-testid="record-item"]',
};

async function enterArena(page: Page): Promise<string> {
  await page.goto(ARENA);
  await expect(page.locator(el.candidateId)).toHaveText(CANDIDATE);
  await page.click(el.enter);
  await expect(page.locator(el.accountId)).toBeVisible();
  return (await page.locator(el.accountId).innerText()).trim();
}

test('SA-01 sign out really ends the session even if the browser logs an abort', async ({
  page,
  context,
}) => {
  const events: string[] = [];
  page.on('requestfailed', (request) => {
    if (request.url().endsWith('/api/session')) {
      events.push(`requestfailed ${request.method()} :: ${request.failure()?.errorText}`);
    }
  });
  page.on('response', (response) => {
    if (response.url().endsWith('/api/session')) {
      events.push(`response ${response.request().method()} :: ${response.status()}`);
    }
  });

  await enterArena(page);
  await page.fill(el.noteInput, 'note before sign out');
  await page.click(el.submit);
  await expect(page.locator(el.recordItem)).toHaveCount(1);

  const cookies = await context.cookies(ARENA);
  const stolen = cookies.find((c) => c.name === 'hd_dev_session')?.value;
  expect(stolen, 'a session cookie should exist while signed in').toBeTruthy();

  await page.click(el.leave);
  await expect(page.locator(el.enter)).toBeVisible();
  await expect(page.locator(el.notice)).toContainText('Session ended');
  await expect(page.locator(el.error)).toHaveCount(0);

  // The decisive question: is the token dead on the server?
  const replay = await page.request.get(`${ARENA}/api/foundation-checks`, {
    headers: { origin: ARENA, cookie: `hd_dev_session=${stolen}` },
  });
  const replayWrite = await page.request.post(`${ARENA}/api/foundation-checks`, {
    headers: {
      origin: ARENA,
      cookie: `hd_dev_session=${stolen}`,
      'x-hd-candidate': CANDIDATE,
      'content-type': 'application/json',
    },
    data: { requestId: '66666666-6666-4666-8666-666666666666', note: 'after sign out' },
  });

  test.info().annotations.push({
    type: 'observed',
    description: JSON.stringify({
      sessionRequestEvents: events,
      replayReadStatus: replay.status(),
      replayWriteStatus: replayWrite.status(),
      cookieAfterSignOut:
        (await context.cookies(ARENA)).find((c) => c.name === 'hd_dev_session')?.value ?? null,
    }),
  });
  await page.screenshot({ path: `${EVIDENCE}/sa01-01-sign-out-state.png`, fullPage: true });

  expect(replay.status()).toBe(401);
  expect(replayWrite.status()).toBe(401);
});

test('SA-02 the sign-out request itself completes with 204', async ({ page }) => {
  const statuses: Array<{ method: string; status: number }> = [];
  page.on('response', (response) => {
    if (response.url().endsWith('/api/session')) {
      statuses.push({ method: response.request().method(), status: response.status() });
    }
  });

  await enterArena(page);

  // Observe the DELETE from inside the page, where an abort would surface as a
  // thrown fetch rather than a logged network event.
  const inPageResult = await page.evaluate(async (candidateId) => {
    try {
      const response = await fetch('/api/session', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'x-hd-candidate': candidateId },
      });
      return { threw: false, status: response.status };
    } catch (error) {
      return { threw: true, reason: String(error) };
    }
  }, CANDIDATE);

  test.info().annotations.push({
    type: 'observed',
    description: JSON.stringify({ inPageResult, observedResponses: statuses }),
  });

  expect(inPageResult.threw).toBe(false);
  expect(inPageResult.status).toBe(204);
});
