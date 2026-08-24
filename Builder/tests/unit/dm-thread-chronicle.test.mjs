import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  dmThreadFromChronicleEntries,
  formatDirectorProse,
} from '../../dist/shared/communication-contract.js';

test('PQA-157/159: dmThreadFromChronicleEntries rebuilds play thread from Chronicle', () => {
  const thread = dmThreadFromChronicleEntries({
    directorLabel: 'Garrick',
    sceneBanner: 'Improvised chamber — walls and doorways are committed on this table.',
    entries: [
      {
        entryId: 'e1',
        campaignId: 'camp-1',
        kind: 'play_declaration',
        body: 'I inspect the door for traps and pick the lock.',
        createdAt: '2026-08-23T10:00:00.000Z',
        sequence: 1,
      },
      {
        entryId: 'e2',
        campaignId: 'camp-1',
        kind: 'director_ruling',
        body: 'Ready to search the doorway for traps.',
        createdAt: '2026-08-23T10:00:01.000Z',
        sequence: 2,
      },
      {
        entryId: 'e3',
        campaignId: 'camp-1',
        kind: 'token_moved',
        body: 'Regression Hero moved to column 11, row 7.',
        createdAt: '2026-08-23T10:01:00.000Z',
        sequence: 3,
      },
    ],
  });
  assert.equal(thread.length, 3);
  assert.equal(thread[0].speaker, 'player');
  assert.equal(thread[1].speaker, 'dm');
  assert.equal(thread[2].kind, 'mechanics');
});

test('dmThreadFromChronicleEntries seeds opening prompt when Chronicle has no play beats', () => {
  const thread = dmThreadFromChronicleEntries({
    directorLabel: 'Garrick',
    sceneBanner: 'An empty table.',
    entries: [
      {
        entryId: 'e1',
        campaignId: 'camp-1',
        kind: 'campaign_created',
        body: 'Campaign created.',
        createdAt: '2026-08-23T09:00:00.000Z',
        sequence: 1,
      },
    ],
  });
  assert.equal(thread.length, 1);
  assert.equal(thread[0].kind, 'prompt');
  assert.match(thread[0].body, /What do you do\?/);
  assert.notEqual(thread[0].createdAt, '1970-01-01T00:00:00.000Z');
  assert.ok(Date.parse(thread[0].createdAt) > 0);
});

test('formatDirectorProse strips bold markers', () => {
  assert.equal(formatDirectorProse('**Guidance** only'), 'Guidance only');
});
