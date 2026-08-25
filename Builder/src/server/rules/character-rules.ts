/**
 * The deterministic character-creation rules engine.
 *
 * Blueprint ownership: Section 6.4 (character creation rules contract) and
 * Section 6.5 (derivation and audit). Two rules shape every function here:
 *
 * - The server decides legality. `validateChoices` is the only authority for
 *   whether the final Create Character action may run; the client renders
 *   what this returns and never reaches its own verdict.
 * - Every derived number carries its own explanation. `DerivedValue` records
 *   the components and the rule identifier each came from, so the sheet can
 *   answer "why is this number?" without a second calculation path.
 */

import {
  ABILITIES,
  ABILITY_LABELS,
  ABILITY_METHODS,
  CHARACTER_NAME_MAX_LENGTH,
  CHARACTER_TEXT_MAX_LENGTH,
  MAX_ABILITY_ROLL_ATTEMPTS,
  POINT_BUY_BUDGET,
  STANDARD_ARRAY,
  WIZARD_STEPS,
  abilityModifier,
  pointBuyCost,
  type Ability,
  type CharacterChoices,
  type DerivedAttack,
  type DerivedCharacterSheet,
  type DerivedProficiency,
  type DerivedValue,
  type DraftOptions,
  type RulesCatalog,
  type UnresolvedChoice,
  type WizardStep,
} from '../../shared/character-contract.js';
import { randomInt } from 'node:crypto';
import {
  BACKGROUNDS,
  CLASSES,
  QUICK_START_TEMPLATES,
  RULES_VERSION,
  SKILLS,
  SPECIES,
  MAGIC_INITIATE_CANTRIPS_KNOWN,
  MAGIC_INITIATE_SPELLS_KNOWN,
  ORIGIN_FEAT_OPTIONS,
  ORIGIN_FEAT_SUMMARIES,
  findArmor,
  findBackground,
  findClass,
  findSkill,
  findSpecies,
  findSpell,
  findWeapon,
  magicInitiateSpellListId,
  spellsForList,
  type ClassRecord,
  type EquipmentOption,
} from './srd-manifest.js';

/** Proficiency Bonus at level 1. Single-class progression only (Section 1.5.19). */
const LEVEL_1_PROFICIENCY_BONUS = 2;
const STARTING_LEVEL = 1;

/** SRD 5.2.1 weapon mastery properties for starting weapons. */
const WEAPON_MASTERY_BY_NAME: Readonly<Record<string, string>> = {
  Greataxe: 'Cleave',
  Greatsword: 'Graze',
  Longsword: 'Sap',
  Scimitar: 'Nick',
  Shortsword: 'Vex',
  Longbow: 'Slow',
  Javelin: 'Slow',
  Handaxe: 'Vex',
  Dagger: 'Nick',
  Spear: 'Sap',
  Quarterstaff: 'Topple',
  Sickle: 'Nick',
};

export function emptyChoices(): CharacterChoices {
  return {
    classId: null,
    backgroundId: null,
    speciesId: null,
    abilityMethod: 'standard-array',
    baseAbilityScores: {},
    rolledScorePool: null,
    abilityRollAttempts: 0,
    backgroundAbilityBonuses: {},
    classSkillIds: [],
    speciesChoiceIds: {},
    classEquipmentOptionId: null,
    backgroundEquipmentOptionId: null,
    cantripIds: [],
    spellbookIds: [],
    spellIds: [],
    chosenOriginFeatId: null,
    backgroundFeatCantripIds: [],
    backgroundFeatSpellIds: [],
    originFeatCantripIds: [],
    originFeatSpellIds: [],
    classChoiceIds: {},
    weaponMasteryWeaponNames: [],
    identity: { name: '', pronouns: '', appearance: '', concept: '' },
  };
}

/**
 * Backfill fields added after a draft/character was first written so older
 * Firestore documents still validate and project under the current contract.
 * Without this, missing arrays (for example `spellbookIds`) throw inside
 * validateChoices and the hosted vault surfaces a false "live storage" error.
 */
export function coerceStoredChoices(choices: CharacterChoices): CharacterChoices {
  const base = emptyChoices();
  return {
    ...base,
    ...choices,
    baseAbilityScores: choices.baseAbilityScores ?? base.baseAbilityScores,
    backgroundAbilityBonuses: choices.backgroundAbilityBonuses ?? base.backgroundAbilityBonuses,
    classSkillIds: choices.classSkillIds ?? base.classSkillIds,
    speciesChoiceIds: choices.speciesChoiceIds ?? base.speciesChoiceIds,
    classChoiceIds: choices.classChoiceIds ?? base.classChoiceIds,
    cantripIds: choices.cantripIds ?? base.cantripIds,
    spellbookIds: choices.spellbookIds ?? base.spellbookIds,
    spellIds: choices.spellIds ?? base.spellIds,
    chosenOriginFeatId: choices.chosenOriginFeatId ?? base.chosenOriginFeatId,
    backgroundFeatCantripIds: choices.backgroundFeatCantripIds ?? base.backgroundFeatCantripIds,
    backgroundFeatSpellIds: choices.backgroundFeatSpellIds ?? base.backgroundFeatSpellIds,
    originFeatCantripIds: choices.originFeatCantripIds ?? base.originFeatCantripIds,
    originFeatSpellIds: choices.originFeatSpellIds ?? base.originFeatSpellIds,
    weaponMasteryWeaponNames: Array.isArray(choices.weaponMasteryWeaponNames)
      ? choices.weaponMasteryWeaponNames
      : base.weaponMasteryWeaponNames,
    identity: choices.identity ?? base.identity,
    rolledScorePool: Array.isArray(choices.rolledScorePool) ? choices.rolledScorePool : null,
    abilityRollAttempts:
      typeof choices.abilityRollAttempts === 'number' && Number.isInteger(choices.abilityRollAttempts)
        ? Math.max(0, choices.abilityRollAttempts)
        : 0,
  };
}

/** Human Versatile Origin feat choice only — Background feats use backgroundDetail. */
export function resolveActiveOriginFeat(
  choices: CharacterChoices,
  _backgroundRecord: ReturnType<typeof findBackground> = findBackground(choices.backgroundId),
  speciesRecord: ReturnType<typeof findSpecies> = findSpecies(choices.speciesId),
): string | null {
  if (speciesRecord?.id === 'human') {
    return choices.chosenOriginFeatId;
  }
  return null;
}

function magicInitiateAbility(listId: string): Ability {
  return listId === 'wizard' ? 'intelligence' : 'wisdom';
}

