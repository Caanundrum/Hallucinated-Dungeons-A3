/**
 * Staging-checklist smoke for DM understanding core + QA recheck remediation.
 * Exercises Play interpreter + Ask draft validation without a live browser.
 */
import assert from 'node:assert/strict';

import {
  parsePlayerDeclaration,
  resolveIntentAuthority,
} from '../../dist/shared/play-authority-contract.js';
import {
  answerFromCampaignFacts,
  extractCampaignFactsFromPremise,
  rejectUnsupportedPremiseClaim,
} from '../../dist/shared/campaign-facts.js';
import { answerContainerContentsQuery } from '../../dist/shared/container-contents.js';
import {
  relationToDoor,
  resolveCrossingAgainstTopology,
} from '../../dist/shared/door-topology.js';
import { resolveDoorIntentForMap } from '../../dist/server/table/scene-door-intent.js';
import { buildResolvedActionReceipt } from '../../dist/shared/resolved-action-receipt.js';
import {
  evaluateCharacterCapability,
  resolveConditionalDoorIntent,
  understandUtterance,
} from '../../dist/shared/utterance-understanding.js';

function section(title) {
  console.log(`\n== ${title} ==`);
}

function expectNarrate(text, label) {
  const parsed = parsePlayerDeclaration(text);
  const authority = resolveIntentAuthority(parsed);
  assert.equal(
    authority.disposition,
    'director_narrate_only',
    `${label}: expected director_narrate_only, got ${authority.disposition}`,
  );
  assert.equal(
    authority.actionSequence.some((step) => step.kind === 'move'),
    false,
    `${label}: must not draft move`,
  );
  console.log(`PASS  ${label}`);
  console.log(`      disposition=${authority.disposition}`);
  console.log(`      summary=${authority.summary}`);
  return authority;
}

function expectAskDraftOnlyWhenPlayWould(text, label) {
  const understanding = understandUtterance(text);
  const parsed = parsePlayerDeclaration(text);
  const authority = resolveIntentAuthority(parsed);
  const wouldSuggest =
    !understanding.wantsKnowledgeRecap &&
    !understanding.wantsContentsQuery &&
    understanding.speechAct !== 'question' &&
    understanding.speechAct !== 'rules_query' &&
    understanding.speechAct !== 'ooc_instruction' &&
    authority.disposition === 'propose_command' &&
    authority.proposedCommandType !== null &&
    authority.proposedCommandType !== 'table.sync';
  console.log(`PASS  ${label}`);
  console.log(
    `      speechAct=${understanding.speechAct} disposition=${authority.disposition} suggest=${wouldSuggest} command=${authority.proposedCommandType}`,
  );
  return { wouldSuggest, authority, understanding };
}

section('1. Soft recap is narrate-only (not a move draft)');
expectNarrate('Remind me why I am here', 'remind-me-why');

section('2. Stay-put listen honors do-not-move');
{
  const text = 'Do not move me — I listen at the doorway';
  const understanding = understandUtterance(text);
  assert.equal(understanding.constraints.forbidMove, true);
  const authority = expectNarrate(text, 'do-not-move-listen');
  assert.equal(authority.actionSequence.some((step) => step.kind === 'open_door'), false);
}

section('3. Hide + listen collapses to sensory sequence');
{
  const authority = expectNarrate('I hide behind the crates and listen', 'hide-and-listen');
  assert.ok(
    authority.actionSequence.some(
      (step) => step.kind === 'inspect' && step.outcomeHint === 'sensory_sequence',
    ),
  );
}

section('4. Campaign facts answer courier recap without inventing loot');
{
  const facts = extractCampaignFactsFromPremise(
    'Find the missing courier. Mara Venn hired you.',
  );
  const answer = answerFromCampaignFacts({
    facts,
    queryText: 'What do I know about the missing courier?',
  });
  assert.match(answer.playerFacingBody, /courier/i);
  assert.doesNotMatch(answer.playerFacingBody, /silver key|dragon|hoard/i);
  console.log('PASS  courier-fact-recap');
  console.log(`      ${answer.playerFacingBody}`);
}

section('5. Unauthored satchel contents stay honest');
{
  const answer = answerContainerContentsQuery({
    containerLabel: 'courier satchel',
    view: { contents: null, discovery: 'visible', open: true },
  });
  assert.match(answer.body, /no contents are authored/i);
  console.log('PASS  satchel-unauthored');
  console.log(`      ${answer.body}`);
}

section('6. Already-through door topology refuses inventing another cross');
{
  const edge = { column: 9, row: 6, orientation: 'east', doorState: 'open' };
  assert.equal(relationToDoor({ column: 10, row: 6 }, edge), 'far');
  const crossing = resolveCrossingAgainstTopology({
    relation: 'far',
    leaf: 'open',
    wantsCross: true,
    wantsReverse: false,
  });
  assert.equal(crossing.kind, 'already_through');
  console.log('PASS  already-through-topology');
  console.log(`      ${crossing.summary}`);
}

section('7. Ask draft suggestion only when Play would propose a real command');
{
  const recap = expectAskDraftOnlyWhenPlayWould(
    'What do I know about the missing courier?',
    'ask-recap-no-draft',
  );
  assert.equal(recap.wouldSuggest, false);

  const open = expectAskDraftOnlyWhenPlayWould(
    'I open the wooden door beside me',
    'ask-open-door-may-draft',
  );
  assert.equal(open.understanding.speechAct !== 'question', true);
}

