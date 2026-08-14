/**
 * Phase 2 command / event / table-projection contracts.
 *
 * Blueprint ownership: Section 25 Phase 2 ("canonical command acceptance, event
 * log, projection publication, state versioning, … idempotency") and
 * Sections 9.14.2, 11.3–11.4, 19.7–19.8.
 *
 * Chunk 2a ships the authority pipeline with a single seated-member command
 * type (`table.sync`) so later map/movement commands reuse the same gate.
 */

/** Commands the Phase 2 gateway accepts. */
export const TABLE_COMMAND_TYPES = ['table.sync', 'table.move', 'table.open_door'] as const;
export type TableCommandType = (typeof TABLE_COMMAND_TYPES)[number];

export const TABLE_EVENT_TYPES = [
  'table.state_synced',
  'table.token_moved',
  'table.door_opened',
] as const;
export type TableEventType = (typeof TABLE_EVENT_TYPES)[number];

export function isTableCommandType(value: unknown): value is TableCommandType {
  return typeof value === 'string' && (TABLE_COMMAND_TYPES as readonly string[]).includes(value);
}

/** Client → server command submission body. Device session binds on the server. */
export interface TableCommandRequest {
  readonly requestId: string;
  readonly commandType: TableCommandType;
  readonly expectedStateVersion: number;
  /** Server-issued Active Turn Timing Authority id (Phase 2d). */
  readonly timingAuthorityId?: string;
  /** Ordered destination squares after the current anchor (table.move). */
  readonly path?: readonly { readonly column: number; readonly row: number }[];
  /** Door edge id (table.open_door). */
  readonly edgeId?: string;
}

/** One immutable event in the campaign table log. */
export interface TableEventProjection {
  readonly eventId: string;
  readonly eventSequence: number;
  readonly eventType: TableEventType;
  readonly commandId: string;
  readonly requestId: string;
  readonly actorAccountId: string;
  readonly seatId: string;
  readonly priorStateVersion: number;
  readonly resultStateVersion: number;
  readonly committedAt: string;
}

/** Server-authored table projection the page may render. */
export interface TableStateProjection {
  readonly campaignId: string;
  readonly stateVersion: number;
  readonly lastEventSequence: number;
  readonly lastEventId: string | null;
  readonly updatedAt: string | null;
  readonly recentEvents: readonly TableEventProjection[];
}

export interface TableCommandAcceptResponse {
  readonly duplicate: boolean;
  readonly commandId: string;
  readonly requestId: string;
  readonly event: TableEventProjection;
  readonly table: TableStateProjection;
}

export const TABLE_EVENT_PAGE_SIZE = 20;
