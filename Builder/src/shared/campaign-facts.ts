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
]);

/** Interpersonal verbs indicating an active quest-giving contact present in the opening scene. */
export const INTERPERSONAL_CONTACT_VERB_RE =
  /^\s*(?:,\s*[^,.;!?]{1,70},\s*)?(?:asks|asked|hires|hired|begs|begged|warns|warned|tells|told|implores|implored|summons|summoned|recruits|recruited|tasks|tasked|approaches|approached|greets|greeted|meets|met|pleads|pleaded|offers|offered|commissions|commissioned|entrusts|entrusted|presses|pressed|hands|handed|gives|gave|urges|urged|whispers|whispered|explains|explained|bids|bade|wants|wanted|needs|needed|waits|is\s+waiting|awaits)\b/i;

/** Disappearance or victim predicates indicating an NPC is missing/absent from the opening scene. */
export const DISAPPEARANCE_PREDICATE_RE =
  /\b(?:vanished|disappeared|went\s+missing|is\s+missing|was\s+kidnapped|was\s+taken|was\s+abducted|has\s+not\s+returned|never\s+returned|was\s+lost|was\s+captured|was\s+seized|fell\s+silent|failed\s+to\s+return|kidnapped|captive|hostage)\b/i;

export function isCompoundPlaceWord(word: string): boolean {
  const cleaned = word.trim().replace(/^['’]+|['’]+$/g, '');
  if (cleaned.length < 5) {
    return false;
  }
  return COMPOUND_PLACE_SUFFIX_RE.test(cleaned);
}

/**
 * Expands a stored or candidate NPC name into all natural reference forms:
 * "Warden <First> <Last>", "<First> <Last>", "Warden <First>", "<First>", and "<Last>".
 */
export function expandNpcNameVariants(
  rawName: string,
  roleHint?: string,
): readonly string[] {
  const cleaned = rawName
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+[—–-]\s+.*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length === 0) {
    return [];
  }
  const words = cleaned.split(/\s+/);
  const firstLower = (words[0] ?? '').toLowerCase().replace(/\.$/, '');
  let titleWord: string | null = null;
  let nameWords: string[] = words;

  if (words.length >= 2 && PERSONAL_ROLE_TITLES.has(firstLower)) {
    titleWord = words[0]!.replace(/\.$/, '');
    nameWords = words.slice(1);
  } else if (typeof roleHint === 'string' && roleHint.trim().length > 0) {
    const roleFirst = roleHint.trim().split(/\s+/)[0]?.replace(/[^A-Za-z]/g, '') ?? '';
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
  if (nameWords.length > 0) {
    pushVariant(nameWords.join(' '));
  }
  if (titleWord !== null && nameWords.length >= 2) {
    pushVariant(`${titleWord} ${nameWords[0]}`);
  }
  if (nameWords.length >= 1 && nameWords[0]!.length >= 3) {
    pushVariant(nameWords[0]!);
  }
  if (nameWords.length >= 2 && nameWords[nameWords.length - 1]!.length >= 3) {
    pushVariant(nameWords[nameWords.length - 1]!);
  }
  pushVariant(cleaned);
  return results;
}

/**
 * Returns true when a stored NPC name and a player/premise candidate reference refer to the same NPC
 * across any natural form ("Warden <First> <Last>", "Warden <First>", "<First> <Last>", "<First>").
 */
export function npcNamesMatch(
  storedName: string,
  candidateRef: string,
  roleHint?: string,
): boolean {
  const storedVariants = expandNpcNameVariants(storedName, roleHint).map((v) => v.toLowerCase());
  const candidateVariants = expandNpcNameVariants(candidateRef).map((v) => v.toLowerCase());
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
