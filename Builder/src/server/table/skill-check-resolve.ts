/**
 * Resolve exploration skill attempts committed via table.sync (PQA-152–156).
 */

import type { DerivedCharacterSheet } from '../../shared/character-contract.js';
import { rollD20 } from '../rules/engine/dice.js';

export interface SkillAttemptResolution {
  readonly summary: string;
  readonly rolls: readonly number[];
}

const DEFAULT_TRAP_DC = 13;
const DEFAULT_LOCK_DC = 15;

function skillBonus(sheet: DerivedCharacterSheet, skillId: string): {
  readonly label: string;
  readonly bonus: number;
  readonly proficient: boolean;
} {
  const skill = sheet.skills.find((entry) => entry.id === skillId);
  if (skill !== undefined) {
    return { label: skill.label, bonus: skill.bonus.value, proficient: skill.proficient };
  }
  const ability =
    skillId === 'sleight-of-hand' || skillId === 'stealth'
      ? 'dexterity'
      : skillId === 'investigation' || skillId === 'perception'
        ? skillId === 'perception'
          ? 'wisdom'
          : 'intelligence'
        : 'dexterity';
  return {
    label: skillId,
    bonus: sheet.abilityModifiers[ability],
    proficient: false,
  };
}

function hasThievesTools(sheet: DerivedCharacterSheet): boolean {
  const haystack = [
    ...sheet.equipment.map((item) => item.name),
    ...sheet.proficiencies.map((entry) => entry.label),
  ]
    .join(' ')
    .toLowerCase();
  return /thieves'?(\s*tools)?/.test(haystack);
}

/** Build the confirmable draft summary for trap/lock declarations (PQA-152–154). */
export function buildSkillCheckDraftSummary(
  sheet: DerivedCharacterSheet | null,
  text: string,
): string {
  const wantsTrap = /(trap|disarm)/.test(text);
  const wantsLock = /(pick|unlock|lock|thieves)/.test(text);
  if (sheet === null) {
    return wantsTrap
      ? 'Ready to search the doorway for traps, then attempt the lock if it looks safe. Confirm to roll the checks on the table.'
      : 'Ready to attempt the lock or inspection. Confirm to roll the check on the table.';
  }

  const investigation = skillBonus(sheet, 'investigation');
  const sleight = skillBonus(sheet, 'sleight-of-hand');
  const tools = hasThievesTools(sheet);
  const toolNote = tools
    ? 'Thieves’ Tools are on your sheet.'
    : 'Your sheet does not list Thieves’ Tools — the lock attempt uses Sleight of Hand without tool proficiency.';

  if (wantsTrap && wantsLock) {
    return [
      `Ready to search for traps (Investigation ${investigation.proficient ? 'proficient' : 'not proficient'}, ${formatBonus(investigation.bonus)}; DC ${DEFAULT_TRAP_DC})`,
      `then attempt the lock (Sleight of Hand ${sleight.proficient ? 'proficient' : 'not proficient'}, ${formatBonus(sleight.bonus)}; DC ${DEFAULT_LOCK_DC}).`,
      toolNote,
      'Confirm to roll both checks on the table.',
    ].join(' ');
  }
  if (wantsLock) {
    return [
      `Ready to attempt the lock (Sleight of Hand ${sleight.proficient ? 'proficient' : 'not proficient'}, ${formatBonus(sleight.bonus)}; DC ${DEFAULT_LOCK_DC}).`,
      toolNote,
      'Confirm to roll the check on the table.',
    ].join(' ');
  }
  return [
    `Ready to inspect the doorway (Investigation ${investigation.proficient ? 'proficient' : 'not proficient'}, ${formatBonus(investigation.bonus)}; DC ${DEFAULT_TRAP_DC}).`,
    'Confirm to roll the check on the table.',
  ].join(' ');
}

function formatBonus(bonus: number): string {
  return bonus >= 0 ? `+${bonus}` : `${bonus}`;
}

/**
 * Resolve a committed skill-check draft against the seated sheet.
 * Returns null when the summary is not a skill attempt.
 */
export function resolveSkillAttemptFromSummary(
  sheet: DerivedCharacterSheet | null,
  draftSummary: string,
): SkillAttemptResolution | null {
  if (!/^Ready to /i.test(draftSummary.trim())) {
    return null;
  }
  const text = draftSummary.toLowerCase();
  const wantsTrap = /trap|search|inspect|investigat/.test(text);
  const wantsLock = /lock|sleight|thieves/.test(text);
  if (!wantsTrap && !wantsLock) {
    return null;
  }

  if (sheet === null) {
    return {
      summary:
        'Seat a character before resolving skill attempts. The table did not roll.',
      rolls: [],
    };
  }

  const parts: string[] = [];
  const rolls: number[] = [];

  if (wantsTrap) {
    const skill = skillBonus(sheet, 'investigation');
    const roll = rollD20('normal', skill.bonus);
    rolls.push(roll.natural);
    const success = roll.total >= DEFAULT_TRAP_DC;
    parts.push(
      `Trap search (Investigation ${formatBonus(skill.bonus)}): d20 ${roll.natural} ${formatBonus(skill.bonus)} = ${roll.total} vs DC ${DEFAULT_TRAP_DC} — ${
        success ? 'no trap found' : 'you cannot tell if the doorway is trapped'
      }.`,
    );
  }

  if (wantsLock) {
    const skill = skillBonus(sheet, 'sleight-of-hand');
    const tools = hasThievesTools(sheet);
    const roll = rollD20('normal', skill.bonus);
    rolls.push(roll.natural);
    const success = roll.total >= DEFAULT_LOCK_DC;
    parts.push(
      `Lock attempt (Sleight of Hand ${formatBonus(skill.bonus)}${tools ? ', Thieves’ Tools' : ', no Thieves’ Tools'}): d20 ${roll.natural} ${formatBonus(skill.bonus)} = ${roll.total} vs DC ${DEFAULT_LOCK_DC} — ${
        success ? 'the lock yields' : 'the lock holds'
      }.`,
    );
  }

  return { summary: parts.join(' '), rolls };
}
