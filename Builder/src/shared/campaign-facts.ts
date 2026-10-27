/**
 * Campaign epistemic facts — established / inferred / unknown.
 *
 * Shared by Play (knowledge recap) and Ask the Director so both channels
 * refuse invention and agree on what the table already knows.
 */

export const FACT_EPISTEMIC_STATUSES = ['established', 'inferred', 'unknown'] as const;
export type FactEpistemicStatus = (typeof FACT_EPISTEMIC_STATUSES)[number];

export interface CampaignFactRecord {
  readonly factId: string;
  readonly label: string;
  readonly summary: string;
  readonly status: FactEpistemicStatus;
  /** Loose tags for retrieval (courier, mara, key, premise, …). */
  readonly tags: readonly string[];
}

export interface CampaignFactAnswer {
  readonly knownSummaries: readonly string[];
  readonly inferredSummaries: readonly string[];
  readonly unknownLabels: readonly string[];
  readonly playerFacingBody: string;
}

/** Spatial and locative prepositions that introduce a setting, building, or place name. */
export const LOCATIVE_PREPOSITIONS: ReadonlySet<string> = new Set([
  'at',
  'in',
  'inside',
  'into',
  'within',
  'near',
  'beneath',
  'under',
  'beyond',
  'across',
  'around',
  'from',
  'toward',
  'towards',
  'to',
  'through',
  'atop',
  'beside',
  'outside',
  'along',
  'amid',
  'amidst',
]);

/** Strictly spatial prepositions that never introduce a person unless followed by a role title. */
export const STRICT_LOCATIVE_PREPOSITIONS: ReadonlySet<string> = new Set([
  'at',
  'in',
  'inside',
  'into',
  'within',
  'near',
  'beneath',
  'under',
  'beyond',
  'across',
  'around',
  'through',
  'atop',
  'beside',
  'outside',
  'along',
  'amid',
  'amidst',
]);

/** Compound place/structure suffixes (e.g. words ending in -house, -hall, -keep, -mire, -fen). */
export const COMPOUND_PLACE_SUFFIX_RE =
  /^[a-z]{2,}(?:house|hall|keep|tower|spire|hold|haven|watch|gate|bridge|mill|forge|vault|crypt|abbey|manor|wharf|dock|pier|port|falls|reach|brook|ford|crest|peak|vale|glen|marsh|mire|fen|wood|grove|hollow|stead|ton|burg|borough|ville|shire|yard|works|foundry|bastion|citadel|sanctum|lodge|post|crossing|point|cove|bay|cliff|bluff|ridge)$/i;

