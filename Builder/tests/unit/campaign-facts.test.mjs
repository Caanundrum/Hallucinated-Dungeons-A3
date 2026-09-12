import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  answerFromCampaignFacts,
  extractCampaignFactsFromPremise,
  rejectUnsupportedItemClaim,
} from '../../dist/shared/campaign-facts.js';

test('extractCampaignFactsFromPremise seeds courier and named NPC without inventing loot', () => {
  const facts = extractCampaignFactsFromPremise(
    'Find the missing courier. Mara Venn hired you. A silver key was mentioned in the brief.',
  );
  assert.ok(facts.some((fact) => fact.tags.includes('courier') && fact.status === 'established'));
  assert.ok(facts.some((fact) => /Mara/i.test(fact.label)));
  const key = facts.find((fact) => fact.tags.includes('key'));
  assert.ok(key);
  assert.equal(key.status, 'inferred');
});

test('answerFromCampaignFacts answers recap from established facts only', () => {
  const facts = extractCampaignFactsFromPremise(
    'You were hired to recover the missing courier before dawn.',
  );
  const answer = answerFromCampaignFacts({
    facts,
    queryText: 'Remind me why I am here — what do I know about the missing courier?',
  });
  assert.match(answer.playerFacingBody, /courier/i);
  assert.doesNotMatch(answer.playerFacingBody, /dragon hoard/i);
});

test('rejectUnsupportedItemClaim blocks invented keys', () => {
  const facts = extractCampaignFactsFromPremise('Find the missing courier.');
  const rejection = rejectUnsupportedItemClaim({
    claimText: 'I use my silver key on the door',
    inventoryNames: ['rope', 'torch'],
    facts,
  });
  assert.ok(rejection);
  assert.match(rejection, /key/i);
});
