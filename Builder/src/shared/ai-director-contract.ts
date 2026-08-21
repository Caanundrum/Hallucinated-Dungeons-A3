/**
 * AI Director gateway contracts — Phase 4.
 *
 * Role-isolated payloads, Intent Intercept NL path, mechanics-first narration,
 * kill switch, and Payload Manifests. Local Arena uses a deterministic
 * Director simulator so certification does not depend on live LLM quotas;
 * the gateway boundary is the production path Milestone providers plug into.
 */

import type { DirectorIdentity, DirectorPersonality } from './campaign-contract.js';
import type { NarrationDensity } from './settings-contract.js';

export const AI_ROLES = [
  'intent_interpreter',
  'director_address',
  'narrator',
  'bounded_ruling',
] as const;
export type AiRole = (typeof AI_ROLES)[number];

export const AI_CHANNEL_CLASSES = [
  'party_chat_ooc',
  'speak_as_character',
  'rules_desk',
  'director_address',
  'action_composer',
  'chronicle',
  'hidden_facts',
] as const;
export type AiChannelClass = (typeof AI_CHANNEL_CLASSES)[number];

export interface AiPayloadManifest {
  readonly manifestId: string;
  readonly role: AiRole;
  readonly campaignId: string;
  readonly sourceType: string;
  readonly audience: 'actor' | 'table' | 'private_director';
  readonly includedIds: readonly string[];
  readonly omittedChannelClasses: readonly AiChannelClass[];
  readonly visibleFactScope: 'actor_visible' | 'table_visible' | 'none';
  readonly retentionPolicy: 'session_ephemeral' | 'campaign_audit';
  readonly destination: AiRole;
  readonly directorIdentity: DirectorIdentity;
  readonly directorPersonality: DirectorPersonality;
  readonly createdAt: string;
}

export interface DirectorNarrationProjection {
  readonly narrationId: string;
  readonly campaignId: string;
  readonly body: string;
  readonly mechanicsFirstSummary: string;
  readonly humorApplied: boolean;
  readonly fallbackUsed: boolean;
  /** Player-controlled narration length applied to this beat (Section 25 Phase 5). */
  readonly narrationDensity: NarrationDensity;
  readonly directorIdentity: DirectorIdentity;
  readonly directorIdentityLabel: string;
  readonly directorPersonality: DirectorPersonality;
  readonly avatarKey: string;
  readonly manifest: AiPayloadManifest;
  readonly createdAt: string;
}

export interface DirectorAddressResponse {
  readonly responseId: string;
  readonly campaignId: string;
  readonly body: string;
  readonly mutatesState: false;
  /** Locked campaign DM display name (Veyra / Garrick). */
  readonly directorIdentityLabel: string;
  readonly directorIdentity: DirectorIdentity;
  readonly directorPersonality: DirectorPersonality;
  /** Ask-the-DM consults use the rules-arbiter role when the question is mechanical. */
  readonly consultMode: 'arbiter' | 'scene';
  readonly actionDraftSuggestion: {
    readonly draftId: string;
    readonly summary: string;
    readonly proposedCommandType: 'table.sync' | 'table.move' | 'table.open_door';
  } | null;
  readonly manifest: AiPayloadManifest;
  readonly createdAt: string;
}

export interface IntentInterpretResponse {
  readonly draftId: string;
  readonly campaignId: string;
  readonly summary: string;
  readonly proposedCommandType: 'table.sync' | 'table.move' | 'table.open_door';
  readonly path?: readonly { readonly column: number; readonly row: number }[];
  readonly interceptState: 'awaiting_confirmation';
  readonly source: 'action_composer_nl';
  readonly manifest: AiPayloadManifest;
  readonly createdAt: string;
}

export interface ProviderComplianceEntry {
  readonly providerId: string;
  readonly displayName: string;
  readonly category: 'ai_text' | 'speech_tts' | 'speech_stt' | 'identity';
  readonly localArena: 'deterministic_simulator' | 'emulator' | 'browser_api';
  readonly milestone: 'configured_provider' | 'google_oauth' | 'browser_api';
  readonly ageRegionGate: 'none' | 'conditional';
  readonly notes: string;
}
