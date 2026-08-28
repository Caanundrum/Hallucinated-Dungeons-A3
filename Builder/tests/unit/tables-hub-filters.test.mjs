import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  filterMyTables,
  filterOpenTables,
  matchesTablesSearch,
} from '../../dist/shared/tables-hub-filters.js';

const myTables = [
  {
    name: 'Alpha Public',
    visibility: 'public',
    sessionStatusLabel: 'Active',
    activeSeatCount: 1,
    director: { identityLabel: 'Veyra', personalityLabel: 'Seasoned Host' },
  },
  {
    name: 'Beta Private',
    visibility: 'private',
    sessionStatusLabel: 'Not started',
    activeSeatCount: 4,
    director: { identityLabel: 'Garrick', personalityLabel: 'Seasoned Host' },
  },
  {
    name: 'Gamma Suspended',
    visibility: 'public',
    sessionStatusLabel: 'Suspended',
    activeSeatCount: 2,
    director: { identityLabel: 'Veyra', personalityLabel: 'Mystic Guide' },
  },
];

const openTables = [
  {
    name: 'Open Hall',
    ownerDisplayLabel: 'Host One',
    directorIdentityLabel: 'Veyra',
    directorPersonalityLabel: 'Seasoned Host',
    activeSeatCount: 1,
    passwordProtected: false,
  },
  {
    name: 'Locked Vault',
    ownerDisplayLabel: 'Host Two',
    directorIdentityLabel: 'Garrick',
    directorPersonalityLabel: 'Seasoned Host',
    activeSeatCount: 4,
    passwordProtected: true,
  },
];

test('matchesTablesSearch is case-insensitive and ignores empty needles', () => {
  assert.equal(matchesTablesSearch('', 'Quiet chamber'), true);
  assert.equal(matchesTablesSearch('veyra', 'Veyra · Seasoned Host'), true);
  assert.equal(matchesTablesSearch('missing', 'Quiet chamber'), false);
});

test('filterMyTables applies visibility and session filters', () => {
  const publicOnly = filterMyTables(myTables, {
    searchNeedle: '',
    visibility: 'public',
    session: 'all',
    seats: 'all',
  });
  assert.deepEqual(
    publicOnly.map((table) => table.name),
    ['Alpha Public', 'Gamma Suspended'],
  );

  const notStarted = filterMyTables(myTables, {
    searchNeedle: '',
    visibility: 'all',
    session: 'not_started',
    seats: 'all',
  });
  assert.deepEqual(notStarted.map((table) => table.name), ['Beta Private']);
});

test('filterMyTables applies seat-capacity filters', () => {
  const openSeats = filterMyTables(myTables, {
    searchNeedle: '',
    visibility: 'all',
    session: 'all',
    seats: 'open_seats',
  });
  assert.deepEqual(openSeats.map((table) => table.name), ['Alpha Public', 'Gamma Suspended']);

  const full = filterMyTables(myTables, {
    searchNeedle: '',
    visibility: 'all',
    session: 'all',
    seats: 'full',
  });
  assert.deepEqual(full.map((table) => table.name), ['Beta Private']);
});

test('filterOpenTables applies password and seat filters', () => {
  const passwordOnly = filterOpenTables(openTables, {
    searchNeedle: '',
    seats: 'all',
    join: 'password',
  });
  assert.deepEqual(passwordOnly.map((table) => table.name), ['Locked Vault']);

  const openJoinWithSeats = filterOpenTables(openTables, {
    searchNeedle: '',
    seats: 'open_seats',
    join: 'open_join',
  });
  assert.deepEqual(openJoinWithSeats.map((table) => table.name), ['Open Hall']);
});
