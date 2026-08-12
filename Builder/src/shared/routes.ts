/**
 * Canonical route table, shared by the client router and the server so the
 * two cannot drift apart.
 *
 * Blueprint ownership: Section 25 Phase 1 build scope (stable navigation) and
 * Section 1.8.4 (stable hosted legal routes).
 *
 * Legal routes are deliberately not part of the single-page application. They
 * are plain server-rendered documents so they remain readable without script
 * execution, per Section 1.8.4's requirement that each route display
 * "accessibility-compliant content without required script execution." Only
 * `SPA_ROUTES` are client-rendered pages that need the built bundle served for
 * a hard navigation or reload.
 */

export const SPA_ROUTES = ['/', '/diagnostics', '/characters', '/characters/new'] as const;
export type SpaRoute = (typeof SPA_ROUTES)[number];

/**
 * Parameterized single-page routes. A path matching one of these is served
 * the built bundle on a hard navigation, the same as a fixed route, while
 * anything else still receives the honest 404 document.
 */
const SPA_ROUTE_PATTERNS: readonly RegExp[] = [/^\/characters\/[A-Za-z0-9-]{1,64}$/];

export const LEGAL_ROUTES = [
  '/legal/terms',
  '/legal/privacy',
  '/legal/alpha-participation',
  '/legal/content-and-safety',
] as const;
export type LegalRoute = (typeof LEGAL_ROUTES)[number];

export function isSpaRoute(path: string): boolean {
  return (
    (SPA_ROUTES as readonly string[]).includes(path) ||
    SPA_ROUTE_PATTERNS.some((pattern) => pattern.test(path))
  );
}

/** The character id in a `/characters/:id` route, or null for any other path. */
export function characterIdFromPath(path: string): string | null {
  const match = /^\/characters\/([A-Za-z0-9-]{1,64})$/.exec(path);
  if (match === null || match[1] === 'new') {
    return null;
  }
  return match[1] ?? null;
}

export function isLegalRoute(path: string): path is LegalRoute {
  return (LEGAL_ROUTES as readonly string[]).includes(path);
}
