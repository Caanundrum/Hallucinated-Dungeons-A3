/**
 * Strict parsing of a client-supplied choices payload.
 *
 * Blueprint ownership: Section 1.12.5 (an API without input validation is an
 * incomplete API) and Section 7.7 (client-supplied identifiers are lookup
 * requests, never assertions).
 *
 * Nothing here decides legality — that is the rules engine's job. This layer
 * only guarantees the object is structurally what it claims to be, so an
 * malformed or hostile payload is rejected at the boundary instead of being
 * stored and re-read later as if it were valid.
 */

import {
  ABILITIES,
  ABILITY_METHODS,
  type Ability,
  type AbilityMethod,
  type CharacterChoices,
} from '../../shared/character-contract.js';

const MAX_SELECTION_LIST = 24;
const MAX_STRING = 400;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asOptionalId(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  return value.length <= 120 ? value : undefined;
}

function asIdList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_SELECTION_LIST) {
    return undefined;
  }
  const list: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length > 120) {
      return undefined;
    }
    list.push(entry);
  }
  return list;
}

function asText(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_STRING) {
    return undefined;
  }
  return value;
}

function asScoreMap(value: unknown): Partial<Record<Ability, number>> | undefined {
  const record = asRecord(value);
  if (record === null) {
    return undefined;
  }
  const scores: Partial<Record<Ability, number>> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (!(ABILITIES as readonly string[]).includes(key)) {
      return undefined;
    }
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 30) {
      return undefined;
    }
    scores[key as Ability] = raw;
  }
  return scores;
}

function asChoiceMap(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  if (record === null) {
    return undefined;
  }
  const map: Record<string, string> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (key.length > 120 || typeof raw !== 'string' || raw.length > 120) {
      return undefined;
    }
    map[key] = raw;
  }
  return map;
}

function asChoiceListMap(value: unknown): Record<string, readonly string[]> | undefined {
  const record = asRecord(value);
  if (record === null) {
    return undefined;
  }
  const map: Record<string, readonly string[]> = {};
  for (const [key, raw] of Object.entries(record)) {
    const list = asIdList(raw);
    if (key.length > 120 || list === undefined) {
      return undefined;
    }
    map[key] = list;
  }
  return map;
}

/**
 * Parses an untrusted payload into a well-formed choices object, or returns
 * null when the shape is wrong. A structurally valid but rules-illegal set of
 * choices parses successfully and is reported by the rules engine instead, so
 * the player sees a rules explanation rather than a generic rejection.
 */
export function parseChoices(payload: unknown): CharacterChoices | null {
  const record = asRecord(payload);
  if (record === null) {
    return null;
  }

  const classId = asOptionalId(record.classId);
  const backgroundId = asOptionalId(record.backgroundId);
  const speciesId = asOptionalId(record.speciesId);
  const classEquipmentOptionId = asOptionalId(record.classEquipmentOptionId);
  const backgroundEquipmentOptionId = asOptionalId(record.backgroundEquipmentOptionId);
  if (
    classId === undefined ||
    backgroundId === undefined ||
    speciesId === undefined ||
    classEquipmentOptionId === undefined ||
    backgroundEquipmentOptionId === undefined
  ) {
    return null;
  }

  const abilityMethod = record.abilityMethod;
  if (typeof abilityMethod !== 'string' || !(ABILITY_METHODS as readonly string[]).includes(abilityMethod)) {
    return null;
  }

  const baseAbilityScores = asScoreMap(record.baseAbilityScores);
  const backgroundAbilityBonuses = asScoreMap(record.backgroundAbilityBonuses);
  const classSkillIds = asIdList(record.classSkillIds);
  const cantripIds = asIdList(record.cantripIds);
  const spellIds = asIdList(record.spellIds);
  const chosenOriginFeatId = asOptionalId(record.chosenOriginFeatId);
  const backgroundFeatCantripIds = asIdList(record.backgroundFeatCantripIds) ?? [];
  const backgroundFeatSpellIds = asIdList(record.backgroundFeatSpellIds) ?? [];
  const originFeatCantripIds = asIdList(record.originFeatCantripIds) ?? [];
  const originFeatSpellIds = asIdList(record.originFeatSpellIds) ?? [];
  const speciesChoiceIds = asChoiceMap(record.speciesChoiceIds);
  const classChoiceIds = asChoiceListMap(record.classChoiceIds);
  if (
    baseAbilityScores === undefined ||
    backgroundAbilityBonuses === undefined ||
    classSkillIds === undefined ||
    cantripIds === undefined ||
    spellIds === undefined ||
    speciesChoiceIds === undefined ||
    classChoiceIds === undefined
  ) {
    return null;
  }

  const identityRecord = asRecord(record.identity);
  if (identityRecord === null) {
    return null;
  }
  const name = asText(identityRecord.name);
  const pronouns = asText(identityRecord.pronouns);
  const appearance = asText(identityRecord.appearance);
  const concept = asText(identityRecord.concept);
  if (name === undefined || pronouns === undefined || appearance === undefined || concept === undefined) {
    return null;
  }

  return {
    classId,
    backgroundId,
    speciesId,
    abilityMethod: abilityMethod as AbilityMethod,
    baseAbilityScores,
    // Roll state is server-authored. Parsing defaults these; updateDraft
    // always restores the stored values so a client cannot forge or rewind.
    rolledScorePool: null,
    abilityRollAttempts: 0,
    backgroundAbilityBonuses,
    classSkillIds,
    speciesChoiceIds,
    classEquipmentOptionId,
    backgroundEquipmentOptionId,
    cantripIds,
    spellIds,
    chosenOriginFeatId: chosenOriginFeatId ?? null,
    backgroundFeatCantripIds,
    backgroundFeatSpellIds,
    originFeatCantripIds,
    originFeatSpellIds,
    classChoiceIds,
    identity: { name, pronouns, appearance, concept },
  };
}
