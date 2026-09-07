import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildNarrationSeedFromReceipt,
  buildResolvedActionReceipt,
  declarationIsDoorOpenOrPassage,
  declarationMentionsLabelWord,
  declarationNegatesDoorOpen,
} from '../../dist/shared/resolved-action-receipt.js';
import { parsePlayerDeclaration, resolveIntentAuthority } from '../../dist/shared/play-authority-contract.js';
import { resolvedSummaryAfterTableConfirm } from '../../dist/shared/play-beat-summary.js';
import { matchInteractableByDeclaration } from '../../dist/server/table/scene-commands.js';

test('declarationMentionsLabelWord: wood does not match wooden', () => {
  assert.equal(declarationMentionsLabelWord('open the wooden doorway', 'wood'), false);
  assert.equal(declarationMentionsLabelWord('clear the wood pile', 'wood'), true);
  assert.equal(declarationMentionsLabelWord('open the wooden doorway', 'wooden'), true);
});

test('declarationNegatesDoorOpen catches without opening / do not open', () => {
  assert.equal(declarationNegatesDoorOpen('I peer through without opening the door.'), true);
  assert.equal(declarationNegatesDoorOpen('I walk past but I do not open it.'), true);
  assert.equal(declarationNegatesDoorOpen('I open the wooden doorway.'), false);
});

test('declarationIsDoorOpenOrPassage owns doorway open language', () => {
  assert.equal(declarationIsDoorOpenOrPassage('I open the wooden doorway east.'), true);
  assert.equal(declarationIsDoorOpenOrPassage('I open the wood pile.'), false);
  assert.equal(declarationIsDoorOpenOrPassage('I peer through without opening the door.'), false);
});

test('parsePlayerDeclaration: negation never drafts open_door', () => {
  const parsed = parsePlayerDeclaration(
    'I look beyond the doorway without opening it.',
  );
  assert.ok(parsed.actionSequence.every((step) => step.kind !== 'open_door'));
  const authority = resolveIntentAuthority(parsed);
  assert.notEqual(authority.proposedCommandType, 'table.open_door');
});

test('matchInteractableByDeclaration: wooden doorway does not hit Wood pile', () => {
  const runtime = {
    adventureStarted: true,
    activeSceneId: 'scene-1',
    sceneStack: [],
    sceneInstances: {
      'scene-1': {
        sceneId: 'scene-1',
        title: 'Trail camp',
        purpose: 'exploration',
        columns: 8,
        rows: 6,
        features: [
          {
            objectId: 'obj-wood-pile',
            label: 'Wood pile',
            objectKind: 'cover',
            state: 'intact',
            interactable: true,
            column: 3,
            row: 2,
          },
          {
            objectId: 'obj-lamp',
            label: 'Camp lamp',
            objectKind: 'light',
            state: 'lit',
            interactable: true,
            column: 1,
            row: 1,
          },
        ],
        exits: [],
        tokenPositions: [],
        doorStates: {},
        exploredByAccount: {},
      },
    },
    tokenPositions: [],
    doorStates: {},
    runtimeEdges: [],
    sceneTitle: 'Trail camp',
    exploredByAccount: {},
    premiseKey: null,
  };
  assert.equal(
    matchInteractableByDeclaration(runtime, 'I open the wooden doorway east.'),
    null,
  );
  assert.equal(
    matchInteractableByDeclaration(runtime, 'I clear the wood pile.'),
    'obj-wood-pile',
  );
});

test('receipt narration never claims crossing a closed door', () => {
  const closed = buildResolvedActionReceipt({
    commandType: 'table.open_door',
    declaration: 'I open the wooden doorway and step through.',
    edgeId: 'edge-1',
    targetLabel: 'wooden doorway east',
    targetKind: 'door',
    doorStatesAfter: { 'edge-1': 'closed' },
    openCross: true,
    sceneTitle: 'Quiet chamber',
  });
  assert.equal(closed.namedDoorOpenAfter, false);
  assert.match(closed.narrationSeed, /not open|remains closed|Tried to open/i);
  assert.doesNotMatch(closed.narrationSeed, /stepped through/i);

  const opened = buildResolvedActionReceipt({
    commandType: 'table.open_door',
    declaration: 'I open the wooden doorway and step through.',
    edgeId: 'edge-1',
    targetLabel: 'wooden doorway east',
    targetKind: 'door',
    doorStatesAfter: { 'edge-1': 'open' },
    openCross: true,
    sceneTitle: 'Quiet chamber',
  });
  assert.equal(opened.namedDoorOpenAfter, true);
  assert.match(opened.narrationSeed, /Opened wooden doorway east.*stepped through/i);

  const interact = buildNarrationSeedFromReceipt({
    commandType: 'table.interact_object',
    targetLabel: 'Wood pile',
    mutations: [
      { kind: 'object', id: 'obj-wood-pile', label: 'Wood pile', from: 'intact', to: 'broken' },
    ],
    namedDoorOpenAfter: false,
    openCross: false,
  });
  assert.match(interact, /Wood pile changed from intact to broken/);
});

test('resolvedSummaryAfterTableConfirm prefers receipt seed over draft openCross', () => {
  const receipt = buildResolvedActionReceipt({
    commandType: 'table.open_door',
    edgeId: 'edge-1',
    targetLabel: 'wooden doorway east',
    targetKind: 'door',
    doorStatesAfter: { 'edge-1': 'closed' },
    openCross: true,
  });
  const summary = resolvedSummaryAfterTableConfirm({
    commandType: 'table.open_door',
    draftSummary: 'Ready to open the door and step through. Confirm to open it.',
    openCross: true,
    receipt,
  });
  assert.equal(summary, receipt.narrationSeed);
  assert.doesNotMatch(summary, /stepped through|Ready to|Confirm to/i);
});
