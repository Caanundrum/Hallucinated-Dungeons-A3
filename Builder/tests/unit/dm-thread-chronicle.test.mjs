import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CHRONICLE_FILTER_RECAP,
  CHRONICLE_FILTER_STORY,
  collapseDuplicateDmMessages,
  dmThreadFromChronicleEntries,
  filterOptimisticDmDupes,
  formatDirectorProse,
  formatPlayerFacingTimestamp,
  isEpochPlaceholderTimestamp,
  PLAY_CHRONICLE_KINDS,
  RECAP_CHRONICLE_KINDS,
  storyBodiesEquivalent,
} from '../../dist/shared/communication-contract.js';

test('Story so far defaults to recap kinds distinct from full play log', () => {
  assert.equal(CHRONICLE_FILTER_RECAP, 'recap');
  assert.equal(CHRONICLE_FILTER_STORY, 'story');
  assert.ok(RECAP_CHRONICLE_KINDS.has('director_ruling'));
  assert.ok(RECAP_CHRONICLE_KINDS.has('scene_built'));
  assert.ok(RECAP_CHRONICLE_KINDS.has('door_opened'));
  assert.ok(RECAP_CHRONICLE_KINDS.has('play_resolved'));
  assert.equal(RECAP_CHRONICLE_KINDS.has('play_declaration'), false);
  assert.equal(RECAP_CHRONICLE_KINDS.has('token_moved'), false);
  assert.ok(PLAY_CHRONICLE_KINDS.has('play_declaration'));
  assert.ok(PLAY_CHRONICLE_KINDS.has('token_moved'));
  for (const kind of RECAP_CHRONICLE_KINDS) {
    assert.ok(PLAY_CHRONICLE_KINDS.has(kind), `recap kind ${kind} stays inside play kinds`);
  }
});

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

test('collapseDuplicateDmMessages collapses adjacent equivalent DM races', () => {
  const collapsed = collapseDuplicateDmMessages([
    {
      messageId: 'a',
      speaker: 'dm',
      speakerLabel: 'Garrick',
      body: 'You step through the open doorway in Quiet chamber.',
      createdAt: '2026-08-30T12:00:00.000Z',
      kind: 'ruling_hint',
    },
    {
      messageId: 'b',
      speaker: 'system',
      speakerLabel: 'Table',
      body: 'Moved across the table.',
      createdAt: '2026-08-30T12:00:01.000Z',
      kind: 'mechanics',
    },
    {
      messageId: 'c',
      speaker: 'dm',
      speakerLabel: 'Garrick',
      body: 'You step through the open doorway in Quiet chamber. A lightly knowing beat lands.',
      createdAt: '2026-08-30T12:00:02.000Z',
      kind: 'narration',
    },
  ]);
  assert.equal(collapsed.length, 2);
  assert.equal(collapsed[0].messageId, 'a');
  assert.equal(collapsed[1].messageId, 'b');
});

test('R4-01: repeated door-state rulings survive when a player declaration intervenes', () => {
  const answer =
    'You check Wooden doorway east — closed, unlocked without opening it. The lock is unlocked; the leaf is still closed. The doorway stays shut on the table.';
  const collapsed = collapseDuplicateDmMessages([
    {
      messageId: 'hist-player',
      speaker: 'player',
      speakerLabel: 'You',
      body: 'I inspect the wooden doorway east leaf and lock.',
      createdAt: '2026-09-07T12:00:00.000Z',
      kind: 'declaration',
    },
    {
      messageId: 'hist-dm',
      speaker: 'dm',
      speakerLabel: 'Garrick',
      body: answer,
      createdAt: '2026-09-07T12:00:01.000Z',
      kind: 'ruling_hint',
    },
    {
      messageId: 'fresh-player',
      speaker: 'player',
      speakerLabel: 'You',
      body: "I inspect the wooden doorway east's leaf and lock state without opening or closing it.",
      createdAt: '2026-09-08T04:47:00.000Z',
      kind: 'declaration',
    },
    {
      messageId: 'fresh-dm',
      speaker: 'dm',
      speakerLabel: 'Garrick',
      body: answer,
      createdAt: '2026-09-08T04:47:01.000Z',
      kind: 'ruling_hint',
    },
  ]);
  assert.equal(collapsed.length, 4);
  assert.equal(collapsed[3]?.messageId, 'fresh-dm');
});