section('8. QA R05 — crouch + listen is sensory narrate-only');
{
  const authority = expectNarrate(
    'I crouch behind the broken crate stack and listen without attacking',
    'crouch-and-listen',
  );
  assert.ok(
    authority.actionSequence.some(
      (step) => step.kind === 'inspect' && step.outcomeHint === 'sensory_sequence',
    ),
  );
  assert.match(authority.summary, /does not establish/i);
}

section('9. QA R06 — open-only-if-closed is a no-op on an already-open leaf');
{
  const understanding = understandUtterance(
    'If the east doorway is closed, open it; otherwise leave it exactly as it is',
  );
  assert.equal(understanding.constraints.openOnlyIfClosed, true);
  assert.equal(
    resolveConditionalDoorIntent({
      constraints: understanding.constraints,
      doorLeaf: 'open',
    }),
    'noop',
  );
  console.log('PASS  conditional-open-noop-when-open');
}

section('10. QA R08 — Fireball refusal names Rogue + Fireball');
{
  const verdict = evaluateCharacterCapability(
    { level: 1, spellcasting: null },
    { wantsCast: true, spellLabel: 'Fireball', classLabel: 'Rogue' },
  );
  assert.equal(verdict.allowed, false);
  assert.match(verdict.reason ?? '', /Rogue/i);
  assert.match(verdict.reason ?? '', /Fireball/i);
  console.log('PASS  fireball-capability-refusal');
  console.log(`      ${verdict.reason}`);
}

section('11. QA R10 — invented Mara handoff / silver key is rejected');
{
  const reject = rejectUnsupportedPremiseClaim({
    claimText:
      'Mara Venn handed me a silver key earlier; I use it on the already-open east doorway',
    knownNpcNames: [],
    inventoryNames: [],
    facts: extractCampaignFactsFromPremise('Find the missing courier.'),
  });
  assert.ok(reject !== null);
  assert.match(reject ?? '', /key|Mara|not established|handoff|invent/i);
  assert.doesNotMatch(reject ?? '', /thieves.?tools|DC\s*15/i);
  console.log('PASS  premise-reject-mara-key');
  console.log(`      ${reject}`);
}

section('12. QA R11 — open doorway table.move receipt narrates stepped through');
{
  const receipt = buildResolvedActionReceipt({
    commandType: 'table.move',
    declaration: 'I step through the open wooden doorway east',
    edgeId: 'door-e',
    targetLabel: 'Wooden doorway east — open',
    targetKind: 'token_path',
    mutations: [],
    doorStatesAfter: { 'door-e': 'open' },
    openCross: true,
    sceneTitle: 'Canal warehouse loft',
  });
  assert.equal(receipt.namedDoorOpenAfter, true);
  assert.match(receipt.narrationSeed, /stepped through/i);
  assert.doesNotMatch(receipt.narrationSeed, /remains closed/i);
  console.log('PASS  open-door-move-receipt');
  console.log(`      ${receipt.narrationSeed}`);
}


section('13. QA R06 — door resolver refuses step-through for conditional open');
{
  const cells = [];
  for (let column = 0; column < 12; column += 1) {
    for (let row = 0; row < 8; row += 1) {
      cells.push({ column, row, terrain: 'normal', known: true });
    }
  }
  const map = {
    mapBundleId: 'blank:camp-1',
    title: 'Canal warehouse loft',
    coordinateSpace: { columns: 12, rows: 8, pixelsPerSquare: 48, feetPerSquare: 5 },
    cells,
    edges: [
      {
        edgeId: 'e:9:6:east',
        column: 9,
        row: 6,
        orientation: 'east',
        kind: 'door',
        doorState: 'open',
      },
    ],
    tokens: [
      {
        tokenId: 'tok-1',
        seatId: 'seat-1',
        label: 'Pip',
        footprint: {
          anchor: { column: 10, row: 6 },
          widthSquares: 1,
          heightSquares: 1,
        },
      },
    ],
    notableFeatures: [],
    viewerSeatId: 'seat-1',
  };
  const resolved = resolveDoorIntentForMap(
    map,
    { column: 10, row: 6 },
    'If the east doorway is closed, open it; otherwise leave it exactly as it is',
  );
  assert.ok(resolved);
  assert.equal(resolved.proposedCommandType, 'table.sync');
  assert.doesNotMatch(resolved.summary, /step back through|step through/i);
  console.log('PASS  resolver-conditional-noop');
  console.log(`      ${resolved.summary}`);
}

section('14. QA take — open courier satchel is take_item narrate-only');
{
  const authority = expectNarrate('I take the open courier satchel', 'take-satchel');
  assert.ok(
    authority.actionSequence.some(
      (step) => step.kind === 'inspect' && step.outcomeHint === 'take_item',
    ),
  );
}

section('15. QA provenance — banner echo does not name Mara in premise');
{
  const facts = extractCampaignFactsFromPremise(
    'Canal warehouse loft. Mara Venn muttered in a prior player claim.',
    { allowNamedNpcs: false },
  );
  assert.equal(facts.some((fact) => /Mara/i.test(fact.label)), false);
  console.log('PASS  banner-no-mara-premise');
}


console.log('\nAll DM-understanding staging smoke checks passed.');
