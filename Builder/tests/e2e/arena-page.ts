import { expect, type Page, type Request } from '@playwright/test';

/**
 * Page helpers shared by the smoke spine and the Phase 0 self-play journey.
 * They drive the rendered page the way a person does: click the control, wait
 * for the visible result, and read what the page actually shows.
 */

export const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Origin of the application server itself.
 *
 * In Frozen Local Certification Mode the server also serves the page, so this
 * equals the page origin. In Rapid Builder Mode the page comes from the dev
 * server, and tests that assert server behavior must address the server.
 */
export const SERVER_ORIGIN =
  process.env.HD_E2E_SERVER_URL ?? process.env.HD_E2E_BASE_URL ?? 'http://127.0.0.1:5173';

/**
 * Opens the Local Arena diagnostics page and waits for the candidate strip to
 * be populated. The Phase 0 write/read journey moved from the site root to
 * `/diagnostics` once the Phase 1 shell took over the root route; this helper
 * is kept pointed at wherever that journey actually lives so every test
 * written against it did not need to change individually.
 */
export async function openArena(page: Page): Promise<void> {
  await page.goto('/diagnostics');
  await expect(page.getByTestId('candidate-id')).not.toBeEmpty();
}

/** Signs in with a server-minted development identity and returns its account id. */
export async function enterArena(page: Page): Promise<string> {
  // Prefer the diagnostics control when it is already on screen. Using the shell
  // Sign in path while parked on /diagnostics remounts the page and races the
  // bootstrap fetch against later session teardown (P0-QA-009 second half).
  const diagnosticsEnter = page.getByTestId('enter-arena');
  if (await diagnosticsEnter.isVisible().catch(() => false)) {
    await diagnosticsEnter.click();
    await expect(page.getByTestId('account-id')).toBeVisible();
    await expect(page.getByTestId('record-submit')).toBeVisible();
    // account-id appears before handleEnter clears busy; wait out the in-flight
    // projection fetch or keyboard/form submits silently no-op.
    await expect(page.getByTestId('record-submit')).toHaveAttribute('aria-disabled', 'false');
    return (await page.getByTestId('account-id').innerText()).trim();
  }

  const shellEnter = page.getByTestId('shell-enter-account');
  if (await shellEnter.isVisible().catch(() => false)) {
    await shellEnter.click();
    await expect(page.getByTestId('shell-account-link')).toBeVisible();
    await page.getByTestId('nav-diagnostics').click();
    await expect(page.getByTestId('account-id')).toBeVisible();
    await expect(page.getByTestId('record-submit')).toBeVisible();
    await expect(page.getByTestId('record-submit')).toHaveAttribute('aria-disabled', 'false');
    return (await page.getByTestId('account-id').innerText()).trim();
  }

  await page.getByTestId('enter-arena').click();
  await expect(page.getByTestId('account-id')).toBeVisible();
  await expect(page.getByTestId('record-submit')).toBeVisible();
  await expect(page.getByTestId('record-submit')).toHaveAttribute('aria-disabled', 'false');
  return (await page.getByTestId('account-id').innerText()).trim();
}

/** Signs in from the shell account chip without visiting diagnostics. */
export async function enterAccountFromShell(page: Page): Promise<void> {
  await expect(page.getByTestId('shell-enter-account')).toBeVisible();
  await page.getByTestId('shell-enter-account').click();
  await expect(page.getByTestId('shell-account-link')).toBeVisible();
}

/** Submits a foundation check and waits for the page to settle. */
export async function recordCheck(page: Page, note: string): Promise<void> {
  await page.getByTestId('note-input').fill(note);
  await page.getByTestId('record-submit').click();
  await expect(page.getByTestId('record-submit')).toHaveAttribute('aria-disabled', 'false');
}

/**
 * Records Session Zero with defaults from the campaign detail page.
 * Required before seating or opening the table dock (PQA-086).
 */
export async function recordDefaultSessionZero(page: Page): Promise<void> {
  const summary = page.getByTestId('session-zero-summary');
  if (await summary.isVisible().catch(() => false)) {
    const text = await summary.innerText();
    if (text.includes('recorded') && !text.includes('not recorded')) {
      return;
    }
  }
  await page.getByTestId('open-campaign-settings').click();
  await expect(page.getByTestId('campaign-settings-heading')).toBeVisible();
  await page.getByTestId('complete-session-zero').click();
  await expect(page.getByTestId('settings-notice')).toContainText(
    /Session Zero (recorded|updated)/i,
  );
  await page.getByTestId('settings-back').click();
  await expect(page.getByTestId('campaign-detail-heading')).toBeVisible();
  await expect(page.getByTestId('session-zero-summary')).toContainText('recorded');
}

/** Opens training / developer controls on the campaign table dashboard. */
export async function openTableAdvancedControls(page: Page): Promise<void> {
  await page.getByTestId('table-info-tab-tools').click();
  await expect(page.getByTestId('table-tools-panel')).toBeVisible();
  const details = page.getByTestId('table-advanced-controls');
  await expect(details).toBeVisible();
  if ((await details.getAttribute('open')) === null) {
    await details.locator('summary').click();
  }
  await expect(details).toHaveAttribute('open', '');
  await expect(page.getByTestId('begin-encounter')).toBeVisible();
}

/** Opens the footer Table details panel so presence / state meta are visible. */
export async function openTablePresencePanel(page: Page): Promise<void> {
  const details = page.getByTestId('presence-section');
  await expect(details).toBeVisible();
  if ((await details.getAttribute('open')) === null) {
    await details.locator('summary').click();
  }
  await expect(details).toHaveAttribute('open', '');
  await expect(page.getByTestId('presence-panel')).toBeVisible();
}

/** Closes the footer Table details panel so it does not cover dock controls. */
export async function closeTablePresencePanel(page: Page): Promise<void> {
  const details = page.getByTestId('presence-section');
  if ((await details.getAttribute('open')) !== null) {
    await details.locator('summary').click();
  }
  await expect(details).not.toHaveAttribute('open', '');
}

/** Reads the notes currently rendered from the server projection. */
export async function renderedNotes(page: Page): Promise<string[]> {
  return page.getByTestId('record-note').allInnerTexts();
}

/** Reads the projection version the page is displaying. */
export async function projectionVersion(page: Page): Promise<number> {
  return Number((await page.getByTestId('projection-version').innerText()).trim());
}

/**
 * Records every request the page makes so a journey can prove the running
 * candidate never reaches beyond loopback (Section 1.11.8 fail-closed
 * isolation, and the Phase 0 outbound-origin check).
 */
export function collectRequestHosts(page: Page): { hosts: Set<string>; urls: string[] } {
  const hosts = new Set<string>();
  const urls: string[] = [];
  page.on('request', (request: Request) => {
    const url = new URL(request.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') {
      return;
    }
    hosts.add(url.hostname);
    urls.push(request.url());
  });
  return { hosts, urls };
}

/** Reads the candidate identity the running server reports. */
export async function readCandidate(page: Page): Promise<{
  candidateId: string;
  runtimeMode: string;
  environmentClass: string;
}> {
  const response = await page.request.get('/api/candidate');
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as {
    candidateId: string;
    runtimeMode: string;
    environmentClass: string;
  };
}
