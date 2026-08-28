/**
 * Client-side Tables hub filters (PQA-231).
 *
 * Alpha adds discovery filters on fields already present in hub projections.
 * Archive and server-side query filters remain post-Alpha.
 */

import type { CampaignVisibility } from './campaign-contract.js';
import { MAX_ACTIVE_PLAYERS } from './campaign-contract.js';

export type TablesVisibilityFilter = 'all' | 'public' | 'private';
export type TablesSessionFilter = 'all' | 'active' | 'suspended' | 'not_started';
export type TablesSeatsFilter = 'all' | 'open_seats' | 'full';
export type TablesJoinFilter = 'all' | 'password' | 'open_join';

export interface MyTableFilterFields {
  readonly name: string;
  readonly visibility: CampaignVisibility;
  readonly sessionStatusLabel?: string;
  readonly activeSeatCount: number;
  readonly director: {
    readonly identityLabel: string;
    readonly personalityLabel: string;
  };
}

export interface OpenTableFilterFields {
  readonly name: string;
  readonly ownerDisplayLabel: string;
  readonly directorIdentityLabel: string;
  readonly directorPersonalityLabel: string;
  readonly activeSeatCount: number;
  readonly passwordProtected: boolean;
}

export function matchesTablesSearch(needle: string, haystack: string): boolean {
  const trimmed = needle.trim().toLowerCase();
  if (trimmed.length === 0) {
    return true;
  }
  return haystack.toLowerCase().includes(trimmed);
}

export function filterMyTables<T extends MyTableFilterFields>(
  tables: readonly T[],
  options: {
    readonly searchNeedle: string;
    readonly visibility: TablesVisibilityFilter;
    readonly session: TablesSessionFilter;
    readonly seats: TablesSeatsFilter;
    readonly maxActivePlayers?: number;
  },
): T[] {
  const maxSeats = options.maxActivePlayers ?? MAX_ACTIVE_PLAYERS;
  return tables.filter((table) => {
    const searchHaystack = [
      table.name,
      table.director.identityLabel,
      table.director.personalityLabel,
      table.visibility,
      table.sessionStatusLabel ?? '',
    ].join(' ');
    if (!matchesTablesSearch(options.searchNeedle, searchHaystack)) {
      return false;
    }
    if (options.visibility !== 'all' && table.visibility !== options.visibility) {
      return false;
    }
    const sessionLabel = table.sessionStatusLabel ?? 'Not started';
    if (options.session === 'active' && sessionLabel !== 'Active') {
      return false;
    }
    if (options.session === 'suspended' && sessionLabel !== 'Suspended') {
      return false;
    }
    if (options.session === 'not_started' && sessionLabel !== 'Not started') {
      return false;
    }
    if (options.seats === 'open_seats' && table.activeSeatCount >= maxSeats) {
      return false;
    }
    if (options.seats === 'full' && table.activeSeatCount < maxSeats) {
      return false;
    }
    return true;
  });
}

export function filterOpenTables<T extends OpenTableFilterFields>(
  tables: readonly T[],
  options: {
    readonly searchNeedle: string;
    readonly seats: TablesSeatsFilter;
    readonly join: TablesJoinFilter;
    readonly maxActivePlayers?: number;
  },
): T[] {
  const maxSeats = options.maxActivePlayers ?? MAX_ACTIVE_PLAYERS;
  return tables.filter((table) => {
    const searchHaystack = [
      table.name,
      table.ownerDisplayLabel,
      table.directorIdentityLabel,
      table.directorPersonalityLabel,
    ].join(' ');
    if (!matchesTablesSearch(options.searchNeedle, searchHaystack)) {
      return false;
    }
    if (options.seats === 'open_seats' && table.activeSeatCount >= maxSeats) {
      return false;
    }
    if (options.seats === 'full' && table.activeSeatCount < maxSeats) {
      return false;
    }
    if (options.join === 'password' && !table.passwordProtected) {
      return false;
    }
    if (options.join === 'open_join' && table.passwordProtected) {
      return false;
    }
    return true;
  });
}
