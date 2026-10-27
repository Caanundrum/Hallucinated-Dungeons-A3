/**
 * Global Asset Library (`assetBank`) Quarantine & Canonical Tag Guard.
 *
 * Ensures that only authentic medieval/high-fantasy Portraits and Object Sprites
 * enter the shared cross-campaign `assetBank`, while quarantining off-genre,
 * anachronistic, meme, or hyper-specific custom descriptions to `account_private`.
 * Battlemaps are NEVER eligible for the shared `assetBank`.
 */

export interface AssetLibraryGuardInput {
  readonly assetKind: 'portrait' | 'object_sprite' | 'battlemap';
  readonly speciesId?: string | undefined;
  readonly classId?: string | undefined;
  readonly pronouns?: string | undefined;
  readonly customDescription?: string | undefined;
  readonly objectKind?: string | undefined;
  readonly promptText: string;
}

export interface AssetLibraryGuardResult {
  readonly eligibleForGlobalBank: boolean;
  readonly canonicalTags: readonly string[];
  readonly quarantineReason?: string;
}

const OFF_GENRE_BLOCKLIST_PATTERNS: readonly RegExp[] = [
  /\bpink\s+tuxedo\b/i,
  /\btuxedo\b/i,
  /\bsuit\s+and\s+tie\b/i,
  /\bsunglasses\b/i,
  /\baviators\b/i,
  /\bsneakers\b/i,
  /\bjeans\b/i,
  /\bhoodie\b/i,
  /\bbaseball\s+cap\b/i,
  /\bfedora\b/i,
  /\bgun\b/i,
  /\bpistol\b/i,
  /\brifle\b/i,
  /\bshotgun\b/i,
  /\bak[- ]?47\b/i,
  /\blaser\b/i,
  /\blightsaber\b/i,
  /\bspaceship\b/i,
  /\bcyborg\b/i,
  /\brobot\b/i,
  /\bsmartphone\b/i,
  /\biphone\b/i,
  /\blaptop\b/i,
  /\b(?:sports\s+)?car\b/i,
  /\bmotorcycle\b/i,
  /\bskateboard\b/i,
  /\bcigarette\b/i,
  /\bvape\b/i,
  /\bneon\b/i,
  /\bcyberpunk\b/i,
  /\bbikini\b/i,
  /\blingerie\b/i,
  /\bnsfw\b/i,
  /\bnude\b/i,
  /\bnaked\b/i,
  /\bspongebob\b/i,
  /\bshrek\b/i,
  /\bpikachu\b/i,
  /\bmario\b/i,
  /\bgoku\b/i,
  /\bnaruto\b/i,
  /\bbatman\b/i,
  /\bspider[- ]?man\b/i,
  /\bdarth\s+vader\b/i,
  /\bstormtrooper\b/i,
  /\bclown\s+nose\b/i,
  /\bballoon\s+animal\b/i,
  /\bdisco\b/i,
  /\bboombox\b/i,
  /\bhotdog\b/i,
  /\bhamburger\b/i,
  /\bpizza\b/i,
];

const WHITELISTED_SPECIES_TAGS: ReadonlySet<string> = new Set([
  'human',
  'elf',
  'high-elf',
  'wood-elf',
  'drow',
  'dwarf',
  'halfling',
  'gnome',
  'dragonborn',
  'tiefling',
  'orc',
  'half-orc',
  'half-elf',
  'goliath',
  'aasimar',
]);

const WHITELISTED_CLASS_ARCHETYPE_TAGS: ReadonlySet<string> = new Set([
  'barbarian',
  'bard',
  'cleric',
  'druid',
  'fighter',
  'monk',
  'paladin',
  'ranger',
  'rogue',
  'sorcerer',
  'warlock',
  'wizard',
  'merchant',
  'guard',
  'scholar',
  'noble',
  'innkeeper',
  'scout',
  'captain',
  'cultist',
  'warden',
  'curator',
]);

