/**
 * Director Prose Scrubbers — Pure Post-Processing String Filters.
 *
 * Enforces authoritative rules truth on LLM narration output:
 * - Prevents false scene departure when stepping through same-scene doors
 * - Prevents stale door-close narration from referencing open passages
 * - Enforces hands-off / no-touch inspect declarations
 * - Strips false trap certainty ("guaranteed completely safe")
 * - Keeps inspect scope targeted to the confirmed object
 * - Cleans internal engine coordinates (c4r3) from player-facing copy
 * - Prevents hallucinated loot in unauthored containers
 * - Ensures closed doors are never described as wide open
 */

import { canonicalDoorFeatureKey } from '../../shared/play-authority-contract.js';

/** Extract the named inspect/trap target from mechanics prose (FQA-003). */
function namedTargetFromMechanics(mechanicsSummary: string): string | null {
  const mechanics = mechanicsSummary.trim();
  const targetMatch =
    /Trap search on (?:the\s+)?([^.——\n(]+?)(?:\s*\(|\s*—|\s*-|\.|$)/i.exec(mechanics) ??
    /(?:no trap found on|cannot tell if)\s+(?:the\s+)?([^.!?\n]+?)(?:\s+is trapped)?[.!]?$/i.exec(
      mechanics,
    ) ??
    /(?:inspect(?:ing)?|examining|examined|search(?:ing)?)\s+(?:the\s+)?([^.——\n(]+?)(?:\s*(?:—|-|DC|\(|\.|,)|$)/i.exec(
      mechanics,
    ) ??
    /Ready to (?:inspect|search)\s+(?:the\s+)?([^.——\n(]+?)(?:\s+for traps)?/i.exec(mechanics) ??
    /\b((?:wooden\s+)?door(?:way)?(?:\s+(?:east|west|north|south))?)\b/i.exec(mechanics);
  const rawTarget = targetMatch?.[1]?.trim();
  if (rawTarget === undefined || rawTarget.length === 0) {
    return null;
  }
  const target = rawTarget
    .replace(/\s+/g, ' ')
    .replace(/\s+$/g, '')
    .replace(/^the\s+/i, '');
  if (
    !/\bdoor(?:way)?\b|\bfeature\b|\bbench\b|\bcounter\b|\blamp\b|\bhearth\b/i.test(target) &&
    !/\bwooden\b/i.test(target)
  ) {
    return null;
  }
  if (/^confirmed target$/i.test(target)) {
    return null;
  }
  return target;
}

/**
 * Stepping through a doorway on the same map keeps the current scene — describe the step, not a departure.
 */
export function scrubFalseSceneDeparture(body: string, mechanicsSummary: string): string {
  const mechanics = mechanicsSummary.trim();
  const sameSceneStep =
    /\bStepped(?: back)? through the open doorway\b/i.test(mechanics) ||
    /\bOpened the door and stepped through the doorway\b/i.test(mechanics);
  const sceneChangeClaimed =
    /\bscene change\b|\bleft .+ for\b|\bentered a new (?:scene|location|chamber)\b/i.test(mechanics);
  if (!sameSceneStep || sceneChangeClaimed) {
    return body;
  }
  const sceneMatch = /\bin ([^.]+)\.\s*(?:Same scene|Current scene)/i.exec(mechanics);
  const sceneName = sceneMatch?.[1]?.trim() ?? null;
  let scrubbed = body
    .replace(
      /\b(?:you |she |he |they )?(?:leave|leaves|left|leaving)\s+(?:the\s+)?[^.!?\n]{0,40}\s+behind\b[^.!?\n]*/gi,
      '',
    )
    .replace(
      /\b(?:you |she |he |they )?(?:abandon|abandons|abandoned)\s+(?:the\s+)?[^.!?\n]{0,40}\b[^.!?\n]*/gi,
      '',
    )
    .replace(
      /\b(?:arrive|arrives|arrived|enter|enters|entered)\s+(?:a |an |the )?(?:new |different )?(?:location|chamber|room|scene)\b[^.!?\n]*/gi,
      '',
    );
  if (sceneName !== null) {
    const escaped = sceneName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    scrubbed = scrubbed.replace(
      new RegExp(
        `\\b(?:leave|leaves|left|leaving)\\s+${escaped}\\b[^.!?\\n]*`,
        'gi',
      ),
      '',
    );
  }
  return scrubbed.replace(/\s{2,}/g, ' ').replace(/\s+([.!?])/g, '$1').trim() || mechanics;
}

/**
 * Close-door mechanics must not inherit prior trap/open-way prose from recent events.
 * Recheck 3: successful close received trap-inspection narration that contradicted closed leaf.
 */
export function scrubStaleDoorCloseNarration(body: string, mechanicsSummary: string): string {
  const mechanics = mechanicsSummary.trim();
  const isClose =
    /\bClosed\b/i.test(mechanics) &&
    /\b(door|doorway|leaf)\b/i.test(mechanics) &&
    !/\bOpened\b/i.test(mechanics);
  if (!isClose) {
    return body;
  }
  const trapOrInspectProse =
    /\b(trap|hinge|mechanism|inspect(?:ing|ed)?|no mechanisms|spot(?:s|ted)? no)\b/i.test(body);
  const openWayContradiction =
    /\b(open way|passage ahead is clear|doorway (?:is |stands )?open|already open)\b/i.test(body);
  if (!trapOrInspectProse && !openWayContradiction) {
    // Still ensure closed-leaf vocabulary is present when the model drifted.
    if (/\bclosed\b/i.test(body) && /\b(leaf|door|doorway|unlock)/i.test(body)) {
      return body;
    }
  }
  // Prefer the authoritative close seed when narration drifted to a prior beat.
  return mechanics;
}

/**
 * When the player declared a no-touch / without-touching inspect, strip contact prose (R4-03).
 */
export function scrubNoTouchConstraint(body: string, mechanicsSummary: string): string {
  const noTouch =
    /\bwithout touching\b|\bno[- ]touch\b|\bdo not touch\b|\bdon't touch\b|\bhands off\b|\bfrom a (?:safe )?distance\b|\blook(?:ing)? (?:only|closely) without\b/i.test(
      mechanicsSummary,
    );
  if (!noTouch) {
    return body;
  }
  let scrubbed = body
    .replace(
      /\b(?:you |she |he |they )?(?:run|runs|ran|running)\s+(?:your |their |his |her )?fingers?\b[^.!?\n]*/gi,
      'You study it carefully without touching',
    )
    .replace(
      /\b(?:feel|feels|felt|feeling|touch|touches|touched|touching|press|presses|pressed|probe|probes|probed|brush|brushes|brushed)\b[^.!?\n]{0,40}\b(?:frame|hinge|wood|door|surface|latch)\b[^.!?\n]*/gi,
      'trace the outline by eye only',
    )
    .replace(/\balong the frame\b/gi, 'at a careful distance');
  if (/\bfingers?\b|\brun .+ along\b/i.test(scrubbed)) {
    return mechanicsSummary.trim() || scrubbed;
  }
  return scrubbed.replace(/\s{2,}/g, ' ').replace(/\s+([.!?])/g, '$1').trim() || body;
}

/**
 * Trap-search mechanics that report "no trap found" must not become omniscient safety.
 */
export function scrubFalseTrapCertainty(body: string, mechanicsSummary: string): string {
  const mechanics = mechanicsSummary.trim();
  const noTrapFound = /\bno trap found\b/i.test(mechanics);
  const uncertain = /\bcannot tell\b|\bcould not tell\b|\bno sign of\b/i.test(mechanics);
  if (!noTrapFound && !uncertain) {
    return body;
  }
  const named = namedTargetFromMechanics(mechanics) ?? 'confirmed target';
  let scrubbed = body
    .replace(
      /\b(?:completely |entirely |totally )?(?:safe|clear|free of traps|without traps|trap[- ]free)\b[^.!?\n]*/gi,
      'shows no sign of a trap',
    )
    .replace(
      /\b(?:there (?:are|is) )?(?:no traps?(?: here| nearby| in (?:the|this) (?:area|room|chamber))?)\b/gi,
      'you find no sign of a trap',
    )
    .replace(
      /\b(?:confirms?|proves?|guarantees?) (?:the )?(?:area|room|chamber|doorway) (?:is|are) (?:completely )?(?:safe|clear)\b[^.!?\n]*/gi,
      `finds no sign of a trap on the ${named}`,
    );
  return scrubbed.replace(/\s{2,}/g, ' ').replace(/\s+([.!?])/g, '$1').trim() || mechanics;
}

/**
 * One confirmed inspect target must not expand into a room-wide sweep in prose.
 */
export function scrubExpandedInspectScope(body: string, mechanicsSummary: string): string {
  const named = namedTargetFromMechanics(mechanicsSummary);
  if (named === null) {
    return body;
  }
  let scrubbed = body
    .replace(
      /\b(?:timber\s+)?floorboards?(?:,?\s*(?:the\s+)?doorframes?)?(?:,?\s*and\s+(?:the\s+)?(?:nearby\s+)?furnishings?)?\b/gi,
      named,
    )
    .replace(/\b(?:doorframe|furnishings?|nearby furnishings?)\b/gi, named)
    .replace(/\bthe confirmed target\b/gi, `the ${named}`)
    .replace(/\bthe target\b/gi, `the ${named}`)
    .replace(/\bthis area\b/gi, `the ${named}`)
    .replace(/\bthat area\b/gi, `the ${named}`)
    .replace(/\bthe area\b/gi, `the ${named}`)
    .replace(
      /\b(?:the\s+)?(?:entire\s+)?(?:room|chamber|surroundings)\b(?=[^.!?\n]{0,64}\b(?:inspect|examin|search|sweep|probe|spot|find|notice|mechanism))/gi,
      `the ${named}`,
    );
  return scrubbed.replace(/\s{2,}/g, ' ').replace(/\s+([.!?])/g, '$1').trim() || body;
}

/** Strip internal grid ids like c4r3 from player-facing Director prose. */
export function scrubEngineCoordinates(body: string): string {
  return body
    .replace(/\bat\s+c\d+r\d+\b/gi, '')
    .replace(/\b\(c\d+r\d+\)/gi, '')
    .replace(/\bc\d+r\d+\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .trim();
}

/** When an unauthored container opens, prevent hallucinated loot or contents (HD18-12). */
export function scrubInventedContainerContents(body: string, mechanicsSummary: string): string {
  const opensContainer =
    /\b(?:open|opened|inspect|inspects|looking\s+inside|look\s+inside)\b/i.test(mechanicsSummary) &&
    /\b(?:satchel|pack|chest|bag|pouch|box|crate|barrel)\b/i.test(mechanicsSummary);
  if (!opensContainer) {
    return body;
  }
  return body.replace(
    /(?:(?:He|She|They|The\s+\w+|\b\w+\b)\s+)?\b(?:takes?\s+in\s+(?:its|the)\s+contents|sees?\s+what\s+(?:the\s+\w+\s+)?left\s+behind|glimpses?\s+(?:what|the\s+contents)|finds?\s+(?:clues|items|goods|belongings|tools|letters|notes))\b[^.!?]*[.!?]/gi,
    'The container opens smoothly, revealing an empty interior with no items inside.',
  );
}

/** Ensure a closed or unlocked door is never described as wide open (HD18-19). */
export function scrubClosedDoorCalledOpen(body: string, mechanicsSummary: string): string {
  const closedDoor =
    /\b(?:closed|unlocked|locked)\b/i.test(mechanicsSummary) &&
    !/\bopened\b|\bswung wide\b/i.test(mechanicsSummary);
  if (!closedDoor) {
    return body;
  }
  return body.replace(/\ban open wooden door\b/gi, 'a closed wooden door');
}

/** Deduplicates candidate labels for inspection or skills, preserving state hints. */
export function dedupeInspectCandidateLabels(labels: readonly string[]): string[] {
  const preferred = new Map<string, string>();
  for (const label of labels) {
    const trimmed = label.replace(/\s+/g, ' ').trim();
    if (trimmed.length === 0) {
      continue;
    }
    const key = canonicalDoorFeatureKey(trimmed);
    const existing = preferred.get(key);
    if (existing === undefined) {
      preferred.set(key, trimmed);
      continue;
    }
    // Prefer the label that includes mechanical state.
    const existingHasState = /\s+[—-]\s+|\([^)]*(open|closed|locked)/i.test(existing);
    const nextHasState = /\s+[—-]\s+|\([^)]*(open|closed|locked)/i.test(trimmed);
    if (!existingHasState && nextHasState) {
      preferred.set(key, trimmed);
    }
  }
  return [...preferred.values()];
}
