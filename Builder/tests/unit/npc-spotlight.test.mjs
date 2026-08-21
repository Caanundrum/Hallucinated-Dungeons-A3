import assert from 'node:assert/strict';
import { test } from 'node:test';

import { matchAddressedNpc } from '../../dist/server/table/npc-spotlight.js';
import { deriveEpicFramingTags } from '../../dist/shared/intent-draft-contract.js';

const npcs = [
  {
    npcId: 'lysa-quill',
    name: 'Lysa Quill',
    role: 'Harbor Warden',
    motive: 'Keep the crossing running.',
    knowledge: 'Knows the barge schedules.',
    audience: 'public',
  },
  {
    npcId: 'sera-windlow',
    name: 'Sera Windlow',
    role: 'Chandler',
    motive: 'Sell supplies.',
    knowledge: 'Heard the bell.',
    audience: 'public',
  },
];

test('matchAddressedNpc prefers explicit address forms', () => {
  const matched = matchAddressedNpc('Hey Lysa Quill, what do you know about the barges?', npcs);
  assert.equal(matched?.npcId, 'lysa-quill');
});

test('matchAddressedNpc returns null when no NPC is named', () => {
  assert.equal(matchAddressedNpc('I look around the dock.', npcs), null);
});

test('epic framing tags still never invent outcomes', () => {
  const tags = deriveEpicFramingTags('You hit for 4 damage.');
  assert.equal(tags.includes('finishing_blow'), false);
});
