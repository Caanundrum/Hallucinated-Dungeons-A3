/**
 * Free-roam contention + NPC spotlight contracts.
 *
 * Competing free-roam beats and Speak-as-Character floors share one table
 * timeline. Mechanics still commit through stateVersion CAS; these types only
 * explain conflicts and serialize social spotlight.
 */

export const TABLE_CONFLICT_REASONS = [
  'same_door',
  'overlapping_move',
  'scene_lock',
  'version_race',
  'npc_spotlight',
] as const;
export type TableConflictReason = (typeof TABLE_CONFLICT_REASONS)[number];

export function isTableConflictReason(value: unknown): value is TableConflictReason {
  return (
    typeof value === 'string' &&
    (TABLE_CONFLICT_REASONS as readonly string[]).includes(value)
  );
}

/** Structured conflict payload returned with STALE / spotlight failures. */
export interface TableConflictDetail {
  readonly reason: TableConflictReason;
  readonly message: string;
  readonly edgeId?: string;
  readonly contestedSquares?: readonly {
    readonly column: number;
    readonly row: number;
  }[];
  readonly competingSummary?: string;
  readonly holderDisplayName?: string;
  readonly npcId?: string;
  readonly npcName?: string;
  readonly serverStateVersion?: number;
}

/** Short-lived Speak-as-Character floor for one NPC. */
export interface NpcSpotlightProjection {
  readonly npcId: string;
  readonly npcName: string;
  readonly holderSeatId: string;
  readonly holderAccountId: string;
  readonly holderDisplayName: string;
  readonly claimedAt: string;
  readonly expiresAt: string;
  readonly lastMessagePreview: string | null;
}

/** How long one seat may hold the NPC floor before others may claim it. */
export const NPC_SPOTLIGHT_TTL_MS = 45_000;