const WHITELISTED_VISUAL_GEAR_PATTERNS: readonly [RegExp, string][] = [
  [/\bplate(?:\s+armor|\s+mail)?\b/i, 'plate-armor'],
  [/\bchain(?:\s*mail|\s+shirt)?\b/i, 'chainmail'],
  [/\bleather(?:\s+armor|\s+jerkin)?\b/i, 'leather-armor'],
  [/\brobes?\b/i, 'robes'],
  [/\bcloak(?:ed)?\b/i, 'cloak'],
  [/\bhood(?:ed)?\b/i, 'hooded'],
  [/\bshield\b/i, 'shield'],
  [/\bgreatsword\b/i, 'greatsword'],
  [/\b(?:long)?sword\b/i, 'sword'],
  [/\bdaggers?\b/i, 'dagger'],
  [/\b(?:long|short)?bow\b/i, 'bow'],
  [/\bcrossbow\b/i, 'crossbow'],
  [/\bstaff|quarterstaff\b/i, 'staff'],
  [/\bwand\b/i, 'wand'],
  [/\bmace\b/i, 'mace'],
  [/\bwarhammer|hammer\b/i, 'warhammer'],
  [/\b(?:battle|great|hand)?axe\b/i, 'axe'],
  [/\bspear\b/i, 'spear'],
  [/\blantern\b/i, 'lantern'],
  [/\btorch\b/i, 'torch'],
  [/\btome|spellbook|grimoire\b/i, 'tome'],
  [/\bscroll\b/i, 'scroll'],
  [/\bholy\s+symbol|amulet|reliquary\b/i, 'holy-symbol'],
  [/\blute\b/i, 'lute'],
  [/\bbeard(?:ed)?\b/i, 'bearded'],
  [/\bscar(?:red|s)?\b/i, 'scarred'],
  [/\bsilver[- ]hair|white[- ]hair\b/i, 'silver-hair'],
  [/\bdark[- ]hair|black[- ]hair|raven[- ]hair\b/i, 'dark-hair'],
  [/\bred[- ]hair|auburn[- ]hair|copper[- ]hair\b/i, 'red-hair'],
  [/\bblonde?[- ]hair|golden[- ]hair\b/i, 'blonde-hair'],
  [/\bbraid(?:ed|s)?\b/i, 'braided-hair'],
  [/\bbald\b/i, 'bald'],
  [/\baged|elderly|old|veteran\b/i, 'aged'],
  [/\byoung|youthful\b/i, 'young'],
  [/\bstern|grim\b/i, 'stern'],
  [/\bweathered|rugged\b/i, 'weathered'],
];

const STANDARD_FANTASY_CAPITALIZED_WORDS: ReadonlySet<string> = new Set([
  'the',
  'a',
  'an',
  'in',
  'of',
  'with',
  'and',
  ' wearing',
  'wearing',
  'holding',
  'carrying',
  'human',
  'elf',
  'high',
  'wood',
  'drow',
  'dwarf',
  'hill',
  'mountain',
  'halfling',
  'lightfoot',
  'stout',
  'gnome',
  'rock',
  'forest',
  'dragonborn',
  'tiefling',
  'orc',
  'half-orc',
  'half-elf',
  'goliath',
  'aasimar',
  'barbarian',
  'bard',
  'cleric',
  'druid',
  'fighter',
  'monk',
  'paladin',
  'ranger',
  'rogue',
  'sorcerer',
  'warlock',
  'wizard',
  'acolyte',
  'charlatan',
  'criminal',
  'entertainer',
  'folk',
  'hero',
  'guild',
  'artisan',
  'hermit',
  'noble',
  'outlander',
  'sage',
  'sailor',
  'soldier',
  'urchin',
  'warden',
  'captain',
  'scholar',
  'merchant',
  'guard',
  'scout',
  'curator',
  'innkeeper',
  'she',
  'her',
  'he',
  'him',
  'they',
  'them',
  'his',
  'their',
]);

export function resolvePresentationTagFromPronouns(pronouns?: string): 'feminine' | 'masculine' | 'androgynous' {
  const norm = (pronouns ?? '').trim().toLowerCase();
  if (norm.startsWith('she') || /\bfemale|feminine|woman\b/.test(norm)) {
    return 'feminine';
  }
  if (norm.startsWith('he') || /\bmale|masculine|man\b/.test(norm)) {
    return 'masculine';
  }
  return 'androgynous';
}