function validateMagicInitiatePicks(options: {
  readonly problems: UnresolvedChoice[];
  readonly featLabel: string | null;
  readonly listId: string | null;
  readonly cantripIds: readonly string[];
  readonly spellIds: readonly string[];
  readonly step: WizardStep;
  readonly codePrefix: string;
}): void {
  const { problems, featLabel, listId, cantripIds, spellIds, step, codePrefix } = options;
  if (listId === null || featLabel === null) {
    if (cantripIds.length > 0 || spellIds.length > 0) {
      problems.push(
        unresolved(step, `${codePrefix}_SPELLS_NOT_AVAILABLE`, 'This Origin feat does not grant spell choices.'),
      );
    }
    return;
  }
  const legalCantrips = spellsForList(listId, 0).map((spell) => spell.id);
  const legalSpells = spellsForList(listId, 1).map((spell) => spell.id);
  if (cantripIds.some((id) => !legalCantrips.includes(id))) {
    problems.push(
      unresolved(
        step,
        `${codePrefix}_CANTRIP_NOT_ON_LIST`,
        `A chosen ${featLabel} cantrip is not on the spell list.`,
      ),
    );
  }
  if (new Set(cantripIds).size !== cantripIds.length) {
    problems.push(
      unresolved(step, `${codePrefix}_CANTRIP_DUPLICATE`, 'Each Magic Initiate cantrip must be different.'),
    );
  }
  if (cantripIds.length !== MAGIC_INITIATE_CANTRIPS_KNOWN) {
    problems.push(
      unresolved(
        step,
        `${codePrefix}_CANTRIP_COUNT`,
        `Choose ${MAGIC_INITIATE_CANTRIPS_KNOWN} cantrips for ${featLabel}. ${cantripIds.length} chosen.`,
      ),
    );
  }
  if (spellIds.some((id) => !legalSpells.includes(id))) {
    problems.push(
      unresolved(
        step,
        `${codePrefix}_SPELL_NOT_ON_LIST`,
        `A chosen ${featLabel} spell is not on the spell list.`,
      ),
    );
  }
  if (new Set(spellIds).size !== spellIds.length) {
    problems.push(
      unresolved(step, `${codePrefix}_SPELL_DUPLICATE`, 'Each Magic Initiate spell must be different.'),
    );
  }
  if (spellIds.length !== MAGIC_INITIATE_SPELLS_KNOWN) {
    problems.push(
      unresolved(
        step,
        `${codePrefix}_SPELL_COUNT`,
        `Choose ${MAGIC_INITIATE_SPELLS_KNOWN} level 1 spell for ${featLabel}. ${spellIds.length} chosen.`,
      ),
    );
  }
}

/**
 * Drops class skill picks that duplicate a Background grant so the player
 * keeps every class proficiency slot after changing Background.
 */
export function sanitizeChoices(choices: CharacterChoices): CharacterChoices {
  let next = coerceStoredChoices(choices);
  const backgroundRecord = findBackground(next.backgroundId);
  const speciesRecord = findSpecies(next.speciesId);

  if (backgroundRecord !== null && next.classSkillIds.length > 0) {
    const backgroundSkills = new Set(backgroundRecord.skillIds);
    const classSkillIds = next.classSkillIds.filter((id) => !backgroundSkills.has(id));
    if (classSkillIds.length !== next.classSkillIds.length) {
      next = { ...next, classSkillIds };
    }
  }

  if (speciesRecord?.id !== 'human' && next.chosenOriginFeatId !== null) {
    next = {
      ...next,
      chosenOriginFeatId: null,
      originFeatCantripIds: [],
      originFeatSpellIds: [],
    };
  }

  const backgroundMagicListId = magicInitiateSpellListId(backgroundRecord?.originFeat ?? null);
  if (backgroundMagicListId === null) {
    if (next.backgroundFeatCantripIds.length > 0 || next.backgroundFeatSpellIds.length > 0) {
      next = { ...next, backgroundFeatCantripIds: [], backgroundFeatSpellIds: [] };
    }
  }

  const humanFeat = speciesRecord?.id === 'human' ? next.chosenOriginFeatId : null;
  if (magicInitiateSpellListId(humanFeat) === null) {
    if (next.originFeatCantripIds.length > 0 || next.originFeatSpellIds.length > 0) {
      next = { ...next, originFeatCantripIds: [], originFeatSpellIds: [] };
    }
  }

  const classRecord = findClass(next.classId);
  const spellbookSize = classRecord?.spellcasting?.spellbookSize ?? null;
  if (spellbookSize === null) {
    if (next.spellbookIds.length > 0) {
      next = { ...next, spellbookIds: [] };
    }
  } else {
    const spellbookSet = new Set(next.spellbookIds);
    const prepared = next.spellIds.filter((id) => spellbookSet.has(id));
    if (prepared.length !== next.spellIds.length) {
      next = { ...next, spellIds: prepared };
    }
  }

  return next;
}

/** One Ability Score: 4d6, drop the lowest die. */
export function rollOneAbilityScore(rollDie: () => number = () => randomInt(1, 7)): number {
  const dice = [rollDie(), rollDie(), rollDie(), rollDie()].sort((a, b) => a - b);
  return dice[1]! + dice[2]! + dice[3]!;
}

/** Six Ability Scores for a rolled pool, highest first for display. */
export function rollAbilityScorePool(rollDie: () => number = () => randomInt(1, 7)): readonly number[] {
  return Array.from({ length: 6 }, () => rollOneAbilityScore(rollDie)).sort((a, b) => b - a);
}

export { MAX_ABILITY_ROLL_ATTEMPTS };

export function buildCatalog(): RulesCatalog {
  return {
    rulesVersion: RULES_VERSION,
    classes: CLASSES.map((entry) => ({ id: entry.id, label: entry.label, summary: entry.summary })),
    species: SPECIES.map((entry) => ({ id: entry.id, label: entry.label, summary: entry.summary })),
    backgrounds: BACKGROUNDS.map((entry) => ({ id: entry.id, label: entry.label, summary: entry.summary })),
    skills: SKILLS.map((entry) => ({ id: entry.id, label: entry.label, ability: entry.ability })),
  };
}

function unresolved(step: WizardStep, code: string, message: string): UnresolvedChoice {
  return { step, code, message };
}

/**
 * Every requirement still blocking creation, in wizard order.
 *
 * Section 6.4 requires the builder to prevent incompatible selections rather
 * than accepting them and failing later, so anything selected that is not
 * legal for the current character is reported here as unresolved too.
 */
