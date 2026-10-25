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
  looksLikeTruncatedDirectorProse,
  scrubIncompleteDirectorProse,
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
import {
  formatBlueprintBeatPrompt,
  isCampaignBlueprint,
  selectActiveBlueprintBeat,
} from '../campaigns/campaign-blueprint.js';
import { appendChronicleEntry } from '../communication/chronicle.js';
import { COLLECTIONS } from '../persistence/firestore.js';
import { fetchRulesState } from '../rules/engine/rules-commands.js';
export {
  dedupeInspectCandidateLabels,
  scrubClosedDoorCalledOpen,
  scrubEngineCoordinates,
  scrubExpandedInspectScope,
  scrubFalseSceneDeparture,
  scrubFalseTrapCertainty,
  scrubInventedContainerContents,
  scrubNoTouchConstraint,
  scrubStaleDoorCloseNarration,
} from './director-prose-scrubbers.js';
import {
  dedupeInspectCandidateLabels,
  scrubClosedDoorCalledOpen,
  scrubEngineCoordinates,
  scrubExpandedInspectScope,
  scrubFalseSceneDeparture,
  scrubFalseTrapCertainty,
  scrubInventedContainerContents,
  scrubNoTouchConstraint,
  scrubStaleDoorCloseNarration,
} from './director-prose-scrubbers.js';
export {
  extractDeclaredFoesFromText,
  resolveDeterministicIntentFallback,
  type DeterministicIntentFallbackInput,
  type DeterministicIntentFallbackResult,
} from './deterministic-intent-fallback.js';
import { resolveDeterministicIntentFallback } from './deterministic-intent-fallback.js';
import { findClass } from '../rules/srd-manifest.js';
import { readPlayerSettings } from '../settings/player-settings.js';
import { fetchTableState } from '../table/commands.js';
import { fetchCampaignMap } from '../table/map-projection.js';
import { bootstrapBlankFirstScene } from '../table/scene-builder.js';
import {
  queryDirectorMechanicsArbiter,
  applyDirectorDispatchToMap,
} from './director-mechanics-dispatcher.js';
import {
  applyDmNpcDirective,
  applyDmSceneDirective,
  loadCampaignMemory,
} from '../campaigns/campaign-memory.js';
import {
  doorAuthorityFromStored,
  formatDoorPlayerFacingLabel,
  parsePlayerDeclaration,
  resolveIntentAuthority,
} from '../../shared/play-authority-contract.js';
import {
  understandUtterance,
} from '../../shared/utterance-understanding.js';
import {
  assembleDirectorVisibleContext,
  buildPremiseFactCorpus,
  loadScenePremiseExtras,
} from './director-context.js';
import type { MapBundleProjection } from '../../shared/map-contract.js';
import { formatMapRouteSummary } from '../../shared/map-presentation.js';
import type { CampaignMemoryProjection } from '../../shared/campaign-memory-contract.js';
import {
  answerFromCampaignFacts,
} from '../../shared/campaign-facts.js';
import {
  answerContainerContentsQuery,
  containerLabelHintFromText,
} from '../../shared/container-contents.js';

function shortFeatureLabel(label: string): string {
  return label.replace(/\s+[—-]\s+.*$/u, '').trim();
}

/** Keep exit state suffix for survey/route lines (FQA-004). */
function exitRouteLabel(label: string): string {
  const trimmed = label.replace(/\s+/g, ' ').trim();
  if (/\s+[—-]\s+(open|closed|locked|unlocked)/i.test(trimmed)) {
    return trimmed;
  }
  return shortFeatureLabel(trimmed);
}

export interface SceneSurveyOptions {
  readonly playerText?: string;
  readonly recentChronicleSummaries?: readonly string[];
  readonly campaignPremise?: string | null;
  readonly carriedEquipment?: readonly { readonly name: string; readonly statsSummary?: string }[];
}

