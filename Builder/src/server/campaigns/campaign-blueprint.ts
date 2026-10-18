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
import type {
  CampaignBlueprint,
  CampaignBlueprintBeat,
  CampaignMilestoneBlueprint,
  CampaignRoomBlueprint,
  CampaignTone,
} from '../../shared/campaign-contract.js';
import { CAMPAIGN_TONE_LABELS, isCampaignTone } from '../../shared/campaign-contract.js';
import { XP_THRESHOLDS } from '../rules/engine/xp-progression.js';

export type PremiseLocationKind =
  | 'canal_waterfront'
  | 'inn'
  | 'crypt'
  | 'workshop'
  | 'cottage'
  | 'marsh'
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
  if (/\b(canal|dock|docks|pier|harbor|harbour|ferry|waterfront|wharf|quay)\b/.test(text)) {
    return {
      locationKind: 'canal_waterfront',
      locationPhrase: /\bcanal\b/.test(text) ? 'a canal-town waterfront' : 'a dockside waterfront',
    };
  }
  if (/\b(inn|tavern|pub|alehouse)\b/.test(text)) {
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
  if (/\b(marsh|bog|fen)\b/.test(text)) {
    return { locationKind: 'marsh', locationPhrase: 'a marsh settlement' };
  }
  if (/\b(town|village|city|settlement)\b/.test(text)) {
    return { locationKind: 'town', locationPhrase: 'a busy town' };
  }
  return { locationKind: null, locationPhrase: null };
}

export function detectQuestHook(premise: string, prop?: string | null): string | null {
  const text = premise.toLowerCase();
  if (
    /\b(courier|package|missive|parcel|delivery|missing\s+(?:packet|letter|courier))\b/.test(text)
  ) {
    if (typeof prop === 'string' && prop.trim().length > 0) {
      return `a missing courier and the ${prop.trim()} they carried`;
    }
    return 'a missing courier and the package they carried';
  }
  if (/\b(kidnap|abduct|ransom)\b/.test(text)) {
    return 'a disappearance that needs answering';
  }
  if (/\b(murder|assassin|poison)\b/.test(text)) {
    return 'a violent death that cannot stay quiet';
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
  'defeat', 'meanwhile', 'once', 'every', 'each', 'all', 'some', 'many', 'few',
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
  'messenger', 'guide', 'detective', 'investigator',
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
  'loading', 'storm', 'vault', 'cell',
]);

const PROP_NOUNS = new Set([
  'lantern', 'lamp', 'torch', 'candle', 'candlestick', 'sconce', 'brazier', 'key', 'ledger',
  'satchel', 'chest', 'crate', 'barrel', 'sword', 'dagger', 'blade', 'amulet', 'map', 'letter',
  'ring', 'book', 'tome', 'scroll', 'mirror', 'statue', 'idol', 'altar', 'bell', 'locket',
  'crown', 'cup', 'goblet', 'chalice', 'coin', 'purse', 'pouch', 'box', 'casket', 'trunk', 'sack',
  'bag', 'shield', 'staff', 'wand', 'orb', 'gem', 'jewel', 'mask', 'cloak', 'journal', 'diary',
  'note', 'package', 'parcel', 'sigil', 'banner', 'relic', 'vial', 'bottle', 'flask', 'hourglass',
  'compass', 'skull', 'urn', 'coffin', 'sarcophagus', 'tapestry', 'painting', 'portrait', 'clock',
  'lock', 'chain', 'hammer', 'anvil', 'cauldron', 'pendant', 'brooch', 'medallion',
]);

const EXIT_NOUNS = new Set([
  'door', 'doorway', 'gate', 'gateway', 'hatch', 'trapdoor', 'stairs', 'staircase', 'stairway',
  'passage', 'passageway', 'archway', 'portcullis', 'tunnel', 'ladder', 'exit', 'entrance',
]);

const LIGHT_SOURCE_NOUNS = new Set(['lantern', 'lamp', 'torch', 'candle', 'candlestick', 'sconce', 'brazier']);

