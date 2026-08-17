/**
 * Deterministic Local Arena AI Director gateway — Phase 4.
 *
 * Production boundary: every Director call builds a Payload Manifest, injects
 * locked Veyra/Garrick personality, omits Party Chat OOC by default, and
 * refuses work when the campaign AI kill switch is enabled. Live LLM providers
 * plug into this same gateway in Milestone; Local Arena certifies the boundary
 * with a deterministic simulator.
 */

import { createHash, randomUUID } from 'node:crypto';

import type { Firestore } from 'firebase-admin/firestore';

import type {
  DirectorIdentity,
  DirectorPersonality,
} from '../../shared/campaign-contract.js';
import { DIRECTOR_IDENTITY_LABELS, DIRECTOR_PERSONALITY_LABELS } from '../../shared/campaign-contract.js';
import type {
  AiChannelClass,
  AiPayloadManifest,
  AiRole,
  DirectorAddressResponse,
  DirectorNarrationProjection,
  IntentInterpretResponse,
  ProviderComplianceEntry,
} from '../../shared/ai-director-contract.js';
import type { NarrationDensity } from '../../shared/settings-contract.js';
import { getAiKillSwitch } from '../admin/admin-service.js';
import { COLLECTIONS } from '../persistence/firestore.js';
import { readPlayerSettings } from '../settings/player-settings.js';

const OMITTED_DEFAULT: readonly AiChannelClass[] = [
  'party_chat_ooc',
  'hidden_facts',
  'rules_desk',
];

export class AiDirectorUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiDirectorUnavailableError';
  }
}

export const PROVIDER_COMPLIANCE_REGISTRY: readonly ProviderComplianceEntry[] = [
  {
    providerId: 'local_deterministic_director',
    displayName: 'Local Deterministic Director',
    category: 'ai_text',
    localArena: 'deterministic_simulator',
    milestone: 'configured_provider',
    ageRegionGate: 'none',
    notes: 'Certification path for Intent Intercept, Address, and narration without live LLM quotas.',
  },
  {
    providerId: 'browser_speech_synthesis',
    displayName: 'Browser Speech Synthesis (TTS)',
    category: 'speech_tts',
    localArena: 'browser_api',
    milestone: 'browser_api',
    ageRegionGate: 'none',
    notes: 'Player-optional TTS of already-visible text only.',
  },
  {
    providerId: 'browser_speech_recognition',
    displayName: 'Browser Speech Recognition (STT)',
    category: 'speech_stt',
    localArena: 'browser_api',
    milestone: 'browser_api',
    ageRegionGate: 'none',
    notes: 'Dictation produces editable unsent drafts only; never auto-submits.',
  },
  {
    providerId: 'google_sign_in',
    displayName: 'Google Sign-In',
    category: 'identity',
    localArena: 'emulator',
    milestone: 'google_oauth',
    ageRegionGate: 'conditional',
    notes: 'Only player-facing hosted identity. Local Arena may still use development identities until cutover.',
  },
];

function manifestId(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24);
}

function buildManifest(input: {
  readonly role: AiRole;
  readonly campaignId: string;
  readonly sourceType: string;
  readonly audience: AiPayloadManifest['audience'];
  readonly includedIds: readonly string[];
  readonly visibleFactScope: AiPayloadManifest['visibleFactScope'];
  readonly directorIdentity: DirectorIdentity;
  readonly directorPersonality: DirectorPersonality;
}): AiPayloadManifest {
  const createdAt = new Date().toISOString();
  return {
    manifestId: manifestId([input.role, input.campaignId, createdAt, randomUUID()]),
    role: input.role,
    campaignId: input.campaignId,
    sourceType: input.sourceType,
    audience: input.audience,
    includedIds: input.includedIds,
    omittedChannelClasses: OMITTED_DEFAULT,
    visibleFactScope: input.visibleFactScope,
    retentionPolicy: 'campaign_audit',
    destination: input.role,
    directorIdentity: input.directorIdentity,
    directorPersonality: input.directorPersonality,
    createdAt,
  };
}

