/**
 * Phase 0 shared contract between the browser client and the local server.
 *
 * Blueprint ownership: Section 25 Phase 0 build scope ("minimal approved
 * application/server/shared-package structure"). Everything here describes the
 * canonical Phase 0 foundation path only. Character, campaign, tactical, and
 * rules contracts belong to later phases and are deliberately absent.
 */

export const ENVIRONMENT_CLASSES = ['local', 'milestone', 'launch'] as const;
export type EnvironmentClass = (typeof ENVIRONMENT_CLASSES)[number];

export const RUNTIME_MODES = ['rapid_builder', 'frozen_certification'] as const;
export type RuntimeMode = (typeof RUNTIME_MODES)[number];

/** Version of the `HD_*` environment-variable schema this candidate accepts. */
export const ENVIRONMENT_SCHEMA_VERSION = '1';

/** Maximum length of a Phase 0 foundation-check note, in characters. */
export const FOUNDATION_NOTE_MAX_LENGTH = 120;

/**
 * Machine-readable failure codes. The client renders player-facing text from
 * these codes so a failure is never an unexplained blank screen.
 */
export const ERROR_CODES = {
  ABILITY_ROLLS_EXHAUSTED: 'ABILITY_ROLLS_EXHAUSTED',
  ALREADY_MEMBER: 'ALREADY_MEMBER',
  ALREADY_SEATED: 'ALREADY_SEATED',
  BAD_REQUEST: 'BAD_REQUEST',
  CANDIDATE_MISMATCH: 'CANDIDATE_MISMATCH',
  CHARACTER_INCOMPLETE: 'CHARACTER_INCOMPLETE',
  DIRECTOR_CONFIG_LOCKED: 'DIRECTOR_CONFIG_LOCKED',
  FORBIDDEN_ORIGIN: 'FORBIDDEN_ORIGIN',
  IDENTITY_ROUTE_UNAVAILABLE: 'IDENTITY_ROUTE_UNAVAILABLE',
  INVITATION_UNAVAILABLE: 'INVITATION_UNAVAILABLE',
  INVITATION_RATE_LIMITED: 'INVITATION_RATE_LIMITED',
  NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
  NOT_FOUND: 'NOT_FOUND',
  NOTE_EMPTY: 'NOTE_EMPTY',
  NOTE_TOO_LONG: 'NOTE_TOO_LONG',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  REQUEST_ID_INVALID: 'REQUEST_ID_INVALID',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  STALE_STATE_VERSION: 'STALE_STATE_VERSION',
  NOT_SEATED: 'NOT_SEATED',
  ILLEGAL_PATH: 'ILLEGAL_PATH',
  TIMING_AUTHORITY_REQUIRED: 'TIMING_AUTHORITY_REQUIRED',
  TIMING_AUTHORITY_INVALID: 'TIMING_AUTHORITY_INVALID',
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiErrorBody {
  readonly error: ErrorCode;
  readonly message: string;
}

/** Identity of the running candidate, safe to expose to the browser. */
export interface CandidateIdentity {
  readonly candidateId: string;
  readonly blueprintVersion: string;
  readonly environmentClass: EnvironmentClass;
  readonly runtimeMode: RuntimeMode;
  readonly firebaseProjectId: string;
  readonly environmentSchemaVersion: string;
}

/**
 * Server-produced projection of the signed-in Development Test Identity.
 * The browser renders this; it never invents or edits identity fields.
 */
export interface DevelopmentIdentityProjection {
  readonly accountId: string;
  readonly displayLabel: string;
  readonly identityMode: 'development_test_identity';
  readonly expiresAt: string;
}

/**
 * Phase 1 account surface. Same Development Test Identity, projected as the
 * ordinary account the product uses for ownership and navigation. No second
 * identity provider is introduced (Section 1.5.20; P1-ACCOUNT-PROJECTION).
 */
export type AccountProjection = DevelopmentIdentityProjection;

/** Server-produced projection of one persisted foundation check. */
export interface FoundationCheckProjection {
  readonly checkId: string;
  readonly note: string;
  readonly recordedAt: string;
  readonly sequence: number;
}

/**
 * Owner-scoped projection of everything the Phase 0 page renders about
 * persisted state. `projectionVersion` increments on every accepted canonical
 * write so the page can prove it is showing server truth rather than a local
 * echo of what the player typed.
 *
 * `checks` carries at most {@link PROJECTION_PAGE_SIZE} entries; `totalCount`
 * is the true number stored for the account, so the page can say when the list
 * it is showing is partial instead of quietly truncating.
 */
export interface FoundationProjection {
  readonly accountId: string;
  readonly projectionVersion: number;
  readonly totalCount: number;
  readonly checks: readonly FoundationCheckProjection[];
}

/** Number of most recent checks the owner projection returns. */
export const PROJECTION_PAGE_SIZE = 20;

export interface CreateFoundationCheckRequest {
  readonly requestId: string;
  readonly note: string;
}

/**
 * Result of an accepted foundation-check submission. `duplicate` is true when
 * the same `requestId` was already committed, which is how a retried or
 * double-submitted request returns the original record instead of writing a
 * second one.
 */
export interface CreateFoundationCheckResponse {
  readonly duplicate: boolean;
  readonly check: FoundationCheckProjection;
  readonly projection: FoundationProjection;
}

export interface HealthResponse {
  readonly status: 'ready' | 'degraded';
  readonly candidate: CandidateIdentity;
  readonly checks: {
    readonly firestoreEmulator: boolean;
    readonly authEmulator: boolean;
  };
}

/** Header carrying the candidate identity the loaded page was built against. */
export const CANDIDATE_HEADER = 'x-hd-candidate';

/** Name of the http-only session cookie issued to a development identity. */
export const SESSION_COOKIE_NAME = 'hd_dev_session';

const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

/**
 * Validates a foundation-check note. Returns the trimmed note or the exact
 * failure code the player-facing message is derived from.
 */
export function validateNote(
  value: unknown,
): { ok: true; note: string } | { ok: false; code: ErrorCode } {
  if (typeof value !== 'string') {
    return { ok: false, code: ERROR_CODES.BAD_REQUEST };
  }
  const note = value.trim();
  if (note.length === 0) {
    return { ok: false, code: ERROR_CODES.NOTE_EMPTY };
  }
  if (note.length > FOUNDATION_NOTE_MAX_LENGTH) {
    return { ok: false, code: ERROR_CODES.NOTE_TOO_LONG };
  }
  return { ok: true, note };
}
