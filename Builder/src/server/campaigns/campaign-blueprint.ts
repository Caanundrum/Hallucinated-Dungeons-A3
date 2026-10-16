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

import type {
  CampaignBlueprint,
  CampaignBlueprintBeat,
} from '../../shared/campaign-contract.js';

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

export function detectQuestHook(premise: string): string | null {
  const text = premise.toLowerCase();
  if (
    /\b(courier|package|missive|parcel|delivery|missing\s+(?:packet|letter|courier))\b/.test(text)
  ) {
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
  'bridge', 'hall', 'market', 'warehouse', 'crypt', 'manor', 'gate', 'wharf', 'mill', 'castle',
  'fort', 'fortress', 'forest', 'woods', 'marsh', 'temple', 'church', 'abbey', 'cathedral',
  'library', 'guild', 'house', 'hold', 'ward', 'square', 'quay', 'pier', 'mines', 'mine', 'cave',
  'caves', 'caverns', 'cavern', 'village', 'town', 'city', 'citadel', 'tomb', 'lair', 'bay',
  'river', 'lake', 'hill', 'hills', 'mountain', 'mountains', 'vale', 'glen', 'fen', 'road',
  'street', 'lane', 'alley', 'academy', 'school', 'theater', 'theatre', 'vault', 'estate', 'farm',
  'lodge', 'port', 'shrine', 'garrison', 'barracks', 'asylum', 'observatory', 'foundry',
]);

const NPC_TITLES = new Set([
  'captain', 'lord', 'lady', 'sir', 'dame', 'master', 'mistress', 'mother', 'father', 'brother',
  'sister', 'madam', 'madame', 'doctor', 'dr', 'professor', 'king', 'queen', 'prince', 'princess',
  'baron', 'baroness', 'elder', 'warden', 'sergeant', 'priest', 'priestess', 'magister', 'abbot',
  'abbess', 'chief', 'commander', 'inspector', 'constable', 'duke', 'duchess', 'count', 'countess',
  'granny', 'grandmother', 'grandfather', 'uncle', 'aunt',
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
  'unmarked', 'half-burnt', 'burnt', 'charred',
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
    if (PLACE_NOUNS.has(last)) {
      pushUnique(places, label);
    } else if (NPC_TITLES.has(first)) {
      pushUnique(npcs, label);
    } else if (hadThe || PLACE_PREPOSITIONS.has(previousWord)) {
      pushUnique(places, label);
    } else {
      pushUnique(npcs, label);
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
  return {
    npcs,
    places,
    props: extractModifierPhrases(premise, PROP_NOUNS, false),
    exits: extractModifierPhrases(premise, EXIT_NOUNS, true),
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

export function buildCampaignBlueprint(premise: string): CampaignBlueprint {
  const entities = extractPremiseEntities(premise);
  const location = detectPremiseLocation(premise);
  const questHook = detectQuestHook(premise);
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

  return {
    premiseDigest: digestPremise(premise),
    namedNpcs: entities.npcs,
    namedPlaces: entities.places,
    namedProps: entities.props,
    namedExits: entities.exits,
    questHook,
    acts: [act1, act2, act3],
  };
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

/** Prompt block that gives the Director a chapter pointer without scripting the table. */
export function formatBlueprintBeatPrompt(beat: CampaignBlueprintBeat): string {
  return [
    `Chapter beat (Act ${beat.act} — ${beat.title}):`,
    `- Current act goal: ${beat.currentActGoal}`,
    `- Key clue: ${beat.keyClue}`,
    `- Next scene trigger: ${beat.nextSceneTrigger}`,
    'Players have full freedom: honor what they declare and the mechanics summary first, and never force this beat.',
    'When it fits naturally, weave the narration back toward the chapter clue or exit by pointing attention at things already present in the visible scene state. Do not state the clue as established fact unless the scene has already shown it.',
  ].join('\n');
}