export function validateChoices(choices: CharacterChoices): readonly UnresolvedChoice[] {
  const problems: UnresolvedChoice[] = [];
  choices = coerceStoredChoices(choices);

  const classRecord = findClass(choices.classId);
  const backgroundRecord = findBackground(choices.backgroundId);
  const speciesRecord = findSpecies(choices.speciesId);

  if (classRecord === null) {
    problems.push(unresolved('class', 'CLASS_REQUIRED', 'Choose a Class.'));
  }
  if (backgroundRecord === null) {
    problems.push(unresolved('background', 'BACKGROUND_REQUIRED', 'Choose a Background.'));
  }
  if (speciesRecord === null) {
    problems.push(unresolved('species', 'SPECIES_REQUIRED', 'Choose a Species.'));
  }

  // ── Class skill proficiencies ──────────────────────────────────────────
  if (classRecord !== null) {
    const allowed =
      classRecord.skillChoiceIds.length === 0
        ? SKILLS.map((skill) => skill.id)
        : classRecord.skillChoiceIds;
    const backgroundSkills = new Set(backgroundRecord?.skillIds ?? []);
    const chosen = choices.classSkillIds;
    const illegal = chosen.filter((id) => !allowed.includes(id));
    const duplicated = chosen.length !== new Set(chosen).size;
    const overlappingBackground = chosen.filter((id) => backgroundSkills.has(id));

    if (illegal.length > 0) {
      problems.push(
        unresolved(
          'class',
          'CLASS_SKILL_NOT_AVAILABLE',
          `${classRecord.label} cannot choose ${illegal.join(', ')} as a skill proficiency.`,
        ),
      );
    }
    if (duplicated) {
      problems.push(
        unresolved('class', 'CLASS_SKILL_DUPLICATE', 'Each skill proficiency must be different.'),
      );
    }
    if (overlappingBackground.length > 0) {
      const labels = overlappingBackground
        .map((id) => findSkill(id)?.label ?? id)
        .join(', ');
      problems.push(
        unresolved(
          'class',
          'CLASS_SKILL_BACKGROUND_OVERLAP',
          `Your Background already grants ${labels}. Pick a different ${classRecord.label} skill.`,
        ),
      );
    }
    if (chosen.length !== classRecord.skillChoiceCount) {
      problems.push(
        unresolved(
          'class',
          'CLASS_SKILL_COUNT',
          `Choose ${classRecord.skillChoiceCount} skill proficiencies for ${classRecord.label}. ${chosen.length} chosen.`,
        ),
      );
    }

    for (const choice of classRecord.choices) {
      const selected = choices.classChoiceIds[choice.id] ?? [];
      const legalIds = choice.from.map((option) => option.id);
      if (selected.some((id) => !legalIds.includes(id))) {
        problems.push(
          unresolved('features', 'CLASS_CHOICE_INVALID', `An option selected for ${choice.label} is not available.`),
        );
      }
      if (selected.length !== choice.choose) {
        problems.push(
          unresolved('features', 'CLASS_CHOICE_REQUIRED', `Choose ${choice.choose} for ${choice.label}.`),
        );
      }
    }
  }

  // ── Species choices ────────────────────────────────────────────────────
  if (speciesRecord !== null) {
    const alreadyProficient = new Set<string>([
      ...(backgroundRecord?.skillIds ?? []),
      ...choices.classSkillIds,
    ]);
    for (const choice of speciesRecord.choices) {
      const selected = choices.speciesChoiceIds[choice.id];
      if (selected === undefined) {
        problems.push(unresolved('species', 'SPECIES_CHOICE_REQUIRED', `Choose ${choice.label}.`));
        continue;
      }
      if (!choice.from.some((option) => option.id === selected)) {
        problems.push(
          unresolved('species', 'SPECIES_CHOICE_INVALID', `That option is not available for ${choice.label}.`),
        );
      }
      if (choice.grantsSkillProficiency === true && alreadyProficient.has(selected)) {
        problems.push(
          unresolved(
            'species',
            'SPECIES_SKILL_ALREADY_PROFICIENT',
            `You are already proficient in ${findSkill(selected)?.label ?? selected}. Choose a different skill.`,
          ),
        );
      }
    }
    if (speciesRecord.id === 'human') {
      if (choices.chosenOriginFeatId === null) {
        problems.push(
          unresolved('species', 'ORIGIN_FEAT_REQUIRED', 'Choose an Origin feat for your Human.'),
        );
      } else if (!ORIGIN_FEAT_OPTIONS.some((option) => option.id === choices.chosenOriginFeatId)) {
        problems.push(unresolved('species', 'ORIGIN_FEAT_INVALID', 'That Origin feat is not available.'));
      }
    }
  }

  // ── Ability scores ─────────────────────────────────────────────────────
  if (!ABILITY_METHODS.includes(choices.abilityMethod)) {
    problems.push(unresolved('abilities', 'ABILITY_METHOD_INVALID', 'Choose a supported ability-generation method.'));
  }

  if (
    choices.abilityMethod === 'rolled' &&
    (choices.rolledScorePool === null || choices.rolledScorePool.length !== 6)
  ) {
    problems.push(
      unresolved(
        'abilities',
        'ABILITY_ROLL_REQUIRED',
        `Roll for Ability Scores (up to ${MAX_ABILITY_ROLL_ATTEMPTS} times). Each roll replaces the previous one.`,
      ),
    );
  }

  const assigned = ABILITIES.map((ability) => choices.baseAbilityScores[ability]);
  if (assigned.some((score) => score === undefined)) {
    problems.push(
      unresolved('abilities', 'ABILITY_SCORES_INCOMPLETE', 'Assign a score to each of the six Ability Scores.'),
    );
  } else {
    const scores = assigned as number[];
    if (choices.abilityMethod === 'standard-array') {
      const sortedChosen = [...scores].sort((a, b) => b - a).join(',');
      const sortedArray = [...STANDARD_ARRAY].sort((a, b) => b - a).join(',');
      if (sortedChosen !== sortedArray) {
        problems.push(
          unresolved(
            'abilities',
            'STANDARD_ARRAY_MISMATCH',
            `The standard array assigns exactly ${STANDARD_ARRAY.join(', ')} across the six Ability Scores.`,
          ),
        );
      }
    } else if (choices.abilityMethod === 'point-buy') {
      const cost = pointBuyCost(scores);
      if (cost === null) {
        problems.push(
          unresolved('abilities', 'POINT_BUY_OUT_OF_RANGE', 'Point buy allows scores from 8 to 15 before Background increases.'),
        );
      } else if (cost > POINT_BUY_BUDGET) {
        problems.push(
          unresolved('abilities', 'POINT_BUY_OVER_BUDGET', `Point buy allows ${POINT_BUY_BUDGET} points. That array costs ${cost}.`),
        );
      }
    } else if (choices.abilityMethod === 'rolled' && choices.rolledScorePool !== null) {
      const sortedChosen = [...scores].sort((a, b) => b - a).join(',');
      const sortedPool = [...choices.rolledScorePool].sort((a, b) => b - a).join(',');
      if (sortedChosen !== sortedPool) {
        problems.push(
          unresolved(
            'abilities',
            'ROLLED_POOL_MISMATCH',
            `Assign exactly the rolled scores (${choices.rolledScorePool.join(', ')}) across the six Ability Scores.`,
          ),
        );
      }
    }
  }

  // ── Background ability increases ───────────────────────────────────────
  if (backgroundRecord !== null) {
    const bonuses = choices.backgroundAbilityBonuses;
    const entries = ABILITIES.map((ability) => [ability, bonuses[ability] ?? 0] as const).filter(
      ([, amount]) => amount !== 0,
    );
    const outsideBackground = entries.filter(
      ([ability]) => !backgroundRecord.abilityOptions.includes(ability),
    );
    const total = entries.reduce((sum, [, amount]) => sum + amount, 0);
    const amounts = entries.map(([, amount]) => amount).sort((a, b) => b - a).join(',');
    const legalPattern = amounts === '2,1' || amounts === '1,1,1';

    if (outsideBackground.length > 0) {
      problems.push(
        unresolved(
          'background',
          'BACKGROUND_BONUS_NOT_AVAILABLE',
          `${backgroundRecord.label} increases only ${backgroundRecord.abilityOptions
            .map((ability) => ABILITY_LABELS[ability])
            .join(', ')}.`,
        ),
      );
    } else if (total === 0) {
      problems.push(
        unresolved('background', 'BACKGROUND_BONUS_REQUIRED', 'Assign the Background ability increases.'),
      );
    } else if (!legalPattern) {
      problems.push(
        unresolved(
          'background',
          'BACKGROUND_BONUS_PATTERN',
          'Background increases are either +2 and +1 across two abilities, or +1 to each of three.',
        ),
      );
    }
  }

  // ── Equipment ──────────────────────────────────────────────────────────
  if (classRecord !== null) {
    if (!classRecord.equipmentOptions.some((option) => option.id === choices.classEquipmentOptionId)) {
      problems.push(
        unresolved('equipment', 'CLASS_EQUIPMENT_REQUIRED', `Choose starting equipment for ${classRecord.label}.`),
      );
    }
  }
  if (backgroundRecord !== null) {
    if (!backgroundRecord.equipmentOptions.some((option) => option.id === choices.backgroundEquipmentOptionId)) {
      problems.push(
        unresolved('equipment', 'BACKGROUND_EQUIPMENT_REQUIRED', `Choose starting equipment for ${backgroundRecord.label}.`),
      );
    }
  }

  // ── Cantrips and spells ────────────────────────────────────────────────
  if (classRecord?.spellcasting != null) {
    const casting = classRecord.spellcasting;
    const legalCantrips = spellsForList(casting.spellListId, 0).map((spell) => spell.id);
    const legalSpells = spellsForList(casting.spellListId, 1).map((spell) => spell.id);

    if (choices.cantripIds.some((id) => !legalCantrips.includes(id))) {
      problems.push(
        unresolved('features', 'CANTRIP_NOT_ON_LIST', `A chosen cantrip is not on the ${classRecord.label} spell list.`),
      );
    }
    if (new Set(choices.cantripIds).size !== choices.cantripIds.length) {
      problems.push(unresolved('features', 'CANTRIP_DUPLICATE', 'Each cantrip must be different.'));
    }
    if (choices.cantripIds.length !== casting.cantripsKnown) {
      problems.push(
        unresolved('features', 'CANTRIP_COUNT', `Choose ${casting.cantripsKnown} cantrips. ${choices.cantripIds.length} chosen.`),
      );
    }

    if (choices.spellIds.some((id) => !legalSpells.includes(id))) {
      problems.push(
        unresolved('features', 'SPELL_NOT_ON_LIST', `A chosen spell is not on the ${classRecord.label} spell list.`),
      );
    }
    if (new Set(choices.spellIds).size !== choices.spellIds.length) {
      problems.push(unresolved('features', 'SPELL_DUPLICATE', 'Each spell must be different.'));
    }
    if (choices.spellIds.length !== casting.spellsAvailable) {
      const verb = casting.preparationStyle === 'prepared' ? 'prepare' : 'know';
      problems.push(
        unresolved('features', 'SPELL_COUNT', `Choose ${casting.spellsAvailable} level 1 spells to ${verb}. ${choices.spellIds.length} chosen.`),
      );
    }

    const spellbookSize = casting.spellbookSize ?? null;
    if (spellbookSize !== null) {
      if (choices.spellbookIds.some((id) => !legalSpells.includes(id))) {
        problems.push(
          unresolved('features', 'SPELLBOOK_NOT_ON_LIST', `A spellbook spell is not on the ${classRecord.label} spell list.`),
        );
      }
      if (new Set(choices.spellbookIds).size !== choices.spellbookIds.length) {
        problems.push(unresolved('features', 'SPELLBOOK_DUPLICATE', 'Each spellbook spell must be different.'));
      }
      if (choices.spellbookIds.length !== spellbookSize) {
        problems.push(
          unresolved(
            'features',
            'SPELLBOOK_COUNT',
            `Choose ${spellbookSize} spells for your spellbook. ${choices.spellbookIds.length} chosen.`,
          ),
        );
      }
      if (choices.spellIds.some((id) => !choices.spellbookIds.includes(id))) {
        problems.push(
          unresolved(
            'features',
            'SPELL_NOT_IN_SPELLBOOK',
            'Each prepared spell must also appear in your spellbook.',
          ),
        );
      }
    } else if (choices.spellbookIds.length > 0) {
      problems.push(
        unresolved('features', 'SPELLBOOK_NOT_AVAILABLE', 'This Class does not use a spellbook at level 1.'),
      );
    }
  } else if (choices.cantripIds.length > 0 || choices.spellIds.length > 0 || choices.spellbookIds.length > 0) {
    problems.push(
      unresolved('features', 'SPELLS_NOT_AVAILABLE', 'This Class does not cast spells at level 1.'),
    );
  }

  const activeOriginFeat = resolveActiveOriginFeat(choices, backgroundRecord, speciesRecord);
  validateMagicInitiatePicks({
    problems,
    featLabel: backgroundRecord?.originFeat ?? null,
    listId: magicInitiateSpellListId(backgroundRecord?.originFeat ?? null),
    cantripIds: choices.backgroundFeatCantripIds,
    spellIds: choices.backgroundFeatSpellIds,
    step: 'features',
    codePrefix: 'BACKGROUND_FEAT',
  });
  validateMagicInitiatePicks({
    problems,
    featLabel: activeOriginFeat,
    listId: magicInitiateSpellListId(activeOriginFeat),
    cantripIds: choices.originFeatCantripIds,
    spellIds: choices.originFeatSpellIds,
    step: 'features',
    codePrefix: 'ORIGIN_FEAT',
  });

  // ── Identity, last ─────────────────────────────────────────────────────
  const name = choices.identity.name.trim();
  if (name.length === 0) {
    problems.push(unresolved('identity', 'NAME_REQUIRED', 'Give your character a name.'));
  } else if (name.length > CHARACTER_NAME_MAX_LENGTH) {
    problems.push(
      unresolved('identity', 'NAME_TOO_LONG', `A character name is at most ${CHARACTER_NAME_MAX_LENGTH} characters.`),
    );
  }
  for (const [field, label] of [
    ['pronouns', 'Pronouns'],
    ['appearance', 'Appearance'],
    ['concept', 'Concept'],
  ] as const) {
    if (choices.identity[field].length > CHARACTER_TEXT_MAX_LENGTH) {
      problems.push(
        unresolved('identity', 'IDENTITY_TEXT_TOO_LONG', `${label} is at most ${CHARACTER_TEXT_MAX_LENGTH} characters.`),
      );
    }
  }

  return problems;
}

