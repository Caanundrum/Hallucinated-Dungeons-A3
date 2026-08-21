/**
 * Deterministic Local Arena AI Director gateway — Phase 4.
 *
 * Production boundary: every Director call builds a Payload Manifest, injects
 * locked Veyra/Garrick personality, omits Party Chat OOC by default, and
 * refuses work when the campaign AI kill switch is enabled. Live LLM providers
 * plug into this same gateway in Milestone via Gemini on Agent Platform;
 * Local Arena certifies the boundary with a deterministic simulator.
 */

import { createHash, randomUUID } from 'node:crypto';

import type { Firestore } from 'firebase-admin/firestore';

import type {
  DirectorIdentity,
  DirectorPersonality,
} from '../../shared/campaign-contract.js';
import {
  DIRECTOR_IDENTITY_LABELS,
  DIRECTOR_PERSONALITY_LABELS,
  DIRECTOR_PERSONALITY_SUMMARIES,
} from '../../shared/campaign-contract.js';
import type { EnvironmentClass } from '../../shared/contract.js';
import {
  createGeminiDirectorClient,
  type DirectorLlmClient,
} from './gemini-director.js';
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
import { assembleDirectorVisibleContext } from './director-context.js';

const OMITTED_DEFAULT: readonly AiChannelClass[] = [
  'party_chat_ooc',
  'hidden_facts',
  'rules_desk',
];

const ARBITER_CONSTITUTION = [
  'You are the rules arbiter for this campaign, speaking as the selected DM.',
  'Players ask whether a plan is legal or feasible: skills, action economy (Action / Bonus Action / Reaction / movement), spell availability on the sheet, range, and whether the scene supports the attempt.',
  'Use ONLY the AUTHORITATIVE VISIBLE GAME STATE block. If the wall height, DC, or object is not in that block, say the scene has not established it and what the player could do to learn it.',
  'Never invent DCs, roll dice, spend spell slots, move tokens, or declare success or failure.',
  'When a plan would require checks or multiple action economy spends, list them clearly.',
  'If the character lacks a spell, feature, or capacity, say so plainly.',
  'Answer in 3 to 8 short sentences or tight bullets. Lead with the useful ruling.',
  'Do not narrate a new story beat unless needed to clarify presence or reach.',
].join(' ');

const NARRATOR_CONSTITUTION = [
  'You are the in-world narrator for this campaign, speaking as the selected DM.',
  'The mechanics summary is authoritative and final. Narrate what the player experiences from it.',
  'Use the AUTHORITATIVE VISIBLE GAME STATE for spatial awareness, who is present, and atmosphere.',
  'Never invent damage, conditions, hidden facts, or change success into failure (or the reverse).',
  'Write in second person. Keep paragraphs short. Do not open with a title or heading.',
  'If the player tried something not present in the scene state, clarify the gap in-world without granting it.',
].join(' ');