const PAST_PARTICIPLE_EXCLUDES = new Set([
  'hundred', 'indeed', 'instead', 'hundreds', 'needed', 'wanted', 'called', 'named', 'asked',
  'hired', 'worried', 'carried', 'arrived', 'expected', 'expecting', 'trusted', 'waited',
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
    while (words.length > 0 && LEADING_STOPWORDS.has(words[0]!.toLowerCase())) {
      if (words[0]!.toLowerCase() === 'the') {
        hadThe = true;
      }
      words.shift();
    }
    const capitalised = words.filter((word) => /^[A-Z]/.test(word));
    if (capitalised.length < 2) {
      continue;
    }
    const label = words.join(' ');
    const before = premise.slice(0, start).trimEnd();
    const previousWord = (before.match(/([A-Za-z]+)$/)?.[1] ?? '').toLowerCase();
    hadThe = hadThe || previousWord === 'the';
    const first = words[0]!.toLowerCase();
    const last = words[words.length - 1]!.toLowerCase();
    const hasNpcTitle = words.some((word) => NPC_TITLES.has(word.toLowerCase()));
    const isArchitecturalRoom = words.some((word) =>
      ARCHITECTURAL_ROOM_NOUNS.has(word.toLowerCase()),
    );

    if (isArchitecturalRoom) {
      pushUnique(places, label);
    } else if (hasNpcTitle || NPC_TITLES.has(first) || NPC_TITLES.has(previousWord)) {
      pushUnique(npcs, label);
    } else if (
      COMMON_SURNAMES_THAT_ARE_PLACE_NOUNS.has(last) &&
      !hadThe &&
      !PLACE_PREPOSITIONS.has(previousWord)
    ) {
      pushUnique(npcs, label);
    } else if (PLACE_NOUNS.has(last)) {
      pushUnique(places, label);
    } else if (hadThe || PLACE_PREPOSITIONS.has(previousWord)) {
      pushUnique(places, label);
    } else {
      pushUnique(npcs, label);
    }
  }

  // Also extract single capitalized names preceded by an NPC role/title (e.g., "miller Orin", "the miller Orin")
  const singleNamePattern = /\b(?:the\s+)?([a-z]+)\s+([A-Z][A-Za-z'’-]+)\b/g;
  for (const match of premise.matchAll(singleNamePattern)) {
    const roleWord = match[1]!.toLowerCase();
    const candidateName = match[2]!;
    if (
      NPC_TITLES.has(roleWord) &&
      !LEADING_STOPWORDS.has(candidateName.toLowerCase()) &&
      !PLACE_NOUNS.has(candidateName.toLowerCase())
    ) {
      pushUnique(npcs, candidateName);
    }
  }

  // Also extract names explicitly noted as waiting or present
  const waitingNamePattern = /\b([A-Z][A-Za-z'’-]+)\s+(?:is\s+waiting|waits|greets|meets)\b/g;
  for (const match of premise.matchAll(waitingNamePattern)) {
    const candidateName = match[1]!;
    if (
      !LEADING_STOPWORDS.has(candidateName.toLowerCase()) &&
      !PLACE_NOUNS.has(candidateName.toLowerCase())
    ) {
      pushUnique(npcs, candidateName);
    }
  }

  return { npcs, places };
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

export function extractPremiseEntities(premise: string): PremiseEntities {
  const { npcs, places } = extractProperNames(premise);
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
      /\b([A-Z][A-Za-z'’-]+)\s+(?:village|town|city|settlement|mill|sawmill|inn|tavern|keep|crypt)\b/g;
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
      return { opening: 'interior_inn_common', investigation: 'exterior_village_street' };
    case 'crypt':
      return { opening: 'interior_stone_crypt', investigation: null };
    case 'workshop':
      return { opening: 'interior_workshop', investigation: 'exterior_village_street' };
    case 'cottage':
      return { opening: 'interior_cottage', investigation: 'exterior_forest_path' };
    case 'marsh':
      return { opening: 'interior_warehouse', investigation: 'exterior_marsh_trail' };
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
}

export function classifyNpcRoles(
  npcs: readonly string[],
  premise: string,
): ClassifiedNpcRoles {
  const missing: string[] = [];
  const present: string[] = [];

  for (const name of npcs) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isMissing =
      new RegExp(`\\b${escaped}\\b[^.!?,;\\n]*\\b(?:vanished|missing|lost|kidnapped|captive|hostage)\\b`, 'i').test(premise) ||
      new RegExp(`\\b(?:vanished|missing|lost|kidnapped|captive|hostage|rescue|save)\\b[^.!?,;\\n]*\\b${escaped}\\b`, 'i').test(premise) ||
      new RegExp(`\\b(?:find|rescue|save)\\s+(?:missing\\s+)?(?:courier\\s+|the\\s+)?${escaped}\\s+alive\\b`, 'i').test(premise);

    const isPresent =
      new RegExp(`\\b${escaped}\\b[^.!?,;\\n]*\\b(?:waiting|entrance|greets?|meets?|here)\\b`, 'i').test(premise) ||
      new RegExp(`\\b(?:waiting|entrance|greets?|meets?|question|speak\\s+with|talk\\s+to|meet)\\s+(?:(?:the|with|to)\\s+)?(?:[a-z]+\\s+){0,3}${escaped}\\b`, 'i').test(premise);

    if (isMissing) {
      missing.push(name);
    } else if (isPresent) {
      present.push(name);
    } else {
      present.push(name);
    }
  }

  return { missingNpcs: missing, presentNpcs: present };
}

export interface BuildCampaignBlueprintOptions {
  readonly summary: string;
  readonly premise?: string;
  readonly name?: string;
  readonly startLevel?: number;
  readonly targetEndLevel?: number;
  readonly campaignTone?: CampaignTone;
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
  'Kaelen the Informant',
  'Old Greta',
];

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
  const { missingNpcs, presentNpcs } = classifyNpcRoles(options.entities.npcs, premiseText);

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

    const openingNpcFromPremise =
      m === 1
        ? presentNpcs[0] ??
          options.entities.npcs.find((name) => !missingNpcs.includes(name)) ??
          null
        : presentNpcs[m - 1] ??
          options.entities.npcs.filter((name) => !missingNpcs.includes(name))[m - 1] ??
          null;
    const fallbackNpc = EVOCATIVE_FALLBACK_NPCS[(m - 1) % EVOCATIVE_FALLBACK_NPCS.length]!;
    const npcName = sanitizeWotcProductIdentity(
      openingNpcFromPremise ?? fallbackNpc,
    );
    const fallbackPlaceBase =
      options.campaignName.trim().length > 0 &&
      !/^untitled\s+campaign$/i.test(options.campaignName.trim())
        ? options.campaignName.trim()
        : capitalizeLabel(options.setting.replace(/^(?:a|an)\s+/i, 'The '));
    const placeName = sanitizeWotcProductIdentity(
      options.entities.places[(m - 1) % Math.max(1, options.entities.places.length)] ??
        (m === 1 ? fallbackPlaceBase : `${fallbackPlaceBase} — Lower Reach ${m}`),
    );
    const propLabel = sanitizeWotcProductIdentity(
      options.entities.props[(m - 1) % Math.max(1, options.entities.props.length)] ??
        'iron lantern',
    );
    const secondPropLabel = sanitizeWotcProductIdentity(
      options.entities.props[m % Math.max(1, options.entities.props.length)] ??
        'sealed ledger',
    );
    const exitLabel = sanitizeWotcProductIdentity(
      options.entities.exits[(m - 1) % Math.max(1, options.entities.exits.length)] ??
        'wooden door',
    );
    const monster = pickSrdMonsterForLevel(fromLevel);
    const bossMonster = pickSrdMonsterForLevel(targetLevel);

    const room1Id = `scene-m${m}-r1`;
    const room2Id = `scene-m${m}-r2`;
    const room3Id = `scene-m${m}-r3`;

    const room2Title =
      m === 1
        ? `${capitalizeLabel(placeName)} — Side Passage`
        : m === 2
          ? `${capitalizeLabel(placeName)} — Subterranean Reach`
          : `${capitalizeLabel(placeName)} — Deep Warrens ${m}`;
    const room2Summary =
      m === 1
        ? sanitizeWotcProductIdentity(
            `A shadowed passage beyond the ${exitLabel}, where hidden clues and lurking hazards guard the way deeper into ${placeName}.`,
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

    const room1Exits: CampaignRoomBlueprint['exits'][number][] = [
      {
        edgeLabel: capitalizeLabel(exitLabel),
        targetSceneId: room2Id,
        direction: 'east',
      },
    ];
    if (m > 1) {
      room1Exits.push({
        edgeLabel: 'Stairway back to the upper reach',
        targetSceneId: `scene-m${m - 1}-r3`,
        direction: 'west',
      });
    }

    const room2Exits: CampaignRoomBlueprint['exits'][number][] = [
      {
        edgeLabel: `Passage back to ${placeName}`,
        targetSceneId: room1Id,
        direction: 'west',
      },
      {
        edgeLabel: 'Sanctum archway',
        targetSceneId: room3Id,
        direction: 'east',
      },
    ];

    const room3Exits: CampaignRoomBlueprint['exits'][number][] = [
      {
        edgeLabel: 'Archway back to the outer passage',
        targetSceneId: room2Id,
        direction: 'west',
      },
    ];
    if (m < totalMilestones) {
      room3Exits.push({
        edgeLabel: 'Descending stone archway to the deeper reaches',
        targetSceneId: `scene-m${m + 1}-r1`,
        direction: 'east',
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
            },
          ]
        : [];

    const room3SummaryFinal =
      missingTarget !== null
        ? sanitizeWotcProductIdentity(
            `${room3Summary} ${missingTarget} is held here, awaiting rescue alongside ${options.hook}.`,
          )
        : room3Summary;

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
        templateId: m === 1 ? options.openingTemplate : options.investigationTemplate,
        battlemapPrompt: sanitizeWotcProductIdentity(
          `${placeName} entry chamber in a ${toneLabel.toLowerCase()} setting, warm lantern light, stone and timber floor, doorway leading east`,
        ),
        exits: room1Exits,
        npcs: [
          {
            name: npcName,
            role: m === 1 ? 'Key contact' : 'Local witness',
            portraitPrompt: sanitizeWotcProductIdentity(
              `${npcName}, ${m === 1 ? 'key contact' : 'local witness'} in ${placeName}, ${toneLabel.toLowerCase()} fantasy portrait`,
            ),
          },
        ],
        encounters: [],
        props: [propLabel],
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
        battlemapPrompt: sanitizeWotcProductIdentity(
          `Shadowed investigation passage beyond ${placeName}, flagstone floor, alcoves and crates, doorways west and east`,
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
        battlemapPrompt: sanitizeWotcProductIdentity(
          `Dramatic sanctum chamber beneath ${placeName}, ritual braziers, carved pillars, ancient stonework`,
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

  const premise = sanitizeWotcProductIdentity(rawSummary);
  const entities = extractPremiseEntities(premise);
  const location = detectPremiseLocation(premise);
  const questHook = detectQuestHook(premise, entities.props[0]);
  const hints = actTemplateHints(location.locationKind);

  const hook = questHook ?? 'the trouble that brought the party together';
  const npc = entities.npcs[0] ?? null;
  const place = entities.places[0] ?? null;
  const exit = entities.exits[0] ?? null;
  const firstProp = entities.props[0] ?? null;
  const secondProp = entities.props[1] ?? null;
  const setting = place ?? location.locationPhrase ?? 'the opening scene';
  const exitPhrase = exit !== null ? `the ${exit}` : 'the first exit';

  const act1: CampaignBlueprintBeat = {
    act: 1,
    title: `Act I — Opening at ${setting}`,
    currentActGoal: `Establish ${setting} and let the party feel why ${hook} matters${
      npc !== null ? `; ${npc} is the first face to deal with` : ''
    }.`,
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
    title: `Act II — Investigation beyond ${exit !== null ? `the ${exit}` : 'the opening room'}`,
    currentActGoal: `Follow the trail of ${hook} past ${exitPhrase}; a hazard or complication should make the answer cost something.`,
    keyClue:
      secondProp !== null
        ? `The ${secondProp} found along the trail`
        : entities.places[1] !== undefined
          ? `A lead pointing to ${entities.places[1]}`
          : `A trace tying ${npc ?? 'the culprit'} to ${hook}`,
    nextSceneTrigger: `The party learns who or what is behind ${hook} and commits to confronting it.`,
    templateIdHint: hints.investigation,
  };
  const act3: CampaignBlueprintBeat = {
    act: 3,
    title: 'Act III — Climax',
    currentActGoal: `Confront the source of ${hook} and resolve it for good or ill${
      npc !== null ? `, with ${npc} still at stake` : ''
    }.`,
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
    openingTemplate: hints.opening ?? 'interior_inn_common',
    investigationTemplate: hints.investigation ?? 'interior_stone_crypt',
    premise,
  });

  return {
    premiseDigest: digestPremise(premise),
    startLevel,
    targetEndLevel,
    campaignTone,
    centralTension: sanitizeWotcProductIdentity(
      `Resolve ${hook} across ${setting} (${CAMPAIGN_TONE_LABELS[campaignTone]}).`,
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
  const canUseVertex = env.HD_ENVIRONMENT_CLASS === 'milestone' && project.length > 0;
  if (apiKey.length < 20 && !canUseVertex) {
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
      'Return JSON only with shape: {"centralTension": string, "milestoneTitles": string[], "climaxObjectives": string[]}',
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
      milestoneTitles?: unknown;
      climaxObjectives?: unknown;
    };
    const centralTension =
      typeof parsed.centralTension === 'string' && parsed.centralTension.trim().length > 0
        ? sanitizeWotcProductIdentity(parsed.centralTension.trim())
        : base.centralTension;
    const titles = Array.isArray(parsed.milestoneTitles) ? parsed.milestoneTitles : [];
    const objectives = Array.isArray(parsed.climaxObjectives) ? parsed.climaxObjectives : [];
    const milestones = (base.milestones ?? []).map((m, idx) => ({
      ...m,
      title:
        typeof titles[idx] === 'string' && titles[idx].trim().length > 0
          ? sanitizeWotcProductIdentity(titles[idx].trim())
          : m.title,
      climaxObjective:
        typeof objectives[idx] === 'string' && objectives[idx].trim().length > 0
          ? sanitizeWotcProductIdentity(objectives[idx].trim())
          : m.climaxObjective,
    }));
    return {
      ...base,
      ...(centralTension !== undefined ? { centralTension } : {}),
      milestones,
    };
  } catch {
    return base;
  }
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