/** Steps with nothing unresolved, so the wizard can show real progress. */
export function completedSteps(choices: CharacterChoices): readonly WizardStep[] {
  const problems = validateChoices(choices);
  return WIZARD_STEPS.filter((step) => !problems.some((problem) => problem.step === step));
}

function value(components: readonly { label: string; amount: number; ruleId: string }[]): DerivedValue {
  return { value: components.reduce((sum, part) => sum + part.amount, 0), components };
}

function equipmentOptionFor(
  options: readonly EquipmentOption[],
  id: string | null,
): EquipmentOption | null {
  return options.find((option) => option.id === id) ?? null;
}

function consolidateEquipment(
  items: readonly { readonly name: string; readonly quantity: number }[],
): { readonly name: string; readonly quantity: number }[] {
  const quantities = new Map<string, number>();
  for (const item of items) {
    quantities.set(item.name, (quantities.get(item.name) ?? 0) + item.quantity);
  }
  return [...quantities.entries()].map(([name, quantity]) => ({ name, quantity }));
}

function originFeatSummary(featName: string, fallback: string): string {
  return ORIGIN_FEAT_SUMMARIES[featName] ?? fallback;
}

function selectedClassChoiceIds(choices: CharacterChoices, choiceId: string): readonly string[] {
  return choices.classChoiceIds[choiceId] ?? [];
}

function hasFightingStyle(choices: CharacterChoices, styleId: string): boolean {
  return selectedClassChoiceIds(choices, 'fighting-style').includes(styleId);
}

/**
 * Best Armor Class available from the chosen equipment and features.
 *
 * Unarmored Defense replaces the ordinary formula only while its conditions
 * hold, so it is evaluated against the equipment actually chosen rather than
 * assumed from the Class alone.
 */
