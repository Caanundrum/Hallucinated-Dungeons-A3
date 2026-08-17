/**
 * Presentation Cue Plan contract — Phase 5.
 *
 * Blueprint ownership: Section 25 Phase 5 build scope item 3 ("Presentation
 * Cue Plans") and the invariant kernel ("Presentation Cue Plans are
 * server-derived from committed events — AI prose cannot trigger FX/audio/
 * state"). Cues are derived only from the committed table/rules event log;
 * Director narration text is never a cue source, so an AI-authored sentence
 * can never trigger a sound or a screen effect.
 *
 * Performance budget: the client may play at most
 * {@link MAX_CONCURRENT_CUE_SOUNDS} short Web Audio tones at once, each
 * capped at {@link MAX_CUE_SOUND_DURATION_MS}, so a burst of table events
 * cannot turn into a wall of overlapping noise.
 */

export const PRESENTATION_CUE_KINDS = [
  'attack_hit',
  'attack_miss',
  'critical_hit',
  'spell_cast',
  'door_opened',
  'creature_down',
  'creature_revived',
  'death_save_made',
  'rest_completed',
  'level_up',
  'token_moved',
] as const;
export type PresentationCueKind = (typeof PRESENTATION_CUE_KINDS)[number];

/** Maximum simultaneous short SFX voices the client will play for one cue plan refresh. */
export const MAX_CONCURRENT_CUE_SOUNDS = 3;

/** Longest a single cue tone may play, in milliseconds. */
export const MAX_CUE_SOUND_DURATION_MS = 450;

/** One server-derived presentation cue for a single committed event. */
export interface PresentationCueProjection {
  readonly cueId: string;
  readonly kind: PresentationCueKind;
  readonly sourceEventId: string;
  readonly sourceEventSequence: number;
  /** Stable across repeated fetches of the same event, so the client can skip cues it already played. */
  readonly dedupeKey: string;
  readonly label: string;
  readonly createdAt: string;
}

/** Server-authored cue plan attached to (or fetched alongside) a table state refresh. */
export interface PresentationCuePlanProjection {
  readonly campaignId: string;
  readonly stateVersion: number;
  readonly cues: readonly PresentationCueProjection[];
  readonly maxConcurrentSounds: typeof MAX_CONCURRENT_CUE_SOUNDS;
  readonly maxCueSoundDurationMs: typeof MAX_CUE_SOUND_DURATION_MS;
}

export function isPresentationCueKind(value: unknown): value is PresentationCueKind {
  return typeof value === 'string' && (PRESENTATION_CUE_KINDS as readonly string[]).includes(value);
}
