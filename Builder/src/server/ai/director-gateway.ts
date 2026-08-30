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
import { scrubPlayerFacingIntentCopy } from '../../shared/ai-director-contract.js';
import { PLAY_CHANNEL_LABEL } from '../../shared/communication-contract.js';
import {
  deriveEpicFramingTags,
  type IntentDraftCommandType,
} from '../../shared/intent-draft-contract.js';
import type { NarrationDensity } from '../../shared/settings-contract.js';
import type { EncounterProjection } from '../../shared/rules-combat-contract.js';
import { getAiKillSwitch } from '../admin/admin-service.js';
import { appendChronicleEntry } from '../communication/chronicle.js';
import { COLLECTIONS } from '../persistence/firestore.js';
import { fetchRulesState } from '../rules/engine/rules-commands.js';
import { SPELL_EFFECTS } from '../rules/engine/spell-effects.js';
import { readPlayerSettings } from '../settings/player-settings.js';
import { fetchTableState } from '../table/commands.js';
import { fetchCampaignMap } from '../table/map-projection.js';
import { resolveBlankTableDoorBuild, resolveDoorIntentForMap } from '../table/scene-door-intent.js';
import { buildSkillCheckDraftSummary } from '../table/skill-check-resolve.js';
import {
  applyDmNpcDirective,
  applyDmSceneDirective,
  loadCampaignMemory,
} from '../campaigns/campaign-memory.js';
import {
  parsePlayerDeclaration,
  resolveIntentAuthority,
  textReferencesUnlockedDoorState,
  textRequestsLockPicking,
} from '../../shared/play-authority-contract.js';
import { assembleDirectorVisibleContext } from './director-context.js';
import type { MapBundleProjection } from '../../shared/map-contract.js';
import type { CampaignMemoryProjection } from '../../shared/campaign-memory-contract.js';

function shortFeatureLabel(label: string): string {
  return label.replace(/\s+[—-]\s+.*$/u, '').trim();
}

/** Player-facing fiction from the validated map — never invents unseen locations. */
export function buildSceneSurveyNarration(map: MapBundleProjection): string {
  const title = map.title.trim() || 'this chamber';
  const banner = map.sceneBanner
    .trim()
    .replace(/\s*[—-]\s*walls and a wooden doorway are established for this table\.?/gi, '')
    .replace(/\s+are established for this table\.?/gi, '')
    .trim();
  const features = map.notableFeatures
    .slice(0, 4)
    .map((feature) => shortFeatureLabel(feature.label))
    .filter((label) => label.length > 0);
  const doorCount = map.edges.filter((edge) => edge.kind === 'door').length;
  const doorLine =
    doorCount === 0
      ? 'No doorway is marked on the walls you can see.'
      : doorCount === 1
        ? 'A single wooden doorway breaks the wall ahead.'
        : `${doorCount} doorways break the walls you can see.`;
  const featureLine =
    features.length === 0
      ? 'Little else stands out in the lantern light.'
      : `You note ${features.join(', ')}.`;
  const lead = banner.length > 0 ? banner : `You take in ${title}.`;
  return `${lead}. ${doorLine} ${featureLine}`;
}

/** Presence fiction from campaign memory — Director may decline or refer to established NPCs. */
export function buildPresenceDeclineNarration(map: MapBundleProjection | null): string {
  const where = map?.title.trim() || 'the chamber';
  return `Nobody answers from ${where}. You hear only your own movement and the quiet of the room — no other person is present here yet.`;
}