/** Appositive place description immediately following a proper name (", a/an/the [adjectives] <place noun>"). */
export const APPOSITIVE_PLACE_CLAUSE_RE =
  /^\s*,\s*(?:a|an|the|our|this|that)\s+(?:[a-z0-9'’-]+(?:,\s*|\s+)){0,6}(?:hall|tower|house|keep|observatory|archive|archives|abbey|foundry|guildhall|warehouse|sanctum|manor|inn|tavern|dock|docks|wharf|pier|mill|sawmill|gristmill|windmill|temple|shrine|vault|cellar|crypt|prison|fortress|fort|outpost|bastion|settlement|village|town|city|station|laboratory|library|museum|lodge|post|crossing|bridge|gate|citadel|hold|spire|haven|sanctuary|monastery|chapel|market|bazaar|garrison|camp|hamlet|port|harbor|harbour|estate|farm|quarry|lighthouse|beacon)\b/i;

/** Personal role titles that precede NPC names. */
export const PERSONAL_ROLE_TITLES: ReadonlySet<string> = new Set([
  'warden',
  'apprentice',
  'archivist',
  'master',
  'mistress',
  'captain',
  'inspector',
  'curator',
  'scholar',
  'elder',
  'brother',
  'sister',
  'father',
  'mother',
  'lord',
  'lady',
  'sir',
  'dame',
  'prior',
  'prioress',
  'abbot',
  'abbess',
  'guildmaster',
  'steward',
  'constable',
  'sergeant',
  'doctor',
  'dr',
  'professor',
  'keeper',
  'overseer',
  'reeve',
  'bailiff',
  'merchant',
  'trader',
  'smith',
  'blacksmith',
  'caretaker',
  'watchman',
  'sentinel',
  'quartermaster',
  'marshal',
  'herald',
  'sage',
  'priest',
  'priestess',
  'cleric',
  'acolyte',
  'apothecary',
  'alchemist',
  'herbalist',
  'innkeeper',
  'tavernkeeper',
  'barkeep',
  'bartender',
  'ferryman',
  'harbormaster',
  'factor',
  'clerk',
  'scribe',
  'chronicler',
  'miller',
  'courier',
  'scout',
  'hunter',
  'guard',
  'guardsman',
  'commander',
  'chief',
  'magister',
  'castellan',
  'curate',
  'preceptor',
  'astronomer',
  'astrologer',
  'baron',
  'baroness',
  'duke',
  'duchess',
  'count',
  'countess',
  'king',
  'queen',
  'prince',
  'princess',
  'madam',
  'madame',
  'provost',
  'custodian',
  'chancellor',
  'prefect',
  'magistrate',
  'chamberlain',
  'seneschal',
  'deacon',
  'archdeacon',
  'vicar',
  'rector',
  'dean',
  'bursar',
  'inquisitor',
  'envoy',
  'consul',
  'legate',
  'tribune',
  'centurion',
  'adjutant',
  'auditor',
  'assessor',
  'comptroller',
  'registrar',
  'proctor',
  'beadle',
  'verger',
  'sacristan',
  'artificer',
  'navigator',
  'pilot',
  'bosun',
  'purser',
  'archon',
  'prelate',
  'canon',
  'syndic',
  'regent',
  'delegate',
  'advocate',
  'potentate',
  'exarch',
  'viceroy',
  'bellkeeper',
  'surveyor',
  'sexton',
  'granny',
  'grandmother',
  'grandfather',
  'uncle',
  'aunt',
  'emperor',
  'empress',
  'warlord',
  'archmage',
  'overlord',
  'rogue',
  'artisan',
  'baker',
  'butcher',
  'brewer',
  'fisherman',
  'farmer',
  'weaver',
  'miner',
  'messenger',
  'guide',
  'detective',
  'investigator',
  'informant',
  'witness',
  'contact',
  'agent',
  'patron',
]);

const NPC_TOKEN_STOPWORDS: ReadonlySet<string> = new Set([
  'the',
  'and',
  'for',
  'from',
  'with',
  'into',
  'onto',
  'upon',
  'over',
  'under',
  'near',
  'beside',
  'beyond',
  'through',
  'between',
  'among',
  'without',
  'within',
  'who',
  'whom',
  'whose',
  'what',
  'where',
  'when',
  'why',
  'how',
  'that',
  'this',
  'these',
  'those',
  'missing',
  'local',
  'contact',
  'guide',
  'helpful',
  'hostile',
  'friendly',
  'neutral',
  'present',
  'absent',
  'waiting',
  'vanished',
  'lost',
  'unknown',
  'npc',
  'character',
]);

/**
 * Strips parenthetical status/role tags `(...)` and dash suffixes `— ...` / ` - ...`
 * so metadata words (`Missing`, `Local`, `Contact`, `Guide`) are never indexed as NPC name tokens.
 */
export function cleanNpcLabelForMatching(rawName: string): string {
  return rawName
    .replace(/^@+/, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+[—–-]\s+.*$/u, '')
    .replace(/[.,:;!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts a leading role/honorific title and canonical `<GivenName> <Surname>` / `<GivenName>`
 * from an NPC name, supporting both known `PERSONAL_ROLE_TITLES` and any 3+-word `<Word1> <Word2> <Word3>`
 * person name where `<Word1>` precedes a 2-word proper name.
 */
export function stripPersonalRoleTitle(rawName: string): {
  readonly title: string | null;
  readonly strippedName: string;
  readonly givenName: string | null;
} {
  const cleaned = cleanNpcLabelForMatching(rawName);
  if (cleaned.length === 0) {
    return { title: null, strippedName: '', givenName: null };
  }
  const words = cleaned.split(/\s+/);
  const firstClean = (words[0] ?? '').replace(/\.$/, '');
  const firstLower = firstClean.toLowerCase();
  if (words.length >= 2 && PERSONAL_ROLE_TITLES.has(firstLower)) {
    const rest = words.slice(1);
    return {
      title: firstClean,
      strippedName: rest.join(' '),
      givenName: rest[0] ?? null,
    };
  }
  if (words.length >= 3) {
    const rest = words.slice(1);
    return {
      title: firstClean,
      strippedName: rest.join(' '),
      givenName: rest[0] ?? null,
    };
  }
  return {
    title: null,
    strippedName: cleaned,
    givenName: words[0] ?? null,
  };
}

/** Interpersonal verbs indicating an active quest-giving contact present in the opening scene. */
export const INTERPERSONAL_CONTACT_VERB_RE =
  /^\s*(?:,\s*[^,.;!?]{1,70},\s*)?(?:asks|asked|hires|hired|begs|begged|warns|warned|tells|told|implores|implored|summons|summoned|recruits|recruited|tasks|tasked|approaches|approached|greets|greeted|meets|met|pleads|pleaded|offers|offered|commissions|commissioned|entrusts|entrusted|presses|pressed|hands|handed|gives|gave|urges|urged|whispers|whispered|explains|explained|bids|bade|wants|wanted|needs|needed|waits|is\s+waiting|awaits)\b/i;

/** Disappearance or victim predicates indicating an NPC is missing/absent from the opening scene. */
export const DISAPPEARANCE_PREDICATE_RE =
  /\b(?:vanished|disappeared|went\s+missing|is\s+missing|was\s+kidnapped|was\s+taken|was\s+abducted|has\s+not\s+returned|never\s+returned|was\s+lost|was\s+captured|was\s+seized|fell\s+silent|failed\s+to\s+return|kidnapped|captive|hostage)\b/i;

/** Words ending in `-ate` (specifically `-gate` like `legate` / `delegate`) that are never compound `-gate` places. */
export const NON_PLACE_ATE_WORDS_RE =
  /^(?:legate|delegate|relegate|abnegate|aggregate|congregate|segregate|propagate|mitigate|litigate|investigate|navigate|obligate|instigate|interrogate|castigate|fumigate|irrigate|subjugate|surrogate|magistrate|prelate|advocate|curate|potentate|syndicate|consulate|protectorate|directorate|novitiate|episcopate|caliphate|sultanate|triumvirate|archonate)$/i;

/** Explicit architectural building nouns or suffixes that denote a physical structure when used as the final head noun. */
export const EXPLICIT_ARCHITECTURAL_HEAD_NOUN_RE =
  /^(?:[a-z]{2,}(?:house|hall|keep|tower|spire|abbey|manor|vault|crypt|foundry|bastion|citadel|sanctum|lodge|mill|forge|wharf|dock|pier)|house|hall|keep|tower|spire|observatory|archive|archives|abbey|foundry|guildhall|warehouse|sanctum|manor|inn|tavern|dock|docks|wharf|pier|mill|sawmill|gristmill|windmill|temple|shrine|vault|cellar|crypt|prison|fortress|fort|outpost|bastion|station|laboratory|library|museum|lodge|citadel|sanctuary|monastery|chapel|garrison|quarry|lighthouse|beacon|glasshouse|lockhouse|bellhouse|watchtower|gatehouse|boathouse|storehouse|almshouse|charthouse|customhouse|workhouse)$/i;

export function isCompoundPlaceWord(word: string): boolean {
  const cleaned = word.trim().replace(/^['’]+|['’]+$/g, '');
  if (cleaned.length < 5) {
    return false;
  }
  if (NON_PLACE_ATE_WORDS_RE.test(cleaned)) {
    return false;
  }
  if (PERSONAL_ROLE_TITLES.has(cleaned.toLowerCase())) {
    return false;
  }
  return COMPOUND_PLACE_SUFFIX_RE.test(cleaned);
}

/**
 * Evaluates whether a proper noun phrase is syntactically a Person (NPC) BEFORE any place-noun
 * or compound-suffix check (`C12-01`).
 */
export function isPersonBySyntacticContext(
  candidate: string,
  fullText?: string,
  matchIndex?: number,
): boolean {
  const cleaned = cleanNpcLabelForMatching(candidate);
  if (cleaned.length === 0) {
    return false;
  }
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return false;
  }
  const firstClean = (words[0] ?? '').replace(/\.$/, '').toLowerCase();
  const lastClean = (words[words.length - 1] ?? '').replace(/\.$/, '').toLowerCase();

  // If the final head word is an explicit building/room structure (e.g. "Warden's Keep", "Frostwatch Glasshouse"),
  // it is a structure, not a person.
  if (EXPLICIT_ARCHITECTURAL_HEAD_NOUN_RE.test(lastClean)) {
    return false;
  }

  // 1. Starts with any PERSONAL_ROLE_TITLES word in a multi-word name ("Legate Aveline Marr", "Provost Ilwen")
  if (words.length >= 2 && PERSONAL_ROLE_TITLES.has(firstClean)) {
    return true;
  }

  if (typeof fullText === 'string' && fullText.trim().length > 0) {
    const escaped = cleaned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Check preceding role title immediately before candidate in fullText
    if (
      typeof matchIndex === 'number' &&
      matchIndex > 0
    ) {
      const beforeSlice = fullText.slice(0, matchIndex).trimEnd();
      const prevWord = (beforeSlice.match(/([A-Za-z]+)\.?$/)?.[1] ?? '').toLowerCase();
      if (PERSONAL_ROLE_TITLES.has(prevWord)) {
        return true;
      }
    }

    // 2. Acts as the subject of an interpersonal contact verb
    const subjectContactRe = new RegExp(
      `\\b${escaped}\\b\\s*(?:,\\s*[^,.;!?]{1,70},\\s*)?(?:asks|asked|hires|hired|begs|begged|warns|warned|tells|told|implores|implored|summons|summoned|recruits|recruited|tasks|tasked|approaches|approached|greets|greeted|meets|met|pleads|pleaded|offers|offered|commissions|commissioned|entrusts|entrusted|presses|pressed|hands|handed|gives|gave|urges|urged|whispers|whispered|explains|explained|bids|bade|wants|wanted|needs|needed|waits|is\\s+waiting|awaits)\\b`,
      'i',
    );
    if (subjectContactRe.test(fullText)) {
      return true;
    }

    // 3. Attached to a disappearance/victim predicate or rescue/find verb
    const missingPredicateRe = new RegExp(
      `\\b${escaped}\\b\\s*(?:,\\s*[^,.;!?]{1,60},\\s*)?(?:who\\s+)?(?:has\\s+|had\\s+|was\\s+|is\\s+|have\\s+|went\\s+)?(?:vanished|missing|lost|kidnapped|captive|hostage|disappeared|abducted|taken|captured|seized|fell\\s+silent|failed\\s+to\\s+return|not\\s+returned|never\\s+returned)\\b`,
      'i',
    );
    const findVictimRe = new RegExp(
      `\\b(?:find|rescue|save|locate|recover|search\\s+for|trace|track(?:\\s+down)?|question|speak\\s+with|talk\\s+to|meet|hired\\s+by|summoned\\s+by|recruited\\s+by|tasked\\s+by)\\s+(?:missing\\s+)?(?:[a-z'-]+\\s+){0,2}${escaped}\\b`,
      'i',
    );
    if (missingPredicateRe.test(fullText) || findVictimRe.test(fullText)) {
      return true;
    }
  }

  return false;
}

/**
 * Evaluates whether a multi-word proper name `<Word1> <Word2> [<Word3>]` is a Place (`C12-01` Guardrail 1).
 * Never allows a multi-word proper name to be classified as a Place via `COMPOUND_PLACE_SUFFIX_RE`
 * unless its final token has a non-`-ate` place suffix AND the phrase is either preceded by a locative
 * preposition, followed by a place appositive, or ends in an explicit architectural noun.
 */
export function isMultiWordPlaceByContext(
  candidate: string,
  options?: {
    readonly fullText?: string;
    readonly previousWord?: string;
    readonly afterSlice?: string;
    readonly matchIndex?: number;
  },
): boolean {
  const cleaned = cleanNpcLabelForMatching(candidate);
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 2) {
    return false;
  }
  if (isPersonBySyntacticContext(cleaned, options?.fullText, options?.matchIndex)) {
    return false;
  }
  const lastWord = words[words.length - 1] ?? '';
  if (!isCompoundPlaceWord(lastWord) && !EXPLICIT_ARCHITECTURAL_HEAD_NOUN_RE.test(lastWord)) {
    return false;
  }
  const prevLower = (options?.previousWord ?? '').trim().toLowerCase();
  const afterSlice = options?.afterSlice ?? '';
  const precededByLocative = LOCATIVE_PREPOSITIONS.has(prevLower);
  const followedByPlaceAppositive = APPOSITIVE_PLACE_CLAUSE_RE.test(afterSlice);
  const endsInArchitecturalNoun = EXPLICIT_ARCHITECTURAL_HEAD_NOUN_RE.test(lastWord);

  return precededByLocative || followedByPlaceAppositive || endsInArchitecturalNoun;
}

/**
 * Expands a stored or candidate NPC name into all natural reference forms:
 * - Full normalized name ("<Title> <GivenName> <Surname>")
 * - Stripped personal name ("<GivenName> <Surname>")
 * - Every contiguous multi-word sub-phrase ("<Title> <GivenName>", "<GivenName> <Surname>")
 * - Every substantive token (`len >= 3`, excluding metadata/stopwords) at any position (`0`, `1`, `2`, ...)
 */
export function expandNpcNameVariants(
  rawName: string,
  roleHint?: string,
): readonly string[] {
  const cleaned = cleanNpcLabelForMatching(rawName);
  if (cleaned.length === 0) {
    return [];
  }
  const words = cleaned
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z0-9'-]+|[^A-Za-z0-9'-]+$/g, ''))
    .filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const stripped = stripPersonalRoleTitle(cleaned);
  const firstLower = (words[0] ?? '').toLowerCase().replace(/\.$/, '');
  let titleWord: string | null = stripped.title;
  const nameWords: string[] =
    stripped.title !== null && words.length >= 2 ? words.slice(1) : words;

  if (titleWord === null && typeof roleHint === 'string' && roleHint.trim().length > 0) {
    const roleFirst =
      cleanNpcLabelForMatching(roleHint).split(/\s+/)[0]?.replace(/[^A-Za-z]/g, '') ?? '';
    if (roleFirst.length > 0 && PERSONAL_ROLE_TITLES.has(roleFirst.toLowerCase())) {
      titleWord = `${roleFirst.charAt(0).toUpperCase()}${roleFirst.slice(1).toLowerCase()}`;
    }
  }

  const results: string[] = [];
  const pushVariant = (candidate: string) => {
    const norm = candidate.trim();
    if (norm.length === 0) return;
    if (!results.some((existing) => existing.toLowerCase() === norm.toLowerCase())) {
      results.push(norm);
    }
  };

  if (titleWord !== null && nameWords.length > 0) {
    pushVariant(`${titleWord} ${nameWords.join(' ')}`);
  }
  pushVariant(cleaned);
  if (stripped.strippedName.length > 0) {
    pushVariant(stripped.strippedName);
  }
  if (titleWord !== null && nameWords.length >= 2) {
    pushVariant(`${titleWord} ${nameWords[0]}`);
  }

  // Contiguous multi-word N-grams across all tokens
  for (let span = words.length - 1; span >= 2; span -= 1) {
    for (let i = 0; i <= words.length - span; i += 1) {
      pushVariant(words.slice(i, i + span).join(' '));
    }
  }

  // Every substantive personal token (len >= 3) across nameWords first, then any remaining substantive token
  for (const token of nameWords) {
    const lower = token.toLowerCase().replace(/\.$/, '');
    if (token.length >= 3 && !NPC_TOKEN_STOPWORDS.has(lower)) {
      pushVariant(token);
    }
  }
  for (let i = 0; i < words.length; i += 1) {
    const token = words[i]!;
    const lower = token.toLowerCase().replace(/\.$/, '');
    if (i === 0 && words.length >= 2 && PERSONAL_ROLE_TITLES.has(firstLower)) {
      continue;
    }
    if (token.length >= 3 && !NPC_TOKEN_STOPWORDS.has(lower)) {
      pushVariant(token);
    }
  }

  return results;
}