function humorLine(personality: DirectorPersonality): string {
  switch (personality) {
    case 'sassy_companion':
      return ' The Director adds a light jab at the furniture, not the party.';
    case 'dry_storyteller':
      return ' A dry aside notes that luck remains undetermined.';
    case 'dramatic_chronicler':
      return ' The moment hangs a beat longer than comfort.';
    case 'friendly_adventurer':
      return ' A warm aside keeps the table invited in.';
    case 'encouraging_guide':
      return ' A patient reminder names the safe options still open.';
    case 'seasoned_host':
    default:
      return ' A lightly knowing beat lands, then control returns to the table.';
  }
}

/**
 * Extra sensory-detail sentence layered on top of `humorLine` for the
 * `cinematic` narration density (Section 25 Phase 5). Never introduces new
 * mechanical state — it only dresses the already-committed mechanics summary.
 */
function cinematicLine(personality: DirectorPersonality): string {
  switch (personality) {
    case 'sassy_companion':
      return ' The room holds its breath just long enough to be dramatic about it.';
    case 'dry_storyteller':
      return ' Dust settles, torchlight flickers, and the scene resets around the result.';
    case 'dramatic_chronicler':
      return ' Shadows stretch across the stone as the consequence settles into the scene.';
    case 'friendly_adventurer':
      return ' The party trades a glance, already imagining what happens next.';
    case 'encouraging_guide':
      return ' The scene settles, giving everyone a clear beat to plan the next move.';
    case 'seasoned_host':
    default:
      return ' The Director lets the moment breathe before the table presses on.';
  }
}

/** Builds narration body text for the given density, without inventing state. */
function composeNarrationBody(
  mechanicsSummary: string,
  personality: DirectorPersonality,
  density: NarrationDensity,
): { readonly body: string; readonly humorApplied: boolean } {
  if (density === 'concise') {
    return { body: mechanicsSummary, humorApplied: false };
  }
  if (density === 'cinematic') {
    return {
      body: `${mechanicsSummary}${humorLine(personality)}${cinematicLine(personality)}`,
      humorApplied: true,
    };
  }
  return { body: `${mechanicsSummary}${humorLine(personality)}`, humorApplied: true };
}

async function requireAiEnabled(firestore: Firestore): Promise<void> {
  if (await getAiKillSwitch(firestore)) {
    throw new AiDirectorUnavailableError(
      'The campaign AI kill switch is enabled. Mechanical play continues without Director AI.',
    );
  }
}

async function loadDirectorConfig(
  firestore: Firestore,
  campaignId: string,
): Promise<{
  identity: DirectorIdentity;
  personality: DirectorPersonality;
  avatarKey: string;
}> {
  const snap = await firestore.collection(COLLECTIONS.campaigns).doc(campaignId).get();
  if (!snap.exists) {
    throw new AiDirectorUnavailableError('Campaign not found for Director gateway.');
  }
  const data = snap.data() as {
    directorIdentity?: string;
    directorPersonality?: string;
    directorAvatarKey?: string;
  };
  const identity = (data.directorIdentity ?? 'veyra') as DirectorIdentity;
  const personality = (data.directorPersonality ?? 'seasoned_host') as DirectorPersonality;
  return {
    identity,
    personality,
    avatarKey: data.directorAvatarKey ?? `${identity}:${personality}`,
  };
}

export async function interpretNaturalLanguageIntent(options: {
  readonly firestore: Firestore;
  readonly campaignId: string;
  readonly accountId: string;
  readonly text: string;
  readonly moveTarget?: { column: number; row: number } | null;
}): Promise<IntentInterpretResponse> {
  await requireAiEnabled(options.firestore);
  const director = await loadDirectorConfig(options.firestore, options.campaignId);
  const text = options.text.trim().toLowerCase();
  let proposedCommandType: IntentInterpretResponse['proposedCommandType'] = 'table.sync';
  let summary =
    'Intent Intercept draft: commit a table sync from your natural-language declaration.';
  let path: IntentInterpretResponse['path'];

  if (/(move|walk|go|step|approach)/.test(text) && options.moveTarget) {
    proposedCommandType = 'table.move';
    path = [options.moveTarget];
    summary = `Intent Intercept draft: move to column ${options.moveTarget.column}, row ${options.moveTarget.row} (interpreted from your words).`;
  } else if (/(open|unlock|push).*(door|gate)/.test(text)) {
    proposedCommandType = 'table.open_door';
    summary =
      'Intent Intercept draft: open the selected door. Confirm to submit through Timing Authority.';
  } else if (/(attack|strike|hit|cast|spell)/.test(text)) {
    summary =
      'Intent Intercept draft: your words sound combat-bound. Confirm a table sync first, then use the combat controls — this gateway will not invent attack resolution.';
    proposedCommandType = 'table.sync';
  }

  const createdAt = new Date().toISOString();
  const manifest = buildManifest({
    role: 'intent_interpreter',
    campaignId: options.campaignId,
    sourceType: 'action_composer_nl',
    audience: 'actor',
    includedIds: [options.accountId],
    visibleFactScope: 'actor_visible',
    directorIdentity: director.identity,
    directorPersonality: director.personality,
  });

  return {
    draftId: randomUUID(),
    campaignId: options.campaignId,
    summary: `${summary} (${DIRECTOR_IDENTITY_LABELS[director.identity]} · ${DIRECTOR_PERSONALITY_LABELS[director.personality]})`,
    proposedCommandType,
    ...(path !== undefined ? { path } : {}),
    interceptState: 'awaiting_confirmation',
    source: 'action_composer_nl',
    manifest,
    createdAt,
  };
}

