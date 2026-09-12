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

/** Seed facts from adventure premise text — never invent beyond explicit cues. */
export function extractCampaignFactsFromPremise(premise: string): readonly CampaignFactRecord[] {
  const text = premise.trim();
  if (text.length === 0) {
    return [];
  }
  const facts: CampaignFactRecord[] = [];

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
  }

  const mara = text.match(/\b(Mara(?:\s+Venn)?)\b/);
  if (mara !== null) {
    facts.push({
      factId: 'premise-mara',
      label: mara[1]!,
      summary: `${mara[1]} is named in the premise. Presence at the table is separate — do not treat them as here unless the scene established them.`,
      status: 'established',
      tags: ['mara', 'npc', 'premise', 'recap'],
    });
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