/**
 * Returns true when a stored NPC name and a player/premise candidate reference refer to the same NPC
 * across any natural form ("<Title> <Given> <Surname>", "<Title> <Given>", "<Given> <Surname>", "<Given>", "<Surname>").
 */
export function npcNamesMatch(
  storedName: string,
  candidateRef: string,
  roleHint?: string,
): boolean {
  const cleanStored = cleanNpcLabelForMatching(storedName);
  const cleanCandidate = cleanNpcLabelForMatching(candidateRef);
  if (cleanStored.length === 0 || cleanCandidate.length === 0) {
    return false;
  }
  const storedWords = cleanStored.toLowerCase().split(/\s+/).filter(Boolean);
  const candidateWords = cleanCandidate.toLowerCase().split(/\s+/).filter(Boolean);
  // Prevent two distinct multi-word titled NPCs (e.g. "Archon Mira Vane" vs "Archon Orin Kael")
  // from false-matching solely on their shared leading title token.
  if (
    storedWords.length >= 2 &&
    candidateWords.length >= 2 &&
    storedWords[0] === candidateWords[0]
  ) {
    const storedRest = storedWords.slice(1);
    const candidateRest = candidateWords.slice(1);
    if (!storedRest.some((w) => candidateRest.includes(w))) {
      return false;
    }
  }
  const storedVariants = expandNpcNameVariants(cleanStored, roleHint).map((v) => v.toLowerCase());
  const candidateVariants = expandNpcNameVariants(cleanCandidate).map((v) => v.toLowerCase());
  if (storedVariants.length === 0 || candidateVariants.length === 0) {
    return false;
  }
  return storedVariants.some((sv) => candidateVariants.includes(sv));
}

