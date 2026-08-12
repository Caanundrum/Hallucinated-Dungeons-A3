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

export const SPA_ROUTES = ['/', '/diagnostics'] as const;
export type SpaRoute = (typeof SPA_ROUTES)[number];

export const LEGAL_ROUTES = [
  '/legal/terms',
  '/legal/privacy',
  '/legal/alpha-participation',
  '/legal/content-and-safety',
] as const;
export type LegalRoute = (typeof LEGAL_ROUTES)[number];

export function isSpaRoute(path: string): path is SpaRoute {
  return (SPA_ROUTES as readonly string[]).includes(path);
}

export function isLegalRoute(path: string): path is LegalRoute {
  return (LEGAL_ROUTES as readonly string[]).includes(path);
}
