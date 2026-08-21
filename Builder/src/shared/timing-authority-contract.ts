/**
 * Phase 2d Timing Authority and Intent Intercept contracts.
 *
 * Blueprint ownership: Sections 11.10, 1.5.2.5, 10.12.5, and Phase 2 Timing
 * Authority / Action Composer plumbing. Clients never mint authorities.
 */

import type { IntentDraftCommandType } from './intent-draft-contract.js';
import type { AreaTarget } from './rules-combat-contract.js';

export const TIMING_AUTHORITY_SCHEMA_VERSION = 'phase3-timing-v1' as const;

/** Server-issued opportunities; Reaction and Decision windows are single-use. */
export const TIMING_OPPORTUNITY_CLASSES = ['active_turn', 'reaction', 'decision'] as const;
export type TimingOpportunityClass = (typeof TIMING_OPPORTUNITY_CLASSES)[number];

export const TIMING_AUTHORITY_STATES = [
  'issued',
  'consumed',
  'revoked',
  'expired',
  'superseded',
] as const;
export type TimingAuthorityState = (typeof TIMING_AUTHORITY_STATES)[number];

/** Commands that may be initiated during the holder's Active Turn. */
export const ACTIVE_TURN_PERMITTED_COMMANDS = [
  'table.sync',
  'table.move',
  'table.open_door',
  'encounter.begin',
  'initiative.roll',
  'encounter.next_turn',
  'combat.attack',
  'combat.cast_spell',
  'combat.death_save',
  'combat.short_rest',
  'combat.long_rest',
  'combat.ready',
  'combat.training_drop',
  'progression.award_xp',
  'progression.level_up',
  'inventory.use_item',
] as const;

export const REACTION_PERMITTED_COMMANDS = ['combat.reaction'] as const;

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
  readonly proposedCommandType: IntentDraftCommandType;
  readonly summary: string;
  readonly path?: readonly { readonly column: number; readonly row: number }[];
  readonly edgeId?: string;
  readonly targetCombatantId?: string;
  readonly spellId?: string;
  readonly itemId?: string;
  readonly attackId?: string;
  readonly area?: AreaTarget;
  readonly projectionVersionAtIssue?: number;
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