/**
 * Returns true when a candidate proper name matches any excluded player character name
 * (either full name or given/first name of length >= 3).
 */
export function matchesExcludedCharacterName(
  candidate: string,
  excludeCharacterNames?: readonly string[],
): boolean {
  if (!excludeCharacterNames || excludeCharacterNames.length === 0) {
    return false;
  }
  const cleanCandidate = candidate
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, '')
    .trim();
  if (cleanCandidate.length === 0) {
    return false;
  }
  const candidateTokens = cleanCandidate.split(/\s+/).filter((t) => t.length >= 3);
  const candidateFirst = candidateTokens[0] ?? '';

  for (const rawExcluded of excludeCharacterNames) {
    const cleanExcluded = rawExcluded.trim().toLowerCase();
    if (cleanExcluded.length === 0) {
      continue;
    }
    if (cleanCandidate === cleanExcluded) {
      return true;
    }
    const excludedTokens = cleanExcluded.split(/\s+/).filter((t) => t.length >= 3);
    const excludedFirst = excludedTokens[0] ?? '';
    if (excludedFirst.length >= 3 && cleanCandidate === excludedFirst) {
      return true;
    }
    if (candidateFirst.length >= 3 && candidateFirst === cleanExcluded) {
      return true;
    }
    if (
      excludedFirst.length >= 3 &&
      candidateFirst.length >= 3 &&
      candidateFirst === excludedFirst &&
      (candidateTokens.length === 1 || excludedTokens.length === 1)
    ) {
      return true;
    }
  }
  return false;
}