export function extractWhitelistedCanonicalTags(input: {
  readonly speciesId?: string | undefined;
  readonly classId?: string | undefined;
  readonly pronouns?: string | undefined;
  readonly objectKind?: string | undefined;
  readonly text: string;
}): readonly string[] {
  const tags = new Set<string>();
  const lowerText = input.text.toLowerCase();

  const rawSpecies = (input.speciesId ?? '').trim().toLowerCase();
  if (rawSpecies.length > 0 && WHITELISTED_SPECIES_TAGS.has(rawSpecies)) {
    tags.add(rawSpecies);
  }
  for (const sp of WHITELISTED_SPECIES_TAGS) {
    if (new RegExp(`\\b${sp.replace('-', '[- ]')}\\b`, 'i').test(lowerText)) {
      tags.add(sp);
    }
  }

  const rawClass = (input.classId ?? '').trim().toLowerCase();
  if (rawClass.length > 0 && WHITELISTED_CLASS_ARCHETYPE_TAGS.has(rawClass)) {
    tags.add(rawClass);
  }
  for (const cl of WHITELISTED_CLASS_ARCHETYPE_TAGS) {
    if (new RegExp(`\\b${cl}\\b`, 'i').test(lowerText)) {
      tags.add(cl);
    }
  }

  if (input.pronouns !== undefined && input.pronouns.trim().length > 0) {
    tags.add(resolvePresentationTagFromPronouns(input.pronouns));
  } else if (/\bfeminine|female|woman\b/i.test(lowerText)) {
    tags.add('feminine');
  } else if (/\bmasculine|male|man\b/i.test(lowerText)) {
    tags.add('masculine');
  }

  if (input.objectKind !== undefined && input.objectKind.trim().length > 0) {
    tags.add(input.objectKind.trim().toLowerCase());
  }

  for (const [pattern, canonicalTag] of WHITELISTED_VISUAL_GEAR_PATTERNS) {
    if (pattern.test(lowerText)) {
      tags.add(canonicalTag);
    }
  }

  return [...tags];
}

export function evaluateGlobalAssetBankEligibility(
  input: AssetLibraryGuardInput,
): AssetLibraryGuardResult {
  if (input.assetKind === 'battlemap') {
    return {
      eligibleForGlobalBank: false,
      canonicalTags: [],
      quarantineReason: 'battlemap_never_shared_across_campaigns',
    };
  }

  const customDesc = (input.customDescription ?? '').trim();
  const combinedText = `${customDesc} ${input.promptText}`.trim();

  for (const pattern of OFF_GENRE_BLOCKLIST_PATTERNS) {
    if (pattern.test(combinedText)) {
      return {
        eligibleForGlobalBank: false,
        canonicalTags: [],
        quarantineReason: 'off_genre_or_restricted_token',
      };
    }
  }

  if (customDesc.length > 0) {
    if (
      customDesc.length > 240 ||
      /["“”]/.test(customDesc) ||
      /\bhttps?:\/\/|\bwww\.|@[a-z0-9_]+|\.[a-z]{2,4}\b/i.test(customDesc)
    ) {
      return {
        eligibleForGlobalBank: false,
        canonicalTags: [],
        quarantineReason: 'hyper_specific_custom_description',
      };
    }

    // Count capitalized words that are not sentence-initial and not standard SRD vocabulary.
    const clauses = customDesc.split(/[.!?]+\s*/);
    let unknownProperNounCount = 0;
    for (const clause of clauses) {
      const words = clause.trim().split(/\s+/).filter(Boolean);
      for (let i = 1; i < words.length; i += 1) {
        const cleaned = words[i]!.replace(/[^A-Za-z'-]/g, '');
        if (
          cleaned.length >= 2 &&
          /^[A-Z][a-z]/.test(cleaned) &&
          !STANDARD_FANTASY_CAPITALIZED_WORDS.has(cleaned.toLowerCase())
        ) {
          unknownProperNounCount += 1;
        }
      }
    }
    if (unknownProperNounCount > 2) {
      return {
        eligibleForGlobalBank: false,
        canonicalTags: [],
        quarantineReason: 'hyper_specific_custom_description',
      };
    }
  }

  const canonicalTags = extractWhitelistedCanonicalTags({
    speciesId: input.speciesId,
    classId: input.classId,
    pronouns: input.pronouns,
    objectKind: input.objectKind,
    text: combinedText,
  });

  return {
    eligibleForGlobalBank: true,
    canonicalTags,
  };
}
