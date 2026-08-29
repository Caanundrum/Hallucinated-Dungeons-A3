import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  doorAuthorityFromStored,
  doorStateAfterUnlockSuccess,
  formatDoorAuthorityLabel,
  PLAY_AUTHORITY_SPIKE,
  resolveIntentAuthority,
  textIsInterrogative,
  textReferencesUnlockedDoorState,
  textRequestsLockPicking,
} from '../../dist/shared/play-authority-contract.js';

test('spike locks product rules Nick approved', () => {
  assert.equal(PLAY_AUTHORITY_SPIKE.rules.noFixedIntentKeywordPrecedence, true);
  assert.equal(PLAY_AUTHORITY_SPIKE.rules.unlockLeavesDoorClosedUnlessAlsoOpened, true);
  assert.equal(PLAY_AUTHORITY_SPIKE.rules.noPlayerConfirmSceneControl, true);
  assert.equal(PLAY_AUTHORITY_SPIKE.rules.referenceMarkersNonMechanical, true);
});

test('A2: successful unlock yields closed + unlocked, not open', () => {
  assert.deepEqual(doorStateAfterUnlockSuccess(), { leaf: 'closed', lock: 'unlocked' });
  assert.deepEqual(doorStateAfterUnlockSuccess({ alsoOpened: true }), {
    leaf: 'open',
    lock: 'unlocked',
  });
  assert.equal(formatDoorAuthorityLabel(doorStateAfterUnlockSuccess()), 'Wooden door (closed, unlocked)');
  assert.equal(formatDoorAuthorityLabel(doorAuthorityFromStored('locked')), 'Wooden door (closed, locked)');
  assert.equal(formatDoorAuthorityLabel(doorAuthorityFromStored('closed')), 'Wooden door (closed)');
});

test('unlocked door language is state reference, not lock-picking', () => {
  assert.equal(textReferencesUnlockedDoorState('Beyond the unlocked door I see mist.'), true);
  assert.equal(textRequestsLockPicking('Beyond the unlocked door I see mist.'), false);
  assert.equal(textRequestsLockPicking('I pick the lock on the wooden door.'), true);
  assert.equal(textRequestsLockPicking('I unlock the door with thieves tools.'), true);
});

test('addressing Nib makes dialogue the primary intent', () => {
  const parsed = {
    rawText: 'Nib, which door leads to the old archive?',
    speaker: 'player_character',
    addressee: 'Nib',
    intendedActions: [{ kind: 'dialogue', targetRef: 'Nib', outcomeHint: null }],
    primaryTarget: 'Nib',
    requestedOutcome: 'learn which door leads to the archive',
    actionSequence: [
      { kind: 'dialogue', targetRef: 'Nib', outcomeHint: null },
      { kind: 'open_door', targetRef: null, outcomeHint: null },
    ],
    playerAssertedWorldFacts: [],
    knownCanonicalReferences: [{ kind: 'npc', id: 'npc-nib', label: 'Nib' }],
    isInterrogative: true,
  };
  const resolved = resolveIntentAuthority(parsed);
  assert.equal(resolved.disposition, 'director_narrate_only');
  assert.equal(resolved.actionSequence[0]?.kind, 'dialogue');
  assert.equal(resolved.proposedCommandType, 'table.sync');
  assert.match(resolved.summary, /dialogue/i);
});

test('which-door interrogative without addressee clarifies instead of opening', () => {
  const parsed = {
    rawText: 'Which door leads to the old archive?',
    speaker: 'player_character',
    addressee: null,
    intendedActions: [{ kind: 'open_door', targetRef: null, outcomeHint: null }],
    primaryTarget: null,
    requestedOutcome: null,
    actionSequence: [{ kind: 'open_door', targetRef: null, outcomeHint: null }],
    playerAssertedWorldFacts: [],
    knownCanonicalReferences: [],
    isInterrogative: true,
  };
  assert.equal(textIsInterrogative(parsed.rawText), true);
  const resolved = resolveIntentAuthority(parsed);
  assert.equal(resolved.disposition, 'clarify');
  assert.equal(resolved.proposedCommandType, null);
  assert.match(resolved.clarificationPrompt ?? '', /question|door action/i);
});

test('player-invented place/NPC authorship is rejected as world facts', () => {
  const parsed = {
    rawText: 'A goblin cartographer named Nib appears and warns us.',
    speaker: 'player_character',
    addressee: null,
    intendedActions: [{ kind: 'introduce_npc_request', targetRef: 'Nib', outcomeHint: null }],
    primaryTarget: 'Nib',
    requestedOutcome: 'introduce Nib',
    actionSequence: [{ kind: 'introduce_npc_request', targetRef: 'Nib', outcomeHint: null }],
    playerAssertedWorldFacts: [{ kind: 'npc', text: 'Nib the goblin cartographer' }],
    knownCanonicalReferences: [],
    isInterrogative: false,
  };
  const resolved = resolveIntentAuthority(parsed);
  assert.equal(resolved.disposition, 'reject_world_authorship');
  assert.ok(resolved.ignoredWorldFacts.length >= 1);
  assert.match(resolved.summary, /Game Director/i);
});

test('multiple real actions ask for explicit sequence', () => {
  const parsed = {
    rawText: 'I unlock the door and then open it.',
    speaker: 'player_character',
    addressee: null,
    intendedActions: [
      { kind: 'unlock_door', targetRef: 'door-1', outcomeHint: null },
      { kind: 'open_door', targetRef: 'door-1', outcomeHint: null },
    ],
    primaryTarget: 'door-1',
    requestedOutcome: 'pass through',
    actionSequence: [
      { kind: 'unlock_door', targetRef: 'door-1', outcomeHint: null },
      { kind: 'open_door', targetRef: 'door-1', outcomeHint: null },
    ],
    playerAssertedWorldFacts: [],
    knownCanonicalReferences: [{ kind: 'door', id: 'door-1', label: 'Wooden door' }],
    isInterrogative: false,
  };
  const resolved = resolveIntentAuthority(parsed);
  assert.equal(resolved.disposition, 'clarify');
  assert.equal(resolved.actionSequence.length, 2);
  assert.match(resolved.clarificationPrompt ?? '', /order|one at a time/i);
});
