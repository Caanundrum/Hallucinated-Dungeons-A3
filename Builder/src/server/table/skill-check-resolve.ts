/**
 * Resolve exploration skill attempts committed via table.sync (PQA-152–156).
 */

import type { DerivedCharacterSheet } from '../../shared/character-contract.js';
import { textRequestsLockPicking } from '../../shared/play-authority-contract.js';
import { rollD20 } from '../rules/engine/dice.js';

export interface SkillAttemptResolution {
  readonly summary: string;
  readonly rolls: readonly number[];
  /** True when a lock attempt was rolled and succeeded (A2 → map unlock). */
  readonly lockYielded: boolean;
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
  options: {
    readonly candidateLabels?: readonly string[];
  } = {},
): string {
  const wantsTrap = /(trap|disarm)/.test(text);
  const wantsLock =
    textRequestsLockPicking(text) ||
    (/\block\b/.test(text) && !/\bunlocked\b/.test(text));
  const ambiguousTarget =
    /\b(most suspicious|anything unusual|something suspicious|visible feature|the area|this area|the room|the chamber)\b/i.test(
      text,
    ) && !/\b(door|doorway|gate|lock|lamp|bench|crate|counter|trap)\b/i.test(text);
  const candidates = options.candidateLabels ?? [];
  if (ambiguousTarget || (candidates.length > 1 && !/\b(door|doorway|gate|lock)\b/i.test(text))) {
    const list =
      candidates.length > 0
        ? candidates.slice(0, 6).join('; ')
        : 'name the doorway, prop, or square you mean';
    return `Which feature are you examining? Choose one before the table prepares a roll: ${list}.`;
  }
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

  const namedTarget = (() => {
    const eastWest = text.match(
      /\b(?:the\s+)?(?:wooden\s+)?door(?:way)?(?:\s+(?:to\s+the\s+)?(east|west|north|south))?\b/i,
    );
    if (eastWest !== null) {
      const facing = eastWest[1]?.toLowerCase();
      return facing !== undefined ? `wooden doorway ${facing}` : 'wooden doorway';
    }
    return 'named target';
  })();

  if (wantsTrap && wantsLock) {
    return [
      `Ready to search the ${namedTarget} for traps (Investigation ${investigation.proficient ? 'proficient' : 'not proficient'}, ${formatBonus(investigation.bonus)}; DC ${DEFAULT_TRAP_DC})`,
      `then attempt the lock (Sleight of Hand ${sleight.proficient ? 'proficient' : 'not proficient'}, ${formatBonus(sleight.bonus)}; DC ${DEFAULT_LOCK_DC}).`,
      toolNote,
      'Confirm to roll both checks on the table. Narration will stay on that target only.',
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
    `Ready to inspect the ${namedTarget} (Investigation ${investigation.proficient ? 'proficient' : 'not proficient'}, ${formatBonus(investigation.bonus)}; DC ${DEFAULT_TRAP_DC}).`,
    'Confirm to roll the check on the table. Narration will stay on that target only.',
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
      lockYielded: false,
    };
  }

  const parts: string[] = [];
  const rolls: number[] = [];
  let lockYielded = false;

  if (wantsTrap) {
    const skill = skillBonus(sheet, 'investigation');
    const roll = rollD20('normal', skill.bonus);
    rolls.push(roll.natural);
    const success = roll.total >= DEFAULT_TRAP_DC;
    parts.push(
      `Trap search (Investigation ${formatBonus(skill.bonus)}): d20 ${roll.natural} ${formatBonus(skill.bonus)} = ${roll.total} vs DC ${DEFAULT_TRAP_DC} — ${
        success ? 'no trap found on the confirmed target' : 'you cannot tell if the confirmed target is trapped'
      }.`,
    );
  }

  if (wantsLock) {
    const skill = skillBonus(sheet, 'sleight-of-hand');
    const tools = hasThievesTools(sheet);
    const roll = rollD20('normal', skill.bonus);
    rolls.push(roll.natural);
    const success = roll.total >= DEFAULT_LOCK_DC;
    lockYielded = success;
    parts.push(
      `Lock attempt (Sleight of Hand ${formatBonus(skill.bonus)}${tools ? ', Thieves’ Tools' : ', no Thieves’ Tools'}): d20 ${roll.natural} ${formatBonus(skill.bonus)} = ${roll.total} vs DC ${DEFAULT_LOCK_DC} — ${
        success ? 'the lock yields' : 'the lock holds'
      }.`,
    );
  }

  return { summary: parts.join(' '), rolls, lockYielded };
}
