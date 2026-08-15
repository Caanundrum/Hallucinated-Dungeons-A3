/**
 * Phase 2d Timing Authority and Intent Intercept contracts.
 *
 * Blueprint ownership: Sections 11.10, 1.5.2.5, 10.12.5, and Phase 2 Timing
 * Authority / Action Composer plumbing. Clients never mint authorities.
 */

export const TIMING_AUTHORITY_SCHEMA_VERSION = 'phase2-timing-v1' as const;

/** Phase 2d ships Active Turn only; later phases add Reaction/Decision classes. */
export const TIMING_OPPORTUNITY_CLASSES = ['active_turn'] as const;
export type TimingOpportunityClass = (typeof TIMING_OPPORTUNITY_CLASSES)[number];

export const TIMING_AUTHORITY_STATES = [
  'issued',
  'consumed',
  'revoked',
  'expired',
  'superseded',
] as const;
export type TimingAuthorityState = (typeof TIMING_AUTHORITY_STATES)[number];

/** Command kinds an Active Turn Authority may permit in Phase 2d. */
export const ACTIVE_TURN_PERMITTED_COMMANDS = [
  'table.sync',
  'table.move',
  'table.open_door',
] as const;

export const INTENT_INTERCEPT_STATES = [
  'draft',
  'awaiting_confirmation',
  'confirmed',
  'cancelled',
  'stale',
] as const;
export type IntentInterceptState = (typeof INTENT_INTERCEPT_STATES)[number];

/** Viewer-safe Timing Authority projection (never the full secret record). */
export interface TimingAuthorityProjection {
  readonly timingAuthorityId: string;
  readonly schemaVersion: typeof TIMING_AUTHORITY_SCHEMA_VERSION;
  readonly opportunityClass: TimingOpportunityClass;
  readonly campaignId: string;
  readonly seatId: string;
  readonly characterId: string;
  readonly accountId: string;
  readonly permittedCommandTypes: readonly string[];
  readonly projectionVersionAtIssue: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly state: TimingAuthorityState;
  readonly singleUse: boolean;
}

export interface TimingAuthorityClaimResponse {
  readonly authority: TimingAuthorityProjection;
  readonly supersededAuthorityId: string | null;
}

/** Noncanonical Action Composer draft awaiting Intent Intercept confirmation. */
export interface ActionDraftSuggestion {
  readonly draftId: string;
  readonly source: 'action_composer_interpret';
  readonly campaignId: string;
  readonly proposedCommandType: 'table.move' | 'table.open_door' | 'table.sync';
  readonly summary: string;
  readonly path?: readonly { readonly column: number; readonly row: number }[];
  readonly edgeId?: string;
  readonly interceptState: IntentInterceptState;
  readonly createdAt: string;
}

export interface IntentInterceptProjection {
  readonly draft: ActionDraftSuggestion;
  readonly timingAuthorityId: string | null;
  readonly canConfirm: boolean;
  readonly notice: string;
}

export function isTimingOpportunityClass(value: unknown): value is TimingOpportunityClass {
  return (
    typeof value === 'string' &&
    (TIMING_OPPORTUNITY_CLASSES as readonly string[]).includes(value)
  );
}

export function isTimingAuthorityState(value: unknown): value is TimingAuthorityState {
  return (
    typeof value === 'string' && (TIMING_AUTHORITY_STATES as readonly string[]).includes(value)
  );
}
