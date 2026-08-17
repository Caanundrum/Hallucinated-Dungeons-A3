/**
 * Public surface / Gold Master artifact profile.
 *
 * Blueprint ownership: Section 25 Phase 7 — hosted artifacts must strip
 * Local Arena development identities, QA fixtures, and QA harness endpoints.
 * The Local Execution Environment may still expose those capabilities.
 *
 * `publicSurface` is independent of `environmentClass`. This host only runs
 * `environmentClass=local` (emulators). Gold Master fail-closed behavior is
 * rehearsed by setting `publicSurface=gold_master` without pretending the
 * process is Launch Production.
 */

export const PUBLIC_SURFACES = ['local_arena', 'gold_master'] as const;
export type PublicSurface = (typeof PUBLIC_SURFACES)[number];

export function isPublicSurface(value: unknown): value is PublicSurface {
  return value === 'local_arena' || value === 'gold_master';
}

/** Capabilities that must fail closed on Gold Master / hosted artifacts. */
export const GOLD_MASTER_STRIPPED_CAPABILITIES = [
  'development_identity_mint',
  'qa_fixture_session_mint',
  'qa_progression_harness',
  'diagnostics_fixture_controls',
] as const;

export type GoldMasterStrippedCapability =
  (typeof GOLD_MASTER_STRIPPED_CAPABILITIES)[number];

export const BROWSER_SUPPORT_MATRIX = [
  {
    id: 'chrome',
    label: 'Chrome (current stable desktop)',
    status: 'certified_chromium_class',
  },
  {
    id: 'edge',
    label: 'Edge (current stable desktop)',
    status: 'certified_chromium_class',
  },
  {
    id: 'firefox',
    label: 'Firefox (current stable desktop)',
    status: 'ordinary_regression_when_available',
  },
  {
    id: 'safari',
    label: 'Safari (current stable desktop)',
    status: 'not_yet_certified',
  },
  {
    id: 'tablet',
    label: 'Certified tablet hardware',
    status: 'not_yet_certified',
  },
  {
    id: 'phone',
    label: 'Mobile phone full tactical table',
    status: 'unsupported',
  },
] as const;

export type BrowserSupportStatus =
  (typeof BROWSER_SUPPORT_MATRIX)[number]['status'];

export const ELIGIBILITY_POLICY = {
  status: 'inactive',
  ageGate: 'not_required_by_selected_provider',
  notice:
    'Adult-eligibility collection stays inactive unless a selected hosted provider or applicable law requires an age restriction. This candidate does not collect an adult affirmation merely because the schema exists.',
} as const;

export function allowsLocalArenaOnlyCapability(surface: PublicSurface): boolean {
  return surface === 'local_arena';
}