function deriveArmorClass(
  classRecord: ClassRecord,
  classEquipment: EquipmentOption | null,
  modifiers: Record<Ability, number>,
  choices: CharacterChoices,
): DerivedValue {
  const armorIds = classEquipment?.armorIds ?? [];
  const bodyArmor = armorIds
    .map((id) => findArmor(id))
    .filter((armor): armor is NonNullable<typeof armor> => armor !== null && armor.category !== 'shield');
  const shield = armorIds.some((id) => findArmor(id)?.category === 'shield');
  const wearingArmor = bodyArmor.length > 0;

  if (classRecord.unarmoredDefenseAbility !== null && bodyArmor.length === 0) {
    // The Monk's Unarmored Defense also requires no Shield; the Barbarian's
    // permits one.
    const shieldBlocksIt = classRecord.id === 'monk' && shield;
    if (!shieldBlocksIt) {
      const components = [
        { label: 'Unarmored Defense base', amount: 10, ruleId: `class.${classRecord.id}.unarmored-defense` },
        { label: ABILITY_LABELS.dexterity, amount: modifiers.dexterity, ruleId: 'ability.dexterity' },
        {
          label: ABILITY_LABELS[classRecord.unarmoredDefenseAbility],
          amount: modifiers[classRecord.unarmoredDefenseAbility],
          ruleId: `ability.${classRecord.unarmoredDefenseAbility}`,
        },
      ];
      if (shield) {
        components.push({ label: 'Shield', amount: 2, ruleId: 'armor.shield' });
      }
      return value(components);
    }
  }

  // Armor of Shadows (Warlock): Mage Armor while not wearing armor.
  if (
    !wearingArmor &&
    selectedClassChoiceIds(choices, 'eldritch-invocation').includes('armor-of-shadows')
  ) {
    const components = [
      { label: 'Armor of Shadows (Mage Armor)', amount: 13, ruleId: 'class.warlock.eldritch-invocation.armor-of-shadows' },
      { label: ABILITY_LABELS.dexterity, amount: modifiers.dexterity, ruleId: 'ability.dexterity' },
    ];
    if (shield) {
      components.push({ label: 'Shield', amount: 2, ruleId: 'armor.shield' });
    }
    return value(components);
  }

  const best = bodyArmor.sort((a, b) => b.baseArmorClass - a.baseArmorClass)[0];
  if (best === undefined) {
    const components = [
      { label: 'Unarmored base', amount: 10, ruleId: 'armor.unarmored' },
      { label: ABILITY_LABELS.dexterity, amount: modifiers.dexterity, ruleId: 'ability.dexterity' },
    ];
    if (shield) {
      components.push({ label: 'Shield', amount: 2, ruleId: 'armor.shield' });
    }
    return value(components);
  }

  const dexterityApplied =
    best.dexterityCap === null ? modifiers.dexterity : Math.min(modifiers.dexterity, best.dexterityCap);
  const components = [
    { label: best.label, amount: best.baseArmorClass, ruleId: `armor.${best.id}` },
    { label: ABILITY_LABELS.dexterity, amount: dexterityApplied, ruleId: 'ability.dexterity' },
  ];
  if (shield) {
    components.push({ label: 'Shield', amount: 2, ruleId: 'armor.shield' });
  }
  if (hasFightingStyle(choices, 'defense') && wearingArmor) {
    components.push({
      label: 'Fighting Style: Defense',
      amount: 1,
      ruleId: `class.${classRecord.id}.fighting-style.defense`,
    });
  }
  return value(components);
}

function deriveAttacks(
  classRecord: ClassRecord,
  classEquipment: EquipmentOption | null,
  modifiers: Record<Ability, number>,
  proficiencyBonus: number,
  choices: CharacterChoices,
): readonly DerivedAttack[] {
  // Only the Class equipment option produces attack lines: the character is
  // proficient with everything in their own Class kit by construction, so no
  // proficiency has to be inferred. Background items are carried as
  // equipment without an attack line rather than assuming proficiency.
  const weaponIds = classEquipment?.weaponIds ?? [];
  const weapons = weaponIds
    .map((id) => findWeapon(id))
    .filter((weapon): weapon is NonNullable<typeof weapon> => weapon !== null);

  const meleeWeaponCount = weapons.filter((weapon) => !weapon.category.endsWith('ranged')).length;
  const archery = hasFightingStyle(choices, 'archery');
  const dueling = hasFightingStyle(choices, 'dueling');

  if (weapons.length === 0) {
    const ability: Ability =
      modifiers.dexterity > modifiers.strength ? 'dexterity' : 'strength';
    return [
      {
        name: 'Unarmed Strike',
        attackBonus: value([
          { label: ABILITY_LABELS[ability], amount: modifiers[ability], ruleId: `ability.${ability}` },
          { label: 'Proficiency Bonus', amount: proficiencyBonus, ruleId: 'proficiency-bonus' },
        ]),
        damage: `1+${modifiers[ability]}`,
        damageType: 'bludgeoning',
        properties: ['Unarmed'],
        ruleId: 'weapon.unarmed-strike',
      },
    ];
  }

  return weapons.map((weapon) => {
    const ranged = weapon.category.endsWith('ranged');
    const finesse = weapon.properties.includes('Finesse');
    const twoHanded = weapon.properties.includes('Two-Handed');
    const ability: Ability = ranged
      ? 'dexterity'
      : finesse && modifiers.dexterity > modifiers.strength
        ? 'dexterity'
        : 'strength';
    const attackComponents = [
      { label: ABILITY_LABELS[ability], amount: modifiers[ability], ruleId: `ability.${ability}` },
      { label: 'Proficiency Bonus', amount: proficiencyBonus, ruleId: 'proficiency-bonus' },
    ];
    if (archery && ranged) {
      attackComponents.push({
        label: 'Fighting Style: Archery',
        amount: 2,
        ruleId: `class.${classRecord.id}.fighting-style.archery`,
      });
    }

    let damage = weapon.damage;
    const properties = [...weapon.properties];
    if (dueling && !ranged && !twoHanded && meleeWeaponCount === 1) {
      // Sheet-facing reminder: +2 damage under Dueling conditions.
      damage = `${weapon.damage}+2`;
      properties.push('Dueling +2 damage');
    }

    return {
      name: weapon.label,
      attackBonus: value(attackComponents),
      damage,
      damageType: weapon.damageType,
      properties,
      ruleId: `weapon.${weapon.id}`,
    };
  });
}

/**
 * The complete level-1 sheet, or null when Class, Background, or Species is
 * still unchosen. Ability scores may be incomplete; missing scores are
 * treated as unset rather than guessed, and the caller sees the gap through
 * `validateChoices`.
 */
