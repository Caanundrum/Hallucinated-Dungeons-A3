import { Agent, request as httpRequest, type IncomingMessage } from 'node:http';

import { expect, test } from '@playwright/test';

import { PROJECTION_PAGE_SIZE } from '../../src/shared/contract.js';
import {
  enterArena,
  openArena,
  readCandidate,
  recordCheck,
  renderedNotes,
  SERVER_ORIGIN,
} from './arena-page.js';

/**
 * Regression coverage for the findings independent QA raised against the first
 * Phase 0 candidate. Each test names the finding it locks down so a later
 * change cannot quietly reintroduce it.
 */

/** Ends the session server-side, the way an expiry or emulator restart does. */
async function endSessionBehindThePage(page: import('@playwright/test').Page): Promise<void> {
  const candidate = await readCandidate(page);
  const response = await page.request.delete('/api/session', {
    headers: {
      origin: new URL(page.url()).origin,
      'x-hd-candidate': candidate.candidateId,
    },
  });
  expect(response.status()).toBe(204);
}

test.describe('QA regression coverage', () => {
  test('P0-QA-001: a session that ends mid-use is explained on the page', async ({ page }) => {
    await openArena(page);
    await enterArena(page);
    await recordCheck(page, 'recorded before the session ended');

    await endSessionBehindThePage(page);

    await page.getByTestId('note-input').fill('typed after the session ended');
    await page.getByTestId('record-submit').click();

    const error = page.getByTestId('error-message');
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute('data-error-code', 'NOT_AUTHENTICATED');
    await expect(page.getByTestId('enter-arena')).toBeVisible();
  });

  test('P0-QA-001: reloading with a dead session explains itself rather than emptying quietly', async ({
    page,
  }) => {
    await openArena(page);
    await enterArena(page);
    await recordCheck(page, 'recorded before the session ended');

    await endSessionBehindThePage(page);
    await page.getByTestId('refresh-projection').click();

    await expect(page.getByTestId('error-message')).toHaveAttribute(
      'data-error-code',
      'NOT_AUTHENTICATED',
    );
    await expect(page.getByTestId('enter-arena')).toBeVisible();
  });

  test('P0-QA-002: signing out is confirmed on screen', async ({ page }) => {
    await openArena(page);
    await enterArena(page);

    await page.getByTestId('leave-arena').click();

    await expect(page.getByTestId('notice-message')).toContainText('Session ended');
    await expect(page.getByTestId('enter-arena')).toBeVisible();
  });

  test('P0-QA-003: the live region survives re-rendering', async ({ page }) => {
    await openArena(page);

    await page.evaluate(() => {
      document
        .querySelector('[data-testid="live-region"]')
        ?.setAttribute('data-persistence-probe', 'original');
    });

    await enterArena(page);
    await recordCheck(page, 'a render that would replace a fragile live region');

    const stillOriginal = await page.evaluate(
      () =>
        document
          .querySelector('[data-testid="live-region"]')
          ?.getAttribute('data-persistence-probe') ?? null,
    );
    expect(stillOriginal).toBe('original');
    await expect(page.getByTestId('live-region')).toContainText('Recorded sequence 1');
  });

  test('P0-QA-004: a failure replaces the previous success announcement', async ({ page }) => {
    await openArena(page);
    await enterArena(page);
    await recordCheck(page, 'a successful write');
    await expect(page.getByTestId('live-region')).toContainText('Recorded sequence 1');

    await page.getByTestId('note-input').fill('   ');
    await page.getByTestId('record-submit').click();

    const liveRegion = page.getByTestId('live-region');
    await expect(liveRegion).not.toContainText('Recorded sequence 1');
    await expect(liveRegion).toContainText('Enter a short note');
  });

  test('P0-QA-005: keyboard focus is preserved across an action', async ({ page }) => {
    await openArena(page);
    await enterArena(page);

    await page.getByTestId('note-input').focus();
    await page.keyboard.type('focus should come back here');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('notice-message')).toContainText('Recorded sequence 1');

    expect(
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid),
    ).toBe('note-input');

    await page.getByTestId('refresh-projection').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('notice-message')).toContainText('Reloaded');

    expect(
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid),
    ).toBe('refresh-projection');
  });

  test('P0-QA-009: focus moves to the explanation when the focused control is removed', async ({
    page,
  }) => {
    await openArena(page);
    await enterArena(page);

    await page.getByTestId('leave-arena').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('notice-message')).toContainText('Session ended');

    expect(
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid),
    ).toBe('notice-message');

    await enterArena(page);
    await endSessionBehindThePage(page);
    await page.getByTestId('record-submit').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('error-message')).toHaveAttribute(
      'data-error-code',
      'NOT_AUTHENTICATED',
    );

    expect(
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid),
    ).toBe('error-message');
  });

  test('P0-QA-006: a partial list says how many records exist', async ({ page }) => {
    await openArena(page);
    await enterArena(page);
    const candidate = await readCandidate(page);
    const origin = new URL(page.url()).origin;

    const total = PROJECTION_PAGE_SIZE + 3;
    for (let index = 1; index <= total; index += 1) {
      const response = await page.request.post('/api/foundation-checks', {
        headers: {
          origin,
          'x-hd-candidate': candidate.candidateId,
          'content-type': 'application/json',
        },
        data: { requestId: crypto.randomUUID(), note: `bulk note ${index}` },
      });
      expect(response.status()).toBe(201);
    }

    await page.reload();

    await expect(page.getByTestId('truncation-notice')).toContainText(
      `Showing the ${PROJECTION_PAGE_SIZE} most recent of ${total} stored checks`,
    );
    expect(await renderedNotes(page)).toHaveLength(PROJECTION_PAGE_SIZE);
  });

  test('P0-QA-007: an oversized body is refused without stalling the connection', async ({
    page,
  }) => {
    await openArena(page);
    await enterArena(page);
    const candidate = await readCandidate(page);
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');

    const clientOrigin = new URL(page.url()).origin;
    const target = new URL(SERVER_ORIGIN);
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });

    const send = (options: {
      method: string;
      path: string;
      body?: string;
    }): Promise<{ status: number; timedOut: boolean }> =>
      new Promise((resolve) => {
        const clientRequest = httpRequest(
          {
            agent,
            host: target.hostname,
            port: Number(target.port),
            method: options.method,
            path: options.path,
            headers: {
              origin: clientOrigin,
              cookie: cookieHeader,
              'x-hd-candidate': candidate.candidateId,
              'content-type': 'application/json',
            },
          },
          (response: IncomingMessage) => {
            response.resume();
            response.on('end', () => resolve({ status: response.statusCode ?? 0, timedOut: false }));
          },
        );
        clientRequest.setTimeout(8000, () => {
          clientRequest.destroy();
          resolve({ status: 0, timedOut: true });
        });
        clientRequest.on('error', () => resolve({ status: 0, timedOut: false }));
        if (options.body !== undefined) {
          clientRequest.write(options.body);
        }
        clientRequest.end();
      });

    const oversized = await send({
      method: 'POST',
      path: '/api/foundation-checks',
      body: JSON.stringify({ requestId: crypto.randomUUID(), note: 'x'.repeat(200_000) }),
    });
    expect(oversized.status).toBe(413);

    const followUp = await send({ method: 'GET', path: '/api/foundation-checks' });
    expect(followUp.timedOut).toBe(false);
    expect(followUp.status).toBe(200);

    agent.destroy();
  });

  test('P0-QA-008: server responses carry their hardening headers', async ({ page }) => {
    // Addressed to the application server, which owns these headers in both
    // run modes. In Frozen Local Certification Mode this is the page document
    // itself; in Rapid Builder Mode the dev server serves the page and this is
    // the server's own HTML response.
    const document = await page.request.get(`${SERVER_ORIGIN}/`, { failOnStatusCode: false });
    const headers = document.headers();
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['x-content-type-options']).toBe('nosniff');

    const api = await page.request.get(`${SERVER_ORIGIN}/api/candidate`);
    expect(api.ok()).toBeTruthy();
    expect(api.headers()['content-security-policy']).toContain("default-src 'self'");
  });
});