/** Seed facts from adventure premise text — never invent beyond explicit cues. */
export function extractCampaignFactsFromPremise(
  premise: string,
  options: {
    /** When false, skip promoting proper names (e.g. Mara) into premise facts. */
    readonly allowNamedNpcs?: boolean;
  } = {},
): readonly CampaignFactRecord[] {
  const text = premise.trim();
  if (text.length === 0) {
    return [];
  }
  const facts: CampaignFactRecord[] = [];
  const allowNamedNpcs = options.allowNamedNpcs !== false;

  if (/\b(?:missing|vanished|lost)\s+courier\b/i.test(text) || /\bcourier\b/i.test(text)) {
    facts.push({
      factId: 'premise-courier',
      label: 'the missing courier',
      summary: /\b(?:missing|vanished|lost)\s+courier\b/i.test(text)
        ? 'A courier is missing — recovering them (or news of them) is part of why you are here.'
        : 'A courier figures in the premise; details beyond that are not yet established.',
      status: /\b(?:missing|vanished|lost)\s+courier\b/i.test(text) ? 'established' : 'inferred',
      tags: ['courier', 'premise', 'recap'],
    });
    facts.push({
      factId: 'unknown-courier-fate',
      label: "the courier's fate",
      summary: "Where the courier is now, and what happened to them, is not yet established.",
      status: 'unknown',
      tags: ['courier', 'unknown', 'recap'],
    });
    if (!/\bpackage\b/i.test(text)) {
      facts.push({
        factId: 'unknown-package-whereabouts',
        label: "the package's whereabouts",
        summary:
          "Whether a package travels with the courier hook, and where it is now, is not yet established.",
        status: 'unknown',
        tags: ['package', 'unknown', 'recap'],
      });
    }
  }

  if (/\b(?:missing|vanished|lost)\s+package\b/i.test(text) || /\bpackage\b/i.test(text)) {
    facts.push({
      factId: 'premise-package',
      label: 'the missing package',
      summary: /\b(?:missing|vanished|lost)\s+package\b/i.test(text)
        ? 'A package is missing alongside the courier hook — recovering it (or news of it) is part of why you are here.'
        : 'A package figures in the premise; details beyond that are not yet established.',
      status: /\b(?:missing|vanished|lost)\s+package\b/i.test(text) ? 'established' : 'inferred',
      tags: ['package', 'premise', 'recap'],
    });
    facts.push({
      factId: 'unknown-package-whereabouts',
      label: "the package's whereabouts",
      summary: "Where the package is, and who holds it, is not yet established.",
      status: 'unknown',
      tags: ['package', 'unknown', 'recap'],
    });
  }

  // Named NPCs only from true premise text — never from banners or player-echoed chapters.
  if (allowNamedNpcs) {
    const mara = text.match(/\b(Mara(?:\s+Venn)?)\b/);
    if (mara !== null) {
      facts.push({
        factId: 'premise-mara',
        label: mara[1]!,
        summary: `${mara[1]} is named in the authored premise. Presence at the table is separate — do not treat them as here unless the scene established them.`,
        status: 'established',
        tags: ['mara', 'npc', 'premise', 'recap'],
      });
    }
  }

  if (/\b(?:silver\s+)?key\b/i.test(text)) {
    facts.push({
      factId: 'premise-key',
      label: 'a key',
      summary: /\bsilver\s+key\b/i.test(text)
        ? 'A silver key is mentioned in the premise. It is not automatically in your pack unless inventory shows it.'
        : 'A key is mentioned in the premise. Confirm it on your sheet or in the scene before using it.',
      status: 'inferred',
      tags: ['key', 'premise', 'item'],
    });
  }

  if (facts.length === 0 && text.length > 0) {
    facts.push({
      factId: 'premise-hook',
      label: 'your reason for being here',
      summary: text.length > 220 ? `${text.slice(0, 217)}…` : text,
      status: 'established',
      tags: ['premise', 'recap'],
    });
  }

  return facts;
}

