import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parsePlayerDeclaration,
  resolveIntentAuthority,
} from '../../dist/shared/play-authority-contract.js';
import { buildSkillCheckDraftSummary } from '../../dist/server/table/skill-check-resolve.js';
import { resolveDoorIntentForMap } from '../../dist/server/table/scene-door-intent.js';

function chamberMap(options = {}) {
  const tokenColumn = options.tokenColumn ?? 9;
  const tokenRow = options.tokenRow ?? 6;
  return {
    mapBundleId: 'director:quiet:1',
    mapVersion: 1,
    title: 'Quiet chamber',
    sceneBanner: 'Quiet chamber',
    coordinateSpace: { columns: 12, rows: 8, feetPerSquare: 5 },
    cells: [],
    edges: [
      {
        edgeId: 'e:9:6:east',
        column: 9,
        row: 6,
        orientation: 'east',
        kind: 'door',
        doorState: 'closed',
      },
    ],
    tokens: [
      {
        tokenId: 'tok-1',
        seatId: 'seat-1',
        label: 'Pip',
        footprint: {
          size: 'small',
          width: 1,
          height: 1,
          tinySlot: null,
          elevationFeet: 0,
          anchor: { column: tokenColumn, row: tokenRow },
        },
      },
    ],
    notableFeatures: [],
    viewerSeatId: 'seat-1',
  };
}

test('broad examine/search/investigate room is scene survey, not which-feature', () => {
  for (const text of [
    'I examine the room.',
    'I search the chamber for anything unusual.',
    'I investigate the area carefully.',
    'Loophole surveys the current chamber, looking and listening carefully.',
  ]) {
    const parsed = parsePlayerDeclaration(text);
    assert.ok(
      parsed.actionSequence.some(
        (step) => step.kind === 'inspect' && step.outcomeHint === 'scene_perception',
      ),
      text,
    );
    const authority = resolveIntentAuthority(parsed);
    assert.equal(authority.disposition, 'director_narrate_only', text);
    assert.doesNotMatch(authority.summary, /Which feature/i, text);
  }
  const clarify = buildSkillCheckDraftSummary(null, 'I examine the room.', {
    candidateLabels: ['Wood pile', 'Camp lamp', 'Wooden doorway east'],
  });
  assert.doesNotMatch(clarify, /Which feature are you examining/i);
  assert.match(clarify, /look and listen|perceptible|Game Director/i);
});

test('door check/listen with negation is inspect, never open_door or move', () => {
  const check = parsePlayerDeclaration(
    'I check whether the door is locked, but I do not open it.',
  );
  assert.ok(check.actionSequence.some((step) => step.kind === 'inspect'));
  assert.ok(check.actionSequence.every((step) => step.kind !== 'open_door'));
  assert.ok(check.actionSequence.every((step) => step.kind !== 'move'));
  assert.equal(resolveIntentAuthority(check).disposition, 'director_narrate_only');

  const listen = parsePlayerDeclaration('I listen at the door without opening it.');
  assert.ok(
    listen.actionSequence.some(
      (step) => step.kind === 'inspect' && step.outcomeHint === 'listen',
    ),
  );
  assert.ok(listen.actionSequence.every((step) => step.kind !== 'open_door'));
  assert.equal(resolveIntentAuthority(listen).disposition, 'director_narrate_only');
});

test('walk without opening is move only — negation preserved, no open_door', () => {
  const parsed = parsePlayerDeclaration('I walk to the door without opening it.');
  assert.ok(parsed.actionSequence.some((step) => step.kind === 'move'));
  assert.ok(parsed.actionSequence.every((step) => step.kind !== 'open_door'));
  const authority = resolveIntentAuthority(parsed);
  assert.equal(authority.proposedCommandType, 'table.move');
});

test('resolveDoorIntentForMap: negated open never drafts move-to-open or open_door', () => {
  const far = chamberMap({ tokenColumn: 2, tokenRow: 2 });
  const checkFar = resolveDoorIntentForMap(
    far,
    { column: 2, row: 2 },
    'I check whether the door is locked, but I do not open it.',
  );
  assert.ok(checkFar);
  assert.equal(checkFar.proposedCommandType, 'table.sync');
  assert.doesNotMatch(checkFar.summary, /Ready to open|step toward.*open \/ step through/i);

  const listenFar = resolveDoorIntentForMap(
    far,
    { column: 2, row: 2 },
    'I listen at the door without opening it.',
  );
  assert.ok(listenFar);
  assert.equal(listenFar.proposedCommandType, 'table.sync');
  assert.notEqual(listenFar.proposedCommandType, 'table.move');
  assert.notEqual(listenFar.proposedCommandType, 'table.open_door');

  const adjacent = chamberMap({ tokenColumn: 9, tokenRow: 6 });
  const listenAdj = resolveDoorIntentForMap(
    adjacent,
    { column: 9, row: 6 },
    'I listen at the door without opening it.',
  );
  assert.ok(listenAdj);
  assert.equal(listenAdj.proposedCommandType, 'table.sync');
  assert.match(listenAdj.summary, /listen|hear|No open or move/i);
  assert.doesNotMatch(listenAdj.summary, /Ready to open/i);
});