export function buildPresenceWithNpcsNarration(
  memory: CampaignMemoryProjection,
): string {
  const names = memory.npcs
    .filter((npc) => npc.audience === 'public' || npc.audience === 'private')
    .map((npc) => npc.name);
  if (names.length === 0) {
    return 'Nobody else is established as present here.';
  }
  if (names.length === 1) {
    return `${names[0]} is here with you. Address them by name if you want to speak.`;
  }
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are here. Address someone by name if you want to speak.`;
}

/**
 * In-character NPC reply from the player's question and visible scene.
 * Never quotes the NPC description/role field as spoken dialogue.
 */
export function buildNpcDialogueReply(options: {
  readonly npc: { readonly name: string; readonly role: string; readonly motive: string };
  readonly playerText: string;
  readonly mapTitle: string | null;
}): string {
  const q = options.playerText.toLowerCase();
  const name = options.npc.name;
  const where = options.mapTitle?.trim() || 'this chamber';

  if (
    (/\b(beyond|past|behind|through)\b/.test(q) && /\bdoor\b/.test(q)) ||
    /boots?\s+dry/.test(q) ||
    /why should i keep/.test(q)
  ) {
    return `${name}: "Past that east door the stone stays wet. Keep your boots dry until you know what's pooling beyond — I won't invent a place you haven't opened."`;
  }
  if (/\bwho are you\b|\bwhat are you\b/.test(q)) {
    return `${name}: "Name's ${name}. I map damp places so travelers don't walk blind. You're in ${where}."`;
  }
  if (/\bwhich door\b|\bleads to\b|\barchive\b/.test(q)) {
    return `${name}: "Only one door shows from here. What's beyond it isn't settled until someone opens it — I won't invent an archive for you."`;
  }
  if (/\bwhat lies\b|\bwhat's (?:past|beyond|ahead)\b|\bwhat is past\b/.test(q)) {
    return `${name}: "From here I can speak to ${where} — wet stone, the sconce light, that door. Beyond it stays unknown until the fiction opens it."`;
  }
  return `${name}: "Ask plainly about what we can see here. I answer from this chamber — not from places that aren't established yet."`;
}

async function resolveDirectorNarrateOutput(options: {
  readonly firestore: Firestore;
  readonly campaignId: string;
  readonly accountId: string;
  readonly authority: ReturnType<typeof resolveIntentAuthority>;
  readonly structured: ReturnType<typeof parsePlayerDeclaration>;
}): Promise<string> {
  const inspectHint = options.authority.actionSequence[0]?.kind === 'inspect'
    ? options.authority.actionSequence[0]?.outcomeHint
    : null;
  const isDialogue =
    options.authority.actionSequence[0]?.kind === 'dialogue' &&
    options.structured.addressee !== null;

  let map: MapBundleProjection | null = null;
  let memory: CampaignMemoryProjection | null = null;
  try {
    map = await fetchCampaignMap({
      firestore: options.firestore,
      accountId: options.accountId,
      campaignId: options.campaignId,
    });
  } catch {
    map = null;
  }
  try {
    memory = await loadCampaignMemory(
      options.firestore,
      options.campaignId,
      options.accountId,
    );
  } catch {
    memory = null;
  }

  if (inspectHint === 'scene_perception' || inspectHint === 'unlocked door') {
    if (map !== null) {
      try {
        await applyDmSceneDirective(options.firestore, options.campaignId, options.accountId, {
          schemaVersion: 'play-authority-scene-v1',
          sceneId: map.mapBundleId || 'current-scene',
          revision: Math.max(1, map.mapVersion),
          title: map.title.trim() || 'Current scene',
          displayMode: 'exploration',
          bounds: {
            columns: Math.max(1, map.coordinateSpace.columns),
            rows: Math.max(1, map.coordinateSpace.rows),
          },
          causeActionId: null,
          continuity: { previousSceneId: null, boundaryCrossed: false },
          structure: { edges: [] },
          markers: [],
          entities: [],
          visibility: 'public',
          rejectedMechanics: [],
        });
      } catch {
        // Scene chronicle is best-effort; narration still returns.
      }
      return buildSceneSurveyNarration(map);
    }
    return 'You look and listen. The visible scene holds steady — nothing unseen invents itself from your words.';
  }

  if (inspectHint === 'who_is_present') {
    const established =
      memory?.npcs.filter((npc) => npc.audience === 'public' || npc.audience === 'private') ?? [];
    if (established.length > 0 && memory !== null) {
      return buildPresenceWithNpcsNarration(memory);
    }
    const quietChamber =
      map !== null &&
      (/quiet chamber/i.test(map.title) || /quiet chamber/i.test(map.sceneBanner));
    if (quietChamber) {
      try {
        const applied = await applyDmNpcDirective(
          options.firestore,
          options.campaignId,
          options.accountId,
          {
            schemaVersion: 'play-authority-npc-v1',
            npcId: 'npc-nib',
            name: 'Nib',
            publicDescription: 'A wary goblin cartographer',
            disposition: 'wary',
            location: { column: 4, row: 3 },
            placeToken: true,
            firstDialogue: 'Keep your boots dry past the east door.',
            audience: 'public',
            causeActionId: null,
          },
          // Chronicle after the player declaration via interpret's single ruling.
          { writeChronicle: false },
        );
        if (applied.created) {
          return `A wary goblin cartographer answers from beside the rubble pile. Nib: "Keep your boots dry past the east door." Nib is present with the party.`;
        }
        if (memory !== null || applied.memory.npcs.length > 0) {
          return buildPresenceWithNpcsNarration(applied.memory);
        }
      } catch {
        // Fall through to decline fiction.
      }
    }
    return buildPresenceDeclineNarration(map);
  }

  if (isDialogue && options.structured.addressee !== null && memory !== null) {
    const name = options.structured.addressee;
    const npc =
      memory.npcs.find(
        (entry) => entry.name.toLowerCase() === name.toLowerCase() || entry.npcId === name,
      ) ?? null;
    if (npc !== null) {
      return buildNpcDialogueReply({
        npc,
        playerText: options.structured.rawText,
        mapTitle: map?.title ?? null,
      });
    }
  }

  return options.authority.clarificationPrompt ?? options.authority.summary;
}

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
  'Never change Hit Points, kill a creature the mechanics left standing, or spare one the mechanics dropped.',
  'Never claim the party left the current scene, entered a new location, or abandoned the named chamber unless the mechanics summary explicitly says a scene change occurred.',
  'Stepping through a doorway on the same map keeps the current scene — describe the step, not a departure.',
  'If framing tags are present (crit, finishing_blow, near_miss, heroic_failure, bold_stunt, overkill), lean into cinematic emphasis for that beat without altering the outcome.',
  'Write in second person. Keep paragraphs short. Do not open with a title or heading.',
  'If the player tried something not present in the scene state, clarify the gap in-world without granting it.',
].join(' ');

function looksMechanical(text: string): boolean {
  return /(can i|could i|would it|action economy|bonus action|reaction|spell slot|magic missile|climb|athletics|acrobatics|check|save|attack|cast|legal|rules|how many|do i have|proficiency|trap|disarm|lockpick|thieves)/i.test(
    text,
  );
}

/** Trap/lock language that must stay on the skill-check path (PQA-155). */
function mentionsDoorHazardIntent(text: string): boolean {
  return textRequestsLockPicking(text) || /(trap|disarm|lockpick|lock\s*pick)/.test(text);
}

/**
 * Door state / manipulation without a hazard check (PQA-155).
 * Plain inspect/check/examine of a visible door reads state — it is not Investigation.
 */
function mentionsDoorStateIntent(text: string): boolean {
  if (mentionsDoorHazardIntent(text) || textReferencesUnlockedDoorState(text)) {
    return false;
  }
  return (
    /(swing|ajar|hinge|free\s*swing|push|pull|test|inspect|check|examine|look\s*at|study).*(door|gate|entry)/.test(
      text,
    ) ||
    /(door|gate|entry).*(swing|ajar|hinge|stuck|free|push|pull|test|inspect|check|examine|state)/.test(
      text,
    )
  );
}

function mentionsSkillCheckIntent(text: string): boolean {
  if (mentionsDoorStateIntent(text) || textReferencesUnlockedDoorState(text)) {
    return false;
  }
  return (
    (/(trap|disarm|investigat|perception|search|examine|inspect)/.test(text) &&
      /(door|lock|way|trap|entry|gate)/.test(text)) ||
    textRequestsLockPicking(text)
  );
}

function stripAdjectivalOpenDoor(text: string): string {
  return text.replace(/\bopen(?:ed)?\s+(?:wooden\s+)?(?:door|doorway|gate|entry(?:way)?)s?\b/gi, 'doorway');
}

function mentionsDoorIntent(text: string): boolean {
  // Adjectival "open wooden door" is door state, not an open-door verb.
  const withoutOpenNoun = stripAdjectivalOpenDoor(text);
  const openVerb = /\b(?:opens?|opening|push(?:es|ing)?|swings?|swinging)\b/i.test(withoutOpenNoun);
  const passageVerb = /\b(?:enter(?:s|ing)?|steps?|stepping|through)\b/i.test(text);
  if (
    textReferencesUnlockedDoorState(text) &&
    !openVerb &&
    !passageVerb &&
    !/\bbeyond\b/i.test(text)
  ) {
    // Bare unlocked-state reference — not a door action (A1).
    return false;
  }
  if (textReferencesUnlockedDoorState(text) && (openVerb || passageVerb || /\bbeyond\b/i.test(text))) {
    return !textRequestsLockPicking(text);
  }
  return (
    mentionsDoorStateIntent(text) ||
    (/(opens?|opening|push(?:es|ing)?|swings?).*(door|doorway|gate|entry)/.test(withoutOpenNoun) &&
      !textRequestsLockPicking(text)) ||
    (/(door|doorway|gate|entryway).*(opens?|opening|ahead|beyond|enter)/.test(withoutOpenNoun) &&
      !textRequestsLockPicking(text)) ||
    // Through / step / enter a door or doorway (including reverse crossing from the far side).
    (/\b(?:door|doorway|gate|entryway)\b/.test(withoutOpenNoun) &&
      passageVerb &&
      !textRequestsLockPicking(text)) ||
    // "Enter the room beyond" is doorway transit, not free-form mark-square movement.
    (/\bbeyond\b/.test(text) &&
      /\b(?:enter|room|chamber|door|doorway)\b/.test(text) &&
      !textRequestsLockPicking(text)) ||
    // Catch-all for explicit door/gate nouns with no unlock / passage language.
    (/\b(door|gate|entryway)\b/.test(text) &&
      !textRequestsLockPicking(text) &&
      !textReferencesUnlockedDoorState(text) &&
      !/\bdoorway\b/.test(text) &&
      !passageVerb)
  );
}

function mentionsMovementIntent(text: string): boolean {
  return /\b(?:moves?|walks?|goes?|steps?|approaches?|enters?|heading)\b/i.test(text);
}

function isOneStepFrom(
  anchor: { readonly column: number; readonly row: number },
  target: { readonly column: number; readonly row: number },
): boolean {
  const columnDelta = Math.abs(anchor.column - target.column);
  const rowDelta = Math.abs(anchor.row - target.row);
  return columnDelta <= 1 && rowDelta <= 1 && (columnDelta + rowDelta > 0);
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

/**
 * When mechanics describe a same-scene doorway step, strip LLM inventions that
 * claim the party left the named chamber or entered a new location.
 */
function scrubFalseSceneDeparture(body: string, mechanicsSummary: string): string {
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
  'If the player describes a consequential action in Ask-the-DM, tell them what it would take and that they must declare it in the play channel to resolve it. Do not treat the consult as a completed command.',
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

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Pull fiction hostiles from a declaration (PQA-170/171).
 * Prefers "a hostile ashfang raider named Kest" → "Ashfang Raider Kest".
 */
export function extractDeclaredFoesFromText(
  rawText: string,
): readonly { readonly name: string }[] {
  const foes: { name: string }[] = [];
  const patterned = rawText.matchAll(
    /\b(?:a|an|the)\s+(?:hostile\s+|enemy\s+|foe\s+)?([A-Za-z][\w' -]{1,48}?)\s+named\s+([A-Z][\w'-]+)/gi,
  );
  for (const match of patterned) {
    const kind = titleCaseWords(match[1]!.replace(/\s+/g, ' ').trim());
    const personal = match[2]!;
    const name = `${kind} ${personal}`.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (name.length > 0 && !foes.some((entry) => entry.name === name)) {
      foes.push({ name });
    }
  }
  if (foes.length > 0) {
    return foes.slice(0, 4);
  }
  const namedOnly = /\bnamed\s+([A-Z][\w'-]+)/.exec(rawText);
  if (namedOnly !== null) {
    return [{ name: namedOnly[1]!.slice(0, 80) }];
  }
  return [];
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
  const rawText = options.text.trim();
  const text = rawText.toLowerCase();

  let proposedCommandType: IntentDraftCommandType = 'table.sync';
  let summary =
    'I heard your declaration. Confirm only commits what the table can resolve right now.';
  let path: IntentInterpretResponse['path'];
  let edgeId: string | undefined;
  let targetCombatantId: string | undefined;
  let spellId: string | undefined;
  let itemId: string | undefined;
  let declaredFoes: readonly { readonly name: string }[] | undefined;
  let arcaneRecovery: boolean | undefined;
  let projectionVersionAtIssue: number | undefined;

  let encounter: EncounterProjection | null = null;
  let seatedSheet: import('../../shared/character-contract.js').DerivedCharacterSheet | null = null;
  try {
    const [rules, table] = await Promise.all([
      fetchRulesState({
        firestore: options.firestore,
        accountId: options.accountId,
        campaignId: options.campaignId,
      }),
      fetchTableState({
        firestore: options.firestore,
        accountId: options.accountId,
        campaignId: options.campaignId,
      }),
    ]);
    encounter = rules.encounter;
    seatedSheet = rules.progression?.sheet ?? null;
    projectionVersionAtIssue = table.stateVersion;
  } catch {
    encounter = null;
    seatedSheet = null;
  }

  const combatActive = encounter !== null && encounter.status === 'active';
  const foes =
    encounter?.combatants.filter(
      (combatant) => combatant.side === 'foe' && combatant.currentHitPoints > 0,
    ) ?? [];
  const party =
    encounter?.combatants.filter((combatant) => combatant.side === 'party') ?? [];

  let knownNpcs: { id: string; label: string }[] = [];
  try {
    const memory = await loadCampaignMemory(
      options.firestore,
      options.campaignId,
      options.accountId,
    );
    knownNpcs = memory.npcs.map((npc) => ({ id: npc.npcId, label: npc.name }));
  } catch {
    knownNpcs = [];
  }

  const structured = parsePlayerDeclaration(rawText, { knownNpcs });
  const authority = resolveIntentAuthority(structured);
  const authorityShortCircuit =
    authority.disposition === 'director_narrate_only' ||
    authority.disposition === 'reject_world_authorship' ||
    (authority.disposition === 'clarify' &&
      (structured.isInterrogative ||
        authority.actionSequence.length > 1 ||
        structured.playerAssertedWorldFacts.length > 0 ||
        structured.addressee !== null)) ||
    (authority.disposition === 'propose_command' &&
      authority.actionSequence[0]?.kind === 'unlock_door') ||
    (authority.disposition === 'propose_command' &&
      authority.actionSequence[0]?.kind === 'move' &&
      !mentionsDoorIntent(text));

  /** Defer Director fiction until after the player declaration is chronicled. */
  let deferDirectorNarrate = false;

  if (authorityShortCircuit) {
    if (
      authority.disposition === 'propose_command' &&
      authority.actionSequence[0]?.kind === 'unlock_door'
    ) {
      proposedCommandType = 'table.sync';
      summary = buildSkillCheckDraftSummary(seatedSheet, text);
    } else if (
      authority.disposition === 'propose_command' &&
      authority.actionSequence[0]?.kind === 'move'
    ) {
      // Invented scenery may have been ignored — keep the real move (TQA-004).
      if (options.moveTarget) {
        proposedCommandType = 'table.move';
        path = [options.moveTarget];
        summary =
          authority.summary.startsWith('Ready to')
            ? authority.summary
            : 'Ready to move toward the marked destination on the map. Confirm to commit the step.';
        if (authority.ignoredWorldFacts.length > 0 && !/ignored|Game Director/i.test(summary)) {
          summary = `${summary} Player-authored places were ignored — only the Game Director establishes those.`;
        }
      } else {
        // Prefer doorway geometry (including reverse cross / already-through) over mark-square.
        let doorResolved = false;
        try {
          const map = await fetchCampaignMap({
            firestore: options.firestore,
            accountId: options.accountId,
            campaignId: options.campaignId,
          });
          const ownToken =
            map.viewerSeatId === null
              ? map.tokens[0]
              : (map.tokens.find((token) => token.seatId === map.viewerSeatId) ?? map.tokens[0]);
          if (ownToken !== undefined && map.edges.length > 0) {
            const persisted = resolveDoorIntentForMap(map, ownToken.footprint.anchor, text);
            if (persisted !== null) {
              proposedCommandType = persisted.proposedCommandType;
              summary = persisted.summary;
              if (persisted.path !== undefined) {
                path = [...persisted.path];
              }
              if (persisted.edgeId !== undefined) {
                edgeId = persisted.edgeId;
              }
              doorResolved = true;
            }
          }
        } catch {
          doorResolved = false;
        }
        if (!doorResolved) {
          proposedCommandType = 'table.sync';
          summary =
            authority.ignoredWorldFacts.length > 0
              ? 'Your movement stands — mark an adjacent square on the map to commit it. Player-authored places were ignored; only the Game Director establishes those.'
              : 'Mark an adjacent square on the map, then declare your move again to commit the step.';
        }
      }
    } else if (authority.disposition === 'director_narrate_only') {
      proposedCommandType = authority.proposedCommandType ?? 'table.sync';
      deferDirectorNarrate = true;
      summary = authority.summary;
    } else {
      proposedCommandType = authority.proposedCommandType ?? 'table.sync';
      summary = authority.clarificationPrompt ?? authority.summary;
    }
  } else if (
    (authority.disposition === 'propose_command' &&
      authority.actionSequence[0]?.kind === 'open_door') ||
    (mentionsDoorIntent(text) &&
      !/(begin (the )?encounter|start (the )?(encounter|combat|fight)|roll initiative)/i.test(
        text,
      ) &&
      (!mentionsSkillCheckIntent(text) || mentionsDoorStateIntent(text)))
  ) {
    try {
      const map = await fetchCampaignMap({
        firestore: options.firestore,
        accountId: options.accountId,
        campaignId: options.campaignId,
      });
      const ownToken =
        map.viewerSeatId === null
          ? map.tokens[0]
          : (map.tokens.find((token) => token.seatId === map.viewerSeatId) ?? map.tokens[0]);
      if (ownToken !== undefined) {
        const persisted = resolveDoorIntentForMap(map, ownToken.footprint.anchor, text);
        if (persisted !== null) {
          proposedCommandType = persisted.proposedCommandType;
          summary = persisted.summary;
          if (persisted.path !== undefined) {
            path = [...persisted.path];
          }
          if (persisted.edgeId !== undefined) {
            edgeId = persisted.edgeId;
          }
        } else {
          const blankBuild = resolveBlankTableDoorBuild(map, ownToken.footprint.anchor, text);
          if (blankBuild !== null) {
            proposedCommandType = blankBuild.proposedCommandType;
            summary = blankBuild.summary;
            if (blankBuild.edgeId !== undefined) {
              edgeId = blankBuild.edgeId;
            }
          } else {
            proposedCommandType = 'table.sync';
            summary =
              'This scene has no door to open yet. Ask the Director what you can interact with here, or declare how you explore the chamber.';
          }
        }
      }
    } catch {
      proposedCommandType = 'table.sync';
      summary =
        'This scene has no door to open yet. Ask the Director what you can interact with here, or declare how you explore the chamber.';
    }
  } else if (mentionsSkillCheckIntent(text)) {
    proposedCommandType = 'table.sync';
    summary = buildSkillCheckDraftSummary(seatedSheet, text);
  } else if (mentionsMovementIntent(text) && options.moveTarget) {
    let legalStep = false;
    try {
      const map = await fetchCampaignMap({
        firestore: options.firestore,
        accountId: options.accountId,
        campaignId: options.campaignId,
      });
      const ownToken =
        map.viewerSeatId === null
          ? map.tokens[0]
          : (map.tokens.find((token) => token.seatId === map.viewerSeatId) ?? map.tokens[0]);
      if (ownToken !== undefined) {
        legalStep = isOneStepFrom(ownToken.footprint.anchor, options.moveTarget);
      } else if (!mentionsDoorIntent(text)) {
        legalStep = true;
      }
    } catch {
      legalStep = !mentionsDoorIntent(text);
    }
    if (legalStep) {
      proposedCommandType = 'table.move';
      path = [options.moveTarget];
      summary =
        'Ready to move toward the marked destination on the map. Confirm to commit the step.';
    } else {
      proposedCommandType = 'table.sync';
      summary =
        'That destination is not a legal next step from where you stand. Pick an adjacent square on the map, or declare a door or scene action instead.';
    }
  } else if (
    /(end (the )?(encounter|fight|combat)|stop (the )?fight|withdraw from (combat|the fight))/i.test(
      text,
    )
  ) {
    if (encounter !== null && encounter.status !== 'ended') {
      proposedCommandType = 'encounter.end';
      summary =
        'Ready to end the encounter and leave combat. Confirm to clear initiative so the table can rest or explore.';
    } else {
      proposedCommandType = 'table.sync';
      summary = 'There is no active encounter to end right now.';
    }
  } else if (
    /arcane recovery/i.test(text) ||
    (/(short\s*rest|take a short rest)/i.test(text) &&
      /arcane recovery|recover.*(spell )?slot|restore.*(spell )?slot/i.test(text))
  ) {
    if (combatActive) {
      proposedCommandType = 'table.sync';
      summary =
        'Arcane Recovery needs the fight to end first. End the encounter, then declare a Short Rest with Arcane Recovery.';
    } else {
      proposedCommandType = 'combat.short_rest';
      arcaneRecovery = true;
      summary =
        'Ready to take a Short Rest and use Arcane Recovery to restore expended level-1 spell slots (up to half your Wizard level, rounded up; once per day). Confirm to resolve the rest.';
    }
  } else if (
    /(short\s*rest|take a short rest|rest briefly|catch my breath|recover.*(second wind|action surge|short.?rest))/i.test(
      text,
    )
  ) {
    if (combatActive) {
      proposedCommandType = 'table.sync';
      summary =
        'A Short Rest needs the fight to end first. End the encounter, then declare a Short Rest again.';
    } else {
      proposedCommandType = 'combat.short_rest';
      summary =
        'Ready to take a Short Rest and recover short-rest resources (and spend a Hit Die if available). Confirm to resolve the rest.';
    }
  } else if (
    /(long\s*rest|take a long rest|camp for the night|sleep until morning)/i.test(text)
  ) {
    if (combatActive) {
      proposedCommandType = 'table.sync';
      summary =
        'A Long Rest needs the fight to end first. End the encounter, then declare a Long Rest again.';
    } else {
      proposedCommandType = 'combat.long_rest';
      summary =
        'Ready to take a Long Rest and restore Hit Points, Hit Dice, spell slots, and class resources. Confirm to resolve the rest.';
    }
  } else if (
    /(begin (the )?encounter|start (the )?(encounter|combat|fight)|roll initiative|initiative)/i.test(text) ||
    (/hostile|guardian|foe|enemy/.test(text) && /initiative|encounter|combat/.test(text))
  ) {
    const wantsInitiative = /initiative/.test(text);
    const storyFoes = extractDeclaredFoesFromText(rawText);
    if (combatActive) {
      proposedCommandType = 'table.sync';
      summary = 'Combat is already active. Declare your attack or spell on your turn.';
    } else if (encounter !== null && encounter.status === 'setup') {
      proposedCommandType = 'initiative.roll';
      summary =
        'Ready to roll initiative for this encounter. Confirm to establish turn order.';
    } else if (encounter !== null && encounter.status === 'ended') {
      proposedCommandType = 'encounter.begin';
      if (storyFoes.length > 0) {
        declaredFoes = storyFoes;
        const foeNames = storyFoes.map((foe) => foe.name).join(' and ');
        summary = wantsInitiative
          ? `Ready to begin a new encounter against ${foeNames}. Confirm to start; initiative follows once setup is ready.`
          : `Ready to begin a new encounter against ${foeNames}. Confirm to start combat setup.`;
      } else {
        summary = wantsInitiative
          ? 'Ready to begin a new encounter with practice foes. Confirm to start; initiative follows once setup is ready.'
          : 'Ready to begin a new encounter with practice foes. Confirm to start combat setup.';
      }
    } else {
      // No encounter yet — begin is the supported path (hosted has no Tools tab).
      proposedCommandType = 'encounter.begin';
      if (storyFoes.length > 0) {
        declaredFoes = storyFoes;
        const foeNames = storyFoes.map((foe) => foe.name).join(' and ');
        summary = wantsInitiative
          ? `Ready to begin the encounter against ${foeNames} and prepare initiative. Confirm to bring them into play, then confirm rolling initiative.`
          : `Ready to begin the encounter against ${foeNames}. Confirm to bring them into play.`;
      } else {
        summary = wantsInitiative
          ? 'Ready to begin the encounter and prepare initiative. Confirm to bring practice foes into play, then confirm rolling initiative.'
          : 'Ready to begin the encounter. Confirm to bring practice foes into play.';
      }
    }
  } else if (/(potion|drink.*heal|use.*heal|healing potion)/.test(text)) {
    const self = party.find((combatant) => combatant.seatId !== null) ?? party[0] ?? null;
    if (!combatActive || self === null) {
      proposedCommandType = 'encounter.begin';
      summary =
        'Ready to begin an encounter so you can use a Potion of Healing on your turn. Confirm to start combat setup, then declare the potion again.';
    } else {
      proposedCommandType = 'inventory.use_item';
      itemId = 'healing-potion';
      targetCombatantId = self.combatantId;
      summary = `Ready to use a Potion of Healing on ${self.name}. Confirm to let the engine resolve the heal.`;
    }
  } else if (/(cast|spell|fire bolt|firebolt|burning hands|sacred flame|guiding bolt|cure wounds)/.test(text)) {
    const matchedSpell = matchSpellFromText(text);
    const target = matchCombatantFromText(text, foes) ?? (foes.length === 1 ? foes[0]! : null);
    if (!combatActive) {
      proposedCommandType = 'encounter.begin';
      const storyFoes = extractDeclaredFoesFromText(rawText);
      if (storyFoes.length > 0) {
        declaredFoes = storyFoes;
        const foeNames = storyFoes.map((foe) => foe.name).join(' and ');
        summary = `Ready to begin an encounter against ${foeNames} so you can cast in combat. Confirm to start combat setup, then declare the spell again after initiative.`;
      } else {
        summary =
          'Ready to begin an encounter so you can cast in combat. Confirm to start combat setup, then declare the spell again after initiative.';
      }
    } else if (matchedSpell === null) {
      summary =
        'Name which prepared spell you cast (for example Fire Bolt or Burning Hands), then declare again.';
      proposedCommandType = 'table.sync';
    } else if (matchedSpell.targetKind === 'area') {
      proposedCommandType = 'combat.cast_spell';
      spellId = matchedSpell.spellId;
      summary = `Ready to cast ${matchedSpell.label}. Confirm to resolve the area with the engine.`;
    } else if (matchedSpell.targetKind === 'self') {
      const self = party.find((combatant) => combatant.seatId !== null) ?? party[0] ?? null;
      proposedCommandType = 'combat.cast_spell';
      spellId = matchedSpell.spellId;
      if (self !== null) targetCombatantId = self.combatantId;
      summary = `Ready to cast ${matchedSpell.label} on yourself. Confirm to resolve with the engine.`;
    } else if (target === null) {
      const foeHint =
        foes
          .slice(0, 2)
          .map((foe) => foe.name)
          .join(' or ') || 'a foe in the encounter';
      summary = `Ready to cast ${matchedSpell.label}, but name which foe (for example ${foeHint}).`;
      proposedCommandType = 'table.sync';
    } else {
      proposedCommandType = 'combat.cast_spell';
      spellId = matchedSpell.spellId;
      targetCombatantId = target.combatantId;
      summary = `Ready to cast ${matchedSpell.label} at ${target.name}. Confirm to resolve the spell with the engine.`;
    }
  } else if (
    /\b(attack|strike|hit|slash|smash|stab|swing|warhammer|longsword|club|hammer)\b/.test(text)
  ) {
    const target = matchCombatantFromText(text, foes) ?? (foes.length === 1 ? foes[0]! : null);
    if (!combatActive) {
      proposedCommandType = 'encounter.begin';
      const storyFoes = extractDeclaredFoesFromText(rawText);
      if (storyFoes.length > 0) {
        declaredFoes = storyFoes;
        const foeNames = storyFoes.map((foe) => foe.name).join(' and ');
        summary = `Ready to begin an encounter against ${foeNames} so you can attack. Confirm to start combat setup, then declare the attack again after initiative.`;
      } else {
        summary =
          'Ready to begin an encounter so you can attack. Confirm to start combat setup, then declare the attack again after initiative.';
      }
    } else if (target === null) {
      const foeHint =
        foes
          .slice(0, 2)
          .map((foe) => foe.name)
          .join(' or ') || 'a foe in the encounter';
      summary = `Say who you attack (${foeHint}), then declare again.`;
      proposedCommandType = 'table.sync';
    } else {
      proposedCommandType = 'combat.attack';
      targetCombatantId = target.combatantId;
      summary = `Ready to attack ${target.name} with your weapon. Confirm to let the engine roll to hit and damage.`;
    }
  }

  const skipLiveRewrite =
    proposedCommandType === 'table.build_scene' ||
    proposedCommandType === 'table.sync' ||
    proposedCommandType === 'table.move' ||
    proposedCommandType === 'table.open_door' ||
    proposedCommandType === 'encounter.begin' ||
    proposedCommandType === 'initiative.roll' ||
    proposedCommandType === 'combat.short_rest' ||
    proposedCommandType === 'combat.long_rest';
  const liveSummary = skipLiveRewrite
    ? null
    : await tryLiveProse(options, {
        systemInstruction: `${directorVoiceBlock(director.identity, director.personality)} ${DIRECTOR_SAFETY_RULES} Rewrite the Intent summary for the player in one or two sentences. Do not name internal command types or tool ids. Do not change the proposed command type ${proposedCommandType}. Do not invent a different action or mechanical outcome. Do not invent doors, walls, or entryways that are not on the map.`,
        userPrompt: `Player said: ${rawText}\nDeterministic summary: ${summary}`,
      });
  if (liveSummary !== null) {
    summary = liveSummary;
  }
  summary = scrubPlayerFacingIntentCopy(summary);

  if (deferDirectorNarrate) {
    summary = scrubPlayerFacingIntentCopy(
      await resolveDirectorNarrateOutput({
        firestore: options.firestore,
        campaignId: options.campaignId,
        accountId: options.accountId,
        authority,
        structured,
      }),
    );
  }
  summary = scrubPlayerFacingIntentCopy(summary);

  const declaration = rawText.trim().slice(0, 500);
  // Confirmable drafts must not pollute Story so far until Confirm (TQA-005 / TQA-078).
  // Clarifications and Director-only narration chronicle immediately.
  const chronicleImmediately =
    declaration.length > 0 &&
    proposedCommandType === 'table.sync' &&
    edgeId === undefined &&
    path === undefined &&
    !/^Ready to /i.test(summary);
  if (chronicleImmediately) {
    await appendChronicleEntry({
      firestore: options.firestore,
      campaignId: options.campaignId,
      kind: 'play_declaration',
      body: declaration,
    });
    await appendChronicleEntry({
      firestore: options.firestore,
      campaignId: options.campaignId,
      kind: 'director_ruling',
      body: summary,
    });
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
    summary:
      liveSummary === null
        ? `${summary} (${DIRECTOR_IDENTITY_LABELS[director.identity]} · ${DIRECTOR_PERSONALITY_LABELS[director.personality]})`
        : scrubPlayerFacingIntentCopy(summary),
    proposedCommandType,
    ...(path !== undefined ? { path } : {}),
    ...(edgeId !== undefined ? { edgeId } : {}),
    ...(targetCombatantId !== undefined ? { targetCombatantId } : {}),
    ...(spellId !== undefined ? { spellId } : {}),
    ...(itemId !== undefined ? { itemId } : {}),
    ...(declaredFoes !== undefined && declaredFoes.length > 0 ? { declaredFoes } : {}),
    ...(arcaneRecovery === true ? { arcaneRecovery: true } : {}),
    ...(projectionVersionAtIssue !== undefined ? { projectionVersionAtIssue } : {}),
    interceptState: 'awaiting_confirmation',
    source: 'action_composer_nl',
    manifest,
    createdAt,
  };
}

function matchSpellFromText(text: string): (typeof SPELL_EFFECTS)[string] | null {
  const entries = Object.values(SPELL_EFFECTS);
  for (const effect of entries) {
    const label = effect.label.toLowerCase();
    const id = effect.spellId.replace(/-/g, ' ');
    if (text.includes(label) || text.includes(id) || text.includes(effect.spellId)) {
      return effect;
    }
  }
  return null;
}

function matchCombatantFromText(
  text: string,
  combatants: EncounterProjection['combatants'],
): EncounterProjection['combatants'][number] | null {
  let best: EncounterProjection['combatants'][number] | null = null;
  let bestScore = 0;
  for (const combatant of combatants) {
    const nameTokens = combatant.name
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 2);
    const idTokens = combatant.combatantId
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2);
    const score = [...new Set([...nameTokens, ...idTokens])].filter((token) =>
      text.includes(token),
    ).length;
    if (score > bestScore) {
      bestScore = score;
      best = combatant;
    }
  }
  if (best !== null) {
    return best;
  }
  if (/kobold|goblin/.test(text)) {
    return combatants.find((combatant) => /goblin/i.test(combatant.name)) ?? null;
  }
  if (/dummy|training/.test(text)) {
    return combatants.find((combatant) => /dummy/i.test(combatant.name)) ?? null;
  }
  return null;
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
      } Declare the action in the ${PLAY_CHANNEL_LABEL} when you are ready — this consult does not resolve it.`
    : `${name} (${DIRECTOR_PERSONALITY_LABELS[director.personality]}) answers from the visible scene only. The table does not move from Ask the Director. Use the ${PLAY_CHANNEL_LABEL} to declare what you do.`;

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
  readonly rolls?: readonly number[];
  readonly framingTags?: readonly import('../../shared/intent-draft-contract.js').EpicFramingTag[];
} & DirectorLiveOptions): Promise<DirectorNarrationProjection> {
  await requireAiEnabled(options.firestore);
  const director = await loadDirectorConfig(options.firestore, options.campaignId);
  const playerSettings = await readPlayerSettings({
    firestore: options.firestore,
    accountId: options.accountId,
  });
  const narrationDensity = playerSettings.reserved.narrationDensity;
  const framingTags =
    options.framingTags ?? deriveEpicFramingTags(options.mechanicsSummary, options.rolls ?? []);
  const context = await assembleDirectorVisibleContext({
    firestore: options.firestore,
    campaignId: options.campaignId,
    accountId: options.accountId,
  });
  const createdAt = new Date().toISOString();
  const emphasis =
    framingTags.length === 0
      ? ''
      : ` Framing tags (emphasis only, never change outcomes): ${framingTags.join(', ')}.`;
  const effectiveDensity =
    framingTags.includes('crit') ||
    framingTags.includes('finishing_blow') ||
    framingTags.includes('overkill')
      ? narrationDensity === 'concise'
        ? 'balanced'
        : narrationDensity
      : narrationDensity;
  const simulated = composeNarrationBody(
    options.mechanicsSummary,
    director.personality,
    effectiveDensity,
  );
  const liveBody = await tryLiveProse(options, {
    systemInstruction: `${directorVoiceBlock(director.identity, director.personality)} ${DIRECTOR_SAFETY_RULES} ${NARRATOR_CONSTITUTION} Match narration density "${effectiveDensity}" (concise = short; balanced = a beat of flavor; cinematic = richer sensory detail without new facts).${emphasis}`,
    userPrompt: `${context.text}\n\nMechanics summary (authoritative):\n${options.mechanicsSummary}\n\nLocation continuity: unless that summary explicitly reports a scene or location change, the current chamber stays current. A doorway step on the same map is not a departure — do not say anyone left the chamber behind or arrived somewhere new.`,
  });
  const body = scrubFalseSceneDeparture(liveBody ?? simulated.body, options.mechanicsSummary);
  const humorApplied = liveBody === null ? simulated.humorApplied : effectiveDensity !== 'concise';
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

  // Persist Director narration into Story so far / play-thread rebuild (PQA-159).
  // Never chronicle Intent Intercept draft copy after the beat already resolved.
  if (
    !/^Ready to /i.test(options.mechanicsSummary.trim()) &&
    !/\bConfirm to\b/i.test(options.mechanicsSummary)
  ) {
    await appendChronicleEntry({
      firestore: options.firestore,
      campaignId: options.campaignId,
      kind: 'director_ruling',
      body,
    });
  }

  return {
    narrationId: randomUUID(),
    campaignId: options.campaignId,
    body,
    mechanicsFirstSummary: options.mechanicsSummary,
    humorApplied,
    fallbackUsed: liveGeminiEnabled(options) && liveBody === null,
    narrationDensity: effectiveDensity,
    framingTags,
    directorIdentity: director.identity,
    directorIdentityLabel: DIRECTOR_IDENTITY_LABELS[director.identity],
    directorPersonality: director.personality,
    avatarKey: director.avatarKey,
    manifest,
    createdAt,
  };
}

