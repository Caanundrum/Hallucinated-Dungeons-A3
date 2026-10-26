/**
 * Campaign Blueprint engine.
 *
 * Extracts named NPCs, places, props, and exits from free-form premise text
 * with general linguistic heuristics (Title Case proper names, modifier + noun
 * props, modifier + door/passage exits) and derives a three-act outline the
 * Director can steer back toward without scripting the table.
 *
 * Nothing here knows about any particular premise. Authored names such as a
 * tavern, a courier, or a locked red door flow through the same rules as any
 * other premise.
 */

import { GoogleGenAI } from '@google/genai';
import type { Firestore } from 'firebase-admin/firestore';
import type {
  CampaignBlueprint,
  CampaignBlueprintBeat,
  CampaignMilestoneBlueprint,
  CampaignRoomBlueprint,
  CampaignTone,
} from '../../shared/campaign-contract.js';
import { CAMPAIGN_TONE_LABELS, isCampaignTone } from '../../shared/campaign-contract.js';
import {
  APPOSITIVE_PLACE_CLAUSE_RE,
  expandNpcNameVariants,
  INTERPERSONAL_CONTACT_VERB_RE,
  isCompoundPlaceWord,
  LOCATIVE_PREPOSITIONS,
  matchesExcludedCharacterName,
  PERSONAL_ROLE_TITLES,
  STRICT_LOCATIVE_PREPOSITIONS,
} from '../../shared/campaign-facts.js';
import { COLLECTIONS } from '../persistence/firestore.js';
import { XP_THRESHOLDS } from '../rules/engine/xp-progression.js';
import {
  contextualContainerLabelForTemplate,
  contextualPropLabelForTemplate,
} from '../table/scene-composition.js';

export type PremiseLocationKind =
  | 'canal_waterfront'
  | 'inn'
  | 'crypt'
  | 'workshop'
  | 'cottage'
  | 'marsh'
  | 'forest'
  | 'town';

export interface PremiseLocation {
  readonly locationKind: PremiseLocationKind | null;
  readonly locationPhrase: string | null;
}

export interface PremiseEntities {
  readonly npcs: readonly string[];
  readonly places: readonly string[];
  readonly props: readonly string[];
  readonly exits: readonly string[];
}

