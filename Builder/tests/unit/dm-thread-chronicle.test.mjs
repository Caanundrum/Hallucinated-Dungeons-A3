import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  dmThreadFromChronicleEntries,
  filterOptimisticDmDupes,
  formatDirectorProse,
  formatPlayerFacingTimestamp,
  isEpochPlaceholderTimestamp,
  storyBodiesEquivalent,
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
  const now = new Date('2026-08-24T18:00:00.000Z');
  const thread = dmThreadFromChronicleEntries({
    directorLabel: 'Garrick',
    sceneBanner: 'An empty table.',
    now,
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
  assert.equal(thread[0].messageId, 'opening-prompt');
  assert.match(thread[0].body, /What do you do\?/);
  assert.equal(thread[0].createdAt, now.toISOString());
  assert.ok(!isEpochPlaceholderTimestamp(thread[0].createdAt));
  assert.equal(formatPlayerFacingTimestamp(thread[0].createdAt, now), 'Just now');
});

test('TBL-QA-003: epoch placeholders never surface as 1969/1970 wall times', () => {
  assert.equal(isEpochPlaceholderTimestamp('1970-01-01T00:00:00.000Z'), true);
  assert.equal(formatPlayerFacingTimestamp('1970-01-01T00:00:00.000Z'), 'Just now');
  assert.equal(formatPlayerFacingTimestamp('12/31/1969, 6:00:00 PM'), 'Just now');

  const now = new Date('2026-08-24T18:00:00.000Z');
  const thread = dmThreadFromChronicleEntries({
    directorLabel: 'Veyra',
    sceneBanner: 'The table is ready.',
    now,
    entries: [
      {
        entryId: 'bad-epoch',
        campaignId: 'camp-1',
        kind: 'director_ruling',
        body: 'Legacy epoch stamp.',
        createdAt: '1970-01-01T00:00:00.000Z',
        sequence: 1,
      },
    ],
  });
  assert.equal(thread[0].createdAt, now.toISOString());
  assert.equal(formatPlayerFacingTimestamp(thread[0].createdAt, now), 'Just now');
});

test('formatDirectorProse strips bold markers', () => {
  assert.equal(formatDirectorProse('**Guidance** only'), 'Guidance only');
});

test('filterOptimisticDmDupes drops live DM beats already in chronicle', () => {
  const fromChronicle = [
    {
      messageId: 'c1',
      speaker: 'dm',
      speakerLabel: 'Garrick',
      body: 'Stepped through the open doorway in Quiet chamber. Same scene — Quiet chamber remains current; no location change. A lightly knowing beat lands.',
      createdAt: '2026-08-30T12:00:00.000Z',
      kind: 'ruling_hint',
    },
  ];
  const optimistic = [
    {
      messageId: 'o1',
      speaker: 'dm',
      speakerLabel: 'Garrick',
      body: 'Stepped through the open doorway in Quiet chamber. Same scene — Quiet chamber remains current; no location change. A lightly knowing beat lands.',
      createdAt: '2026-08-30T12:00:01.000Z',
      kind: 'narration',
    },
    {
      messageId: 'o2',
      speaker: 'system',
      speakerLabel: 'Table',
      body: 'Moved across the table.',
      createdAt: '2026-08-30T12:00:01.000Z',
      kind: 'mechanics',
    },
  ];
  const filtered = filterOptimisticDmDupes(fromChronicle, optimistic);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].messageId, 'o2');
  assert.equal(storyBodiesEquivalent(fromChronicle[0].body, optimistic[0].body), true);
});