export async function answerDirectorAddress(options: {
  readonly firestore: Firestore;
  readonly campaignId: string;
  readonly accountId: string;
  readonly text: string;
}): Promise<DirectorAddressResponse> {
  await requireAiEnabled(options.firestore);
  const director = await loadDirectorConfig(options.firestore, options.campaignId);
  const text = options.text.trim();
  const lower = text.toLowerCase();
  const actionable = /(pull|attack|move|cast|open the door|i (go|run|strike))/.test(lower);
  const createdAt = new Date().toISOString();
  const manifest = buildManifest({
    role: 'director_address',
    campaignId: options.campaignId,
    sourceType: 'director_address',
    audience: 'private_director',
    includedIds: [options.accountId],
    visibleFactScope: 'actor_visible',
    directorIdentity: director.identity,
    directorPersonality: director.personality,
  });

  const body = actionable
    ? `${DIRECTOR_IDENTITY_LABELS[director.identity]} hears you, but will not change the table from Director Address. An Action Draft Suggestion is available — open it in Declare Action and confirm Intent Intercept if you mean to act.`
    : `${DIRECTOR_IDENTITY_LABELS[director.identity]} (${DIRECTOR_PERSONALITY_LABELS[director.personality]}) answers without changing state: the table remains as you left it. Ask Rules Desk for mechanics; use Declare Action for consequential intent.`;

  return {
    responseId: randomUUID(),
    campaignId: options.campaignId,
    body,
    mutatesState: false,
    actionDraftSuggestion: actionable
      ? {
          draftId: randomUUID(),
          summary: `Suggested from Director Address: ${text.slice(0, 120)}`,
          proposedCommandType: 'table.sync',
        }
      : null,
    manifest,
    createdAt,
  };
}

export async function narrateVisibleBeat(options: {
  readonly firestore: Firestore;
  readonly campaignId: string;
  readonly accountId: string;
  readonly mechanicsSummary: string;
}): Promise<DirectorNarrationProjection> {
  await requireAiEnabled(options.firestore);
  const director = await loadDirectorConfig(options.firestore, options.campaignId);
  const playerSettings = await readPlayerSettings({
    firestore: options.firestore,
    accountId: options.accountId,
  });
  const narrationDensity = playerSettings.reserved.narrationDensity;
  const createdAt = new Date().toISOString();
  const { body, humorApplied } = composeNarrationBody(
    options.mechanicsSummary,
    director.personality,
    narrationDensity,
  );
  const manifest = buildManifest({
    role: 'narrator',
    campaignId: options.campaignId,
    sourceType: 'mechanics_first_narration',
    audience: 'table',
    includedIds: [options.accountId],
    visibleFactScope: 'table_visible',
    directorIdentity: director.identity,
    directorPersonality: director.personality,
  });

  return {
    narrationId: randomUUID(),
    campaignId: options.campaignId,
    body,
    mechanicsFirstSummary: options.mechanicsSummary,
    humorApplied,
    fallbackUsed: false,
    narrationDensity,
    directorIdentity: director.identity,
    directorPersonality: director.personality,
    avatarKey: director.avatarKey,
    manifest,
    createdAt,
  };
}
