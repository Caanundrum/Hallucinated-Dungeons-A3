import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  doorAuthorityFromStored,
  doorStateAfterUnlockSuccess,
  formatDoorAuthorityLabel,
  parsePlayerDeclaration,
  PLAY_AUTHORITY_SPIKE,
  resolveIntentAuthority,
  storedDoorStateFromAuthority,
  textIsInterrogative,
  textReferencesUnlockedDoorState,
  textRequestsLockPicking,
  validateDmNpcDirective,
  validateDmSceneDirective,
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
  assert.equal(formatDoorAuthorityLabel(doorAuthorityFromStored('unlocked')), 'Wooden door (closed, unlocked)');
  assert.equal(storedDoorStateFromAuthority(doorStateAfterUnlockSuccess()), 'unlocked');
});

test('unlocked door language is state reference, not lock-picking', () => {
  assert.equal(textReferencesUnlockedDoorState('Beyond the unlocked door I see mist.'), true);
  assert.equal(textReferencesUnlockedDoorState('opens the unlocked doorway and steps through'), true);
  assert.equal(textRequestsLockPicking('Beyond the unlocked door I see mist.'), false);
  assert.equal(textRequestsLockPicking('opens the unlocked doorway and steps through'), false);
  assert.equal(textRequestsLockPicking('enters the room beyond the unlocked doorway'), false);
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

test('addressing unknown Nib clarifies that the NPC is not established', () => {
  const parsed = {
    rawText: 'Nib, which door leads to the old archive?',
    speaker: 'player_character',
    addressee: 'Nib',
    intendedActions: [{ kind: 'dialogue', targetRef: 'Nib', outcomeHint: null }],
    primaryTarget: 'Nib',
    requestedOutcome: null,
    actionSequence: [
      { kind: 'dialogue', targetRef: 'Nib', outcomeHint: null },
      { kind: 'open_door', targetRef: null, outcomeHint: null },
    ],
    playerAssertedWorldFacts: [],
    knownCanonicalReferences: [],
    isInterrogative: true,
  };
  const resolved = resolveIntentAuthority(parsed);
  assert.equal(resolved.disposition, 'clarify');
  assert.match(resolved.summary, /not established/i);
  assert.match(resolved.clarificationPrompt ?? '', /Game Director/i);
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

test('parsePlayerDeclaration: Nib question is dialogue, not door open', () => {
  const parsed = parsePlayerDeclaration('Nib, which door leads to the old archive?', {
    knownNpcs: [{ id: 'npc-nib', label: 'Nib' }],
  });
  assert.equal(parsed.addressee, 'Nib');
  assert.equal(parsed.isInterrogative, true);
  const resolved = resolveIntentAuthority(parsed);
  assert.equal(resolved.disposition, 'director_narrate_only');
  assert.equal(resolved.actionSequence[0]?.kind, 'dialogue');
});

test('parsePlayerDeclaration: asks Nib mid-sentence sets unknown addressee', () => {
  const parsed = parsePlayerDeclaration(
    'Loophole Lantern asks Nib, “Which door leads to the old archive?”',
  );
  assert.equal(parsed.addressee, 'Nib');
  const resolved = resolveIntentAuthority(parsed);
  assert.equal(resolved.disposition, 'clarify');
  assert.match(resolved.clarificationPrompt ?? '', /not an established NPC/i);
  assert.doesNotMatch(resolved.clarificationPrompt ?? '', /Say who you ask/i);
});

test('parsePlayerDeclaration: looking for who is present is Director narration', () => {
  const parsed = parsePlayerDeclaration(
    'Loophole Lantern calls into the chamber and waits for whoever is present.',
  );
  assert.ok(parsed.actionSequence.some((step) => step.kind === 'inspect'));
  const resolved = resolveIntentAuthority(parsed);
  assert.equal(resolved.disposition, 'director_narrate_only');
  assert.match(resolved.summary, /who is present|Game Director/i);
  assert.doesNotMatch(resolved.summary, /What is your character attempting/i);
});

test('parsePlayerDeclaration: scene survey is perception, not combat', () => {
  const text =
    'Loophole Lantern pauses and surveys the current chamber, looking and listening carefully. Garrick, describe only what she can perceive and reveal any scene change only if the established fiction requires one.';
  const parsed = parsePlayerDeclaration(text);
  assert.ok(parsed.actionSequence.some((step) => step.kind === 'inspect'));
  assert.ok(parsed.actionSequence.every((step) => step.kind !== 'attack'));
  const resolved = resolveIntentAuthority(parsed);
  assert.equal(resolved.disposition, 'director_narrate_only');
  assert.match(resolved.summary, /look and listen|perceptible|Game Director/i);
  assert.doesNotMatch(resolved.summary, /attack|encounter|combat/i);
});

test('parsePlayerDeclaration: conjugations open/step and compound step-through', () => {
  const opens = parsePlayerDeclaration('Loophole Lantern opens the wooden door.');
  assert.ok(opens.actionSequence.some((step) => step.kind === 'open_door'));
  const stepped = parsePlayerDeclaration(
    'I open the unlocked door and step through.',
  );
  assert.ok(stepped.actionSequence.some((step) => step.kind === 'open_door'));
  assert.ok(stepped.actionSequence.every((step) => step.kind !== 'move'));
  const resolved = resolveIntentAuthority(stepped);
  assert.equal(resolved.disposition, 'propose_command');
  assert.equal(resolved.proposedCommandType, 'table.open_door');
  const enterBeyond = parsePlayerDeclaration(
    'I walk to the far wall, open the wooden door, and enter the room beyond.',
  );
  assert.ok(enterBeyond.actionSequence.some((step) => step.kind === 'open_door'));
  assert.ok(enterBeyond.actionSequence.every((step) => step.kind !== 'move'));
  const doorway = parsePlayerDeclaration(
    'Loophole opens the unlocked doorway and steps through.',
  );
  assert.equal(
    doorway.actionSequence.some((step) => step.kind === 'unlock_door'),
    false,
  );
  assert.ok(doorway.actionSequence.some((step) => step.kind === 'open_door'));
  assert.equal(resolveIntentAuthority(doorway).proposedCommandType, 'table.open_door');
  const enters = parsePlayerDeclaration(
    'She enters the room beyond the unlocked doorway.',
  );
  assert.equal(enters.actionSequence.some((step) => step.kind === 'unlock_door'), false);
  assert.ok(enters.actionSequence.some((step) => step.kind === 'open_door'));
  assert.equal(resolveIntentAuthority(enters).proposedCommandType, 'table.open_door');
});

test('parsePlayerDeclaration: through the open wooden door is passage, not open_door', () => {
  const throughOpen = parsePlayerDeclaration('I step through the open wooden door.');
  assert.ok(throughOpen.actionSequence.some((step) => step.kind === 'move'));
  assert.ok(throughOpen.actionSequence.every((step) => step.kind !== 'open_door'));
  assert.equal(resolveIntentAuthority(throughOpen).proposedCommandType, 'table.move');

  const bareThrough = parsePlayerDeclaration('through the open wooden door');
  assert.ok(bareThrough.actionSequence.some((step) => step.kind === 'move'));
  assert.ok(bareThrough.actionSequence.every((step) => step.kind !== 'open_door'));
});
test('parsePlayerDeclaration: invent scenery with move preserves the move', () => {
  const parsed = parsePlayerDeclaration(
    'I walk toward the flooded crypt that materializes ahead.',
  );
  assert.ok(parsed.playerAssertedWorldFacts.some((fact) => fact.kind === 'place'));
  assert.ok(parsed.actionSequence.some((step) => step.kind === 'move'));
  const resolved = resolveIntentAuthority(parsed);
  assert.equal(resolved.disposition, 'propose_command');
  assert.equal(resolved.proposedCommandType, 'table.move');
  assert.ok(resolved.ignoredWorldFacts.length >= 1);
  assert.match(resolved.summary, /ignored|Game Director/i);
  const throughUnlocked = parsePlayerDeclaration(
    'I enter the moonlit flooded crypt through the unlocked doorway.',
  );
  const throughResolved = resolveIntentAuthority(throughUnlocked);
  assert.equal(throughResolved.disposition, 'propose_command');
  assert.equal(throughResolved.proposedCommandType, 'table.open_door');
  assert.ok(throughResolved.ignoredWorldFacts.length >= 1);
  assert.equal(throughResolved.actionSequence.some((step) => step.kind === 'unlock_door'), false);
});

test('parsePlayerDeclaration: unlocked-door prose is not lock-picking', () => {
  const parsed = parsePlayerDeclaration('Beyond the unlocked door I see mist.');
  assert.equal(textRequestsLockPicking(parsed.rawText), false);
  assert.ok(parsed.actionSequence.every((step) => step.kind !== 'unlock_door'));
});

test('parsePlayerDeclaration: pick lock is unlock_door', () => {
  const parsed = parsePlayerDeclaration('I pick the lock on the wooden door.');
  assert.ok(parsed.actionSequence.some((step) => step.kind === 'unlock_door'));
  const resolved = resolveIntentAuthority(parsed);
  assert.equal(resolved.disposition, 'propose_command');
  assert.equal(resolved.proposedCommandType, 'table.sync');
});

test('validateDmNpcDirective and validateDmSceneDirective gate schema', () => {
  assert.equal(PLAY_AUTHORITY_SPIKE.rules.noPlayerConfirmSceneControl, true);
  const npcOk = validateDmNpcDirective({
    schemaVersion: 'play-authority-npc-v1',
    npcId: 'npc-nib',
    name: 'Nib',
    publicDescription: 'A wary goblin cartographer',
    disposition: 'wary',
    location: { column: 4, row: 3 },
    placeToken: true,
    firstDialogue: 'Keep your boots dry past the east door.',
    audience: 'public',
    causeActionId: null,
  });
  assert.equal(npcOk.ok, true);
  const sceneOk = validateDmSceneDirective({
    schemaVersion: 'play-authority-scene-v1',
    sceneId: 'scene-quiet-chamber',
    revision: 1,
    title: 'Quiet chamber',
    displayMode: 'exploration',
    bounds: { columns: 8, rows: 8 },
    causeActionId: null,
    continuity: { previousSceneId: null, boundaryCrossed: false },
    structure: { edges: [] },
    markers: [],
    entities: [],
    visibility: 'public',
    rejectedMechanics: [],
  });
  assert.equal(sceneOk.ok, true);
  const sceneBad = validateDmSceneDirective({
    schemaVersion: 'play-authority-scene-v1',
    sceneId: '',
    revision: 0,
    title: '',
    displayMode: 'exploration',
    bounds: { columns: 0, rows: 0 },
    causeActionId: null,
    continuity: { previousSceneId: null, boundaryCrossed: false },
    structure: { edges: [] },
    markers: [],
    entities: [],
    visibility: 'public',
    rejectedMechanics: [],
  });
  assert.equal(sceneBad.ok, false);
  assert.ok(sceneBad.errors.length >= 2);
});