function looksMechanical(text: string): boolean {
  return /(can i|could i|would it|action economy|bonus action|reaction|spell slot|magic missile|climb|athletics|acrobatics|check|save|attack|cast|legal|rules|how many|do i have|proficiency)/i.test(
    text,
  );
}

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
    notes:
      'Local Arena Director path. Hosted Milestone falls back to this simulator if Gemini is unavailable.',
  },
  {
    providerId: 'gemini_agent_platform',
    displayName: 'Gemini (Agent Platform)',
    category: 'ai_text',
    localArena: 'deterministic_simulator',
    milestone: 'configured_provider',
    ageRegionGate: 'none',
    notes:
      'Invite-Only Alpha Director prose via gemini-3.7-flash on Gemini Enterprise Agent Platform in the Firebase project. Never called from Local Arena.',
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
    notes: 'Only player-facing hosted identity. Local Arena may mint development identities; Gold Master artifacts strip that path. This host uses the Auth emulator, not live OAuth.',
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

export interface DirectorLiveOptions {
  readonly environmentClass?: EnvironmentClass;
  readonly firebaseProjectId?: string;
  /** Test override. Ignored unless environmentClass is milestone. */
  readonly llm?: DirectorLlmClient;
}

function liveGeminiEnabled(options: DirectorLiveOptions): boolean {
  return options.environmentClass === 'milestone';
}

async function resolveLiveLlm(options: DirectorLiveOptions): Promise<DirectorLlmClient | null> {
  if (!liveGeminiEnabled(options)) {
    return null;
  }
  if (options.llm !== undefined) {
    return options.llm;
  }
  const projectId = (options.firebaseProjectId ?? '').trim();
  if (projectId.length === 0) {
    return null;
  }
  return createGeminiDirectorClient({ projectId });
}

function directorVoiceBlock(
  identity: DirectorIdentity,
  personality: DirectorPersonality,
): string {
  const name = DIRECTOR_IDENTITY_LABELS[identity];
  const label = DIRECTOR_PERSONALITY_LABELS[personality];
  return `You are ${name}, the Dungeon Master for this Hallucinated Dungeons campaign. Personality: ${label} — ${DIRECTOR_PERSONALITY_SUMMARIES[personality]}.`;
}

const DIRECTOR_SAFETY_RULES = [
  'You never change table state, move tokens, open doors, roll dice, or invent mechanical outcomes.',
  'You never invent hidden facts, secret NPC motives, or information the speaking player cannot see.',
  'Party Chat and out-of-character table talk are not available to you.',
  'If the player describes a consequential action in Ask-the-DM, tell them what it would take and that they must declare it in the Actions thread to resolve it. Do not treat the consult as a completed command.',
].join(' ');

async function tryLiveProse(
  options: DirectorLiveOptions,
  input: { readonly systemInstruction: string; readonly userPrompt: string },
): Promise<string | null> {
  const llm = await resolveLiveLlm(options);
  if (llm === null) {
    return null;
  }
  try {
    return await llm.generateText(input);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown Gemini failure';
    process.stderr.write(`[director-gateway] Gemini unavailable; using simulator. ${detail}\n`);
    return null;
  }
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
} & DirectorLiveOptions): Promise<IntentInterpretResponse> {
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

  const liveSummary = await tryLiveProse(options, {
    systemInstruction: `${directorVoiceBlock(director.identity, director.personality)} ${DIRECTOR_SAFETY_RULES} Rewrite the Intent Intercept summary for the player in one or two sentences. Do not change the proposed command type ${proposedCommandType}. Do not invent a different action.`,
    userPrompt: `Player said: ${options.text.trim()}\nDeterministic summary: ${summary}`,
  });
  if (liveSummary !== null) {
    summary = liveSummary;
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
    summary: liveSummary === null
      ? `${summary} (${DIRECTOR_IDENTITY_LABELS[director.identity]} · ${DIRECTOR_PERSONALITY_LABELS[director.personality]})`
      : summary,
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
} & DirectorLiveOptions): Promise<DirectorAddressResponse> {
  await requireAiEnabled(options.firestore);
  const director = await loadDirectorConfig(options.firestore, options.campaignId);
  const text = options.text.trim();
  const mechanical = looksMechanical(text);
  const consultMode = mechanical ? 'arbiter' : 'scene';
  const role: AiRole = mechanical ? 'bounded_ruling' : 'director_address';
  const context = await assembleDirectorVisibleContext({
    firestore: options.firestore,
    campaignId: options.campaignId,
    accountId: options.accountId,
  });
  const createdAt = new Date().toISOString();
  const manifest = buildManifest({
    role,
    campaignId: options.campaignId,
    sourceType: mechanical ? 'ask_dm_arbiter' : 'ask_dm_scene',
    audience: 'private_director',
    includedIds: context.includedIds,
    visibleFactScope: 'actor_visible',
    directorIdentity: director.identity,
    directorPersonality: director.personality,
  });

  const name = DIRECTOR_IDENTITY_LABELS[director.identity];
  const simulatorBody = mechanical
    ? `${name} weighs the plan against your sheet and the visible scene. ${
        context.text.includes('Active character')
          ? 'If a spell, skill, or action spend is missing from your sheet or the scene has not established the target, say so before you declare the action.'
          : 'Seat a character so the arbiter can read your sheet.'
      } Declare the action in the Actions thread when you are ready — this consult does not resolve it.`
    : `${name} (${DIRECTOR_PERSONALITY_LABELS[director.personality]}) answers from the visible scene only. The table does not move from Ask the DM. Use the Actions thread to declare what you do.`;

  const liveBody = await tryLiveProse(options, {
    systemInstruction: `${directorVoiceBlock(director.identity, director.personality)} ${DIRECTOR_SAFETY_RULES} ${
      mechanical ? ARBITER_CONSTITUTION : `${ARBITER_CONSTITUTION} Also answer scene questions without inventing unseen detail.`
    }`,
    userPrompt: `${context.text}\n\nPlayer ask-the-DM message:\n${text}`,
  });

  return {
    responseId: randomUUID(),
    campaignId: options.campaignId,
    body: liveBody ?? simulatorBody,
    mutatesState: false,
    directorIdentityLabel: name,
    directorIdentity: director.identity,
    directorPersonality: director.personality,
    consultMode,
    actionDraftSuggestion: null,
    manifest,
    createdAt,
  };
}

export async function narrateVisibleBeat(options: {
  readonly firestore: Firestore;
  readonly campaignId: string;
  readonly accountId: string;
  readonly mechanicsSummary: string;
} & DirectorLiveOptions): Promise<DirectorNarrationProjection> {
  await requireAiEnabled(options.firestore);
  const director = await loadDirectorConfig(options.firestore, options.campaignId);
  const playerSettings = await readPlayerSettings({
    firestore: options.firestore,
    accountId: options.accountId,
  });
  const narrationDensity = playerSettings.reserved.narrationDensity;
  const context = await assembleDirectorVisibleContext({
    firestore: options.firestore,
    campaignId: options.campaignId,
    accountId: options.accountId,
  });
  const createdAt = new Date().toISOString();
  const simulated = composeNarrationBody(
    options.mechanicsSummary,
    director.personality,
    narrationDensity,
  );
  const liveBody = await tryLiveProse(options, {
    systemInstruction: `${directorVoiceBlock(director.identity, director.personality)} ${DIRECTOR_SAFETY_RULES} ${NARRATOR_CONSTITUTION} Match narration density "${narrationDensity}" (concise = short; balanced = a beat of flavor; cinematic = richer sensory detail without new facts).`,
    userPrompt: `${context.text}\n\nMechanics summary (authoritative):\n${options.mechanicsSummary}`,
  });
  const body = liveBody ?? simulated.body;
  const humorApplied = liveBody === null ? simulated.humorApplied : narrationDensity !== 'concise';
  const manifest = buildManifest({
    role: 'narrator',
    campaignId: options.campaignId,
    sourceType: 'mechanics_first_narration',
    audience: 'table',
    includedIds: context.includedIds,
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
    fallbackUsed: liveGeminiEnabled(options) && liveBody === null,
    narrationDensity,
    directorIdentity: director.identity,
    directorIdentityLabel: DIRECTOR_IDENTITY_LABELS[director.identity],
    directorPersonality: director.personality,
    avatarKey: director.avatarKey,
    manifest,
    createdAt,
  };
}