export function deriveSheet(choices: CharacterChoices): DerivedCharacterSheet | null {
  choices = coerceStoredChoices(choices);
  const classRecord = findClass(choices.classId);
  const backgroundRecord = findBackground(choices.backgroundId);
  const speciesRecord = findSpecies(choices.speciesId);
  if (classRecord === null || backgroundRecord === null || speciesRecord === null) {
    return null;
  }

  const proficiencyBonus = value([
    { label: 'Level 1', amount: LEVEL_1_PROFICIENCY_BONUS, ruleId: 'proficiency-bonus.level-1' },
  ]);

  const abilityScores = {} as Record<Ability, DerivedValue>;
  const modifiers = {} as Record<Ability, number>;
  for (const ability of ABILITIES) {
    const base = choices.baseAbilityScores[ability] ?? 0;
    const backgroundBonus = choices.backgroundAbilityBonuses[ability] ?? 0;
    const components = [{ label: 'Base score', amount: base, ruleId: `ability-method.${choices.abilityMethod}` }];
    if (backgroundBonus !== 0) {
      components.push({
        label: `${backgroundRecord.label} increase`,
        amount: backgroundBonus,
        ruleId: `background.${backgroundRecord.id}.ability-increase`,
      });
    }
    const derived = value(components);
    abilityScores[ability] = derived;
    modifiers[ability] = abilityModifier(derived.value);
  }

  const hitPointComponents = [
    { label: `Hit Die maximum (d${classRecord.hitDie})`, amount: classRecord.hitDie, ruleId: `class.${classRecord.id}.hit-die` },
    { label: ABILITY_LABELS.constitution, amount: modifiers.constitution, ruleId: 'ability.constitution' },
  ];
  if (speciesRecord.hitPointsPerLevel > 0) {
    hitPointComponents.push({
      label: `${speciesRecord.label} Hit Points per level`,
      amount: speciesRecord.hitPointsPerLevel * STARTING_LEVEL,
      ruleId: `species.${speciesRecord.id}.hit-points`,
    });
  }

  const classEquipment = equipmentOptionFor(classRecord.equipmentOptions, choices.classEquipmentOptionId);
  const backgroundEquipment = equipmentOptionFor(
    backgroundRecord.equipmentOptions,
    choices.backgroundEquipmentOptionId,
  );

  // ── Proficiencies from every source ────────────────────────────────────
  const proficiencies: DerivedProficiency[] = [];
  const skillSources = new Map<string, string>();

  for (const skillId of choices.classSkillIds) {
    skillSources.set(skillId, classRecord.label);
  }
  for (const skillId of backgroundRecord.skillIds) {
    skillSources.set(skillId, backgroundRecord.label);
  }
  for (const choice of speciesRecord.choices) {
    if (choice.grantsSkillProficiency === true) {
      const selected = choices.speciesChoiceIds[choice.id];
      if (selected !== undefined && findSkill(selected) !== null) {
        skillSources.set(selected, speciesRecord.label);
      }
    }
  }

  for (const [skillId, source] of skillSources) {
    const skill = findSkill(skillId);
    if (skill !== null) {
      proficiencies.push({ id: `skill.${skillId}`, label: skill.label, sourceLabel: source, ruleId: `skill.${skillId}` });
    }
  }
  for (const armorProficiency of classRecord.armorProficiencies) {
    proficiencies.push({ id: `armor.${armorProficiency}`, label: armorProficiency, sourceLabel: classRecord.label, ruleId: `class.${classRecord.id}.armor` });
  }
  for (const weaponProficiency of classRecord.weaponProficiencies) {
    proficiencies.push({ id: `weapon.${weaponProficiency}`, label: weaponProficiency, sourceLabel: classRecord.label, ruleId: `class.${classRecord.id}.weapons` });
  }
  for (const toolProficiency of classRecord.toolProficiencies) {
    proficiencies.push({ id: `tool.${toolProficiency}`, label: toolProficiency, sourceLabel: classRecord.label, ruleId: `class.${classRecord.id}.tools` });
  }
  proficiencies.push({
    id: `tool.${backgroundRecord.toolProficiency}`,
    label: backgroundRecord.toolProficiency,
    sourceLabel: backgroundRecord.label,
    ruleId: `background.${backgroundRecord.id}.tool`,
  });

  const skills = SKILLS.map((skill) => {
    const proficient = skillSources.has(skill.id);
    const components = [
      { label: ABILITY_LABELS[skill.ability], amount: modifiers[skill.ability], ruleId: `ability.${skill.ability}` },
    ];
    if (proficient) {
      components.push({
        label: `Proficiency Bonus (${skillSources.get(skill.id) ?? ''})`,
        amount: proficiencyBonus.value,
        ruleId: 'proficiency-bonus',
      });
    }
    return { id: skill.id, label: skill.label, ability: skill.ability, proficient, bonus: value(components) };
  });

  const savingThrows = {} as Record<Ability, DerivedValue>;
  for (const ability of ABILITIES) {
    const proficient = classRecord.savingThrowProficiencies.includes(ability);
    const components = [
      { label: ABILITY_LABELS[ability], amount: modifiers[ability], ruleId: `ability.${ability}` },
    ];
    if (proficient) {
      components.push({ label: 'Proficiency Bonus', amount: proficiencyBonus.value, ruleId: 'proficiency-bonus' });
    }
    savingThrows[ability] = value(components);
  }

  const perception = skills.find((skill) => skill.id === 'perception');
  const passivePerception = value([
    { label: 'Passive base', amount: 10, ruleId: 'passive.base' },
    { label: 'Perception', amount: perception?.bonus.value ?? modifiers.wisdom, ruleId: 'skill.perception' },
  ]);

  const equipment = consolidateEquipment([
    ...(classEquipment?.items ?? []),
    ...(backgroundEquipment?.items ?? []),
  ]);

  const features = [
    ...classRecord.features
      .filter((feature) => !classRecord.choices.some((choice) => choice.label === feature.name))
      .map((feature) => ({ name: feature.name, source: classRecord.label, summary: feature.summary })),
    ...classRecord.choices.flatMap((choice) => {
      const selected = choices.classChoiceIds[choice.id] ?? [];
      return selected.flatMap((optionId) => {
        const option = choice.from.find((entry) => entry.id === optionId);
        if (option === undefined) {
          return [];
        }
        return [
          {
            name: `${choice.label}: ${option.label}`,
            source: classRecord.label,
            summary: option.summary,
          },
        ];
      });
    }),
    ...speciesRecord.features
      .filter((feature) => (feature.minLevel ?? 1) <= STARTING_LEVEL)
      .filter((feature) => !speciesRecord.choices.some((choice) => choice.label.startsWith(feature.name)))
      // PQA-195: never leave bare Human Versatile — name the feat or mark Unassigned.
      .filter(
        (feature) => !(speciesRecord.id === 'human' && feature.name === 'Versatile'),
      )
      .map((feature) => ({ name: feature.name, source: speciesRecord.label, summary: feature.summary })),
    ...speciesRecord.choices.flatMap((choice) => {
      const selected = choices.speciesChoiceIds[choice.id];
      if (selected === undefined) {
        return [];
      }
      const option = choice.from.find((entry) => entry.id === selected);
      if (option === undefined) {
        return [];
      }
      return [
        {
          name: `${choice.label}: ${option.label}`,
          source: speciesRecord.label,
          summary: option.summary,
        },
      ];
    }),
    { name: backgroundRecord.originFeat, source: backgroundRecord.label, summary: originFeatSummary(backgroundRecord.originFeat, 'Origin feat granted by your Background.') },
  ];
  const activeOriginFeat = resolveActiveOriginFeat(choices, backgroundRecord, speciesRecord);
  if (speciesRecord.id === 'human') {
    features.push({
      name: activeOriginFeat !== null ? `Versatile: ${activeOriginFeat}` : 'Versatile: Unassigned',
      source: `${speciesRecord.label} · Versatile`,
      summary:
        activeOriginFeat !== null
          ? originFeatSummary(activeOriginFeat, 'Origin feat chosen through Human Versatile.')
          : 'Choose an Origin feat through Edit loadout or character creation.',
    });
  }
  if (activeOriginFeat !== null && magicInitiateSpellListId(activeOriginFeat) !== null) {
    const featCantrips = choices.originFeatCantripIds
      .map((id) => findSpell(id))
      .filter((spell): spell is NonNullable<typeof spell> => spell !== null)
      .map((spell) => spell.label);
    const featSpells = choices.originFeatSpellIds
      .map((id) => findSpell(id))
      .filter((spell): spell is NonNullable<typeof spell> => spell !== null)
      .map((spell) => spell.label);
    if (featCantrips.length > 0 || featSpells.length > 0) {
      features.push({
        name: `${activeOriginFeat} spells`,
        source: speciesRecord.label,
        summary: [
          featCantrips.length > 0 ? `Cantrips: ${featCantrips.join(', ')}` : '',
          featSpells.length > 0 ? `Level 1: ${featSpells.join(', ')}` : '',
        ]
          .filter((part) => part.length > 0)
          .join(' · '),
      });
    }
  }
  if (magicInitiateSpellListId(backgroundRecord.originFeat) !== null) {
    const featCantrips = choices.backgroundFeatCantripIds
      .map((id) => findSpell(id))
      .filter((spell): spell is NonNullable<typeof spell> => spell !== null)
      .map((spell) => spell.label);
    const featSpells = choices.backgroundFeatSpellIds
      .map((id) => findSpell(id))
      .filter((spell): spell is NonNullable<typeof spell> => spell !== null)
      .map((spell) => spell.label);
    if (featCantrips.length > 0 || featSpells.length > 0) {
      features.push({
        name: `${backgroundRecord.originFeat} spells`,
        source: backgroundRecord.label,
        summary: [
          featCantrips.length > 0 ? `Cantrips: ${featCantrips.join(', ')}` : '',
          featSpells.length > 0 ? `Level 1: ${featSpells.join(', ')}` : '',
        ]
          .filter((part) => part.length > 0)
          .join(' · '),
      });
    }
  }

  const casting = classRecord.spellcasting;
  const backgroundMagicListId = magicInitiateSpellListId(backgroundRecord.originFeat);
  const humanMagicListId = magicInitiateSpellListId(activeOriginFeat);
  const magicInitiateListId = casting === null ? (backgroundMagicListId ?? humanMagicListId) : backgroundMagicListId ?? humanMagicListId;
  const featCantripEntries = [...choices.backgroundFeatCantripIds, ...choices.originFeatCantripIds]
    .map((id) => findSpell(id))
    .filter((spell): spell is NonNullable<typeof spell> => spell !== null)
    .map((spell) => ({ id: spell.id, name: spell.label }));
  const featSpellEntries = [...choices.backgroundFeatSpellIds, ...choices.originFeatSpellIds]
    .map((id) => findSpell(id))
    .filter((spell): spell is NonNullable<typeof spell> => spell !== null)
    .map((spell) => ({ id: spell.id, name: spell.label }));
  const classSpellEntries =
    casting === null
      ? []
      : choices.spellIds
          .map((id) => findSpell(id))
          .filter((spell): spell is NonNullable<typeof spell> => spell !== null)
          .map((spell) => ({ id: spell.id, name: spell.label }));
  const spellbookSize = casting?.spellbookSize ?? null;
  const spellbookEntries =
    spellbookSize === null
      ? []
      : choices.spellbookIds
          .map((id) => findSpell(id))
          .filter((spell): spell is NonNullable<typeof spell> => spell !== null)
          .map((spell) => ({ id: spell.id, name: spell.label }));
  const level1SlotCount = casting?.level1SlotCount ?? 0;
  const spellcasting =
    casting === null && magicInitiateListId === null
      ? null
      : {
          ability: casting?.ability ?? magicInitiateAbility(magicInitiateListId!),
          spellSaveDc: value([
            { label: 'Base', amount: 8, ruleId: 'spellcasting.save-dc-base' },
            { label: 'Proficiency Bonus', amount: proficiencyBonus.value, ruleId: 'proficiency-bonus' },
            {
              label: ABILITY_LABELS[casting?.ability ?? magicInitiateAbility(magicInitiateListId!)],
              amount: modifiers[casting?.ability ?? magicInitiateAbility(magicInitiateListId!)],
              ruleId: `ability.${casting?.ability ?? magicInitiateAbility(magicInitiateListId!)}`,
            },
          ]),
          spellAttackBonus: value([
            { label: 'Proficiency Bonus', amount: proficiencyBonus.value, ruleId: 'proficiency-bonus' },
            {
              label: ABILITY_LABELS[casting?.ability ?? magicInitiateAbility(magicInitiateListId!)],
              amount: modifiers[casting?.ability ?? magicInitiateAbility(magicInitiateListId!)],
              ruleId: `ability.${casting?.ability ?? magicInitiateAbility(magicInitiateListId!)}`,
            },
          ]),
          cantrips: [
            ...(casting === null
              ? []
              : choices.cantripIds
                  .map((id) => findSpell(id))
                  .filter((spell): spell is NonNullable<typeof spell> => spell !== null)
                  .map((spell) => ({ id: spell.id, name: spell.label }))),
            ...featCantripEntries,
          ],
          spellbook: spellbookEntries,
          spells:
            spellbookSize !== null
              ? classSpellEntries
              : [...classSpellEntries, ...featSpellEntries],
          level1SlotCount,
          level1SlotsRemaining: level1SlotCount,
          preparationStyle: casting?.preparationStyle ?? 'known',
        };

  const hasAlert =
    backgroundRecord.originFeat === 'Alert' ||
    (speciesRecord.id === 'human' && activeOriginFeat === 'Alert');
  const initiativeComponents = [
    { label: ABILITY_LABELS.dexterity, amount: modifiers.dexterity, ruleId: 'ability.dexterity' },
  ];
  if (hasAlert) {
    initiativeComponents.push({
      label: 'Alert',
      amount: proficiencyBonus.value,
      ruleId: 'feat.alert.initiative',
    });
  }
  const hitPoints = value(hitPointComponents);
  const attacks = deriveAttacks(classRecord, classEquipment, modifiers, proficiencyBonus.value, choices);
  const fightingStyle = features.find((feature) => feature.name.startsWith('Fighting Style:'));
  const subclassLabel =
    fightingStyle !== undefined
      ? `${fightingStyle.name.replace('Fighting Style: ', '')} (fighting style)`
      : classRecord.id === 'fighter'
        ? 'Subclass unlocks at level 3 (Champion is the Alpha default)'
        : null;
  const masteryCount = classRecord.features.some((feature) => feature.name === 'Weapon Mastery')
    ? classRecord.id === 'fighter'
      ? 3
      : 2
    : 0;
  const masteryWeapons = [
    ...new Set(
      [
        ...attacks.map((attack) => attack.name),
        ...equipment.map((item) => item.name),
      ].filter((name) => WEAPON_MASTERY_BY_NAME[name] !== undefined),
    ),
  ];
  const explicitMasteryPicks = (choices.weaponMasteryWeaponNames ?? []).filter(
    (name) => WEAPON_MASTERY_BY_NAME[name] !== undefined,
  );
  // PQA-208: once the player has made explicit mastery picks, honor only
  // those — do not backfill remaining slots from starting gear.
  const assignedMasteryNames =
    explicitMasteryPicks.length > 0
      ? explicitMasteryPicks.slice(0, masteryCount)
      : masteryWeapons.slice(0, masteryCount);
  const weaponMasteries =
    masteryCount === 0
      ? []
      : [
          ...assignedMasteryNames.map((name) => ({
            name,
            property: WEAPON_MASTERY_BY_NAME[name] ?? 'Mastery',
            assigned: true as const,
          })),
          ...Array.from({ length: Math.max(0, masteryCount - assignedMasteryNames.length) }, () => ({
            name: 'Unassigned',
            property: 'Choose a proficient mastery weapon',
            assigned: false as const,
          })),
        ];
  const weaponMasterySlotCount = masteryCount;
  const classResources: Array<{
    id: string;
    label: string;
    summary: string;
    remaining: number;
    maximum: number;
    recharge: string;
  }> = [];
  if (classRecord.features.some((feature) => feature.name === 'Second Wind')) {
    classResources.push({
      id: 'second-wind',
      label: 'Second Wind',
      summary: 'Bonus Action to regain 1d10 + level Hit Points.',
      remaining: 1,
      maximum: 1,
      recharge: 'Short rest',
    });
  }
  // Action Surge is a level-2 Fighter feature; L1 sheets omit it.

  return {
    level: STARTING_LEVEL,
    experiencePoints: 0,
    proficiencyBonus,
    abilityScores,
    abilityModifiers: modifiers,
    hitPoints,
    hitPointsCurrent: hitPoints.value,
    hitDice: `1d${classRecord.hitDie}`,
    armorClass: deriveArmorClass(classRecord, classEquipment, modifiers, choices),
    initiative: value(initiativeComponents),
    speed: value([{ label: `${speciesRecord.label} Speed`, amount: speciesRecord.speed, ruleId: `species.${speciesRecord.id}.speed` }]),
    passivePerception,
    savingThrows,
    savingThrowProficiencies: classRecord.savingThrowProficiencies,
    skills,
    senses: speciesRecord.senses,
    proficiencies,
    languages: ['Common'],
    features,
    attacks,
    equipment,
    currencyGold: (classEquipment?.gold ?? 0) + (backgroundEquipment?.gold ?? 0),
    spellcasting,
    subclassLabel,
    weaponMasteries,
    weaponMasterySlotCount,
    temporaryHitPoints: 0,
    classResources,
  };
}