export function detectPremiseLocation(premise: string): PremiseLocation {
  const text = premise.toLowerCase();
  const innMatch = /\b(inn|tavern|pub|alehouse)\b/.exec(text);
  const waterfrontMatch = /\b(canal|dock|docks|pier|harbor|harbour|ferry|waterfront|wharf|quay)\b/.exec(
    text,
  );
  const hasExplicitInnScene =
    /\b[A-Z][A-Za-z'’-]+\s+(?:Inn|Tavern|Pub|Alehouse)\b/.test(premise) ||
    /\b(?:inside|entering|at|in)\s+the\s+(?:[a-z'’-]+\s+)?(?:inn|tavern|pub|alehouse)\b/i.test(
      premise,
    );
  if (hasExplicitInnScene || (innMatch !== null && waterfrontMatch === null)) {
    return {
      locationKind: 'inn',
      locationPhrase: waterfrontMatch !== null ? 'a harbor tavern' : 'a roadside inn',
    };
  }
  if (waterfrontMatch !== null) {
    return {
      locationKind: 'canal_waterfront',
      locationPhrase: /\bcanal\b/.test(text) ? 'a canal-town waterfront' : 'a dockside waterfront',
    };
  }
  if (innMatch !== null) {
    return { locationKind: 'inn', locationPhrase: 'a roadside inn' };
  }
  if (/\b(crypt|tomb|catacomb|grave)\b/.test(text)) {
    return { locationKind: 'crypt', locationPhrase: 'a stone crypt' };
  }
  if (/\b(mill|sawmill|gristmill|windmill)\b/.test(text)) {
    return { locationKind: 'workshop', locationPhrase: 'a riverside mill' };
  }
  if (/\b(workshop|forge|smith|tinker)\b/.test(text)) {
    return { locationKind: 'workshop', locationPhrase: 'a working workshop' };
  }
  if (/\b(cottage|cabin|hut)\b/.test(text)) {
    return { locationKind: 'cottage', locationPhrase: 'a modest cottage' };
  }
  if (/\b(?:marsh|bog|fen|mire)\b|[a-z]{2,}(?:marsh|bog|fen|mire)\b/.test(text)) {
    return { locationKind: 'marsh', locationPhrase: 'a marsh settlement' };
  }
  if (/\b(forest|woods|grove|crossroads|clearing)\b/.test(text)) {
    return { locationKind: 'forest', locationPhrase: 'a forest crossroads' };
  }
  if (/\b(town|village|city|settlement)\b/.test(text)) {
    return { locationKind: 'town', locationPhrase: 'a busy town' };
  }
  return { locationKind: null, locationPhrase: null };
}

export function detectQuestHook(
  premise: string,
  propOrProps?: string | readonly string[] | null,
): string | null {
  const text = premise.toLowerCase();
  const props =
    typeof propOrProps === 'string'
      ? [propOrProps.trim()].filter(Boolean)
      : Array.isArray(propOrProps)
        ? propOrProps.map((p) => p.trim()).filter(Boolean)
        : [];
  const propPhrase =
    props.length >= 2
      ? `${props[0]} and ${props[1]}`
      : props.length === 1
        ? props[0]!
        : null;
  if (
    /\b(courier|package|missive|parcel|delivery|informant|cypher|cipher|missing\s+(?:packet|letter|courier))\b/.test(
      text,
    )
  ) {
    if (propPhrase !== null) {
      return `a missing courier and the ${propPhrase} they carried`;
    }
    return 'a missing courier and the package they carried';
  }
  if (/\b(kidnap|abduct|ransom)\b/.test(text)) {
    return 'a disappearance that needs answering';
  }
  if (/\b(murder|assassin|poison)\b/.test(text)) {
    return 'a violent death that cannot stay quiet';
  }
  const investigateMatch =
    /\b(?:investigate|uncover|discover|solve|stop|prevent|find\s+out|learn|trace)\s+((?:why|how|what|who|where|the\s+[a-z][a-z'’-]+)\s+[^.!?;,\n]{6,80})/i.exec(
      premise,
    );
  if (investigateMatch?.[1]) {
    return investigateMatch[1].trim().replace(/\s+/g, ' ');
  }
  return null;
}

const LEADING_STOPWORDS = new Set([
  'the', 'a', 'an', 'at', 'in', 'on', 'to', 'of', 'for', 'with', 'from', 'by', 'and', 'but',
  'or', 'nor', 'so', 'if', 'as', 'while', 'then', 'when', 'where', 'after', 'before', 'there',
  'here', 'near', 'inside', 'outside', 'behind', 'beyond', 'into', 'through', 'across', 'over',
  'under', 'toward', 'towards', 'someone', 'something', 'one', 'they', 'he', 'she', 'it', 'this',
  'that', 'these', 'those', 'you', 'your', 'we', 'our', 'beware', 'meet', 'find', 'seek',
  'rescue', 'follow', 'investigate', 'deliver', 'help', 'stop', 'search', 'visit', 'enter', 'ask',
  'talk', 'speak', 'track', 'hunt', 'protect', 'guard', 'save', 'recover', 'retrieve', 'escape',
  'meanwhile', 'once', 'every', 'each', 'all', 'some', 'many', 'few',
]);

const PLACE_NOUNS = new Set([
  'inn', 'tavern', 'pub', 'alehouse', 'keep', 'tower', 'harbor', 'harbour', 'docks', 'dock',
  'bridge', 'hall', 'market', 'warehouse', 'crypt', 'manor', 'gate', 'wharf', 'mill', 'sawmill',
  'gristmill', 'windmill', 'castle', 'fort', 'fortress', 'forest', 'woods', 'marsh', 'temple',
  'church', 'abbey', 'cathedral', 'library', 'guild', 'house', 'hold', 'ward', 'square', 'quay',
  'pier', 'mines', 'mine', 'cave', 'caves', 'caverns', 'cavern', 'village', 'town', 'city',
  'citadel', 'tomb', 'lair', 'bay', 'river', 'lake', 'hill', 'hills', 'mountain', 'mountains',
  'vale', 'glen', 'fen', 'road', 'street', 'lane', 'alley', 'academy', 'school', 'theater',
  'theatre', 'vault', 'estate', 'farm', 'lodge', 'port', 'shrine', 'garrison', 'barracks',
  'asylum', 'observatory', 'foundry', 'passage', 'passageway', 'sanctum', 'chamber', 'alcove',
  'corridor', 'hallway', 'reach', 'threshold', 'antechamber', 'loft', 'cellar', 'gallery', 'dais',
  'spire', 'sanctuary', 'archive', 'archives', 'bastion', 'outpost', 'laboratory', 'monastery',
  'ruins', 'ruin', 'dungeons', 'dungeon', 'quarry', 'beacon', 'lighthouse', 'chasm', 'grotto',
]);

export const ARCHITECTURAL_ROOM_NOUNS = new Set([
  'passage', 'passageway', 'sanctum', 'chamber', 'alcove', 'corridor', 'hallway', 'reach',
  'threshold', 'antechamber', 'loft', 'cellar', 'gallery', 'dais', 'vault', 'side passage',
  'inner sanctum',
]);

const COMMON_SURNAMES_THAT_ARE_PLACE_NOUNS = new Set([
  'vale', 'hill', 'hills', 'wood', 'woods', 'hall', 'ford', 'stone', 'lake', 'marsh', 'field',
  'brook', 'dale', 'cross', 'moor', 'ridge',
]);

const NPC_TITLES = new Set([
  'captain', 'lord', 'lady', 'sir', 'dame', 'master', 'mistress', 'mother', 'father', 'brother',
  'sister', 'madam', 'madame', 'doctor', 'dr', 'professor', 'king', 'queen', 'prince', 'princess',
  'baron', 'baroness', 'elder', 'warden', 'sergeant', 'priest', 'priestess', 'magister', 'abbot',
  'abbess', 'chief', 'commander', 'inspector', 'constable', 'duke', 'duchess', 'count', 'countess',
  'granny', 'grandmother', 'grandfather', 'uncle', 'aunt', 'wyrm', 'lich', 'tyrant', 'horror',
  'emperor', 'empress', 'warlord', 'archmage', 'overlord', 'miller', 'courier', 'blacksmith',
  'smith', 'innkeeper', 'tavernkeeper', 'barkeep', 'bartender', 'merchant', 'trader', 'scout',
  'rogue', 'guard', 'guardsman', 'hunter', 'herbalist', 'alchemist', 'scholar', 'apprentice',
  'artisan', 'baker', 'butcher', 'brewer', 'fisherman', 'farmer', 'weaver', 'miner', 'clerk',
  'messenger', 'guide', 'detective', 'investigator', 'informant', 'witness', 'contact', 'agent',
  'envoy', 'patron', 'archivist', 'keeper', 'chronicler', 'astronomer', 'astrologer', 'steward',
  'castellan', 'watchman', 'sentinel', 'sage', 'curate', 'preceptor', 'caretaker', 'overseer',
  'bailiff', 'reeve', 'guildmaster', 'quartermaster',
]);

const PLACE_PREPOSITIONS = new Set([
  'at', 'in', 'inside', 'into', 'outside', 'beneath', 'beyond', 'within',
]);

const MODIFIER_LEXICON = new Set([
  'old', 'new', 'ancient', 'rusty', 'rusted', 'silver', 'golden', 'gold', 'iron', 'brass',
  'bronze', 'copper', 'steel', 'stone', 'wooden', 'oak', 'glass', 'bone', 'red', 'blue', 'green',
  'black', 'white', 'grey', 'gray', 'yellow', 'purple', 'crimson', 'scarlet', 'small', 'large',
  'big', 'tiny', 'heavy', 'ornate', 'battered', 'tarnished', 'cracked', 'broken', 'shattered',
  'dusty', 'locked', 'sealed', 'barred', 'hidden', 'secret', 'narrow', 'creaking', 'dim',
  'flickering', 'jeweled', 'leather', 'velvet', 'cursed', 'glowing', 'missing', 'stolen',
  'forgotten', 'ruined', 'abandoned', 'haunted', 'hollow', 'sunken', 'smoking', 'bloodstained',
  'unmarked', 'half-burnt', 'burnt', 'charred', 'riverside', 'waterfront', 'coastal', 'hillside',
  'lakeside', 'dockside', 'mountain', 'forest', 'marsh', 'cavern', 'subterranean', 'underground',
  'upper', 'lower', 'inner', 'outer', 'water', 'wind',
]);

/** Nouns that read as a qualifier on a door or passage ("warehouse door"). */
const EXIT_QUALIFIERS = new Set([
  'warehouse', 'cellar', 'back', 'front', 'side', 'kitchen', 'cargo', 'service', 'garden',
  'guild', 'trap', 'east', 'west', 'north', 'south', 'tower', 'crypt', 'servants', 'freight',
  'loading', 'storm', 'vault', 'cell', 'lantern', 'winding', 'sunken', 'overgrown', 'plank',
  'timber', 'misty',
]);

const PROP_NOUNS = new Set([
  'lantern', 'lamp', 'torch', 'candle', 'candlestick', 'sconce', 'brazier', 'key', 'ledger',
  'satchel', 'chest', 'crate', 'barrel', 'sword', 'dagger', 'blade', 'amulet', 'map', 'letter',
  'ring', 'book', 'tome', 'scroll', 'mirror', 'statue', 'idol', 'altar', 'bell', 'locket',
  'crown', 'cup', 'goblet', 'chalice', 'coin', 'purse', 'pouch', 'box', 'casket', 'trunk', 'sack',
  'bag', 'shield', 'staff', 'wand', 'orb', 'gem', 'jewel', 'mask', 'cloak', 'journal', 'diary',
  'note', 'package', 'parcel', 'sigil', 'banner', 'relic', 'vial', 'bottle', 'flask', 'hourglass',
  'compass', 'skull', 'urn', 'coffin', 'sarcophagus', 'tapestry', 'painting', 'portrait', 'clock',
  'lock', 'chain', 'hammer', 'anvil', 'cauldron', 'pendant', 'brooch', 'medallion', 'cypher',
  'cipher', 'clue', 'evidence', 'token', 'badge', 'codex', 'manifest', 'writ', 'astrolabe',
  'spyglass', 'sextant', 'chronometer', 'prism', 'lens', 'tablet', 'coffer', 'reliquary',
  'lockbox', 'cabinet',
]);

const EXIT_NOUNS = new Set([
  'door', 'doorway', 'gate', 'gateway', 'hatch', 'trapdoor', 'stairs', 'staircase', 'stairway',
  'passage', 'passageway', 'archway', 'portcullis', 'tunnel', 'ladder', 'exit', 'entrance',
  'trail', 'path', 'pathway', 'causeway', 'bridge', 'corridor',
]);

const LIGHT_SOURCE_NOUNS = new Set(['lantern', 'lamp', 'torch', 'candle', 'candlestick', 'sconce', 'brazier']);

const PAST_PARTICIPLE_EXCLUDES = new Set([
  'hundred', 'indeed', 'instead', 'hundreds', 'needed', 'wanted', 'called', 'named', 'asked',
  'hired', 'worried', 'carried', 'arrived', 'expected', 'expecting', 'trusted', 'waited',
  'contested',
]);

function isModifier(word: string, allowExitQualifiers: boolean): boolean {
  if (MODIFIER_LEXICON.has(word)) {
    return true;
  }
  if (allowExitQualifiers && EXIT_QUALIFIERS.has(word)) {
    return true;
  }
  return (
    word.length >= 5 &&
    word.endsWith('ed') &&
    !PAST_PARTICIPLE_EXCLUDES.has(word) &&
    !LEADING_STOPWORDS.has(word)
  );
}

export function isLightSourcePhrase(phrase: string): boolean {
  const last = phrase.trim().toLowerCase().split(/\s+/).pop() ?? '';
  return LIGHT_SOURCE_NOUNS.has(last);
}

export function isDoorLikeExitPhrase(phrase: string): boolean {
  return /\b(door|doorway|gate|gateway|hatch|trapdoor|archway|portcullis|entrance|exit)\b/i.test(
    phrase,
  );
}

function pushUnique(list: string[], label: string): void {
  const lower = label.toLowerCase();
  for (let i = 0; i < list.length; i += 1) {
    const existing = list[i]!.toLowerCase();
    if (existing === lower) {
      return;
    }
    if (existing.includes(lower)) {
      return;
    }
    if (lower.includes(existing)) {
      list[i] = label;
      return;
    }
  }
  list.push(label);
}

function extractProperNames(premise: string): { npcs: string[]; places: string[] } {
  const npcs: string[] = [];
  const places: string[] = [];
  const pattern =
    /\b[A-Z][A-Za-z'’-]*(?:\s+(?:(?:of|de|von|van|du|la|le)\s+)?[A-Z][A-Za-z'’-]*)+/g;
  for (const match of premise.matchAll(pattern)) {
    const start = match.index ?? 0;
    const words = match[0].split(/\s+/);
    let hadThe = false;
    let strippedLocativePrep = '';
    // If a capitalized word at the start of a sentence/clause is followed by an article ("The", "A", "An")
    // and a proper name (e.g. "Remove The Five-Crowned Wyrm"), strip the sentence-opening imperative/verb.
    const articleIdx = words.findIndex((w, idx) => idx > 0 && /^(?:the|a|an)$/i.test(w));
    if (articleIdx > 0 && words.length - articleIdx - 1 >= 2) {
      for (let k = 0; k < articleIdx; k += 1) {
        const wLower = words[k]!.toLowerCase();
        if (LOCATIVE_PREPOSITIONS.has(wLower)) {
          strippedLocativePrep = wLower;
        }
      }
      hadThe = words[articleIdx]!.toLowerCase() === 'the';
      words.splice(0, articleIdx + 1);
    }
    while (words.length > 0 && LEADING_STOPWORDS.has(words[0]!.toLowerCase())) {
      const wLower = words[0]!.toLowerCase();
      if (wLower === 'the') {
        hadThe = true;
      }
      if (LOCATIVE_PREPOSITIONS.has(wLower)) {
        strippedLocativePrep = wLower;
      }
      words.shift();
    }
    const capitalised = words.filter((word) => /^[A-Z]/.test(word));
    if (capitalised.length === 0) {
      continue;
    }
    const label = words.join(' ');
    const before = premise.slice(0, start).trimEnd();
    const after = premise.slice(start + match[0].length);
    const beforeWord = (before.match(/([A-Za-z]+)$/)?.[1] ?? '').toLowerCase();
    const previousWord = strippedLocativePrep || beforeWord;
    hadThe = hadThe || previousWord === 'the' || beforeWord === 'the';
    const first = words[0]!.toLowerCase();
    const last = words[words.length - 1]!.toLowerCase();
    const hasNpcTitle = words.some((word) => NPC_TITLES.has(word.toLowerCase()));
    const isArchitecturalRoom = words.some((word) =>
      ARCHITECTURAL_ROOM_NOUNS.has(word.toLowerCase()),
    );
    const hasAppositivePlace = APPOSITIVE_PLACE_CLAUSE_RE.test(after);
    const hasCompoundPlace = words.some((word) => isCompoundPlaceWord(word));
    const precededByStrictLocative = STRICT_LOCATIVE_PREPOSITIONS.has(previousWord);

    if (capitalised.length === 1) {
      if (
        !LEADING_STOPWORDS.has(first) &&
        !NPC_TITLES.has(first) &&
        !NPC_TITLES.has(beforeWord) &&
        (hasAppositivePlace || hasCompoundPlace || precededByStrictLocative)
      ) {
        pushUnique(places, label);
      }
      continue;
    }

    if (isArchitecturalRoom || hasAppositivePlace) {
      pushUnique(places, label);
    } else if (hasNpcTitle || NPC_TITLES.has(first) || NPC_TITLES.has(beforeWord)) {
      pushUnique(npcs, label);
    } else if (precededByStrictLocative) {
      pushUnique(places, label);
    } else if (
      COMMON_SURNAMES_THAT_ARE_PLACE_NOUNS.has(last) &&
      !hadThe &&
      !PLACE_PREPOSITIONS.has(previousWord) &&
      !LOCATIVE_PREPOSITIONS.has(previousWord)
    ) {
      pushUnique(npcs, label);
    } else if (PLACE_NOUNS.has(last) || hasCompoundPlace) {
      pushUnique(places, label);
    } else if (hadThe || PLACE_PREPOSITIONS.has(previousWord) || LOCATIVE_PREPOSITIONS.has(previousWord)) {
      pushUnique(places, label);
    } else {
      pushUnique(npcs, label);
    }
  }

  // Extract single-word or multi-word capitalized proper places preceded by a strict locative preposition
  // or followed by an appositive place clause (e.g. "At <Place>, a marsh station" or "in <Place>").
  const locativePlacePattern =
    /\b(?:[Aa]t|[Ii]n|[Ii]nside|[Ii]nto|[Ww]ithin|[Nn]ear|[Bb]eneath|[Uu]nder|[Bb]eyond|[Aa]cross|[Aa]round|[Tt]hrough|[Aa]top|[Bb]eside|[Oo]utside|[Aa]long|[Aa]mid|[Aa]midst)\s+([A-Z][A-Za-z'’-]{2,}(?:\s+[A-Z][A-Za-z'’-]{2,})*)/g;
  for (const match of premise.matchAll(locativePlacePattern)) {
    const rawCandidate = match[1]!.trim();
    const candidateWords = rawCandidate.split(/\s+/);
    while (
      candidateWords.length > 0 &&
      LEADING_STOPWORDS.has(candidateWords[0]!.toLowerCase())
    ) {
      candidateWords.shift();
    }
    if (candidateWords.length === 0) {
      continue;
    }
    const candidate = candidateWords.join(' ');
    const firstLower = candidateWords[0]!.toLowerCase();
    const afterIdx = (match.index ?? 0) + match[0].length;
    const afterSlice = premise.slice(afterIdx);
    if (
      !LEADING_STOPWORDS.has(firstLower) &&
      !NPC_TITLES.has(firstLower) &&
      !PERSONAL_ROLE_TITLES.has(firstLower) &&
      (APPOSITIVE_PLACE_CLAUSE_RE.test(afterSlice) ||
        candidateWords.some((w) => isCompoundPlaceWord(w) || PLACE_NOUNS.has(w.toLowerCase())) ||
        !INTERPERSONAL_CONTACT_VERB_RE.test(afterSlice))
    ) {
      pushUnique(places, candidate);
    }
  }

  // Also extract any standalone capitalized word followed by an appositive place description
  const appositivePlacePattern = /\b([A-Z][A-Za-z'’-]{2,}(?:\s+[A-Z][A-Za-z'’-]{2,})*)(?=\s*,)/g;
  for (const match of premise.matchAll(appositivePlacePattern)) {
    const rawCandidate = match[1]!.trim();
    const candidateWords = rawCandidate.split(/\s+/);
    while (
      candidateWords.length > 0 &&
      LEADING_STOPWORDS.has(candidateWords[0]!.toLowerCase())
    ) {
      candidateWords.shift();
    }
    if (candidateWords.length === 0) {
      continue;
    }
    const candidate = candidateWords.join(' ');
    const firstLower = candidateWords[0]!.toLowerCase();
    const afterIdx = (match.index ?? 0) + match[0].length;
    const afterSlice = premise.slice(afterIdx);
    if (
      !NPC_TITLES.has(firstLower) &&
      !PERSONAL_ROLE_TITLES.has(firstLower) &&
      APPOSITIVE_PLACE_CLAUSE_RE.test(afterSlice)
    ) {
      pushUnique(places, candidate);
    }
  }

  // Also extract any standalone capitalized compound place word (e.g., words ending in -house, -hall, -keep, -fen, -mire)
  const compoundPlaceWordPattern = /\b([A-Z][A-Za-z'’-]{3,})\b/g;
  for (const match of premise.matchAll(compoundPlaceWordPattern)) {
    const word = match[1]!;
    const lower = word.toLowerCase();
    if (
      !LEADING_STOPWORDS.has(lower) &&
      !NPC_TITLES.has(lower) &&
      !PERSONAL_ROLE_TITLES.has(lower) &&
      isCompoundPlaceWord(word)
    ) {
      pushUnique(places, word);
    }
  }

  // Also extract single capitalized names preceded by an NPC role/title (e.g., "miller Orin", "Warden Elira")
  const singleNamePattern = /\b(?:the\s+)?([A-Za-z]+)\s+([A-Z][A-Za-z'’-]+)\b/g;
  for (const match of premise.matchAll(singleNamePattern)) {
    const roleWord = match[1]!.toLowerCase();
    const candidateName = match[2]!;
    if (
      (NPC_TITLES.has(roleWord) || PERSONAL_ROLE_TITLES.has(roleWord)) &&
      !LEADING_STOPWORDS.has(candidateName.toLowerCase()) &&
      !PLACE_NOUNS.has(candidateName.toLowerCase()) &&
      !isCompoundPlaceWord(candidateName)
    ) {
      pushUnique(npcs, candidateName);
    }
  }

  // Also extract names explicitly noted as waiting, present, or commissioning/asking the party
  const waitingNamePattern =
    /\b([A-Z][A-Za-z'’-]{2,})\s+(?:is\s+waiting|waits|greets|meets|asks|asked|hires|hired|warns|warned|summons|summoned|implores|implored|begs|begged|tells|told|urges|urged|sends|commissioned|employs|awaits|approaches|approached|recruits|recruited|tasks|tasked)\b/g;
  for (const match of premise.matchAll(waitingNamePattern)) {
    const candidateName = match[1]!;
    if (
      !LEADING_STOPWORDS.has(candidateName.toLowerCase()) &&
      !PLACE_NOUNS.has(candidateName.toLowerCase()) &&
      !isCompoundPlaceWord(candidateName)
    ) {
      pushUnique(npcs, candidateName);
    }
  }

  // Also extract single-word proper names attached to disappearance/victim predicates
  const missingSingleNamePattern =
    /\b([A-Z][A-Za-z'’-]{2,})\s+(?:has\s+|had\s+|was\s+|is\s+)?(?:vanished|disappeared|went\s+missing|is\s+missing|was\s+kidnapped|was\s+taken|was\s+abducted|has\s+not\s+returned|never\s+returned|was\s+lost|was\s+captured)\b/g;
  for (const match of premise.matchAll(missingSingleNamePattern)) {
    const candidateName = match[1]!;
    if (
      !LEADING_STOPWORDS.has(candidateName.toLowerCase()) &&
      !PLACE_NOUNS.has(candidateName.toLowerCase()) &&
      !isCompoundPlaceWord(candidateName)
    ) {
      pushUnique(npcs, candidateName);
    }
  }

  // Strictly exclude any identified Place (or compound place word without an NPC title) from npcs.
  const placeSet = new Set(places.map((p) => p.toLowerCase()));
  const filteredNpcs = npcs.filter((npc) => {
    const lower = npc.toLowerCase();
    if (placeSet.has(lower)) {
      return false;
    }
    if (places.some((p) => p.toLowerCase().includes(lower) || lower.includes(p.toLowerCase()))) {
      const words = npc.split(/\s+/);
      const hasTitle = words.some(
        (w) => NPC_TITLES.has(w.toLowerCase()) || PERSONAL_ROLE_TITLES.has(w.toLowerCase()),
      );
      if (!hasTitle) {
        return false;
      }
    }
    return true;
  });

  return { npcs: filteredNpcs, places };
}

function extractModifierPhrases(
  premise: string,
  nouns: ReadonlySet<string>,
  allowExitQualifiers: boolean,
): string[] {
  const tokens = premise.match(/[A-Za-z][A-Za-z'’-]*|[.,;:!?()"]/g) ?? [];
  const found: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const noun = tokens[i]!.toLowerCase();
    if (!nouns.has(noun)) {
      continue;
    }
    const nextToken = tokens[i + 1];
    if (
      nouns === PROP_NOUNS &&
      nextToken !== undefined &&
      /^[a-z]/.test(nextToken) &&
      PLACE_NOUNS.has(nextToken.toLowerCase())
    ) {
      continue;
    }
    const parts: string[] = [noun];
    let j = i - 1;
    while (j >= 0 && parts.length < 5) {
      const candidate = tokens[j]!.toLowerCase();
      if (!/^[a-z]/.test(candidate) || !isModifier(candidate, allowExitQualifiers)) {
        break;
      }
      parts.unshift(candidate);
      j -= 1;
    }
    if (parts.length < 2) {
      continue;
    }
    pushUnique(found, parts.join(' '));
  }
  return found;
}

export function extractPremiseEntities(
  premise: string,
  options?: { readonly excludeCharacterNames?: readonly string[] },
): PremiseEntities {
  const { npcs: rawNpcs, places } = extractProperNames(premise);
  const npcs = rawNpcs.filter(
    (name) => !matchesExcludedCharacterName(name, options?.excludeCharacterNames),
  );
  const exits = extractModifierPhrases(premise, EXIT_NOUNS, true);
  const exitsLower = exits.map((e) => e.toLowerCase());

  if (/[A-Z]/.test(premise)) {
    const modifierPlaces = extractModifierPhrases(premise, PLACE_NOUNS, false).map(capitalizeLabel);
    for (const mp of modifierPlaces) {
      const lower = mp.toLowerCase();
      if (
        !ARCHITECTURAL_ROOM_NOUNS.has(lower) &&
        !exitsLower.some((exit) => exit.includes(lower))
      ) {
        pushUnique(places, mp);
      }
    }

    const settlementPattern =
      /\b([A-Z][A-Za-z'’-]+)\s+(?:village|town|city|settlement|mill|sawmill|inn|tavern|keep|crypt|tower|spire|archive|sanctuary|bastion|outpost)\b/g;
    for (const match of premise.matchAll(settlementPattern)) {
      const candidate = match[1]!;
      const lower = candidate.toLowerCase();
      if (
        !LEADING_STOPWORDS.has(lower) &&
        !NPC_TITLES.has(lower) &&
        !ARCHITECTURAL_ROOM_NOUNS.has(lower) &&
        !exitsLower.some((exit) => exit.includes(lower))
      ) {
        pushUnique(places, candidate);
      }
    }
  }

  // Also extract prepositional setting phrases ("at the <adj> <place>", "in the <place>") when no proper place matched yet
  const prepPlacePattern =
    /\b(?:at|in|inside|into|within|beneath|beyond|near|around)\s+the\s+((?:[a-z][a-z'’-]+\s+){0,2}[a-z][a-z'’-]+)\b/gi;
  for (const match of premise.matchAll(prepPlacePattern)) {
    const phrase = match[1]!.trim();
    const words = phrase.toLowerCase().split(/\s+/);
    const last = words[words.length - 1] ?? '';
    if (
      PLACE_NOUNS.has(last) &&
      !ARCHITECTURAL_ROOM_NOUNS.has(last) &&
      !exitsLower.some((exit) => exit.includes(phrase.toLowerCase()))
    ) {
      pushUnique(places, capitalizeLabel(phrase));
    }
  }

  return {
    npcs,
    places,
    props: extractModifierPhrases(premise, PROP_NOUNS, false),
    exits,
  };
}

export function capitalizeLabel(label: string): string {
  const trimmed = label.trim();
  return trimmed.length === 0 ? trimmed : `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function digestPremise(premise: string): string {
  const collapsed = premise.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 240) {
    return collapsed;
  }
  const cut = collapsed.slice(0, 240);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 120 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function actTemplateHints(kind: PremiseLocationKind | null): {
  readonly opening: string | null;
  readonly investigation: string | null;
} {
  switch (kind) {
    case 'canal_waterfront':
      return { opening: 'interior_canal_warehouse', investigation: 'landmark_foggy_docks' };
    case 'inn':
      return { opening: 'interior_inn_common', investigation: 'interior_stone_crypt' };
    case 'crypt':
      return { opening: 'interior_stone_crypt', investigation: null };
    case 'workshop':
      return { opening: 'interior_workshop', investigation: 'exterior_village_street' };
    case 'cottage':
      return { opening: 'interior_cottage', investigation: 'exterior_forest_path' };
    case 'marsh':
      return { opening: 'interior_warehouse', investigation: 'exterior_marsh_trail' };
    case 'forest':
      return { opening: 'exterior_forest_path', investigation: 'landmark_courtyard_ruins' };
    case 'town':
      return { opening: 'interior_warehouse', investigation: 'exterior_village_street' };
    default:
      return { opening: null, investigation: null };
  }
}

const WOTC_PRODUCT_IDENTITY_REPLACEMENTS: readonly [RegExp, string][] = [
  [/\bbeholders?\b/gi, 'Aberrant Eye Tyrant'],
  [/\bmind\s*flayers?\b/gi, 'Psychic Tentacle Horror'],
  [/\billithids?\b/gi, 'Psychic Tentacle Horror'],
  [/\bgithyanki\b/gi, 'Astral Raider'],
  [/\bgithzerai\b/gi, 'Limbo Ascetic'],
  [/\byuan[- ]ti\b/gi, 'Serpentfolk'],
  [/\bcarrion\s+crawlers?\b/gi, 'Chitinous Scavenger'],
  [/\bdisplacer\s+beasts?\b/gi, 'Shadow-Panther'],
  [/\bumber\s+hulks?\b/gi, 'Chitinous Burrower'],
  [/\bslaad(?:i|s)?\b/gi, 'Chaos Toad'],
  [/\bkuo[- ]toa\b/gi, 'Deep-Gilled Zealot'],
  [/\bvecna\b/gi, 'The Whispering Lich'],
  [/\bstrahd\b/gi, 'The Crimson Count'],
  [/\btiamat\b/gi, 'The Five-Crowned Wyrm'],
  [/\bwaterdeep\b/gi, 'Crownport'],
  [/\bbaldur'?s\s+gate\b/gi, 'Ironhaven'],
  [/\bneverwinter\b/gi, 'Frostford'],
  [/\bunderdark\b/gi, 'The Sunless Depths'],
  [/\bfaer[uû]n\b/gi, 'The Shattered Realm'],
  [/\bforgotten\s+realms\b/gi, 'The Old Kingdom'],
  [/\beberron\b/gi, 'The Shardlands'],
  [/\bravenloft\b/gi, 'The Mist Barony'],
];

/** Scrubs WotC Product Identity terms into CC-BY-4.0 SRD 5.2.1-safe equivalents. */
export function sanitizeWotcProductIdentity(text: string): string {
  let result = text;
  for (const [pattern, replacement] of WOTC_PRODUCT_IDENTITY_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export interface ClassifiedNpcRoles {
  readonly missingNpcs: readonly string[];
  readonly presentNpcs: readonly string[];
  readonly antagonistNpcs: readonly string[];
}

export function classifyNpcRoles(
  npcs: readonly string[],
  premise: string,
): ClassifiedNpcRoles {
  const missing: string[] = [];
  const priorityPresent: string[] = [];
  const otherPresent: string[] = [];
  const antagonists: string[] = [];

  for (const name of npcs) {
    const variants = expandNpcNameVariants(name);
    const isDirectlyMissing = variants.some((variant) => {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return (
        new RegExp(
          `\\b${escaped}\\b\\s*(?:,\\s*[^,.;!?]{1,50},\\s*)?(?:has\\s+|had\\s+|was\\s+|is\\s+|have\\s+|went\\s+)?(?:vanished|missing|lost|kidnapped|captive|hostage|disappeared|abducted|taken|captured|seized|fell\\s+silent|failed\\s+to\\s+return|not\\s+returned|never\\s+returned)\\b`,
          'i',
        ).test(premise) ||
        new RegExp(
          `\\b(?:vanished|missing|lost|kidnapped|captive|hostage|disappeared|abducted)\\s+(?:[a-z'-]+\\s+){0,3}${escaped}\\b`,
          'i',
        ).test(premise) ||
        new RegExp(
          `\\b(?:find|rescue|save|locate|recover|search\\s+for|trace|track(?:\\s+down)?)\\s+(?:missing\\s+)?(?:[a-z'-]+\\s+){0,3}${escaped}(?:\\s+alive)?\\b`,
          'i',
        ).test(premise) ||
        new RegExp(
          `\\b(?:what\\s+happened\\s+to|whereabouts\\s+of|fate\\s+of|disappearance\\s+of|vanishing\\s+of)\\s+(?:[a-z'-]+\\s+){0,3}${escaped}\\b`,
          'i',
        ).test(premise)
      );
    });

    const isActiveContact = variants.some((variant) => {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return (
        new RegExp(
          `\\b${escaped}\\b[^.!?;\\n]{0,60}\\b(?:waiting|entrance|greets?|meets?|here|asks?|asked|hires?|hired|begs?|begged|warns?|warned|tells?|told|implores?|implored|summons?|summoned|recruits?|recruited|tasks?|tasked|approaches?|approached|pleads?|pleaded|offers?|offered|commissions?|commissioned|entrusts?|entrusted|presses?|pressed|hands?|handed|gives?|gave|urges?|urged|whispers?|whispered|waits?|awaits?)\\b`,
          'i',
        ).test(premise) ||
        new RegExp(
          `\\b(?:waiting|entrance|greets?|meets?|question|speak\\s+with|talk\\s+to|meet|hired\\s+by|summoned\\s+by|recruited\\s+by|tasked\\s+by)\\s+(?:(?:the|with|to)\\s+)?(?:[a-z'-]+\\s+){0,3}${escaped}\\b`,
          'i',
        ).test(premise) ||
        new RegExp(
          `\\b(?:${[...PERSONAL_ROLE_TITLES].join('|')})\\s+${escaped}\\b`,
          'i',
        ).test(premise)
      );
    });

    const isBossArchetype =
      /\b(?:wyrm|dragon|lich|tyrant|horror|overlord|serpent\s+queen|crimson\s+count|aberrant|archlich|behemoth)\b/i.test(
        name,
      );

    if (isDirectlyMissing) {
      missing.push(name);
    } else if (isBossArchetype) {
      antagonists.push(name);
    } else if (isActiveContact) {
      priorityPresent.push(name);
    } else {
      otherPresent.push(name);
    }
  }

  return {
    missingNpcs: missing,
    presentNpcs: [...priorityPresent, ...otherPresent],
    antagonistNpcs: antagonists,
  };
}

export interface BuildCampaignBlueprintOptions {
  readonly summary: string;
  readonly premise?: string;
  readonly name?: string;
  readonly startLevel?: number;
  readonly targetEndLevel?: number;
  readonly campaignTone?: CampaignTone;
  readonly excludeCharacterNames?: readonly string[];
}

function pickSrdMonsterForLevel(level: number): {
  readonly name: string;
  readonly srdMonsterId: string;
} {
  if (level <= 2) {
    return { name: 'Goblin Scout', srdMonsterId: 'goblin' };
  }
  if (level <= 4) {
    return { name: 'Restless Skeleton', srdMonsterId: 'skeleton' };
  }
  if (level <= 8) {
    return { name: 'Cult Fanatic', srdMonsterId: 'cult-fanatic' };
  }
  return { name: 'Dread Knight', srdMonsterId: 'knight' };
}

const EVOCATIVE_FALLBACK_NPCS = [
  'Warden Elira',
  'Corin the Scout',
  'Bram the Wary',
  'Elora the Herbalist',
  'Duran the Smith',
  'Maeve the Tracker',
  'Soren the Informant',
  'Old Greta',
];

function buildRoomBattlemapPrompt(
  templateId: string,
  placeName: string,
  toneLabel: string,
  roomRole: 'opening' | 'investigation' | 'sanctum',
): string {
  const tone = toneLabel.toLowerCase();
  if (templateId.startsWith('exterior_forest')) {
    return sanitizeWotcProductIdentity(
      `Top-down overhead fantasy battlemap of ${placeName}, outdoor forest clearing with winding dirt trail, ancient mossy trees, fallen logs, and dappled woodland light in a ${tone} setting, outdoor wilderness, no roof, no indoor walls`,
    );
  }
  if (templateId.startsWith('exterior_marsh')) {
    return sanitizeWotcProductIdentity(
      `Top-down overhead fantasy battlemap of ${placeName}, misty marshland trail with weathered wooden boardwalks, reeds, shallow bog water, and mossy stones in a ${tone} setting, outdoor wilderness, no roof`,
    );
  }
  if (templateId.startsWith('exterior_')) {
    return sanitizeWotcProductIdentity(
      `Top-down overhead fantasy battlemap of ${placeName}, open cobblestone frontier approach, timber market stalls, roadside lanterns, and open pathway in a ${tone} setting, outdoor street, no roof`,
    );
  }
  if (templateId.startsWith('landmark_foggy_docks')) {
    return sanitizeWotcProductIdentity(
      `Top-down overhead fantasy battlemap of ${placeName}, weathered wooden waterfront piers, mooring posts, cargo crates, and dark canal water in a ${tone} setting`,
    );
  }
  if (templateId.startsWith('landmark_courtyard_ruins')) {
    return sanitizeWotcProductIdentity(
      `Top-down overhead fantasy battlemap of ${placeName}, weathered stone courtyard ruins, mossy flagstones, broken pillars, and stone colonnades in a ${tone} setting`,
    );
  }
  if (roomRole === 'investigation') {
    return sanitizeWotcProductIdentity(
      `Top-down overhead fantasy battlemap of a shadowed investigation passage beyond ${placeName}, flagstone floor, recessed alcoves and crates in a ${tone} setting`,
    );
  }
  if (roomRole === 'sanctum') {
    return sanitizeWotcProductIdentity(
      `Top-down overhead fantasy battlemap of a dramatic sanctum chamber beneath ${placeName}, ritual braziers, carved pillars, ancient stonework in a ${tone} setting`,
    );
  }
  return sanitizeWotcProductIdentity(
    `Top-down overhead fantasy battlemap of ${placeName} entry chamber in a ${tone} setting, warm lantern light, stone left chamber and timber right chamber divided down the center line`,
  );
}

function buildMilestoneGraph(options: {
  readonly campaignName: string;
  readonly startLevel: number;
  readonly targetEndLevel: number;
  readonly campaignTone: CampaignTone;
  readonly hook: string;
  readonly entities: PremiseEntities;
  readonly setting: string;
  readonly openingTemplate: string;
  readonly investigationTemplate: string;
  readonly premise?: string;
}): readonly CampaignMilestoneBlueprint[] {
  const milestones: CampaignMilestoneBlueprint[] = [];
  const totalMilestones = Math.max(1, options.targetEndLevel - options.startLevel);
  const toneLabel = CAMPAIGN_TONE_LABELS[options.campaignTone];
  const premiseText = typeof options.premise === 'string' ? options.premise : '';
  const { missingNpcs, presentNpcs, antagonistNpcs } = classifyNpcRoles(
    options.entities.npcs,
    premiseText,
  );

  for (let m = 1; m <= totalMilestones; m += 1) {
    const fromLevel = options.startLevel + m - 1;
    const targetLevel = options.startLevel + m;
    const prevXp = XP_THRESHOLDS[fromLevel - 1] ?? 0;
    const requiredXpThreshold = XP_THRESHOLDS[targetLevel - 1] ?? prevXp + 300;
    const xpBudgetForMilestone = Math.max(100, requiredXpThreshold - prevXp);

    const r1Xp = Math.round(xpBudgetForMilestone * 0.25);
    const r2Xp = Math.round(xpBudgetForMilestone * 0.35);
    const r2EncounterXp = Math.round(xpBudgetForMilestone * 0.25);
    const r3Xp = Math.max(50, xpBudgetForMilestone - r1Xp - r2Xp);
    const r3EncounterXp = Math.round(xpBudgetForMilestone * 0.4);

    const nonMissingNonAntagonistNpcs = options.entities.npcs.filter(
      (name) => !missingNpcs.includes(name) && !antagonistNpcs.includes(name),
    );
    const openingNpcFromPremise =
      m === 1
        ? presentNpcs[0] ?? nonMissingNonAntagonistNpcs[0] ?? null
        : presentNpcs[m - 1] ?? nonMissingNonAntagonistNpcs[m - 1] ?? null;
    const fallbackNpc = EVOCATIVE_FALLBACK_NPCS[(m - 1) % EVOCATIVE_FALLBACK_NPCS.length]!;
    const npcName = sanitizeWotcProductIdentity(
      openingNpcFromPremise ?? fallbackNpc,
    );
    const fallbackPlaceBase =
      options.campaignName.trim().length > 0 &&
      !/^(?:campaign|untitled\s+campaign)$/i.test(options.campaignName.trim())
        ? options.campaignName.trim()
        : capitalizeLabel(options.setting.replace(/^(?:a|an)\s+/i, 'The '));
    const placeName = sanitizeWotcProductIdentity(
      options.entities.places[(m - 1) % Math.max(1, options.entities.places.length)] ??
        (m === 1 ? fallbackPlaceBase : `${fallbackPlaceBase} — Lower Reach ${m}`),
    );
    const room1Template = m === 1 ? options.openingTemplate : options.investigationTemplate;
    const isRoom1Outdoor =
      room1Template.startsWith('exterior_') || room1Template.startsWith('landmark_');
    const isRoom2Outdoor =
      options.investigationTemplate.startsWith('exterior_') ||
      options.investigationTemplate.startsWith('landmark_') ||
      isRoom1Outdoor;
    const containerPropRe =
      /\b(?:chest|crate|box|barrel|coffer|trunk|urn|casket|lockbox|reliquary|cabinet)\b/i;
    const itemPropsFromPremise = options.entities.props.filter((p) => !containerPropRe.test(p));
    const containerPropsFromPremise = options.entities.props.filter((p) => containerPropRe.test(p));
    const effectiveItemProps =
      itemPropsFromPremise.length > 0 ? itemPropsFromPremise : options.entities.props;
    const propLabel = sanitizeWotcProductIdentity(
      effectiveItemProps[(m - 1) % Math.max(1, effectiveItemProps.length)] ??
        contextualPropLabelForTemplate(room1Template, m),
    );
    const secondPropLabel = sanitizeWotcProductIdentity(
      effectiveItemProps[m % Math.max(1, effectiveItemProps.length)] ??
        'sealed ledger',
    );
    const room1ContainerLabel =
      m === 1 && containerPropsFromPremise[0] !== undefined
        ? sanitizeWotcProductIdentity(capitalizeLabel(containerPropsFromPremise[0]))
        : contextualContainerLabelForTemplate(room1Template, m);
    const room1ContainerContents = [
      ...new Set([
        ...itemPropsFromPremise.map((p) => sanitizeWotcProductIdentity(capitalizeLabel(p))),
        capitalizeLabel(propLabel),
        'Healing Draught',
      ]),
    ];
    const exitLabel = sanitizeWotcProductIdentity(
      options.entities.exits[(m - 1) % Math.max(1, options.entities.exits.length)] ??
        (isRoom1Outdoor ? 'winding trail ahead' : 'wooden door'),
    );
    const monster = pickSrdMonsterForLevel(fromLevel);
    const bossMonster = pickSrdMonsterForLevel(targetLevel);

    const room1Id = `scene-m${m}-r1`;
    const room2Id = `scene-m${m}-r2`;
    const room3Id = `scene-m${m}-r3`;

    const room2Title = isRoom2Outdoor
      ? m === 1
        ? `${capitalizeLabel(placeName)} — Overgrown Ruin Approach`
        : `${capitalizeLabel(placeName)} — Sunken Causeway ${m}`
      : m === 1
        ? `${capitalizeLabel(placeName)} — Side Passage`
        : m === 2
          ? `${capitalizeLabel(placeName)} — Subterranean Reach`
          : `${capitalizeLabel(placeName)} — Deep Warrens ${m}`;
    const room2Summary = isRoom2Outdoor
      ? sanitizeWotcProductIdentity(
          `Beyond the ${exitLabel.toLowerCase()}, weathered stone ruins and moss-choked masonry mark the outer approach into ${placeName}, where hidden clues and mechanical wards guard the threshold ahead.`,
        )
      : m === 1
        ? sanitizeWotcProductIdentity(
            `A shadowed passage beyond the cellar stairs and connecting doorway, where hidden clues and lurking hazards guard the way deeper into ${placeName}.`,
          )
        : m === 2
          ? sanitizeWotcProductIdentity(
              `A subterranean reach beneath ${placeName}, slick with runoff and littered with old freight, where danger echoes ahead.`,
            )
          : sanitizeWotcProductIdentity(
              `A perilous passage in the lower depths of ${placeName}, guarding the route forward.`,
            );

    const room3Title =
      m === 1
        ? `${capitalizeLabel(placeName)} — Sanctum`
        : m === 2
          ? `${capitalizeLabel(placeName)} — Deep Vault`
          : `${capitalizeLabel(placeName)} — Final Sanctum ${m}`;
    const room3Summary =
      m === 1
        ? sanitizeWotcProductIdentity(
            `The inner sanctum of ${placeName}, where ancient stonework and flickering braziers frame the heart of the danger.`,
          )
        : m === 2
          ? sanitizeWotcProductIdentity(
              `The sealed lower vault of ${placeName}, where the core truth of the mystery is guarded by ancient mechanisms and watchers.`,
            )
          : sanitizeWotcProductIdentity(
              `The heart of the sanctum in ${placeName}, where the climax of milestone ${m} awaits.`,
            );

    const room1ExitLocked = /\b(?:locked|sealed|barred)\b/i.test(exitLabel);
    const keyPropFromPremise = options.entities.props.find((p) => /\bkey\b/i.test(p));
    const room1KeyItem = sanitizeWotcProductIdentity(
      keyPropFromPremise ? capitalizeLabel(keyPropFromPremise) : 'Brass Sanctum Key',
    );
    const room1Exits: CampaignRoomBlueprint['exits'][number][] = [
      {
        edgeLabel: capitalizeLabel(exitLabel),
        targetSceneId: room2Id,
        direction: 'east',
        ...(room1ExitLocked
          ? {
              lockState: 'locked' as const,
              keyItemId: room1KeyItem,
              lockpickDC: 12 + m,
              breakDC: 14 + m,
            }
          : { lockState: 'unlocked' as const }),
      },
    ];
    if (m > 1) {
      room1Exits.push({
        edgeLabel: 'Stairway back to the upper reach',
        targetSceneId: `scene-m${m - 1}-r3`,
        direction: 'west',
        lockState: 'unlocked',
      });
    }

    const room2LeverLabel = isRoom2Outdoor
      ? /marsh|dock|waterfront|canal|harbor/i.test(options.investigationTemplate)
        ? 'Counterweight gate switch'
        : 'Weathered gate lever'
      : 'Rusted wall lever';

    const room2Exits: CampaignRoomBlueprint['exits'][number][] = [
      {
        edgeLabel: isRoom2Outdoor
          ? `Trail back to ${placeName}`
          : `Passage back to ${placeName}`,
        targetSceneId: room1Id,
        direction: isRoom2Outdoor ? 'west' : 'east',
        lockState: 'unlocked',
      },
      {
        edgeLabel: isRoom2Outdoor ? 'Locked sanctum gate' : 'Sanctum archway',
        targetSceneId: room3Id,
        direction: isRoom2Outdoor ? 'east' : 'north',
        lockState: 'locked',
        keyItemId: room2LeverLabel,
      },
    ];

    const room3Exits: CampaignRoomBlueprint['exits'][number][] = [
      {
        edgeLabel: 'Archway back to the outer passage',
        targetSceneId: room2Id,
        direction: 'west',
        lockState: 'unlocked',
      },
    ];
    if (m < totalMilestones) {
      room3Exits.push({
        edgeLabel: 'Descending stone archway to the deeper reaches',
        targetSceneId: `scene-m${m + 1}-r1`,
        direction: 'east',
        lockState: 'unlocked',
      });
    }

    const missingTarget =
      m === 1 && missingNpcs.length > 0 ? sanitizeWotcProductIdentity(missingNpcs[0]!) : null;

    const room3Npcs: CampaignRoomBlueprint['npcs'] =
      missingTarget !== null
        ? [
            {
              name: missingTarget,
              role: 'Missing person awaiting rescue',
              portraitPrompt: sanitizeWotcProductIdentity(
                `${missingTarget}, missing person awaiting rescue in ${placeName}, ${toneLabel.toLowerCase()} fantasy portrait`,
              ),
              heldItems: ['Courier Signet Seal'],
            },
          ]
        : [];

    const room3SummaryFinal =
      missingTarget !== null
        ? sanitizeWotcProductIdentity(
            `${room3Summary} ${missingTarget} is held here, awaiting rescue alongside ${options.hook}.`,
          )
        : room3Summary;

    const room1Archetype = room1Template.startsWith('exterior_')
      ? ('outdoor_clearing' as const)
      : room1Template.startsWith('landmark_')
        ? ('open_chamber' as const)
        : ('divided_rooms' as const);
    const room1Cols = room1Archetype === 'outdoor_clearing' ? 16 : m === 1 ? 12 : 16;
    const room1Rows = room1Archetype === 'outdoor_clearing' ? 12 : m === 1 ? 8 : 12;
    const room2Archetype = options.investigationTemplate.startsWith('exterior_')
      ? ('outdoor_clearing' as const)
      : options.investigationTemplate.startsWith('landmark_')
        ? ('open_chamber' as const)
        : ('corridor' as const);
    const room2Cols = room2Archetype === 'outdoor_clearing' ? 20 : 16;
    const room2Rows = room2Archetype === 'outdoor_clearing' ? 16 : 8;

    const rooms: CampaignRoomBlueprint[] = [
      {
        sceneId: room1Id,
        milestoneIndex: m,
        roomIndex: 1,
        title: m === 1 ? capitalizeLabel(placeName) : `${capitalizeLabel(placeName)} — Threshold`,
        summary: sanitizeWotcProductIdentity(
          m === 1
            ? `${npcName} is waiting at ${placeName} where ${options.hook} begins to surface.`
            : `${npcName} keeps watch over ${placeName} where ${options.hook} begins to surface.`,
        ),
        templateId: room1Template,
        columns: room1Cols,
        rows: room1Rows,
        layoutArchetype: room1Archetype,
        battlemapPrompt: buildRoomBattlemapPrompt(room1Template, placeName, toneLabel, 'opening'),
        exits: room1Exits,
        npcs: [
          {
            name: npcName,
            role: m === 1 ? 'Key contact' : 'Local witness',
            portraitPrompt: sanitizeWotcProductIdentity(
              `${npcName}, ${m === 1 ? 'key contact' : 'local witness'} in ${placeName}, ${toneLabel.toLowerCase()} fantasy portrait`,
            ),
            heldItems: [room1KeyItem],
          },
        ],
        encounters: [],
        props: [propLabel],
        structuredProps: [
          {
            propId: `${room1Id}:east-chest`,
            label: room1ContainerLabel,
            objectKind: 'container',
            objectState: 'closed',
            lockState: 'unlocked',
            contents: room1ContainerContents,
          },
        ],
        xpAwardOnDiscovery: r1Xp,
        isMilestoneClimax: false,
      },
      {
        sceneId: room2Id,
        milestoneIndex: m,
        roomIndex: 2,
        title: room2Title,
        summary: room2Summary,
        templateId: options.investigationTemplate,
        columns: room2Cols,
        rows: room2Rows,
        layoutArchetype: room2Archetype,
        battlemapPrompt: buildRoomBattlemapPrompt(
          options.investigationTemplate,
          placeName,
          toneLabel,
          'investigation',
        ),
        exits: room2Exits,
        npcs: [],
        encounters: [
          {
            name: monster.name,
            srdMonsterId: monster.srdMonsterId,
            count: 2,
            xpAward: r2EncounterXp,
          },
        ],
        props: [secondPropLabel],
        structuredProps: [
          {
            propId: `${room2Id}:chest-1`,
            label: 'Ironbound supply chest',
            objectKind: 'container',
            objectState: 'closed',
            lockState: 'unlocked',
            contents: [capitalizeLabel(secondPropLabel), 'Vault Key'],
          },
          {
            propId: `${room2Id}:lever-1`,
            label: room2LeverLabel,
            objectKind: 'lever',
            objectState: 'closed',
            targetEdgeOrObjectId: `${room2Id}-exit-2`,
          },
        ],
        xpAwardOnDiscovery: r2Xp,
        isMilestoneClimax: false,
      },
      {
        sceneId: room3Id,
        milestoneIndex: m,
        roomIndex: 3,
        title: room3Title,
        summary: room3SummaryFinal,
        templateId: 'interior_stone_crypt',
        columns: 16,
        rows: 16,
        layoutArchetype: 'open_chamber',
        battlemapPrompt: buildRoomBattlemapPrompt(
          'interior_stone_crypt',
          placeName,
          toneLabel,
          'sanctum',
        ),
        exits: room3Exits,
        npcs: room3Npcs,
        encounters: [
          {
            name: bossMonster.name,
            srdMonsterId: bossMonster.srdMonsterId,
            count: 1,
            xpAward: r3EncounterXp,
          },
        ],
        props: ['ancient altar', propLabel],
        structuredProps: [
          {
            propId: `${room3Id}:sanctum-coffer`,
            label: 'Sanctum reliquary coffer',
            objectKind: 'container',
            objectState: 'closed',
            lockState: 'unlocked',
            contents: ['Ancient Sanctum Relic', capitalizeLabel(propLabel)],
          },
        ],
        xpAwardOnDiscovery: r3Xp,
        isMilestoneClimax: true,
      },
    ];

    milestones.push({
      milestoneIndex: m,
      targetLevelAfterCompletion: targetLevel,
      requiredXpThreshold,
      xpBudgetForMilestone,
      title: sanitizeWotcProductIdentity(
        `Milestone ${m}: Level ${fromLevel} → Level ${targetLevel} (${capitalizeLabel(placeName)})`,
      ),
      summary: sanitizeWotcProductIdentity(
        `Earn ${xpBudgetForMilestone} XP across ${placeName} (reaching ${requiredXpThreshold} total XP) to unlock the Level ${targetLevel} milestone.`,
      ),
      climaxObjective: sanitizeWotcProductIdentity(
        missingTarget !== null
          ? `Find ${missingTarget} alive in ${placeName} and recover ${options.hook}.`
          : `Uncover the truth behind ${options.hook} in ${placeName} and overcome the sanctum guardian.`,
      ),
      rooms,
    });
  }

  return milestones;
}

function formatLevelSpan(from: number, to: number): string {
  return to > from ? `Levels ${from}–${to}` : `Level ${to}`;
}

function computeActLevelRanges(
  startLevel: number,
  targetEndLevel: number,
): { readonly r1: string; readonly r2: string; readonly r3: string } {
  const span = Math.max(1, targetEndLevel - startLevel);
  if (span === 1) {
    return {
      r1: `Level ${startLevel}`,
      r2: `Levels ${startLevel}–${targetEndLevel}`,
      r3: `Level ${targetEndLevel}`,
    };
  }
  if (span === 2) {
    return {
      r1: `Level ${startLevel}`,
      r2: `Level ${startLevel + 1}`,
      r3: `Level ${targetEndLevel}`,
    };
  }
  const a1End = Math.min(targetEndLevel, startLevel + Math.floor(span / 3));
  const a2Start = Math.min(targetEndLevel, a1End + 1);
  const a2End = Math.min(
    targetEndLevel,
    Math.max(a2Start, startLevel + Math.floor((span * 2) / 3)),
  );
  const a3Start = Math.min(targetEndLevel, a2End + 1);
  return {
    r1: formatLevelSpan(startLevel, a1End),
    r2: formatLevelSpan(a2Start, a2End),
    r3: formatLevelSpan(a3Start, targetEndLevel),
  };
}

export function buildCampaignBlueprint(
  premiseOrOptions: string | BuildCampaignBlueprintOptions,
  maybeName?: string,
): CampaignBlueprint {
  const rawSummary =
    typeof premiseOrOptions === 'string'
      ? premiseOrOptions
      : [premiseOrOptions.summary, premiseOrOptions.premise].filter(Boolean).join('\n\n');
  const campaignName =
    typeof premiseOrOptions === 'string'
      ? (maybeName ?? 'Campaign')
      : (premiseOrOptions.name ?? 'Campaign');
  const rawStart =
    typeof premiseOrOptions === 'string' ? 1 : (premiseOrOptions.startLevel ?? 1);
  const startLevel = Math.max(1, Math.min(19, Math.floor(Number.isFinite(rawStart) ? rawStart : 1)));
  const rawEnd =
    typeof premiseOrOptions === 'string' ? startLevel + 2 : (premiseOrOptions.targetEndLevel ?? startLevel + 2);
  const targetEndLevel = Math.max(
    startLevel + 1,
    Math.min(20, Math.floor(Number.isFinite(rawEnd) ? rawEnd : startLevel + 2)),
  );
  const campaignTone: CampaignTone =
    typeof premiseOrOptions !== 'string' && isCampaignTone(premiseOrOptions.campaignTone)
      ? premiseOrOptions.campaignTone
      : 'heroic_fantasy';

  const excludeCharacterNames =
    typeof premiseOrOptions !== 'string' ? premiseOrOptions.excludeCharacterNames : undefined;
  const premise = sanitizeWotcProductIdentity(rawSummary);
  const entities = extractPremiseEntities(
    premise,
    excludeCharacterNames !== undefined ? { excludeCharacterNames } : undefined,
  );
  const location = detectPremiseLocation(premise);
  const questHook = detectQuestHook(premise, entities.props);
  const hints = actTemplateHints(location.locationKind);

  const { presentNpcs, missingNpcs, antagonistNpcs } = classifyNpcRoles(entities.npcs, premise);
  const antagonist = antagonistNpcs[0] ?? null;
  const npc = presentNpcs[0] ?? null;
  const cleanTitle =
    campaignName.trim().length > 0 && !/^(?:campaign|untitled\s+campaign)$/i.test(campaignName.trim())
      ? sanitizeWotcProductIdentity(campaignName.trim())
      : null;
  const place = entities.places[0] ?? cleanTitle ?? null;
  const exit = entities.exits[0] ?? null;
  const firstProp = entities.props[0] ?? null;
  const secondProp = entities.props[1] ?? null;
  const setting = place ?? location.locationPhrase ?? 'the frontier';
  const exitPhrase = exit !== null ? `the ${exit}` : 'the outer threshold';
  const hook =
    questHook ??
    (antagonist !== null
      ? `the rising dominion of ${antagonist}`
      : firstProp !== null
        ? secondProp !== null
          ? `the mystery of the ${firstProp} and ${secondProp}`
          : `the mystery of the ${firstProp}`
        : cleanTitle !== null
          ? `the crisis behind ${cleanTitle}`
          : `the gathering crisis`);

  const FALLBACK_OPENING_TEMPLATES = [
    'starter_stone_chamber',
    'interior_inn_common',
    'interior_workshop',
  ] as const;
  let seedAcc = 2166136261;
  const seedKey = `${campaignName}:${premise}`;
  for (let i = 0; i < seedKey.length; i += 1) {
    seedAcc ^= seedKey.charCodeAt(i);
    seedAcc = Math.imul(seedAcc, 16777619) >>> 0;
  }
  const resolvedOpeningTemplate =
    hints.opening ?? FALLBACK_OPENING_TEMPLATES[seedAcc % FALLBACK_OPENING_TEMPLATES.length]!;
  const resolvedInvestigationTemplate =
    hints.investigation ??
    (resolvedOpeningTemplate.startsWith('exterior_')
      ? 'landmark_courtyard_ruins'
      : 'interior_stone_crypt');

  const levelSpan = Math.max(1, targetEndLevel - startLevel);
  const { r1: act1Range, r2: act2Range, r3: act3Range } = computeActLevelRanges(
    startLevel,
    targetEndLevel,
  );

  const scaleTwistClause =
    levelSpan >= 10
      ? ` Across this epic ${startLevel}–${targetEndLevel} arc, what begins as a local flashpoint reveals a realm-spanning network of corrupted sanctuaries, rival warlords, and ancient seals failing one by one.`
      : levelSpan >= 5
        ? ` As the party advances through ${act2Range}, the conflict widens from a local mystery into a regional struggle with entrenched lieutenants and competing factions.`
        : ` A sudden betrayal or hidden accomplice complicates the trail, forcing the party to choose who can be trusted before time runs out.`;

  const act1: CampaignBlueprintBeat = {
    act: 1,
    title: `Act I (${act1Range}) — The Gathering Storm at ${capitalizeLabel(setting)}`,
    currentActGoal: sanitizeWotcProductIdentity(
      `The adventurers converge at ${setting} as the first tremors of ${hook} disrupt the region${
        npc !== null ? `, where ${npc} serves as their initial point of contact` : ''
      }. Early leads and physical evidence (${
        firstProp !== null ? `such as the ${firstProp}` : 'left behind at the scene'
      }) reveal that the surface incident is merely the opening move of a deeper plot. DM Guardrail: Let the party establish their footing, interrogate witnesses, and uncover the trail leading past ${exitPhrase}.`,
    ),
    keyClue:
      firstProp !== null
        ? `The ${firstProp} in the opening room`
        : npc !== null
          ? `What ${npc} knows about ${hook}`
          : `A first physical sign of ${hook}`,
    nextSceneTrigger:
      exit !== null
        ? `The party opens and passes through the ${exit}.`
        : 'The party leaves the opening room through its main exit.',
    templateIdHint: hints.opening,
  };
  const act2: CampaignBlueprintBeat = {
    act: 2,
    title: `Act II (${act2Range}) — Web of Shadows & Shifting Stakes`,
    currentActGoal: sanitizeWotcProductIdentity(
      `Pushing beyond ${exitPhrase}, the party tracks the architects of ${hook} through contested territory and hazardous strongholds.${scaleTwistClause}${
        antagonist !== null
          ? ` Heralds and inner-circle agents of ${antagonist} move to silence witnesses and secure the remaining pieces of their design.`
          : missingNpcs[0] !== undefined
            ? ` Fresh signs show ${missingNpcs[0]} was taken deeper underground for a specific purpose.`
            : ''
      } DM Guardrail: Introduce a mid-campaign twist where an apparent ally or assumption turns out to have hidden strings attached, raising the cost of pressing forward.`,
    ),
    keyClue:
      secondProp !== null
        ? `The ${secondProp} found along the trail`
        : entities.places[1] !== undefined
          ? `A lead pointing to ${entities.places[1]}`
          : `A trace tying ${antagonist ?? npc ?? 'the mastermind'} to ${hook}`,
    nextSceneTrigger: `The party learns who or what is behind ${hook} and commits to confronting it.`,
    templateIdHint: hints.investigation,
  };
  const act3: CampaignBlueprintBeat = {
    act: 3,
    title: `Act III (${act3Range}) — The Crucible & Final Reckoning`,
    currentActGoal: sanitizeWotcProductIdentity(
      `Armed with hard-won allies, relics, and the truth behind ${hook}, the party launches a decisive push into the heart of the sanctum${
        antagonist !== null ? ` to break the power of ${antagonist}` : ''
      }${
        missingNpcs[0] !== undefined ? ` and bring ${missingNpcs[0]} out alive` : ''
      }. The enemy's endgame is already in motion, and the final confrontation forces both a tactical showdown and a defining choice over what becomes of ${setting}. DM Guardrail: Allow the party's earlier faction choices and discoveries to shape the final battlefield.`,
    ),
    keyClue: `The proof that settles ${hook}`,
    nextSceneTrigger: 'The confrontation resolves and the chapter closes with a recap.',
    templateIdHint: null,
  };

  const milestones = buildMilestoneGraph({
    campaignName: sanitizeWotcProductIdentity(campaignName),
    startLevel,
    targetEndLevel,
    campaignTone,
    hook,
    entities,
    setting,
    openingTemplate: resolvedOpeningTemplate,
    investigationTemplate: resolvedInvestigationTemplate,
    premise,
  });

  return {
    premiseDigest: digestPremise(premise),
    startLevel,
    targetEndLevel,
    campaignTone,
    centralTension: sanitizeWotcProductIdentity(
      hook.toLowerCase().includes(setting.toLowerCase())
        ? `Resolve ${hook} (${CAMPAIGN_TONE_LABELS[campaignTone]}).`
        : `Resolve ${hook} across ${setting} (${CAMPAIGN_TONE_LABELS[campaignTone]}).`,
    ),
    milestones,
    namedNpcs: entities.npcs.map(sanitizeWotcProductIdentity),
    namedPlaces: entities.places.map(sanitizeWotcProductIdentity),
    namedProps: entities.props.map(sanitizeWotcProductIdentity),
    namedExits: entities.exits.map(sanitizeWotcProductIdentity),
    questHook,
    acts: [act1, act2, act3],
  };
}

/**
 * Generates an AI-assisted CampaignBlueprint when Gemini / Vertex AI is configured,
 * falling back cleanly to the deterministic `buildCampaignBlueprint`.
 */
export async function draftCampaignBlueprintWithAi(
  options: BuildCampaignBlueprintOptions & {
    readonly env?: Record<string, string | undefined>;
  },
): Promise<CampaignBlueprint> {
  const base = buildCampaignBlueprint(options);
  const env = options.env ?? process.env;
  const apiKey = (env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? '').trim();
  const project = (
    env.HD_FIREBASE_PROJECT_ID ??
    env.GOOGLE_CLOUD_PROJECT ??
    env.GCLOUD_PROJECT ??
    ''
  ).trim();
  const isLocalArena = env.HD_ENVIRONMENT_CLASS === 'local';
  const canUseVertex = env.HD_ENVIRONMENT_CLASS === 'milestone' && project.length > 0;
  if (isLocalArena || (apiKey.length < 20 && !canUseVertex)) {
    return base;
  }

  try {
    const ai =
      apiKey.length >= 20
        ? new GoogleGenAI({ apiKey })
        : new GoogleGenAI({
            vertexai: true,
            project,
            location: (env.GOOGLE_CLOUD_LOCATION ?? 'us-central1').trim() || 'us-central1',
          });
    const model = (env.HD_GEMINI_MODEL ?? 'gemini-2.5-flash').trim() || 'gemini-2.5-flash';
    const prompt = [
      'You are an expert tabletop RPG campaign architect designing an original CC-BY-4.0 SRD 5.2.1 campaign skeleton.',
      'Never use Wizards of the Coast Product Identity (no Beholder, Mind Flayer, Illithid, Underdark, Waterdeep, Baldur\'s Gate, Forgotten Realms, Vecna, Strahd, Tiamat).',
      `Campaign Title: ${sanitizeWotcProductIdentity(options.name ?? 'Campaign')}`,
      `Tone: ${CAMPAIGN_TONE_LABELS[base.campaignTone ?? 'heroic_fantasy']}`,
      `Level Range: Level ${base.startLevel ?? 1} to Level ${base.targetEndLevel ?? 3}`,
      `Premise: ${sanitizeWotcProductIdentity(
        [options.summary, options.premise].filter(Boolean).join('\n\n') || options.summary,
      )}`,
      'Identify who the friendly or neutral contact NPC in the opening scene is ("openingContactNpc" — a proper character name and title only, never an action phrase or the climax monster/boss) versus who the main antagonist or boss threat is ("climaxAntagonist").',
      'Return JSON only with shape: {"centralTension": string, "openingContactNpc": string, "climaxAntagonist": string, "milestoneTitles": string[], "climaxObjectives": string[]}',
    ].join('\n');

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature: 0.4,
        maxOutputTokens: 600,
        responseMimeType: 'application/json',
      },
    });
    const rawText = (response.text ?? '').trim();
    if (rawText.length === 0) {
      return base;
    }
    const parsed = JSON.parse(rawText) as {
      centralTension?: unknown;
      openingContactNpc?: unknown;
      climaxAntagonist?: unknown;
      milestoneTitles?: unknown;
      climaxObjectives?: unknown;
    };
    const centralTension =
      typeof parsed.centralTension === 'string' && parsed.centralTension.trim().length > 0
        ? sanitizeWotcProductIdentity(parsed.centralTension.trim())
        : base.centralTension;
    const rawOpeningContactNpc =
      typeof parsed.openingContactNpc === 'string' && parsed.openingContactNpc.trim().length > 0
        ? sanitizeWotcProductIdentity(parsed.openingContactNpc.trim())
        : null;
    const openingContactNpc =
      rawOpeningContactNpc !== null &&
      !matchesExcludedCharacterName(rawOpeningContactNpc, options.excludeCharacterNames)
        ? rawOpeningContactNpc
        : null;
    const titles = Array.isArray(parsed.milestoneTitles) ? parsed.milestoneTitles : [];
    const objectives = Array.isArray(parsed.climaxObjectives) ? parsed.climaxObjectives : [];
    const milestones = (base.milestones ?? []).map((m, idx) => {
      const updatedRooms =
        idx === 0 && openingContactNpc !== null
          ? m.rooms.map((r, rIdx) => {
              if (rIdx !== 0 || r.npcs.length === 0) {
                return r;
              }
              const oldNpcName = r.npcs[0]?.name;
              const updatedSummary =
                oldNpcName && oldNpcName !== openingContactNpc
                  ? r.summary.replace(oldNpcName, openingContactNpc)
                  : r.summary;
              return {
                ...r,
                summary: updatedSummary,
                npcs: r.npcs.map((npc, nIdx) =>
                  nIdx === 0
                    ? {
                        ...npc,
                        name: openingContactNpc,
                      }
                    : npc,
                ),
              };
            })
          : m.rooms;
      return {
        ...m,
        title:
          typeof titles[idx] === 'string' && titles[idx].trim().length > 0
            ? sanitizeWotcProductIdentity(titles[idx].trim())
            : m.title,
        climaxObjective:
          typeof objectives[idx] === 'string' && objectives[idx].trim().length > 0
            ? sanitizeWotcProductIdentity(objectives[idx].trim())
            : m.climaxObjective,
        rooms: updatedRooms,
      };
    });
    return {
      ...base,
      ...(centralTension !== undefined ? { centralTension } : {}),
      ...(openingContactNpc !== null
        ? { namedNpcs: [openingContactNpc, ...base.namedNpcs.filter((n) => n !== openingContactNpc)] }
        : {}),
      milestones,
    };
  } catch {
    return base;
  }
}

/**
 * Generates 3 distinct Rough Campaign Outlines for the campaign creator to choose from.
 * Each option offers a different opening approach/environment and narrative angle on the premise.
 */
export async function draftCampaignBlueprintOptionsWithAi(
  options: BuildCampaignBlueprintOptions & {
    readonly env?: Record<string, string | undefined>;
  },
): Promise<readonly CampaignBlueprint[]> {
  const primary = await draftCampaignBlueprintWithAi(options);
  const rawPremise = [options.summary, options.premise].filter(Boolean).join(' ');
  const roles = classifyNpcRoles(primary.namedNpcs, rawPremise);
  const antagonist = roles.antagonistNpcs[0] ?? null;
  const baseHook =
    primary.questHook ??
    (antagonist !== null
      ? `the rising dominion of ${antagonist}`
      : primary.namedProps[0] !== undefined
        ? primary.namedProps[1] !== undefined
          ? `the mystery of the ${primary.namedProps[0]} and ${primary.namedProps[1]}`
          : `the mystery of the ${primary.namedProps[0]}`
        : `the crisis unfolding in ${primary.namedPlaces[0] ?? options.name ?? 'the realm'}`);
  const basePlace = primary.namedPlaces[0] ?? options.name ?? 'the frontier';
  const baseNpc = roles.presentNpcs[0] ?? 'Warden Elira';
  const toneLabel = CAMPAIGN_TONE_LABELS[primary.campaignTone ?? 'heroic_fantasy'];
  const startLvl = primary.startLevel ?? 1;
  const endLvl = primary.targetEndLevel ?? 3;
  const { r1, r2, r3 } = computeActLevelRanges(startLvl, endLvl);

  const variant2: CampaignBlueprint = {
    ...primary,
    centralTension: sanitizeWotcProductIdentity(
      `Infiltrate the faction rivalries of ${basePlace} and expose the hidden conspiracy driving ${baseHook} (Levels ${startLvl}–${endLvl}).`,
    ),
    acts: [
      {
        act: 1,
        title: `Act I (${r1}) — Shadows & Informants in ${capitalizeLabel(basePlace)}`,
        currentActGoal: sanitizeWotcProductIdentity(
          `The party arrives along the approach road into ${basePlace}, where ${baseNpc} quietly warns them that local authorities are covering up the truth of ${baseHook}. By following covert leads and testing rival factions' loyalties, the adventurers uncover a hidden smuggling and espionage ring operating right beneath the settlement. DM Guardrail: Reward social cunning, stealth, and investigation as the party pieces together who profits from the chaos.`,
        ),
        keyClue: primary.acts[0]?.keyClue ?? `Covert ledger tying local elites to ${baseHook}`,
        nextSceneTrigger: `The party follows the conspiracy's trail into the ruined inner courtyard of ${basePlace}.`,
        templateIdHint: 'exterior_village_street',
      },
      {
        ...(primary.acts[1] ?? primary.acts[0]!),
        act: 2,
        title: `Act II (${r2}) — Double-Cross in the Fractured Strongholds`,
        currentActGoal: sanitizeWotcProductIdentity(
          `As the investigation reaches the mid-campaign turning point, a trusted patron's faction fractures and an ambush turns the tables on the party. Across ${r2}, the adventurers must disrupt enemy supply lines, turn a rival lieutenant to their side, and breach the inner wardens guarding ${
            antagonist ?? `the architect of ${baseHook}`
          }. DM Guardrail: Keep faction alliances dynamic — let players play enemies against one another or forge unexpected truces.`,
        ),
        templateIdHint: 'landmark_courtyard_ruins',
      },
      {
        ...(primary.acts[2] ?? primary.acts[0]!),
        act: 3,
        title: `Act III (${r3}) — The Shattered Crown at ${capitalizeLabel(basePlace)}`,
        currentActGoal: sanitizeWotcProductIdentity(
          `With the conspiracy unmasked and its outer defenses broken, the party leads a final strike into the sanctum to confront ${
            antagonist ?? `the power behind ${baseHook}`
          } before their ritual or conquest reaches completion. Every faction debt and secret uncovered in earlier acts converges on the final battleground. DM Guardrail: Let the party's accumulated allies and hard choices decide the lasting order of ${basePlace}.`,
        ),
      },
    ],
    milestones: (primary.milestones ?? []).map((m, idx) =>
      idx === 0
        ? {
            ...m,
            rooms: m.rooms.map((r, rIdx) =>
              rIdx === 0
                ? {
                    ...r,
                    templateId: 'exterior_village_street',
                    title: `${capitalizeLabel(basePlace)} — Approach Road`,
                    battlemapPrompt: buildRoomBattlemapPrompt(
                      'exterior_village_street',
                      `${capitalizeLabel(basePlace)} — Approach Road`,
                      toneLabel,
                      'opening',
                    ),
                    exits: r.exits.map((ex, eIdx) =>
                      eIdx === 0 && isDoorLikeExitPhrase(ex.edgeLabel)
                        ? { ...ex, edgeLabel: 'Cobblestone road ahead' }
                        : ex,
                    ),
                  }
                : r,
            ),
          }
        : m,
    ),
  };

  const variant3: CampaignBlueprint = {
    ...primary,
    centralTension: sanitizeWotcProductIdentity(
      `Brave the untamed wilds and ancient ruins bordering ${basePlace} to unearth the forgotten power capable of stopping ${baseHook} (Levels ${startLvl}–${endLvl}).`,
    ),
    acts: [
      {
        act: 1,
        title: `Act I (${r1}) — Whispers at the Wilderness Crossroads`,
        currentActGoal: sanitizeWotcProductIdentity(
          `Drawn together at the forest crossroads outside ${basePlace}, the party meets ${baseNpc} beside the first omens of ${baseHook}. Survival hazards, unnatural scouts, and ancient boundary stones point toward a long-buried ruin waking in the wilds. DM Guardrail: Emphasize frontier exploration, tracking, and environmental discovery as the party charts a path into the borderlands.`,
        ),
        keyClue: primary.acts[0]?.keyClue ?? `Ancient boundary stone bearing the mark of ${baseHook}`,
        nextSceneTrigger: `The party tracks the expedition trail from the forest crossroads toward the sunken ruins.`,
        templateIdHint: 'exterior_forest_path',
      },
      {
        ...(primary.acts[1] ?? primary.acts[0]!),
        act: 2,
        title: `Act II (${r2}) — The Sunken Vaults & Ancient Bargains`,
        currentActGoal: sanitizeWotcProductIdentity(
          `Delving into the forgotten reaches beyond ${basePlace}, the party discovers a twist in the lore: the threat behind ${baseHook} is bound to an ancient pact that was broken generations ago. Across ${r2}, the adventurers must navigate hazardous catacombs, outmaneuver vanguard warbands${
            antagonist !== null ? ` loyal to ${antagonist}` : ''
          }, and claim the keystone relics needed to breach the inner sanctum. DM Guardrail: Offer meaningful exploration choices, ancient puzzles, and high-risk shortcuts.`,
        ),
        templateIdHint: 'landmark_foggy_docks',
      },
      {
        ...(primary.acts[2] ?? primary.acts[0]!),
        act: 3,
        title: `Act III (${r3}) — Dawn Over the Crucible`,
        currentActGoal: sanitizeWotcProductIdentity(
          `In the climactic tier (${r3}), the wilderness and ${basePlace} stand on the brink as ${
            antagonist ?? `the awakened force behind ${baseHook}`
          } gathers its full strength. Wielding the secrets unearthed on their expedition, the party descends into the inner sanctum for a decisive reckoning that will either seal the threat forever or reshape the realm. DM Guardrail: Make the final confrontation feel earned, mythic, and responsive to how the party handled the ancient pact.`,
        ),
      },
    ],
    milestones: (primary.milestones ?? []).map((m, idx) =>
      idx === 0
        ? {
            ...m,
            rooms: m.rooms.map((r, rIdx) =>
              rIdx === 0
                ? {
                    ...r,
                    templateId: 'exterior_forest_path',
                    title: `${capitalizeLabel(basePlace)} — Forest Crossroads`,
                    battlemapPrompt: buildRoomBattlemapPrompt(
                      'exterior_forest_path',
                      `${capitalizeLabel(basePlace)} — Forest Crossroads`,
                      toneLabel,
                      'opening',
                    ),
                    exits: r.exits.map((ex, eIdx) =>
                      eIdx === 0 && isDoorLikeExitPhrase(ex.edgeLabel)
                        ? { ...ex, edgeLabel: 'Winding forest trail ahead' }
                        : ex,
                    ),
                  }
                : r,
            ),
          }
        : m,
    ),
  };

  return [primary, variant2, variant3];
}

/** Act 1 until the party has left a scene, then Act 2, then Act 3. */
export function selectActiveBlueprintBeat(
  blueprint: CampaignBlueprint | null | undefined,
  sceneDepth: number,
): CampaignBlueprintBeat | null {
  if (blueprint === null || blueprint === undefined || blueprint.acts.length === 0) {
    return null;
  }
  const index = Math.max(0, Math.min(blueprint.acts.length - 1, Math.floor(sceneDepth)));
  return blueprint.acts[index] ?? null;
}

export function isCampaignBlueprint(value: unknown): value is CampaignBlueprint {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<CampaignBlueprint>;
  return (
    typeof candidate.premiseDigest === 'string' &&
    Array.isArray(candidate.acts) &&
    candidate.acts.every(
      (beat) =>
        typeof beat === 'object' &&
        beat !== null &&
        typeof (beat as CampaignBlueprintBeat).currentActGoal === 'string' &&
        typeof (beat as CampaignBlueprintBeat).keyClue === 'string' &&
        typeof (beat as CampaignBlueprintBeat).nextSceneTrigger === 'string',
    )
  );
}

export async function loadCampaignBlueprint(
  firestore: Firestore,
  campaignId: string,
): Promise<CampaignBlueprint | null> {
  try {
    const snap = await firestore.collection(COLLECTIONS.campaigns).doc(campaignId).get();
    const candidate = (snap.data() as { campaignBlueprint?: unknown } | undefined)
      ?.campaignBlueprint;
    return isCampaignBlueprint(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

export interface BlueprintPacingContext {
  readonly blueprint?: CampaignBlueprint;
  readonly act?: 1 | 2 | 3;
  readonly currentLevel?: number;
  readonly currentXp?: number;
  readonly activeSceneId?: string | null;
}

/** Prompt block that gives the Director a chapter pointer and internal leveling curve pacing without scripting the table. */
export function formatBlueprintBeatPrompt(
  beatOrBlueprint: CampaignBlueprintBeat | CampaignBlueprint,
  contextOrAct?: 1 | 2 | 3 | BlueprintPacingContext,
): string {
  const isFullBlueprint = 'acts' in beatOrBlueprint;
  const ctx: BlueprintPacingContext =
    typeof contextOrAct === 'number'
      ? { act: contextOrAct }
      : (contextOrAct ?? {});
  const blueprint: CampaignBlueprint | undefined = isFullBlueprint
    ? beatOrBlueprint
    : ctx.blueprint;
  const beat: CampaignBlueprintBeat = isFullBlueprint
    ? (beatOrBlueprint.acts.find((entry) => entry.act === (ctx.act ?? 1)) ??
        beatOrBlueprint.acts[0]!)
    : beatOrBlueprint;

  const lines = [
    `Chapter beat (Act ${beat.act} — ${beat.title}):`,
    `- Current act goal: ${beat.currentActGoal}`,
    `- Key clue: ${beat.keyClue}`,
    `- Next scene trigger: ${beat.nextSceneTrigger}`,
    'Players have full freedom: honor what they declare and the mechanics summary first, and never force this beat.',
    'When it fits naturally, weave the narration back toward the chapter clue or exit by pointing attention at things already present in the visible scene state. Do not state the clue as established fact unless the scene has already shown it.',
  ];

  if (blueprint?.milestones !== undefined && blueprint.milestones.length > 0) {
    const level = Math.max(1, ctx.currentLevel ?? blueprint.startLevel ?? 1);
    const xp = Math.max(0, ctx.currentXp ?? XP_THRESHOLDS[level - 1] ?? 0);
    const activeMilestone =
      blueprint.milestones.find((m) => m.targetLevelAfterCompletion > level) ??
      blueprint.milestones[blueprint.milestones.length - 1]!;
    const activeRoom =
      ctx.activeSceneId
        ? activeMilestone.rooms.find((r) => r.sceneId === ctx.activeSceneId)
        : undefined;
    const pacingDirective =
      xp < activeMilestone.requiredXpThreshold
        ? `If party XP is below ${activeMilestone.requiredXpThreshold}, steer toward exploration, clues, and side-treks before unlocking the Milestone Climax.`
        : `Party has reached ${activeMilestone.requiredXpThreshold} XP and is ready for the Milestone Climax (${activeMilestone.climaxObjective}).`;
    lines.push(
      `LEVELING CURVE PACING (INTERNAL — NEVER CITE IN PROSE): Party is Level ${level} (${xp} / ${activeMilestone.requiredXpThreshold} XP toward Level ${activeMilestone.targetLevelAfterCompletion}). Current Milestone: ${activeMilestone.title} — ${activeMilestone.climaxObjective}.${
        activeRoom !== undefined ? ` Current Room: ${activeRoom.title} (${activeRoom.summary}).` : ''
      } ${pacingDirective}`,
    );
  }

  return lines.join('\n');
}

