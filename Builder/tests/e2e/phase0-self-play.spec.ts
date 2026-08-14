import { expect, test } from '@playwright/test';

import {
  collectRequestHosts,
  enterArena,
  LOOPBACK_HOSTS,
  openArena,
  projectionVersion,
  readCandidate,
  recordCheck,
  renderedNotes,
} from './arena-page.js';

/**
 * Phase 0 actual-page journey and adversarial coverage.
 *
 * Blueprint ownership: Section 25 Phase 0 "Builder and QA page proof" —
 * "development identity, write/read, refresh, retry/failure, and
 * outbound-origin check", plus the bypasses QA is expected to attempt: wrong
 * origin, stale page, duplicate submission, and direct navigation.
 */
test.describe('Phase 0 player journey', () => {
  test('a full pass: enter, write, read, refresh, and recover the same state', async ({ page }) => {
    const traffic = collectRequestHosts(page);

    await openArena(page);
    const accountId = await enterArena(page);

    await recordCheck(page, 'first check before refresh');
    await recordCheck(page, 'second check before refresh');

    expect(await renderedNotes(page)).toEqual([
      'second check before refresh',
      'first check before refresh',
    ]);
    expect(await projectionVersion(page)).toBe(2);

    await page.reload();

    // The session and the persisted records survive a full page reload, which
    // is the Phase 0 proof that state lives in the emulator, not in the tab.
    await expect(page.getByTestId('account-id')).toHaveText(accountId);
    await expect(page.getByTestId('record-note').first()).toBeVisible();
    expect(await renderedNotes(page)).toEqual([
      'second check before refresh',
      'first check before refresh',
    ]);
    expect(await projectionVersion(page)).toBe(2);

    // Outbound-origin check: nothing this candidate loads or calls leaves the
    // loopback interface.
    const offLoopback = [...traffic.hosts].filter((host) => !LOOPBACK_HOSTS.has(host));
    expect(offLoopback, `unexpected outbound hosts: ${traffic.urls.join(', ')}`).toEqual([]);
  });

  test('failure and retry: a lost response does not commit the note twice', async ({ page }) => {
    await openArena(page);
    await enterArena(page);
    await recordCheck(page, 'baseline before the failure');
    expect(await projectionVersion(page)).toBe(1);

    // Let the server commit the request, then drop the response so the browser
    // sees a network failure with an unknown outcome. This is the exact case
    // the request identifier exists for.
    let intercepted = 0;
    await page.route('**/api/foundation-checks', async (route) => {
      if (route.request().method() !== 'POST' || intercepted > 0) {
        await route.continue();
        return;
      }
      intercepted += 1;
      await route.fetch();
      await route.abort('failed');
    });

    await page.getByTestId('note-input').fill('committed but never acknowledged');
    await page.getByTestId('record-submit').click();

    const error = page.getByTestId('error-message');
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute('data-error-code', 'UPSTREAM_UNAVAILABLE');

    await page.getByTestId('retry-submission').click();

    // The retry re-sends the same intent, so the server returns the original
    // record rather than writing a second one.
    await expect(page.getByTestId('notice-message')).toContainText('already recorded');
    expect(await projectionVersion(page)).toBe(2);
    expect(await renderedNotes(page)).toEqual([
      'committed but never acknowledged',
      'baseline before the failure',
    ]);
  });

  test('validation failure is explained on the page and writes nothing', async ({ page }) => {
    await openArena(page);
    await enterArena(page);

    await page.getByTestId('note-input').fill('   ');
    await page.getByTestId('record-submit').click();

    const error = page.getByTestId('error-message');
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute('data-error-code', 'NOTE_EMPTY');
    await expect(page.getByTestId('empty-state')).toBeVisible();
    expect(await projectionVersion(page)).toBe(0);

    await page.getByTestId('note-input').fill('x'.repeat(121));
    await page.getByTestId('record-submit').click();
    await expect(error).toHaveAttribute('data-error-code', 'NOTE_TOO_LONG');
    expect(await projectionVersion(page)).toBe(0);
  });

  test('records are owned by one account and are not visible to another', async ({ browser }) => {
    const firstContext = await browser.newContext();
    const firstPage = await firstContext.newPage();
    await openArena(firstPage);
    await enterArena(firstPage);
    await recordCheck(firstPage, 'private to the first account');
    expect(await renderedNotes(firstPage)).toEqual(['private to the first account']);

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await openArena(secondPage);
    await enterArena(secondPage);

    await expect(secondPage.getByTestId('empty-state')).toBeVisible();
    expect(await renderedNotes(secondPage)).toEqual([]);
    expect(await projectionVersion(secondPage)).toBe(0);

    await firstContext.close();
    await secondContext.close();
  });

  test('a stale page cannot commit into a different candidate', async ({ page }) => {
    await openArena(page);
    await enterArena(page);

    // Simulate the page having been loaded from an earlier candidate.
    await page.route('**/api/foundation-checks', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      const headers = { ...route.request().headers(), 'x-hd-candidate': 'cand-000000000000' };
      await route.continue({ headers });
    });

    await page.getByTestId('note-input').fill('submitted from a stale page');
    await page.getByTestId('record-submit').click();

    await expect(page.getByTestId('error-message')).toHaveAttribute(
      'data-error-code',
      'CANDIDATE_MISMATCH',
    );
    await expect(page.getByTestId('stale-candidate-banner')).toBeVisible();
    expect(await projectionVersion(page)).toBe(0);
  });

  test('a request from another origin is refused', async ({ page, baseURL }) => {
    await openArena(page);
    await enterArena(page);
    const candidate = await readCandidate(page);

    const response = await page.request.post(`${baseURL}/api/foundation-checks`, {
      headers: {
        origin: 'http://attacker.invalid',
        'x-hd-candidate': candidate.candidateId,
        'content-type': 'application/json',
      },
      data: { requestId: crypto.randomUUID(), note: 'cross-origin attempt' },
      failOnStatusCode: false,
    });

    expect(response.status()).toBe(403);
    expect((await response.json()).error).toBe('FORBIDDEN_ORIGIN');

    await page.reload();
    await expect(page.getByTestId('empty-state')).toBeVisible();
  });

  test('direct navigation to an unknown route exposes no account state', async ({ page }) => {
    await openArena(page);
    await enterArena(page);
    const candidate = await readCandidate(page);

    const response = await page.goto('/admin/secret-route');
    const body = await page.content();

    if (candidate.runtimeMode === 'frozen_certification') {
      // The frozen runtime serves the built bundle and answers an unknown path
      // with a real 404 rather than pretending the route exists.
      expect(response?.status()).toBe(404);
      expect(body).toContain('No page exists at /admin/secret-route');
    } else {
      // The Rapid Builder dev server falls back to the app shell. The contract
      // that matters in both modes is that no account state is disclosed.
      expect(body).not.toContain('dev-');
    }
    expect(body).not.toContain('private to the first account');
  });

  test('the unauthenticated API refuses to return records', async ({ page, baseURL }) => {
    const response = await page.request.get(`${baseURL}/api/foundation-checks`, {
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(401);
    expect((await response.json()).error).toBe('NOT_AUTHENTICATED');
  });

  test('leaving the arena ends the session but preserves the stored records', async ({ page }) => {
    await openArena(page);
    const accountId = await enterArena(page);
    await recordCheck(page, 'kept across sign out');

    await page.getByTestId('leave-arena').click();
    await expect(page.getByTestId('enter-arena')).toBeVisible();
    await expect(page.getByTestId('record-form')).toBeHidden();

    await page.reload();
    await expect(page.getByTestId('enter-arena')).toBeVisible();

    // A new identity is a different account and starts empty; the earlier
    // account's records were not deleted, they are simply not this account's.
    const newAccountId = await enterArena(page);
    expect(newAccountId).not.toBe(accountId);
    await expect(page.getByTestId('empty-state')).toBeVisible();
  });

  test('the journey is operable by keyboard alone', async ({ page }) => {
    await openArena(page);

    await page.getByTestId('enter-arena').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('account-id')).toBeVisible();

    await page.getByTestId('note-input').focus();
    await page.keyboard.type('recorded using only the keyboard');
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('notice-message')).toContainText('Recorded sequence 1');
    expect(await renderedNotes(page)).toEqual(['recorded using only the keyboard']);
  });
});
