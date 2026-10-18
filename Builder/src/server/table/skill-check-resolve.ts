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
  const wantsStealth = /\b(?:hide|conceal|take\s+cover|stealth|crouch\s+behind|duck\s+behind)\b/i.test(text);
  const wantsSearch = /\bsearch(?:es|ing)?\b/i.test(text);
  const wantsTrap = /(trap|disarm)/.test(text);
  // "pick up" is inventory — never force a lock draft (VDM-005).
  const wantsLock =
    !/\bpick(?:ing|ed)?\s+up\b/i.test(text) &&
    (textRequestsLockPicking(text) ||
      (/\block\b/.test(text) && !/\bunlocked\b/.test(text)));
  // Broad room surveys are Director perception — never "Which feature…".
  const broadSurvey =
    /\b(?:survey|look\s+around|peer\s+around|look\s+and\s+listen)\b/i.test(text) ||
    (/\b(?:examin(?:e|es|ing)|search(?:es|ing)?|investigat(?:e|es|ing)|inspect(?:s|ing)?)\b/i.test(
      text,
    ) &&
      /\b(?:chamber|room|scene|surroundings|area|here)\b/i.test(text) &&
      !/\b(?:door|doorway|gate|lock|lamp|bench|workbench|crate|counter|trap|mark)\b/i.test(text) &&
      !wantsTrap &&
      !wantsLock &&
      !wantsStealth);
  if (broadSurvey) {
    return 'You look and listen across the scene — the Game Director narrates what is perceptible. Name a single feature only if you want a focused Investigation roll.';
  }
  const ambiguousTarget =
    /\b(most suspicious|anything unusual|something suspicious|visible feature|the area|this area|the room|the chamber)\b/i.test(
      text,
    ) && !/\b(door|doorway|gate|lock|lamp|bench|workbench|crate|counter|trap|mark)\b/i.test(text);
  const candidates = options.candidateLabels ?? [];
  // Only force a feature pick when the player asked for a focused roll without a target.
  if (
    (wantsTrap || wantsLock) &&
    (ambiguousTarget || (candidates.length > 1 && !/\b(door|doorway|gate|lock)\b/i.test(text)))
  ) {
    const list =
      candidates.length > 0
        ? candidates.slice(0, 6).join('; ')
        : 'name the doorway, prop, or square you mean';
    return `Which feature are you examining? Choose one before the table prepares a roll: ${list}.`;
  }

  const namedTarget = (() => {
    const eastWest = text.match(
      /\b(?:the\s+)?(?:wooden\s+)?door(?:way)?(?:\s+(?:to\s+the\s+)?(east|west|north|south))?\b/i,
    );
    if (eastWest !== null) {
      const facing = eastWest[1]?.toLowerCase();
      return facing !== undefined ? `wooden doorway ${facing}` : 'wooden doorway';
    }
    const sanitized = text.replace(/[.,;!?]+$/, '');
    const hideBehind = sanitized.match(
      /\b(?:behind|near|under|by|in)\s+(?:the\s+)?([a-zA-Z0-9_\s'-]+?)(?:\s+(?:and|to|while|for)\b|[.,;!?]|$)/i,
    );
    if (hideBehind !== null && hideBehind[1]?.trim()) {
      const candidate = hideBehind[1].trim();
      if (!/^(?:me|myself|it|them|here|shadows)$/i.test(candidate)) {
        return candidate;
      }
    }
    const actionTarget = sanitized.match(
      /\b(?:investigat(?:e|es|ing)?|search(?:es|ing)?|inspect(?:s|ing)?|examin(?:e|es|ing)?)\s+(?:the\s+)?([a-zA-Z0-9_\s'-]+?)(?:\s+(?:for|using|with|to|and)\b|[.,;!?]|$)/i,
    );
    if (actionTarget !== null && actionTarget[1]?.trim()) {
      const candidate = actionTarget[1].trim();
      if (!/^(?:area|room|chamber|here|surroundings)$/i.test(candidate)) {
        return candidate;
      }
    }
    return 'named target';
  })();

  if (sheet === null) {
    if (wantsStealth) {
      return 'Ready to hide. Confirm to roll the Stealth check on the table.';
    }
    return wantsTrap
      ? 'Ready to search the doorway for traps, then attempt the lock if it looks safe. Confirm to roll the checks on the table.'
      : 'Ready to attempt the lock or inspection. Confirm to roll the check on the table.';
  }

  if (wantsStealth) {
    const stealth = skillBonus(sheet, 'stealth');
    return `Ready to hide behind the ${namedTarget} (Stealth ${stealth.proficient ? 'proficient' : 'not proficient'}, ${formatBonus(stealth.bonus)}; DC 12). Confirm to roll the check on the table.`;
  }

  const investigation = skillBonus(sheet, 'investigation');
  const sleight = skillBonus(sheet, 'sleight-of-hand');
  const tools = hasThievesTools(sheet);
  const toolNote = tools
    ? 'Thieves’ Tools are on your sheet.'
    : 'Your sheet does not list Thieves’ Tools — the lock attempt uses Sleight of Hand without tool proficiency.';

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
  if (wantsSearch) {
    return [
      `Ready to search the ${namedTarget} (Investigation ${investigation.proficient ? 'proficient' : 'not proficient'}, ${formatBonus(investigation.bonus)}; DC ${DEFAULT_TRAP_DC}).`,
      'Confirm to roll the check on the table. Narration will stay on that target only.',
    ].join(' ');
  }
  if (wantsTrap) {
    return [
      `Ready to search the ${namedTarget} for traps (Investigation ${investigation.proficient ? 'proficient' : 'not proficient'}, ${formatBonus(investigation.bonus)}; DC ${DEFAULT_TRAP_DC}).`,
      'Confirm to roll the check on the table. Narration will stay on that target only.',
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

/** Pull the named inspect target from a Ready-to draft summary (FQA-003). */
export function namedInspectTargetFromDraft(draftSummary: string): string {
  const hide = /Ready to hide behind (?:the\s+)?(.+?)\s*\(/i.exec(draftSummary);
  if (hide?.[1]?.trim()) {
    return hide[1].trim().replace(/\s+/g, ' ');
  }
  const inspect =
    /Ready to (?:inspect|search)\s+(?:the\s+)?(.+?)(?:\s+for traps)?\s*\(/i.exec(draftSummary) ??
    /Ready to (?:inspect|search)\s+(?:the\s+)?(.+?)(?:\s+for traps)?(?:\.|,|$)/i.exec(draftSummary);
  const raw = inspect?.[1]?.trim();
  if (raw !== undefined && raw.length > 0 && !/^named target$/i.test(raw)) {
    return raw.replace(/\s+/g, ' ');
  }
  const door = draftSummary.match(
    /\b(?:the\s+)?(?:wooden\s+)?door(?:way)?(?:\s+(?:to\s+the\s+)?(east|west|north|south))?\b/i,
  );
  if (door !== null) {
    const facing = door[1]?.toLowerCase();
    return facing !== undefined ? `wooden doorway ${facing}` : 'wooden doorway';
  }
  return 'confirmed target';
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
  const wantsStealth = /ready to hide|stealth/.test(text);
  const wantsTrap = /trap|search|inspect|investigat/.test(text);
  const wantsLock = /lock|sleight|thieves/.test(text);
  if (!wantsStealth && !wantsTrap && !wantsLock) {
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

  const namedTarget = namedInspectTargetFromDraft(draftSummary);
  const parts: string[] = [];
  const rolls: number[] = [];
  let lockYielded = false;

  if (wantsStealth) {
    const skill = skillBonus(sheet, 'stealth');
    const roll = rollD20('normal', skill.bonus);
    rolls.push(roll.natural);
    const success = roll.total >= 12;
    parts.push(
      `Stealth check to hide behind the ${namedTarget} (Stealth ${formatBonus(skill.bonus)}): d20 ${roll.natural} ${formatBonus(skill.bonus)} = ${roll.total} vs DC 12 — ${
        success
          ? `you are hidden in the shadows behind the ${namedTarget}`
          : `cover behind the ${namedTarget} is insufficient to stay fully hidden`
      }.`,
    );
  }

  if (wantsTrap) {
    const skill = skillBonus(sheet, 'investigation');
    const roll = rollD20('normal', skill.bonus);
    rolls.push(roll.natural);
    const success = roll.total >= DEFAULT_TRAP_DC;
    const isTrapSpecific =
      /for traps|trap search/i.test(draftSummary) ||
      /\b(?:door|doorway|gate)\b/i.test(namedTarget);
    if (isTrapSpecific) {
      parts.push(
        `Trap search on the ${namedTarget} (Investigation ${formatBonus(skill.bonus)}): d20 ${roll.natural} ${formatBonus(skill.bonus)} = ${roll.total} vs DC ${DEFAULT_TRAP_DC} — ${
          success
            ? `no trap found on the ${namedTarget}`
            : `you cannot tell if the ${namedTarget} is trapped`
        }.`,
      );
    } else {
      const verb = /ready to search/i.test(draftSummary) ? 'Search' : 'Investigation';
      parts.push(
        `${verb} on the ${namedTarget} (Investigation ${formatBonus(skill.bonus)}): d20 ${roll.natural} ${formatBonus(skill.bonus)} = ${roll.total} vs DC ${DEFAULT_TRAP_DC} — ${
          success
            ? `you examine the ${namedTarget} thoroughly and note fine details and markings`
            : `you find no hidden mechanisms or unusual marks on the ${namedTarget}`
        }.`,
      );
    }
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
