import { expect, test, type Page } from '@playwright/test';

import {SERVER_ORIGIN} from './arena-page.js';

/**
 * Phase 1 chunk 1b actual-page journey: the hosted shell, navigation, the
 * opening identity sequence, legal routes, and the accessibility foundations
 * they all share.
 *
 * Blueprint ownership: Section 25 Phase 1 build scope (design system and
 * shell, opening identity sequence, legal routes, stable navigation,
 * accessibility foundations) and Section 1.8.4/1.8.6 for the legal and
 * cinematic specifics.
 */

const LEGAL_LINKS: ReadonlyArray<{ readonly label: string; readonly route: string }> = [
  { label: 'Terms of Service', route: '/legal/terms' },
  { label: 'Privacy Notice', route: '/legal/privacy' },
  { label: 'Alpha Participation Terms', route: '/legal/alpha-participation' },
  { label: 'Content and Safety Notice', route: '/legal/content-and-safety' },
];

async function dismissIntroIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId('skip-intro');
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
  }
}

test.describe('Phase 1 shell, navigation, opening sequence, and legal routes', () => {
  test('the opening sequence renders real semantic text and is skippable', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('home-heading')).toHaveText('Hallucinated Dungeons');
    await expect(page.getByTestId('intro-overlay')).toBeVisible();
    await expect(page.getByTestId('skip-intro')).toBeVisible();

    await page.getByTestId('skip-intro').click();

    await expect(page.getByTestId('intro-overlay')).toHaveCount(0);
    // The title is plain semantic text, present independently of the intro —
    // skipping the decorative sequence never removes it.
    await expect(page.getByTestId('home-heading')).toHaveText('Hallucinated Dungeons');
    await expect(page.getByTestId('live-region')).toContainText('Introduction skipped');
  });

  test('the opening sequence honors prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    const title = page.getByTestId('home-heading');
    await expect(title).toBeVisible();
    const animationName = await title.evaluate(
      (element) => getComputedStyle(element).animationName,
    );
    expect(animationName).toBe('none');
  });

  test('the opening sequence does not replay on in-app navigation, only on a fresh load', async ({
    page,
  }) => {
    await page.goto('/');
    await dismissIntroIfPresent(page);

    await page.getByTestId('nav-diagnostics').click();
    await expect(page).toHaveURL(/\/diagnostics$/);

    await page.getByTestId('nav-home').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('intro-overlay')).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId('intro-overlay')).toBeVisible();
  });

  test('primary navigation moves between pages without a full page reload', async ({ page }) => {
    await page.goto('/');
    await dismissIntroIfPresent(page);

    // A full document reload creates a fresh JS context, which would destroy
    // this marker. Its survival is direct evidence that the click below was a
    // History API transition, not a browser navigation.
    await page.evaluate(() => {
      (window as unknown as { __noReloadMarker: boolean }).__noReloadMarker = true;
    });

    await page.getByTestId('nav-diagnostics').click();
    await expect(page.getByTestId('diagnostics-heading')).toBeVisible();
    await expect(page.getByTestId('nav-diagnostics')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('nav-home')).not.toHaveAttribute('aria-current', 'page');

    expect(
      await page.evaluate(
        () => (window as unknown as { __noReloadMarker?: boolean }).__noReloadMarker,
      ),
    ).toBe(true);

    await page.getByTestId('nav-home').click();
    await expect(page.getByTestId('home-heading')).toBeVisible();
    await expect(page.getByTestId('nav-home')).toHaveAttribute('aria-current', 'page');
  });

  test('the footer links to every legal document and opens each in a new tab', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    await dismissIntroIfPresent(page);

    for (const { label, route } of LEGAL_LINKS) {
      const link = page.getByTestId('footer-legal-links').getByRole('link', { name: label });
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('href', route);
    }

    const [newTab] = await Promise.all([
      context.waitForEvent('page'),
      page.getByTestId('footer-legal-links').getByRole('link', { name: 'Terms of Service' }).click(),
    ]);
    await newTab.waitForLoadState();
    expect(new URL(newTab.url()).pathname).toBe('/legal/terms');
    await expect(newTab.getByTestId('legal-title')).toHaveText('Terms of Service');
    await newTab.close();

    // The original tab never navigated away, so its state was never disturbed.
    await expect(page.getByTestId('home-heading')).toBeVisible();
  });

  test('each legal document shows its version, dates, working anchors, and a way back', async ({
    page,
  }) => {
    for (const { route } of LEGAL_LINKS) {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);

      await expect(page.getByTestId('legal-title')).toBeVisible();
      await expect(page.getByTestId('legal-version')).not.toBeEmpty();
      const effectiveDate = await page.getByTestId('legal-effective-date').innerText();
      expect(effectiveDate).toMatch(/\d{4}-\d{2}-\d{2}/);

      const anchors = page.getByTestId('legal-anchor-nav').getByRole('link');
      const anchorCount = await anchors.count();
      expect(anchorCount).toBeGreaterThan(0);

      const firstHref = await anchors.first().getAttribute('href');
      expect(firstHref).not.toBeNull();
      await page.goto(`${route}${firstHref}`);
      const targetId = (firstHref ?? '').slice(1);
      await expect(page.locator(`#${targetId}`)).toBeVisible();

      await expect(page.getByTestId('legal-return-link')).toHaveAttribute('href', '/');
    }
  });

  test('an unregistered legal-looking path is a real 404, not a fabricated document', async ({
    page,
  }) => {
    const response = await page.goto(`${SERVER_ORIGIN}/legal/does-not-exist`);
    expect(response?.status()).toBe(404);
    const body = await page.content();
    expect(body).toContain('No page exists at /legal/does-not-exist');
  });

  test('legal pages carry the same hardening headers as the rest of the site', async ({ page }) => {
    const response = await page.request.get(`${SERVER_ORIGIN}/legal/privacy`);
    expect(response.ok()).toBeTruthy();
    const headers = response.headers();
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
  });

  test('a legal document is a complete, readable page even without running the client script', async ({
    page,
  }) => {
    await page.route('**/*.js', (route) => route.abort());
    const response = await page.goto(`${SERVER_ORIGIN}/legal/alpha-participation`);
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId('legal-title')).toHaveText('Alpha Participation Terms');
    await expect(page.getByTestId('legal-anchor-nav').getByRole('link').first()).toBeVisible();
  });

  test('an unlinked path inside the running application shows the honest not-found page', async ({
    page,
  }) => {
    await page.goto('/');
    await dismissIntroIfPresent(page);

    const response = await page.goto('/this-route-was-never-linked');
    // Frozen Local Certification Mode answers unknown paths with a real HTTP
    // 404 document. Rapid Vite may SPA-fallback and render the client not-found.
    const serverHeading = page.getByRole('heading', {
      name: /No page exists at \/this-route-was-never-linked/,
    });
    const spaHeading = page.getByTestId('not-found-heading');
    await expect(serverHeading.or(spaHeading)).toBeVisible();
    if ((await serverHeading.count()) > 0) {
      expect(response?.status()).toBe(404);
      await page.getByRole('link', { name: /Return to Hallucinated Dungeons/i }).click();
    } else {
      await expect(spaHeading).toContainText('No page exists at /this-route-was-never-linked');
      await expect(page.getByTestId('not-found-home-link')).toBeVisible();
      await page.getByTestId('not-found-home-link').click();
    }
    await expect(page.getByTestId('home-heading')).toBeVisible();
  });

  test('the shell is fully operable by keyboard, and the skip link is the first stop', async ({
    page,
  }) => {
    await page.goto('/');

    // The very first render deliberately does not steal focus (see main.ts),
    // so the first Tab press from a fresh load reaches the skip link, exactly
    // as an ordinary static page would behave.
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });

  test('activating the nav links and skip-intro control works from the keyboard alone', async ({
    page,
  }) => {
    await page.goto('/');

    await page.getByTestId('skip-intro').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('intro-overlay')).toHaveCount(0);

    await page.getByTestId('nav-diagnostics').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('diagnostics-heading')).toBeVisible();

    await page.getByTestId('nav-home').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('home-heading')).toBeVisible();
  });

  test('focus moves to the new page heading after a navigation, for screen-reader users', async ({
    page,
  }) => {
    await page.goto('/');
    await dismissIntroIfPresent(page);

    await page.getByTestId('nav-diagnostics').click();
    await expect(page.getByTestId('diagnostics-heading')).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid),
      )
      .toBe('diagnostics-heading');
  });

  test('the build info in the footer names the running candidate and blueprint version', async ({
    page,
  }) => {
    await page.goto('/');
    const buildInfo = page.getByTestId('footer-build-info');
    await expect(buildInfo).toContainText('ALPHA_3_V1');
    await expect(buildInfo).toContainText('cand-');
  });
});