/**
 * The selectable options for the current draft state, so the wizard renders
 * only legal choices instead of offering something the server would reject
 * (Section 6.4: prevent incompatible selections rather than accepting them).
 */
export function buildDraftOptions(choices: CharacterChoices): DraftOptions {
  const classRecord = findClass(choices.classId);
  const speciesRecord = findSpecies(choices.speciesId);
  const backgroundRecord = findBackground(choices.backgroundId);
  const activeOriginFeat = resolveActiveOriginFeat(choices, backgroundRecord, speciesRecord);

  const magicInitiateDetail = (
    featLabel: string | null,
  ): DraftOptions['backgroundFeatDetail'] => {
    const listId = magicInitiateSpellListId(featLabel);
    if (listId === null || featLabel === null) {
      return null;
    }
    return {
      label: featLabel,
      cantripsKnown: MAGIC_INITIATE_CANTRIPS_KNOWN,
      spellsKnown: MAGIC_INITIATE_SPELLS_KNOWN,
      cantripOptions: spellsForList(listId, 0).map((spell) => ({ id: spell.id, label: spell.label })),
      spellOptions: spellsForList(listId, 1).map((spell) => ({ id: spell.id, label: spell.label })),
    };
  };

  return {
    catalog: buildCatalog(),
    quickStartTemplates: QUICK_START_TEMPLATES.map((template) => ({
      id: template.id,
      label: template.label,
      summary: template.summary,
    })),
    classDetail:
      classRecord === null
        ? null
        : {
            label: classRecord.label,
            hitDie: classRecord.hitDie,
            savingThrowProficiencies: classRecord.savingThrowProficiencies,
            skillChoiceCount: classRecord.skillChoiceCount,
            skillOptions: (classRecord.skillChoiceIds.length === 0
              ? SKILLS.map((skill) => skill.id)
              : classRecord.skillChoiceIds
            )
              .filter((id) => !(backgroundRecord?.skillIds ?? []).includes(id))
              .map((id) => findSkill(id))
              .filter((skill): skill is NonNullable<typeof skill> => skill !== null)
              .map((skill) => ({ id: skill.id, label: skill.label })),
            choices: classRecord.choices.map((choice) => ({
              id: choice.id,
              label: choice.label,
              helper: choice.helper,
              choose: choice.choose,
              from: choice.from.map((option) => ({
                id: option.id,
                label: option.label,
                summary: option.summary,
              })),
            })),
            equipmentOptions: classRecord.equipmentOptions.map((option) => ({
              id: option.id,
              label: option.label,
              gold: option.gold,
            })),
            features: classRecord.features.map((feature) => ({ name: feature.name, summary: feature.summary })),
            spellcasting:
              classRecord.spellcasting === null
                ? null
                : {
                    abilityLabel: ABILITY_LABELS[classRecord.spellcasting.ability],
                    cantripsKnown: classRecord.spellcasting.cantripsKnown,
                    spellsAvailable: classRecord.spellcasting.spellsAvailable,
                    spellbookSize: classRecord.spellcasting.spellbookSize ?? null,
                    preparationStyle: classRecord.spellcasting.preparationStyle,
                    cantripOptions: spellsForList(classRecord.spellcasting.spellListId, 0).map((spell) => ({
                      id: spell.id,
                      label: spell.label,
                    })),
                    spellOptions: spellsForList(classRecord.spellcasting.spellListId, 1).map((spell) => ({
                      id: spell.id,
                      label: spell.label,
                    })),
                  },
          },
    speciesDetail:
      speciesRecord === null
        ? null
        : {
            label: speciesRecord.label,
            speed: speciesRecord.speed,
            size: speciesRecord.size,
            senses: speciesRecord.senses,
            features: speciesRecord.features
              .filter((feature) => (feature.minLevel ?? 1) <= STARTING_LEVEL)
              .map((feature) => ({ name: feature.name, summary: feature.summary })),
            choices: speciesRecord.choices.map((choice) => {
              const alreadyProficient = new Set<string>([
                ...(backgroundRecord?.skillIds ?? []),
                ...choices.classSkillIds,
              ]);
              return {
                id: choice.id,
                label: choice.label,
                helper: choice.helper,
                choose: choice.choose,
                from: choice.from
                  .filter(
                    (option) =>
                      choice.grantsSkillProficiency !== true || !alreadyProficient.has(option.id),
                  )
                  .map((option) => ({
                    id: option.id,
                    label: option.label,
                    summary: option.summary,
                  })),
              };
            }),
          },
    backgroundDetail:
      backgroundRecord === null
        ? null
        : {
            label: backgroundRecord.label,
            abilityOptions: backgroundRecord.abilityOptions,
            originFeat: backgroundRecord.originFeat,
            skillIds: backgroundRecord.skillIds,
            skillLabels: backgroundRecord.skillIds
              .map((id) => findSkill(id)?.label ?? id)
              .filter((label) => label.length > 0),
            toolProficiency: backgroundRecord.toolProficiency,
            equipmentOptions: backgroundRecord.equipmentOptions.map((option) => ({
              id: option.id,
              label: option.label,
              gold: option.gold,
            })),
          },
    originFeatOptions:
      speciesRecord?.id === 'human'
        ? ORIGIN_FEAT_OPTIONS.map((option) => ({
            id: option.id,
            label: option.label,
            summary: option.summary,
          }))
        : null,
    backgroundFeatDetail: magicInitiateDetail(backgroundRecord?.originFeat ?? null),
    originFeatDetail: magicInitiateDetail(activeOriginFeat),
    weaponMastery:
      classRecord === null || !classRecord.features.some((feature) => feature.name === 'Weapon Mastery')
        ? null
        : {
            slotCount: classRecord.id === 'fighter' ? 3 : 2,
            options: Object.entries(WEAPON_MASTERY_BY_NAME).map(([weaponName, property]) => ({
              id: weaponName,
              label: `${weaponName} (${property})`,
            })),
          },
  };
}

/** Labels for a committed character, resolved from the manifest. */
export function describeChoices(choices: CharacterChoices): {
  classLabel: string;
  speciesLabel: string;
  backgroundLabel: string;
} {
  return {
    classLabel: findClass(choices.classId)?.label ?? 'Unchosen',
    speciesLabel: findSpecies(choices.speciesId)?.label ?? 'Unchosen',
    backgroundLabel: findBackground(choices.backgroundId)?.label ?? 'Unchosen',
  };
}

export { RULES_VERSION };
