/**
 * Presentation Cue Plan derivation — Phase 5.
 *
 * Blueprint ownership: Section 25 Phase 5 build scope item 3 ("Presentation
 * Cue Plans") and the invariant kernel ("Presentation Cue Plans are
 * server-derived from committed events — AI prose cannot trigger FX/audio/
 * state"). Cues are derived only from the canonical committed table/rules
 * event log already returned by `fetchTableState` — the same server-authored
 * mechanics summary text shown in the Chronicle. Director narration text is
 * never consulted here, so an AI-authored sentence can never trigger a cue.
 */

import type { Firestore } from 'firebase-admin/firestore';

import type { TableEventProjection } from '../../shared/command-contract.js';
import {
  MAX_CONCURRENT_CUE_SOUNDS,
  MAX_CUE_SOUND_DURATION_MS,
  type PresentationCueKind,
  type PresentationCuePlanProjection,
  type PresentationCueProjection,
} from '../../shared/presentation-cue-contract.js';
import { fetchTableState } from '../table/commands.js';

/** How many of the most recent committed events to consider for cue derivation. */
const CUE_EVENT_WINDOW = 20;

function classifyDeathSave(summary: string): PresentationCueKind {
  if (summary.includes('Death Save dead')) {
    return 'creature_down';
  }
  if (summary.includes('Death Save revived') || summary.includes('Death Save stable')) {
    return 'creature_revived';
  }
  return 'death_save_made';
}

/** Attack-shaped summaries ("X hit Y…", "X missed Y…", "…dealing/dealt N damage…"). */
function classifyAttackLike(summary: string): PresentationCueKind {
  if (summary.includes('(critical hit)')) {
    return 'critical_hit';
  }
  if (summary.includes('missed') || summary.includes('but missed')) {
    return 'attack_miss';
  }
  return 'attack_hit';
}

/**
 * Maps one committed table/rules event to a cue kind, or `null` when the
 * event type has no presentation cue. Exported for direct unit coverage
 * (Section 25 Phase 5) — the mapping is pure and Firestore-free, so tests do
 * not need a fixture Firestore to prove it never reads Director prose.
 */
export function classifyEvent(event: TableEventProjection): PresentationCueKind | null {
  const summary = event.summary ?? '';
  switch (event.eventType) {
    case 'table.token_moved':
      return 'token_moved';
    case 'table.door_opened':
      return 'door_opened';
    case 'combat.attack_resolved':
      return classifyAttackLike(summary);
    case 'combat.spell_resolved':
      return 'spell_cast';
    case 'combat.reaction_resolved':
      return summary.includes('Shield') ? 'spell_cast' : classifyAttackLike(summary);
    case 'combat.death_save_resolved':
      return classifyDeathSave(summary);
    case 'combat.training_drop_resolved':
      return 'creature_down';
    case 'combat.short_rest_completed':
    case 'combat.long_rest_completed':
      return 'rest_completed';
    case 'progression.level_gained':
      return 'level_up';
    default:
      return null;
  }
}

function cueLabel(kind: PresentationCueKind, summary: string): string {
  return summary.length > 0 ? summary : kind.replace(/_/g, ' ');
}

/** Derives a Presentation Cue Plan from the campaign's canonical committed event log. */
export async function fetchPresentationCuePlan(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
}): Promise<PresentationCuePlanProjection> {
  const { firestore, accountId, campaignId } = options;
  const tableState = await fetchTableState({ firestore, accountId, campaignId });
  const recent = tableState.recentEvents.slice(-CUE_EVENT_WINDOW);

  const cues: PresentationCueProjection[] = [];
  for (const event of recent) {
    const kind = classifyEvent(event);
    if (kind === null) {
      continue;
    }
    cues.push({
      cueId: `cue:${event.eventId}`,
      kind,
      sourceEventId: event.eventId,
      sourceEventSequence: event.eventSequence,
      dedupeKey: `${campaignId}:${event.eventId}`,
      label: cueLabel(kind, event.summary ?? ''),
      createdAt: event.committedAt,
    });
  }

  return {
    campaignId,
    stateVersion: tableState.stateVersion,
    cues,
    maxConcurrentSounds: MAX_CONCURRENT_CUE_SOUNDS,
    maxCueSoundDurationMs: MAX_CUE_SOUND_DURATION_MS,
  };
}