/** Player-facing fiction from the validated map — never invents unseen locations. */
export function buildSceneSurveyNarration(
  map: MapBundleProjection,
  options?: SceneSurveyOptions,
): string {
  const title = map.title.trim() || 'this chamber';
  const banner = map.sceneBanner
    .trim()
    .replace(/\s*[—-]\s*walls and a wooden doorway are established for this table\.?/gi, '')
    .replace(/\s+are established for this table\.?/gi, '')
    .replace(/\.\.+/g, '.')
    .trim();
  const exitFeatures = map.notableFeatures.filter(
    (feature) => feature.referenceKind === 'exit' || feature.objectKind === 'exit',
  );
  const exitNames = exitFeatures
    .map((feature) => {
      const label = exitRouteLabel(feature.label);
      if (/\s+[—-]\s+(open|closed|locked|unlocked)/i.test(label)) {
        return label;
      }
      const nearby = map.edges.find(
        (edge) =>
          edge.kind === 'door' &&
          Math.abs(edge.column - feature.column) + Math.abs(edge.row - feature.row) <= 1,
      );
      if (nearby === undefined) {
        return label;
      }
      return formatDoorPlayerFacingLabel(
        doorAuthorityFromStored(nearby.doorState),
        nearby.orientation,
      );
    })
    .filter((label) => label.length > 0);
  const uniqueExits = dedupeInspectCandidateLabels(exitNames);
  const doorEdges = map.edges.filter((edge) => edge.kind === 'door');
  // Prefer named contract exits over raw door-edge counts so prose matches the map.
  let doorLine: string;
  if (uniqueExits.length >= 2) {
    doorLine = `Visible routes: ${uniqueExits.join('; ')}.`;
  } else if (uniqueExits.length === 1) {
    doorLine =
      doorEdges.length > 1 && uniqueExits.length < doorEdges.length
        ? `One named route is clear — ${uniqueExits[0]} — while another opening is marked but not yet identified.`
        : `A single route breaks the wall ahead: ${uniqueExits[0]}.`;
  } else if (doorEdges.length === 0) {
    doorLine = 'No doorway is marked on the walls you can see.';
  } else if (doorEdges.length === 1) {
    doorLine = `A single route breaks the wall ahead: ${formatDoorPlayerFacingLabel(
      doorAuthorityFromStored(doorEdges[0]!.doorState),
      doorEdges[0]!.orientation,
    )}.`;
  } else {
    doorLine = `${doorEdges.length} openings break the walls you can see, though none are named yet.`;
  }
  const propFeatures = map.notableFeatures
    .filter((feature) => feature.referenceKind !== 'exit' && feature.objectKind !== 'exit')
    .slice(0, 4);
  const featureLine =
    propFeatures.length === 0
      ? 'Little else stands out in the lantern light.'
      : `Nearby you notice ${propFeatures
          .map((feature) => naturalFeaturePhrase(feature.label))
          .join('; ')}.`;

  const playerText = (options?.playerText ?? '').trim();
  const lowerAsk = playerText.toLowerCase();
  const isBroadSurvey =
    playerText.length === 0 ||
    /\b(?:look\s+around|peer\s+around|survey|what\s+do\s+i\s+see|surroundings|the\s+room|the\s+chamber|this\s+room)\b/i.test(
      lowerAsk,
    );

  if (!isBroadSurvey) {
    // 1. Check if the player is inspecting or reading a carried inventory item.
    const carried = options?.carriedEquipment ?? [];
    const matchedEquip = carried.find((item) => {
      const cleanName = item.name.toLowerCase().trim();
      if (cleanName.length >= 3 && lowerAsk.includes(cleanName)) return true;
      const tokens = cleanName.split(/[^a-z0-9']+/).filter((w) => w.length >= 4);
      const headNoun = tokens[tokens.length - 1];
      return headNoun !== undefined && new RegExp(`\\b${headNoun}s?\\b`, 'i').test(lowerAsk);
    });
    const matchesSceneFeatureHeadNoun = propFeatures.some((feature) => {
      const cleanFeature = shortFeatureLabel(feature.label)
        .replace(/\s*\([^)]+\)\s*$/, '')
        .toLowerCase()
        .trim();
      const tokens = cleanFeature.split(/[^a-z0-9']+/).filter((w) => w.length >= 3);
      const head = tokens[tokens.length - 1];
      return head !== undefined && new RegExp(`\\b${head}s?\\b`, 'i').test(lowerAsk);
    });
    if (matchedEquip !== undefined && !matchesSceneFeatureHeadNoun) {
      const effectClause = matchedEquip.statsSummary
        ? ` Its practical function is unmistakable (${matchedEquip.statsSummary}).`
        : '';
      return `You examine the ${matchedEquip.name.toLowerCase()} from your pack in the light of ${title}.${effectClause} ${doorLine}`
        .replace(/\.\.+/g, '.')
        .replace(/\s{2,}/g, ' ')
        .trim();
    }

    // 2. Check if the player is inspecting a specific visible scene feature (e.g., reading an open prop).
    const matchedSceneFeature = propFeatures.find((feature) => {
      const cleanFeature = shortFeatureLabel(feature.label)
        .replace(/\s*\([^)]+\)\s*$/, '')
        .toLowerCase()
        .trim();
      const tokens = cleanFeature.split(/[^a-z0-9']+/).filter((w) => w.length >= 3);
      const head = tokens[tokens.length - 1];
      return head !== undefined && new RegExp(`\\b${head}s?\\b`, 'i').test(lowerAsk);
    });

    // 3. Check if the player is examining a clue or detail established in recent Chronicle dialogue or Campaign Premise.
    const askNouns = lowerAsk
      .replace(
        /\b(?:i|my|character|the|a|an|at|on|in|to|toward|towards|near|by|around|from|with|for|of|and|carefully|closely|quietly|inspect|examine|check|look|study|read|peruse|decipher|scan|trace|search|peer|listen)\b/g,
        ' ',
      )
      .split(/[^a-z0-9']+/)
      .filter((w) => w.length >= 4);

    const corpusLines = [
      ...(options?.recentChronicleSummaries ?? []),
      ...(options?.campaignPremise ? [options.campaignPremise] : []),
      ...(banner.length > 0 ? [banner] : []),
    ];
    const matchedClueLine =
      askNouns.length > 0
        ? corpusLines
            .slice()
            .reverse()
            .find((line) => {
              const lowerLine = line.toLowerCase();
              if (lowerLine === lowerAsk) return false;
              return askNouns.some((noun) => lowerLine.includes(noun));
            })
        : undefined;

    if (matchedSceneFeature !== undefined) {
      const cleanName = shortFeatureLabel(matchedSceneFeature.label)
        .replace(/\s*\([^)]+\)\s*$/, '')
        .trim();
      const contentsNote =
        Array.isArray(matchedSceneFeature.contents) && matchedSceneFeature.contents.length > 0
          ? ` Inside you make out ${matchedSceneFeature.contents.join(', ')}.`
          : matchedClueLine
            ? ` Its details align with what is known here: ${matchedClueLine}`
            : ` Its markings and wear point toward the active leads in ${title}.`;
      return `You focus closely on the ${cleanName.toLowerCase()} in ${title}.${contentsNote} ${doorLine}`
        .replace(/\.\.+/g, '.')
        .replace(/\s{2,}/g, ' ')
        .trim();
    }

    if (matchedClueLine !== undefined) {
      const targetSubject = askNouns.slice(0, 3).join(' ');
      return `Inspecting the ${targetSubject} closely in ${title}, you confirm the signs established here: ${matchedClueLine} ${doorLine}`
        .replace(/\.\.+/g, '.')
        .replace(/\s{2,}/g, ' ')
        .trim();
    }

    // 4. Grounded improvisation for plausible room scenery or low-impact in-world action.
    const subjectPhrase = askNouns.length > 0 ? `the ${askNouns.slice(0, 3).join(' ')}` : `your surroundings`;
    return `In ${title}, you attend to ${subjectPhrase} carefully. While it yields no hidden lock or separate compartment of its own, its weathered state fits the chamber's atmosphere. ${doorLine} ${featureLine}`
      .replace(/\.\.+/g, '.')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  const lead = banner.length > 0 ? banner.replace(/\.\s*$/, '') : `You take in ${title}`;
  return `${lead}. ${doorLine} ${featureLine}`.replace(/\.\.+/g, '.').replace(/\s{2,}/g, ' ').trim();
}

/** Convert "Hearth lamp (lit)" into prose without raw database punctuation. */
function naturalFeaturePhrase(label: string): string {
  const cleaned = shortFeatureLabel(label).replace(/\s+/g, ' ').trim();
  const stateMatch = /^(.*?)\s*\((lit|unlit|intact|broken|open|closed|active|disarmed|present)\)\s*$/i.exec(
    cleaned,
  );
  if (stateMatch !== null) {
    const name = stateMatch[1]!.trim();
    const state = stateMatch[2]!.toLowerCase();
    if (state === 'lit') return `a lit ${name.toLowerCase()}`;
    if (state === 'unlit') return `an unlit ${name.toLowerCase()}`;
    if (state === 'intact') return `an intact ${name.toLowerCase()}`;
    if (state === 'broken') return `a broken ${name.toLowerCase()}`;
    if (state === 'open') return `an open ${name.toLowerCase()}`;
    if (state === 'closed') return `a closed ${name.toLowerCase()}`;
    if (state === 'active') return `an active ${name.toLowerCase()}`;
    return `${name.toLowerCase()} (${state})`;
  }
  return cleaned.toLowerCase();
}

/** Presence fiction from campaign memory — Director may decline or refer to established NPCs. */
export function buildPresenceDeclineNarration(map: MapBundleProjection | null): string {
  const where = map?.title.trim() || 'the chamber';
  // Silence is not a census: unanswered call-out must not claim the room is empty.
  return `Nobody answers from ${where}. You hear only your own movement and the quiet of the room.`;
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
  readonly npc: {
    readonly name: string;
    readonly role: string;
    readonly motive: string;
    readonly knowledge?: string;
  };
  readonly playerText: string;
  readonly mapTitle: string | null;
}): string {
  const q = options.playerText.toLowerCase();
  const name = options.npc.name;
  const where = options.mapTitle?.trim() || 'this chamber';
  const knowledge = options.npc.knowledge?.trim() ?? '';

  if (
    (/\b(beyond|past|behind|through)\b/.test(q) && /\bdoor\b/.test(q)) ||
    /boots?\s+dry/.test(q) ||
    /why should i keep/.test(q)
  ) {
    return `${name}: "Past that east door the stone stays wet, and water is pooling beyond — that's why your boots stay dry only on this side until you open it."`;
  }
  if (/\bwho are you\b|\bwhat are you\b/.test(q)) {
    return `${name}: "Name's ${name}. I map damp places so travelers don't walk blind. You're in ${where}."`;
  }
  if (/\bwhich door\b|\bleads to\b|\barchive\b/.test(q)) {
    return `${name}: "Only one door shows from here. What's beyond it isn't settled until someone opens it — I won't invent an archive for you."`;
  }
  if (/\b(?:mira|bell)\b/i.test(q)) {
    return `${name}: "Mira was carrying that copper bell when she vanished into the old mill passages. I fear she's held deeper inside — we need to find her alive and recover the bell."`;
  }
  if (/\b(?:vanished|missing|stolen|last\s+see|seen|patron|courier|backroom|cellar|masked|entered|entering|know\s+about|what\s+happened|who\s+was)\b/i.test(q)) {
    if (
      knowledge.length > 0 &&
      knowledge !== 'Present in the area.' &&
      knowledge.toLowerCase() !== options.npc.role.toLowerCase()
    ) {
      return `${name}: "Here is what I know from ${where}: ${knowledge}"`;
    }
    return `${name}: "Whoever vanished was last seen heading deeper into the passages beyond ${where}. We need to search the adjoining rooms carefully."`;
  }
  return `${name}: "Ask plainly about what we can see here. I answer from this chamber — not from places that aren't established yet."`;
}


function answerKnowledgeRecapNarration(
  memory: CampaignMemoryProjection | null,
  playerText: string,
  extras: {
    readonly banners?: readonly string[];
    readonly premiseKey?: string | null;
  } = {},
): string {
  const facts = buildPremiseFactCorpus(
    memory,
    extras.banners ?? [],
    extras.premiseKey ?? null,
  );
  const answered = answerFromCampaignFacts({ facts, queryText: playerText });
  return answered.playerFacingBody;
}

function answerContentsQueryNarration(
  map: MapBundleProjection | null,
  playerText: string,
  options: {
    readonly wantsTakeContainer?: boolean;
    readonly forceTakeFrom?: boolean;
  } = {},
): string {
  const hint = containerLabelHintFromText(playerText) ?? 'the container';
  let open = /\bopen\b/i.test(playerText) || /\binside\b/i.test(playerText);
  let label = hint;
  let authoredContents: readonly { readonly itemId: string; readonly label: string }[] | null = null;
  if (map !== null) {
    const match = map.notableFeatures.find((feature) => {
      const featureLabel = feature.label.toLowerCase();
      return hint.split(/\s+/).every((part) => featureLabel.includes(part));
    });
    if (match !== undefined) {
      label = match.label;
      if (match.objectState === 'open') {
        open = true;
      }
      if (
        match.objectState === 'closed' ||
        match.objectState === 'locked' ||
        match.lockState === 'locked'
      ) {
        open = false;
      }
      if (Array.isArray(match.contents)) {
        authoredContents = match.contents.map((item, idx) => ({
          itemId: `item-${idx + 1}`,
          label: item,
        }));
      }
    }
  }
  const wantsTakeContainer = options.wantsTakeContainer === true;
  const wantsTakeFrom =
    !wantsTakeContainer &&
    (options.forceTakeFrom === true ||
      (/\b(?:take|grab|pocket|stow)\b/i.test(playerText) && /\bfrom\b/i.test(playerText)));
  // Open empty containers report in-world empty rather than fourth-wall authoring jargon.
  const answered = answerContainerContentsQuery({
    containerLabel: label,
    view: {
      contents: wantsTakeContainer ? null : (authoredContents ?? (open ? [] : null)),
      discovery: open ? 'visible' : 'hidden',
      open,
    },
    wantsTake: wantsTakeFrom,
    wantsTakeContainer,
  });
  return answered.body;
}

async function resolveDirectorNarrateOutput(options: {
  readonly firestore: Firestore;
  readonly campaignId: string;
  readonly accountId: string;
  readonly authority: ReturnType<typeof resolveIntentAuthority>;
  readonly structured: ReturnType<typeof parsePlayerDeclaration>;
  readonly playerText?: string;
} & DirectorLiveOptions): Promise<string> {
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
    if (map !== null && map.title === 'Awaiting first scene') {
      const boot = bootstrapBlankFirstScene();
      map = {
        ...map,
        title: boot.sceneTitle,
        sceneBanner: boot.sceneBanner,
        edges: boot.edges,
        notableFeatures: boot.notableFeatures,
      };
    }
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

  if (inspectHint === 'knowledge_recap' || inspectHint === 'rules_query') {
    const playerAsk = (options.playerText ?? options.structured.rawText ?? '').trim();
    const extras = await loadScenePremiseExtras({
      firestore: options.firestore,
      campaignId: options.campaignId,
      accountId: options.accountId,
    });
    return answerKnowledgeRecapNarration(memory, playerAsk || options.authority.summary, extras);
  }

  if (inspectHint === 'contents_query') {
    const playerAsk = (options.playerText ?? options.structured.rawText ?? '').trim();
    return answerContentsQueryNarration(map, playerAsk);
  }

  if (
    inspectHint === 'scene_perception' ||
    inspectHint === 'sensory_sequence' ||
    inspectHint === 'unlocked door' ||
    inspectHint === 'read_text' ||
    (!isDialogue &&
      inspectHint === null &&
      options.authority.disposition === 'director_narrate_only')
  ) {
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
      const playerAsk = (options.playerText ?? options.structured.rawText ?? '').trim();
      let contextPack: Awaited<ReturnType<typeof assembleDirectorVisibleContext>> | null = null;
      let carriedEquipment: readonly { readonly name: string; readonly statsSummary?: string }[] = [];
      try {
        contextPack = await assembleDirectorVisibleContext({
          firestore: options.firestore,
          campaignId: options.campaignId,
          accountId: options.accountId,
        });
      } catch {
        contextPack = null;
      }
      try {
        const rules = await fetchRulesState({
          firestore: options.firestore,
          accountId: options.accountId,
          campaignId: options.campaignId,
        });
        carriedEquipment = rules.progression?.sheet.equipment ?? [];
      } catch {
        carriedEquipment = [];
      }
      const deterministic = buildSceneSurveyNarration(map, {
        playerText: playerAsk,
        recentChronicleSummaries: contextPack?.recentChronicleSummaries ?? [],
        campaignPremise: contextPack?.campaignPremise ?? null,
        carriedEquipment,
      });
      // Prefer live Director prose grounded in the visible-state pack; never invent unseen places.
      try {
        const director = await loadDirectorConfig(options.firestore, options.campaignId);
        const context =
          contextPack ??
          (await assembleDirectorVisibleContext({
            firestore: options.firestore,
            campaignId: options.campaignId,
            accountId: options.accountId,
          }));
        const liveBody = await tryLiveProse(options, {
          systemInstruction: `${directorVoiceBlock(director.identity, director.personality)} ${DIRECTOR_SAFETY_RULES} The player is examining a detail, reading an item, or taking an in-world action right now. Answer in 2–4 vivid sentences using the Visible state pack, Campaign Premise, Recent Chronicle clues, and the deterministic survey seed. Affirm and coherently describe any clues, markings, trails, or details established in the Campaign Premise or Recent Chronicle dialogue, or any carried equipment item in their pack. If the player examines plausible room scenery/furnishings visible in the chamber's atmosphere, describe it naturally and tie your observation back to the room's active leads and visible routes — never flatly deny visible scenery with "There is no <object> laid out before you". Do not invent unlisted mechanical locks, keys, rooms, NPCs, or lootable item grants. Do not ask what they are trying to do or lecture on command syntax. Do not propose a Confirmable command. Never cite internal grid coordinates.`,
          userPrompt: `${context.text}\n\nDeterministic survey seed (must stay consistent):\n${deterministic}\n\nPlayer declaration:\n${playerAsk || 'I look around.'}`,
        });
        if (liveBody !== null && liveBody.trim().length > 0) {
          return scrubEngineCoordinates(liveBody.trim());
        }
      } catch {
        // Fall through to deterministic survey.
      }
      return deterministic;
    }
    return 'You look and listen. The visible scene holds steady — nothing unseen invents itself from your words.';
  }

  if (
    inspectHint === 'take_item' ||
    inspectHint === 'take_container' ||
    inspectHint === 'take_from_container'
  ) {
    const playerAsk = options.playerText ?? options.structured.rawText;
    if (inspectHint === 'take_item' && containerLabelHintFromText(playerAsk) === null) {
      const visibleProps =
        map?.notableFeatures
          .filter((f) => f.objectKind !== 'npc' && f.objectKind !== 'exit')
          .map((f) => shortFeatureLabel(f.label)) ?? [];
      const list = visibleProps.length > 0 ? visibleProps.join(', ') : 'nothing loose to pocket';
      return `You look around ${map?.title ?? 'the area'} for what you can carry, spotting ${list}. Move beside a portable item on the map and declare taking it to stow it in your gear.`;
    }
    return answerContentsQueryNarration(map, playerAsk, {
      wantsTakeContainer: inspectHint === 'take_container',
      forceTakeFrom: inspectHint === 'take_from_container',
    });
  }

  // Door-ear / door-state only — sensory_sequence (window, lantern, room listen) stays
  // on the scene_perception path so Veyra does not hijack it into the nearest doorway.
  if (inspectHint === 'door_state' || inspectHint === 'listen') {
    if (map !== null) {
      const closed = map.edges.filter((edge) => edge.kind === 'door' && edge.doorState !== 'open');
      const open = map.edges.filter((edge) => edge.kind === 'door' && edge.doorState === 'open');
      // Prefer an adjacent door when the party has one; otherwise closed before open.
      const door = closed[0] ?? open[0] ?? null;
      if (door !== null) {
        const authority = doorAuthorityFromStored(door.doorState);
        const facing = door.orientation;
        const label = formatDoorPlayerFacingLabel(authority, facing);
        if (inspectHint === 'listen') {
          const hideClause = /\b(?:hide|conceal|crouch|kneel|hunker|duck\s+behind|take\s+cover)\b/i.test(
            options.playerText ?? options.structured.rawText,
          )
            ? ' Crouching here does not establish a Hide on the table.'
            : '';
          const waitClause = /\b(?:wait|minute|hold\s+(?:still|position)|pause)\b/i.test(
            options.playerText ?? options.structured.rawText,
          )
            ? ' A short wait passes in the fiction before you catch the sound.'
            : '';
          return authority.leaf === 'open'
            ? `You listen toward ${label}.${waitClause}${hideClause} The leaf is already open; quiet air moves through the passage — nothing forces a roll.`
            : `You press an ear toward ${label}.${waitClause}${hideClause} Beyond the wood you hear only the quiet of the established chamber — nothing that opens the door for you.`;
        }
        if (authority.leaf === 'open') {
          return `You check ${label} without forcing it. The leaf is already open on the table; there is no closed lock to test. The doorway stays open.`;
        }
        const lockLine =
          authority.lock === 'locked'
            ? 'The mechanism is locked.'
            : authority.lock === 'unlocked'
              ? 'The lock is unlocked; the leaf is still closed.'
              : 'From a casual check it looks closed and ordinary.';
        return `You check ${label} without opening it. ${lockLine} The doorway stays shut on the table.`;
      }
    }
    return inspectHint === 'listen'
      ? 'You listen at the doorway. Nothing answers through the wood, and the door stays closed.'
      : 'You check the doorway without opening it. It remains closed on the table.';
  }

  // Explicit map-summary / door-state corrections: answer from live edges, never baked labels.
  const correctionText = options.structured.rawText.toLowerCase();
  if (
    inspectHint === 'map_state_correction' ||
    ((/\b(summary|routes?|map)\b/.test(correctionText) &&
      /\b(closed|open|wrong|still|says?|show|showing|fix|correct|update)\b/.test(
        correctionText,
      )) ||
      (/\b(door|doorway)\b/.test(correctionText) &&
        /\b(already\s+open|is\s+open|says?\s+closed|still\s+closed|summary)\b/.test(
          correctionText,
        )))
  ) {
    if (map !== null) {
      const liveRoutes = formatMapRouteSummary(map);
      const openDoors = map.edges.filter((edge) => edge.kind === 'door' && edge.doorState === 'open');
      if (openDoors.length > 0) {
        return `You're right to check. Live table state: ${liveRoutes}. The doorway is already open on the map — the route line now matches that open state. No further Confirm is required for this correction.`;
      }
      return `Live table state: ${liveRoutes}. That is the authoritative door summary for this scene.`;
    }
    return 'No door routes are on the table yet to reconcile.';
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
    if (map !== null) {
      const mapNpcs = map.notableFeatures
        .filter((f) => f.referenceKind === 'npc')
        .map((f) => f.label.replace(/\s+[—–-]\s+\w+$/u, '').trim())
        .filter((label) => label.length > 0);
      if (mapNpcs.length > 0) {
        return mapNpcs.length === 1
          ? `${mapNpcs[0]} is here with you. Address them by name if you want to speak.`
          : `${mapNpcs.slice(0, -1).join(', ')} and ${mapNpcs[mapNpcs.length - 1]} are here. Address someone by name if you want to speak.`;
      }
    }
    return buildPresenceDeclineNarration(map);
  }

  if (isDialogue && options.structured.addressee !== null) {
    const name = options.structured.addressee;
    const npc =
      memory?.npcs.find(
        (entry) => entry.name.toLowerCase() === name.toLowerCase() || entry.npcId === name,
      ) ?? null;
    const sceneNpc =
      map?.notableFeatures.find(
        (f) =>
          f.referenceKind === 'npc' &&
          f.label.toLowerCase().includes(name.toLowerCase()),
      ) ?? null;

    // Check if the player is speaking to an established NPC who is absent/missing from this scene
    const isMissingNpc =
      npc !== null &&
      (/missing/i.test(npc.role) || /awaiting rescue/i.test(npc.motive));
    const sceneHasNpcFeatures =
      map !== null && map.notableFeatures.some((f) => f.referenceKind === 'npc');

    if (sceneNpc === null && isMissingNpc && map !== null && sceneHasNpcFeatures) {
      const presentNames = map.notableFeatures
        .filter((f) => f.referenceKind === 'npc')
        .map((f) => f.label.replace(/\s+[—–-]\s+\w+$/u, '').trim())
        .filter((l) => l.length > 0);
      const presentNote =
        presentNames.length > 0 ? ` ${presentNames.join(', ')} is waiting here.` : '';
      return `${name} is not present in this room — they vanished before the party arrived and must be rescued.${presentNote}`;
    }

    // If the NPC is known in campaign memory or in a previous room but not present in this room
    const returnExitFeature = map?.notableFeatures.find(
      (f) =>
        (f.referenceKind === 'exit' || f.objectKind === 'exit') &&
        /\b(?:passage\s+back\s+to|return\s+to|back\s+to)\b/i.test(f.label),
    );
    if (sceneNpc === null && returnExitFeature !== undefined) {
      const returnRoomMatch = returnExitFeature?.label.match(
        /\b(?:passage\s+back\s+to|return\s+to|back\s+to)\s+(.+)$/i,
      );
      const locationNote = returnRoomMatch?.[1]
        ? `back in ${returnRoomMatch[1].trim()}`
        : /tavern/i.test(memory?.chapters[0]?.title ?? '')
          ? 'in the tavern'
          : 'in the previous area';
      const displayNpc = npc?.name ?? name;
      return `${displayNpc} is not in this room right now — they remain ${locationNote}, out of earshot from here.`;
    }
    const cleanName = sceneNpc?.label.replace(/\s+[—–-]\s+\w+$/u, '').trim() || npc?.name || name;
    try {
      const director = await loadDirectorConfig(options.firestore, options.campaignId);
      const context = await assembleDirectorVisibleContext({
        firestore: options.firestore,
        campaignId: options.campaignId,
        accountId: options.accountId,
      });
      const playerAsk = (options.playerText ?? options.structured.rawText ?? '').trim();
      const liveBody = await tryLiveProse(options, {
        systemInstruction: `${directorVoiceBlock(director.identity, director.personality)} ${DIRECTOR_SAFETY_RULES} The player is speaking to ${cleanName}, who is present in the current scene. Reply in 2–4 vivid sentences in-world, including ${cleanName}'s spoken response in quotes grounded in the Visible state pack and campaign context. If asked about missing persons, clues, or quest objects, have ${cleanName} share what they know from the premise and guide the player toward the next passage or investigation. Do not ask what they are trying to do. Do not propose a Confirmable command. Never cite internal grid coordinates.`,
        userPrompt: `${context.text}\n\nPlayer addresses ${cleanName}:\n${playerAsk}`,
      });
      if (liveBody !== null && liveBody.trim().length > 0) {
        return scrubEngineCoordinates(liveBody.trim());
      }
    } catch {
      // Fall through to deterministic NPC reply.
    }
    return buildNpcDialogueReply({
      npc: npc ?? { name: cleanName, role: 'present contact', motive: 'share what is known here' },
      playerText: options.structured.rawText,
      mapTitle: map?.title ?? null,
    });
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
  'When mechanics say "no trap found" or that the character cannot tell, narrate only what they detect — never absolute safety, omniscient clearance, or that the area is completely free of traps.',
  'Keep narration scoped to the named target in the mechanics summary (for example the wooden doorway east); never replace that name with vague phrases like the area, the room, or the target.',
  'If framing tags are present (crit, finishing_blow, near_miss, heroic_failure, bold_stunt, overkill), lean into cinematic emphasis for that beat without altering the outcome.',
  'Write in second person. Keep paragraphs short. Do not open with a title or heading.',
  'If the player tried something not present in the scene state, clarify the gap in-world without granting it.',
].join(' ');

function looksMechanical(text: string): boolean {
  return /(can i|could i|would it|action economy|bonus action|reaction|spell slot|magic missile|climb|athletics|acrobatics|check|save|attack|cast|legal|rules|how many|do i have|proficiency|trap|disarm|lockpick|thieves)/i.test(
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
      return ' Floorboards creak in wry commentary as the silence returns.';
    case 'dry_storyteller':
      return ' Torchlight settles; whatever fortune awaits here remains unspoken.';
    case 'dramatic_chronicler':
      return ' Long shadows stretch across the room as the tension holds.';
    case 'friendly_adventurer':
      return ' A warm draft stirs the lantern glow, inviting the next bold step.';
    case 'encouraging_guide':
      return ' The chamber lies steady, leaving clear paths open ahead.';
    case 'seasoned_host':
    default:
      return ' Lantern light glints across the worn timber as the quiet settles in.';
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
      return ' The air holds its breath just long enough to feel deliberate.';
    case 'dry_storyteller':
      return ' Dust settles, torchlight flickers, and the chamber steadies around you.';
    case 'dramatic_chronicler':
      return ' Shadows coil along the stonework as the consequence sinks into the room.';
    case 'friendly_adventurer':
      return ' The quiet between heartbeats leaves room for what comes next.';
    case 'encouraging_guide':
      return ' The stillness offers a clear moment to weigh the next move.';
    case 'seasoned_host':
    default:
      return ' Drafts whisper past the threshold while the chamber waits.';
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
].join(' ');

const CONSULT_SAFETY_RULES = [
  DIRECTOR_SAFETY_RULES,
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

/** Active chapter beat (goal / clue / next trigger + leveling curve pacing) for the Director prompt; empty when unavailable. */
async function loadBlueprintBeatPrompt(
  firestore: Firestore,
  campaignId: string,
): Promise<string> {
  try {
    const snap = await firestore.collection(COLLECTIONS.campaigns).doc(campaignId).get();
    const blueprint = (snap.data() as { campaignBlueprint?: unknown } | undefined)
      ?.campaignBlueprint;
    if (!isCampaignBlueprint(blueprint)) {
      return '';
    }
    let sceneDepth = 0;
    let activeSceneId: string | null = null;
    try {
      const { loadMapRuntime } = await import('../table/map-runtime.js');
      const runtime = await loadMapRuntime(firestore, campaignId);
      sceneDepth = runtime.sceneStack?.length ?? 0;
      activeSceneId = runtime.activeSceneId ?? null;
    } catch {
      sceneDepth = 0;
    }
    let currentLevel = blueprint.startLevel ?? 1;
    let currentXp = 0;
    try {
      const seatsSnap = await firestore
        .collection(COLLECTIONS.campaignSeats)
        .where('campaignId', '==', campaignId)
        .get();
      const firstCharacterId = (
        seatsSnap.docs[0]?.data() as { characterId?: string } | undefined
      )?.characterId;
      if (typeof firstCharacterId === 'string' && firstCharacterId.length > 0) {
        const progSnap = await firestore
          .collection(COLLECTIONS.characterProgressions)
          .doc(firstCharacterId)
          .get();
        const progData = progSnap.data() as
          | { level?: number; experiencePoints?: number }
          | undefined;
        if (typeof progData?.level === 'number') {
          currentLevel = progData.level;
        }
        if (typeof progData?.experiencePoints === 'number') {
          currentXp = progData.experiencePoints;
        }
      }
    } catch {
      // Best-effort party progression lookup.
    }
    const beat = selectActiveBlueprintBeat(blueprint, sceneDepth);
    return beat === null
      ? ''
      : `\n\n${formatBlueprintBeatPrompt(beat, {
          blueprint,
          currentLevel,
          currentXp,
          activeSceneId,
        })}`;
  } catch {
    return '';
  }
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

  let proposedCommandType: IntentDraftCommandType = 'table.sync';
  let summary =
    'I heard your declaration. Confirm only commits what the table can resolve right now.';
  let path: IntentInterpretResponse['path'];
  let edgeId: string | undefined;
  let objectId: string | undefined;
  let destinationHint: string | undefined;
  let returnToPrevious: boolean | undefined;
  let premise: string | undefined;
  let targetCombatantId: string | undefined;
  let spellId: string | undefined;
  let itemId: string | undefined;
  let declaredFoes: readonly { readonly name: string }[] | undefined;
  let arcaneRecovery: boolean | undefined;
  let skillCheckIntent: import('../../shared/intent-draft-contract.js').SkillCheckIntent | undefined;
  let projectionVersionAtIssue: number | undefined;

  let encounter: EncounterProjection | null = null;
  let seatedSheet: import('../../shared/character-contract.js').DerivedCharacterSheet | null = null;
  let rulesProgressionClassLabel: string | null = null;
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
    if (typeof rules.progression?.classId === 'string') {
      rulesProgressionClassLabel = findClass(rules.progression.classId)?.label ?? null;
    }
    projectionVersionAtIssue = table.stateVersion;
  } catch {
    encounter = null;
    seatedSheet = null;
    rulesProgressionClassLabel = null;
  }

  let knownNpcs: { id: string; label: string }[] = [];
  let presentNpcRecords: { id: string; label: string }[] = [];
  let absentRoomNpcs: { id: string; label: string; roomTitle: string }[] = [];
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
  try {
    const { loadMapRuntime } = await import('../table/map-runtime.js');
    const runtime = await loadMapRuntime(options.firestore, options.campaignId);
    const activeScene =
      runtime.activeSceneId !== null && runtime.activeSceneId !== undefined
        ? runtime.sceneInstances?.[runtime.activeSceneId]
        : undefined;
    const activeNpcNames = new Set<string>();
    if (activeScene !== undefined) {
      for (const feature of activeScene.features) {
        if (feature.objectKind === 'npc' || feature.referenceKind === 'npc') {
          const cleanLabel = feature.label
            .replace(/\s+[—–-]\s+.*$/u, '')
            .replace(/\s*\([^)]*\)\s*$/u, '')
            .trim();
          if (cleanLabel.length > 0) {
            activeNpcNames.add(cleanLabel.toLowerCase());
            if (!presentNpcRecords.some((entry) => entry.label.toLowerCase() === cleanLabel.toLowerCase())) {
              presentNpcRecords.push({ id: feature.objectId, label: cleanLabel });
            }
            if (!knownNpcs.some((entry) => entry.label.toLowerCase() === cleanLabel.toLowerCase())) {
              knownNpcs.push({ id: feature.objectId, label: cleanLabel });
            }
          }
        }
      }
      let previousRoomTitle = 'the previous chamber';
      for (const [sceneId, sceneInst] of Object.entries(runtime.sceneInstances ?? {})) {
        if (sceneId === runtime.activeSceneId || !sceneInst) continue;
        if (sceneId === 'scene-m1-r1' || (runtime.sceneStack ?? []).includes(sceneId)) {
          previousRoomTitle = sceneInst.title || previousRoomTitle;
        }
        for (const feature of sceneInst.features ?? []) {
          if (feature.objectKind === 'npc' || feature.referenceKind === 'npc') {
            const cleanLabel = feature.label
              .replace(/\s+[—–-]\s+.*$/u, '')
              .replace(/\s*\([^)]*\)\s*$/u, '')
              .trim();
            if (cleanLabel.length > 0 && !activeNpcNames.has(cleanLabel.toLowerCase())) {
              if (!absentRoomNpcs.some((entry) => entry.label.toLowerCase() === cleanLabel.toLowerCase())) {
                absentRoomNpcs.push({
                  id: feature.objectId,
                  label: cleanLabel,
                  roomTitle: sceneInst.title || 'the previous chamber',
                });
              }
            }
          }
        }
        const bannerText = `${sceneInst.sceneBanner ?? ''} ${sceneInst.description ?? ''}`;
        const bannerMatch = /\b([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)+)\s+is\s+(?:waiting|here)\b/.exec(
          bannerText,
        );
        if (bannerMatch !== null) {
          const bannerNpc = bannerMatch[1]!.trim();
          if (
            bannerNpc.length > 0 &&
            !activeNpcNames.has(bannerNpc.toLowerCase()) &&
            !absentRoomNpcs.some((entry) => entry.label.toLowerCase() === bannerNpc.toLowerCase())
          ) {
            absentRoomNpcs.push({
              id: `${sceneId}:npc-banner`,
              label: bannerNpc,
              roomTitle: sceneInst.title || 'the previous chamber',
            });
          }
        }
      }
      // Also mark any memory NPCs who are not in the active room when the party is in a secondary room
      const isSecondaryRoom =
        (runtime.sceneStack?.length ?? 0) > 0 ||
        (runtime.activeSceneId !== null &&
          runtime.activeSceneId !== undefined &&
          runtime.activeSceneId !== 'scene-m1-r1' &&
          Object.keys(runtime.sceneInstances ?? {}).length > 1);
      if (isSecondaryRoom) {
        for (const memNpc of knownNpcs) {
          if (
            !activeNpcNames.has(memNpc.label.toLowerCase()) &&
            !absentRoomNpcs.some((entry) => entry.label.toLowerCase() === memNpc.label.toLowerCase())
          ) {
            absentRoomNpcs.push({
              id: memNpc.id,
              label: memNpc.label,
              roomTitle: previousRoomTitle,
            });
          }
        }
      }
    }
  } catch {
    // Active scene NPC lookup is best-effort.
  }

   // 1. Attempt AI Director Mechanics Dispatcher (Arbiter) first
  let aiDispatched = false;
  try {
    const map = await fetchCampaignMap({
      firestore: options.firestore,
      accountId: options.accountId,
      campaignId: options.campaignId,
    });
    const ownToken =
      map.viewerSeatId === null
        ? map.tokens[0]
        : (map.tokens.find((t) => t.seatId === map.viewerSeatId) ?? map.tokens[0]);
    const visibleFeatures = map.notableFeatures.map((f) => f.label);
    const doors = map.edges
      .filter((e) => e.kind === 'door')
      .map((e) =>
        formatDoorPlayerFacingLabel(
          doorAuthorityFromStored(e.doorState),
          e.orientation,
        ),
      );
    const presentNpcs = map.notableFeatures
      .filter((f) => f.objectKind === 'npc' || f.referenceKind === 'npc')
      .map((f) => f.label);
    const feetPerSq = map.coordinateSpace.feetPerSquare || 5;
    const anchor = ownToken?.footprint.anchor;
    const spatialObjects: string[] = [];
    if (anchor !== undefined) {
      for (const f of map.notableFeatures) {
        const distFt =
          Math.max(Math.abs(anchor.column - f.column), Math.abs(anchor.row - f.row)) * feetPerSq;
        spatialObjects.push(`${f.label} at (${f.column},${f.row}) [${distFt} ft away]`);
      }
      for (const e of map.edges.filter((edge) => edge.kind === 'door')) {
        const distFt =
          Math.max(Math.abs(anchor.column - e.column), Math.abs(anchor.row - e.row)) * feetPerSq;
        const dLabel = formatDoorPlayerFacingLabel(
          doorAuthorityFromStored(e.doorState),
          e.orientation,
        );
        spatialObjects.push(`${dLabel} at (${e.column},${e.row}) [${distFt} ft away]`);
      }
    }
    const equippedItems =
      seatedSheet?.equipment.filter((item) => item.equipped).map((item) => item.name) ?? [];

    const dispatch = await queryDirectorMechanicsArbiter({
      rawText,
      sceneTitle: map.title,
      sceneDescription: map.sceneBanner ?? undefined,
      playerPosition: anchor,
      spatialObjects,
      equippedItems,
      visibleFeatures,
      doors,
      presentNpcs,
      knownNpcs: knownNpcs.map((n) => n.label),
      characterName: ownToken?.label ?? 'Adventurer',
      characterClass: rulesProgressionClassLabel ?? undefined,
      characterLevel: seatedSheet?.level ?? 1,
      llm: options.llm,
      env: {
        HD_ENVIRONMENT_CLASS: options.environmentClass,
        HD_FIREBASE_PROJECT_ID: options.firebaseProjectId,
        GEMINI_API_KEY: process.env.GEMINI_API_KEY,
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
      },
    });

    if (dispatch !== null) {
      const applied = applyDirectorDispatchToMap({
        dispatch,
        map,
        seatedSheet,
        knownNpcs,
        absentRoomNpcs,
      });
      if (applied !== null) {
        proposedCommandType = applied.proposedCommandType;
        summary = applied.summary;
        if (applied.path) path = applied.path;
        if (applied.edgeId) edgeId = applied.edgeId;
        if (applied.objectId) objectId = applied.objectId;
        if (applied.returnToPrevious !== undefined) returnToPrevious = applied.returnToPrevious;
        if (applied.destinationHint) destinationHint = applied.destinationHint;
        if (applied.skillCheckIntent !== undefined) skillCheckIntent = applied.skillCheckIntent;
        if (applied.deferDirectorNarrate) {
          const structured = parsePlayerDeclaration(rawText, {
            knownNpcs,
            presentNpcs: presentNpcRecords,
          });
          const authority = resolveIntentAuthority(structured);
          summary = scrubPlayerFacingIntentCopy(
            await resolveDirectorNarrateOutput({
              firestore: options.firestore,
              campaignId: options.campaignId,
              accountId: options.accountId,
              authority,
              structured,
              playerText: rawText,
              ...(options.environmentClass !== undefined
                ? { environmentClass: options.environmentClass }
                : {}),
              ...(options.firebaseProjectId !== undefined
                ? { firebaseProjectId: options.firebaseProjectId }
                : {}),
              ...(options.llm !== undefined ? { llm: options.llm } : {}),
            }),
          );
        }
        aiDispatched = true;
      }
    }
  } catch {
    // Graceful fallback to deterministic parsing
  }

  if (!aiDispatched) {
    const fallback = await resolveDeterministicIntentFallback({
      firestore: options.firestore,
      campaignId: options.campaignId,
      accountId: options.accountId,
      rawText,
      moveTarget: options.moveTarget,
      encounter,
      seatedSheet,
      rulesProgressionClassLabel,
      knownNpcs,
      presentNpcs: presentNpcRecords,
      absentRoomNpcs,
    });
    proposedCommandType = fallback.proposedCommandType;
    summary = fallback.summary;
    if (fallback.path !== undefined) path = fallback.path;
    if (fallback.edgeId !== undefined) edgeId = fallback.edgeId;
    if (fallback.objectId !== undefined) objectId = fallback.objectId;
    if (fallback.destinationHint !== undefined) destinationHint = fallback.destinationHint;
    if (fallback.returnToPrevious !== undefined) returnToPrevious = fallback.returnToPrevious;
    if (fallback.premise !== undefined) premise = fallback.premise;
    if (fallback.targetCombatantId !== undefined) targetCombatantId = fallback.targetCombatantId;
    if (fallback.spellId !== undefined) spellId = fallback.spellId;
    if (fallback.itemId !== undefined) itemId = fallback.itemId;
    if (fallback.declaredFoes !== undefined) declaredFoes = fallback.declaredFoes;
    if (fallback.arcaneRecovery !== undefined) arcaneRecovery = fallback.arcaneRecovery;
    if (fallback.skillCheckIntent !== undefined) skillCheckIntent = fallback.skillCheckIntent;

    if (fallback.deferDirectorNarrate) {
      summary = scrubPlayerFacingIntentCopy(
        await resolveDirectorNarrateOutput({
          firestore: options.firestore,
          campaignId: options.campaignId,
          accountId: options.accountId,
          authority: fallback.authority,
          structured: fallback.structured,
          playerText: rawText,
          ...(options.environmentClass !== undefined
            ? { environmentClass: options.environmentClass }
            : {}),
          ...(options.firebaseProjectId !== undefined
            ? { firebaseProjectId: options.firebaseProjectId }
            : {}),
          ...(options.llm !== undefined ? { llm: options.llm } : {}),
        }),
      );
    }
  }

  const skipLiveRewrite =
    aiDispatched ||
    proposedCommandType === 'table.build_scene' ||
    proposedCommandType === 'table.sync' ||
    proposedCommandType === 'table.move' ||
    proposedCommandType === 'table.open_door' ||
    proposedCommandType === 'table.take_scene_prop' ||
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

  const declaration = rawText.trim().slice(0, 500);
  // Confirmable drafts must not pollute Story so far until Confirm (TQA-005 / TQA-078).
  // Clarifications and Director-only narration chronicle immediately.
  const chronicleImmediately =
    declaration.length > 0 &&
    proposedCommandType === 'table.sync' &&
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
    ...(objectId !== undefined ? { objectId } : {}),
    ...(destinationHint !== undefined ? { destinationHint } : {}),
    ...(returnToPrevious === true ? { returnToPrevious: true } : {}),
    ...(premise !== undefined ? { premise } : {}),
    ...(targetCombatantId !== undefined ? { targetCombatantId } : {}),
    ...(spellId !== undefined ? { spellId } : {}),
    ...(itemId !== undefined ? { itemId } : {}),
    ...(declaredFoes !== undefined && declaredFoes.length > 0 ? { declaredFoes } : {}),
    ...(arcaneRecovery === true ? { arcaneRecovery: true } : {}),
    ...(skillCheckIntent !== undefined ? { skillCheckIntent } : {}),
    ...(projectionVersionAtIssue !== undefined ? { projectionVersionAtIssue } : {}),
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
      } Declare the action in the ${PLAY_CHANNEL_LABEL} when you are ready — this consult does not resolve it.`
    : `${name} (${DIRECTOR_PERSONALITY_LABELS[director.personality]}) answers from the visible scene only. The table does not move from Ask the Director. Use the ${PLAY_CHANNEL_LABEL} to declare what you do.`;

  const beatPrompt = mechanical
    ? ''
    : await loadBlueprintBeatPrompt(options.firestore, options.campaignId);
  const liveBody = await tryLiveProse(options, {
    systemInstruction: `${directorVoiceBlock(director.identity, director.personality)} ${CONSULT_SAFETY_RULES} ${
      mechanical ? ARBITER_CONSTITUTION : `${ARBITER_CONSTITUTION} Also answer scene questions without inventing unseen detail.`
    } Never cite internal grid coordinates such as c4r3 — describe doors and props by player-facing names and directions only.`,
    userPrompt: `${context.text}${beatPrompt}\n\nPlayer ask-the-DM message:\n${text}`,
  });

  // Shared fact corpus with Play — Ask must not invent beyond established/inferred facts.
  let askMemory: CampaignMemoryProjection | null = null;
  try {
    askMemory = await loadCampaignMemory(
      options.firestore,
      options.campaignId,
      options.accountId,
    );
  } catch {
    askMemory = null;
  }
  const understanding = understandUtterance(text);
  let body = scrubEngineCoordinates(liveBody ?? simulatorBody);
  if (understanding.wantsKnowledgeRecap || (!mechanical && understanding.speechAct === 'rules_query')) {
    const extras = await loadScenePremiseExtras({
      firestore: options.firestore,
      campaignId: options.campaignId,
      accountId: options.accountId,
    });
    body = answerKnowledgeRecapNarration(askMemory, text, extras);
  } else if (understanding.wantsContentsQuery) {
    let askMap: MapBundleProjection | null = null;
    try {
      askMap = await fetchCampaignMap({
        firestore: options.firestore,
        accountId: options.accountId,
        campaignId: options.campaignId,
      });
    } catch {
      askMap = null;
    }
    body = answerContentsQueryNarration(askMap, text);
  }

  // Only suggest a Play draft when the same interpreter would propose a real command.
  let actionDraftSuggestion: DirectorAddressResponse['actionDraftSuggestion'] = null;
  if (
    !understanding.wantsKnowledgeRecap &&
    !understanding.wantsContentsQuery &&
    understanding.speechAct !== 'question' &&
    understanding.speechAct !== 'rules_query' &&
    understanding.speechAct !== 'ooc_instruction'
  ) {
    const structured = parsePlayerDeclaration(text);
    const authority = resolveIntentAuthority(structured);
    if (
      authority.disposition === 'propose_command' &&
      authority.proposedCommandType !== null &&
      authority.proposedCommandType !== 'table.sync'
    ) {
      let boundFields: Partial<NonNullable<DirectorAddressResponse['actionDraftSuggestion']>> = {};
      try {
        const resolved = await resolveDeterministicIntentFallback({
          firestore: options.firestore,
          campaignId: options.campaignId,
          accountId: options.accountId,
          rawText: text,
          encounter: null,
          seatedSheet: null,
          rulesProgressionClassLabel: null,
          knownNpcs: [],
        });
        boundFields = {
          ...(resolved.path !== undefined ? { path: resolved.path } : {}),
          ...(resolved.edgeId !== undefined ? { edgeId: resolved.edgeId } : {}),
          ...(resolved.objectId !== undefined ? { objectId: resolved.objectId } : {}),
          ...(resolved.destinationHint !== undefined
            ? { destinationHint: resolved.destinationHint }
            : {}),
          ...(resolved.returnToPrevious === true ? { returnToPrevious: true } : {}),
          ...(resolved.skillCheckIntent !== undefined
            ? { skillCheckIntent: resolved.skillCheckIntent }
            : {}),
        };
      } catch {
        boundFields = {};
      }
      actionDraftSuggestion = {
        draftId: randomUUID(),
        summary: authority.summary,
        proposedCommandType: authority.proposedCommandType,
        ...boundFields,
      };
    }
  }

  return {
    responseId: randomUUID(),
    campaignId: options.campaignId,
    body,
    mutatesState: false,
    directorIdentityLabel: name,
    directorIdentity: director.identity,
    directorPersonality: director.personality,
    consultMode,
    actionDraftSuggestion,
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
  const beatPrompt = await loadBlueprintBeatPrompt(options.firestore, options.campaignId);
  const liveBody = await tryLiveProse(options, {
    systemInstruction: `${directorVoiceBlock(director.identity, director.personality)} ${DIRECTOR_SAFETY_RULES} ${NARRATOR_CONSTITUTION} Match narration density "${effectiveDensity}" (concise = short; balanced = a beat of flavor; cinematic = richer sensory detail without new facts). Write 2 to 4 complete sentences only — never end mid-clause or on a dangling word like "without".${emphasis}`,
    userPrompt: `${context.text}\n\nMechanics summary (authoritative — narrate ONLY this beat; recent table events are background, not this beat):\n${options.mechanicsSummary}\n\nLocation continuity: unless that summary explicitly reports a scene or location change, the current chamber stays current. A doorway step on the same map is not a departure — do not say anyone left the chamber behind or arrived somewhere new. If the summary says the leaf closed, do not describe an open way, clear passage, or trap inspection. If the player declared without touching / no contact, describe only visual inspection — never fingers, feeling, pressing, or brushing the object.\nClosed-world scene manifest rule: NEVER invent keys, chests, levers, traps, or locks in prose that do not exist in the active scene manifest or mechanics summary. If opening an unauthored container (satchel, pack, chest, box), its contents are unauthored and empty. Do NOT invent items, letters, tools, or clues inside it. Never promise or hint at unseen items or what someone left behind.\nDoor state rule: An unlocked door is CLOSED (leaf is shut, latch is unlocked). Never describe a closed door as open, ajar, or swung wide unless its leaf is explicitly "open".${beatPrompt}`,
  });
  const liveCandidate =
    liveBody !== null ? scrubIncompleteDirectorProse(liveBody) : null;
  const preferSimulated =
    liveBody === null ||
    liveCandidate === null ||
    liveCandidate.length === 0 ||
    looksLikeTruncatedDirectorProse(liveBody) ||
    looksLikeTruncatedDirectorProse(liveCandidate);
  const body = scrubEngineCoordinates(
    scrubClosedDoorCalledOpen(
      scrubInventedContainerContents(
        scrubExpandedInspectScope(
          scrubFalseTrapCertainty(
            scrubFalseSceneDeparture(
              scrubStaleDoorCloseNarration(
                scrubNoTouchConstraint(
                  preferSimulated ? simulated.body : liveCandidate,
                  options.mechanicsSummary,
                ),
                options.mechanicsSummary,
              ),
              options.mechanicsSummary,
            ),
            options.mechanicsSummary,
          ),
          options.mechanicsSummary,
        ),
        options.mechanicsSummary,
      ),
      options.mechanicsSummary,
    ),
  );
  const humorApplied = preferSimulated ? simulated.humorApplied : effectiveDensity !== 'concise';
  const fallbackUsed = liveGeminiEnabled(options) && preferSimulated;
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
    fallbackUsed,
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