export function mergeCampaignFacts(
  ...groups: readonly (readonly CampaignFactRecord[])[]
): readonly CampaignFactRecord[] {
  const byId = new Map<string, CampaignFactRecord>();
  for (const group of groups) {
    for (const fact of group) {
      const prior = byId.get(fact.factId);
      if (prior === undefined) {
        byId.set(fact.factId, fact);
        continue;
      }
      // Prefer established over inferred/unknown.
      const rank = (status: FactEpistemicStatus): number =>
        status === 'established' ? 2 : status === 'inferred' ? 1 : 0;
      if (rank(fact.status) >= rank(prior.status)) {
        byId.set(fact.factId, fact);
      }
    }
  }
  return [...byId.values()];
}

export function answerFromCampaignFacts(options: {
  readonly facts: readonly CampaignFactRecord[];
  readonly queryText: string;
}): CampaignFactAnswer {
  const query = options.queryText.toLowerCase();
  const tagged = options.facts.filter((fact) => {
    if (fact.tags.some((tag) => query.includes(tag))) {
      return true;
    }
    if (query.includes(fact.label.toLowerCase())) {
      return true;
    }
    return /\b(?:recap|remind|know|why\s+(?:am|are)\s+i\s+here|established)\b/i.test(
      options.queryText,
    );
  });
  const pool = tagged.length > 0 ? tagged : options.facts.filter((fact) => fact.tags.includes('recap'));
  const knownSummaries = pool
    .filter((fact) => fact.status === 'established')
    .map((fact) => fact.summary);
  const inferredSummaries = pool
    .filter((fact) => fact.status === 'inferred')
    .map((fact) => fact.summary);
  const unknownLabels = pool
    .filter((fact) => fact.status === 'unknown')
    .map((fact) => fact.label);

  const parts: string[] = [];
  if (knownSummaries.length > 0) {
    parts.push(`Established: ${knownSummaries.join(' ')}`);
  }
  if (inferredSummaries.length > 0) {
    parts.push(`Inferred (not confirmed): ${inferredSummaries.join(' ')}`);
  }
  if (unknownLabels.length > 0) {
    parts.push(`Unknown: ${unknownLabels.join(', ')} — do not invent detail.`);
  }
  if (parts.length === 0) {
    parts.push(
      'Nothing further is established on the table for that question. Declare how you investigate, or ask about something already in the scene.',
    );
  }

  return {
    knownSummaries,
    inferredSummaries,
    unknownLabels,
    playerFacingBody: parts.join(' '),
  };
}

