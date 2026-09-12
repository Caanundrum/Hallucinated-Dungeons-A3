import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  describeDoorPosition,
  relationToDoor,
  resolveCrossingAgainstTopology,
} from '../../dist/shared/door-topology.js';

test('relationToDoor marks passage square as far', () => {
  const edge = { column: 9, row: 6, orientation: 'east', doorState: 'open' };
  assert.equal(relationToDoor({ column: 10, row: 6 }, edge), 'far');
  assert.equal(relationToDoor({ column: 9, row: 6 }, edge), 'near');
  assert.equal(relationToDoor({ column: 4, row: 6 }, edge), 'away');
});

test('resolveCrossingAgainstTopology refuses already-through enter intents', () => {
  const crossing = resolveCrossingAgainstTopology({
    relation: 'far',
    leaf: 'open',
    wantsCross: true,
    wantsReverse: false,
  });
  assert.equal(crossing.kind, 'already_through');
  assert.match(crossing.summary, /already through the doorway/i);
});

test('resolveCrossingAgainstTopology allows reverse cross from far side', () => {
  const crossing = resolveCrossingAgainstTopology({
    relation: 'far',
    leaf: 'open',
    wantsCross: true,
    wantsReverse: true,
  });
  assert.equal(crossing.kind, 'proceed');
});

test('describeDoorPosition keeps already-through wording for far relation', () => {
  const text = describeDoorPosition({
    relation: 'far',
    doorLabel: 'wooden doorway',
    leaf: 'open',
    sceneTitle: 'Quiet chamber',
  });
  assert.match(text, /already through the doorway/i);
});
