import assert from 'node:assert/strict';
import { test } from 'node:test';

import { emptyChoices, validateChoices, deriveSheet } from '../../dist/server/rules/character-rules.js';
import { QUICK_START_TEMPLATES } from '../../dist/server/rules/srd-manifest.js';

/**
 * Quick-start templates must produce legal, fully explained sheets once the
 * player supplies identity. Ownership isolation is covered by the character
 * service routes and the Phase 1 characters e2e journey (authenticated account
 * boundary), not by an in-process Firestore fake.
 */

function choicesFromTemplate(template) {
  return {
    ...emptyChoices(),
    classId: template.classId,
    backgroundId: template.backgroundId,
    speciesId: template.speciesId,
    abilityMethod: 'standard-array',
    baseAbilityScores: template.baseAbilityScores,
    backgroundAbilityBonuses: template.backgroundAbilityBonuses,
    classSkillIds: template.classSkillIds,
    speciesChoiceIds: template.speciesChoiceIds,
    classChoiceIds: template.classChoiceIds,
    classEquipmentOptionId: template.classEquipmentOptionId,
    backgroundEquipmentOptionId: template.backgroundEquipmentOptionId,
    cantripIds: template.cantripIds,
    spellbookIds: template.spellbookIds ?? [],
    spellIds: template.spellIds,
    chosenOriginFeatId: template.chosenOriginFeatId ?? null,
    backgroundFeatCantripIds: template.backgroundFeatCantripIds ?? [],
    backgroundFeatSpellIds: template.backgroundFeatSpellIds ?? [],
    originFeatCantripIds: template.originFeatCantripIds ?? [],
    originFeatSpellIds: template.originFeatSpellIds ?? [],
    identity: {
      name: `${template.label} Test`,
      pronouns: 'they/them',
      appearance: '',
      concept: '',
    },
  };
}

test('every quick-start template is mechanically complete after identity is supplied', () => {
  assert.ok(QUICK_START_TEMPLATES.length >= 1);

  for (const template of QUICK_START_TEMPLATES) {
    const withoutIdentity = {
      ...choicesFromTemplate(template),
      identity: { name: '', pronouns: '', appearance: '', concept: '' },
    };
    const identityProblems = validateChoices(withoutIdentity);
    assert.ok(
      identityProblems.some((problem) => problem.step === 'identity'),
      `${template.id} should still require identity`,
    );

    const complete = choicesFromTemplate(template);
    const problems = validateChoices(complete);
    assert.deepEqual(problems, [], `${template.id} should be legal: ${JSON.stringify(problems)}`);

    const sheet = deriveSheet(complete);
    assert.ok(sheet, `${template.id} must derive a sheet`);
    assert.equal(sheet.level, 1);
    assert.ok(sheet.hitPoints.value >= 1);
    assert.ok(sheet.proficiencyBonus.value >= 2);
    assert.ok(sheet.hitPoints.components.length >= 1);
  }
});