/** Reject unsupported player-asserted items (e.g. invented silver key). */
export function rejectUnsupportedItemClaim(options: {
  readonly claimText: string;
  readonly inventoryNames: readonly string[];
  readonly facts: readonly CampaignFactRecord[];
}): string | null {
  const text = options.claimText.toLowerCase();
  if (!/\b(?:key|silver\s+key)\b/i.test(text)) {
    return null;
  }
  const hasKey = options.inventoryNames.some((name) => /\bkey\b/i.test(name));
  const factAllows = options.facts.some(
    (fact) =>
      fact.tags.includes('key') &&
      (fact.status === 'established' || fact.status === 'inferred'),
  );
  if (hasKey) {
    return null;
  }
  if (factAllows) {
    return 'A key is only mentioned in the premise — it is not in your inventory on the table. Find it in play before you use it.';
  }
  return 'No key is established in your inventory or the scene. Do not invent one.';
}


/** Reject invented NPC handoffs / possessions before mechanics are chosen. */
export function rejectUnsupportedPremiseClaim(options: {
  readonly claimText: string;
  readonly knownNpcNames: readonly string[];
  readonly inventoryNames: readonly string[];
  readonly facts: readonly CampaignFactRecord[];
}): string | null {
  const itemReject = rejectUnsupportedItemClaim({
    claimText: options.claimText,
    inventoryNames: options.inventoryNames,
    facts: options.facts,
  });
  if (itemReject !== null) {
    return itemReject;
  }
  const text = options.claimText;
  const handoff =
    /\b(?:handed\s+(?:me\s+)?over|gave\s+me|passed\s+me|from\s+)\b/i.test(text) &&
    /\b(?:key|letter|package|parcel)\b/i.test(text);
  if (!handoff) {
    return null;
  }
  const named = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g) ?? [];
  for (const candidate of named) {
    if (/^(The|A|An|I|If|Then|East|West|North|South)$/i.test(candidate)) {
      continue;
    }
    const known = options.knownNpcNames.some(
      (name) =>
        name.toLowerCase() === candidate.toLowerCase() || npcNamesMatch(name, candidate),
    );
    const factNamed = options.facts.some((fact) =>
      fact.label.toLowerCase().includes(candidate.toLowerCase()),
    );
    // Premise-named NPCs still do not authorize unestablished handoffs at the table.
    if (!known) {
      return `${candidate} is not established as present at this table, so no handoff or possession from them is in play. Declare what you do with what the scene already shows.`;
    }
    if (factNamed && /\b(?:handed|gave|passed)\b/i.test(options.claimText)) {
      return `${candidate} is only named in the premise — they are not established as present, so no handoff is in play. Use what the scene already shows.`;
    }
  }
  return null;
}
