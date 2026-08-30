/**
 * Campaign table shell: map stage, Communication Dock, and Action Composer.
 *
 * Blueprint ownership: Sections 1.5.2.1–1.5.2.5 and Phase 2 map/Pixi stage.
 * Party Chat stays social-only. Table sync uses the command gateway.
 * The Pixi stage renders only server map projections (Section 1.10.9).
 */

import type { TableStateProjection } from '../../shared/command-contract.js';
import type { CampaignMemoryProjection } from '../../shared/campaign-memory-contract.js';
import type { ChronicleFeedProjection, DmThreadMessage, PartyChatFeedProjection } from '../../shared/communication-contract.js';
import {
  ACTION_COMPOSER_STRUCTURE,
  DIRECTOR_ADDRESS_NOTICE,
  DOCK_TAB_LABELS,
  PLAYER_DOCK_TAB_ORDER,
  PARTY_CHAT_MODE_LABELS,
  PARTY_CHAT_MODES,
  RULES_DESK_NOTICE,
  CHRONICLE_ENTRY_KINDS,
  CHRONICLE_ENTRY_KIND_LABELS,
  dmThreadFromChronicleEntries,
  formatDirectorProse,
  formatPlayerFacingTimestamp,
  PLAY_CHANNEL_LABEL,
  scrubChronicleCheckpointZero,
  type DockTab,
  type PartyChatMode,
} from '../../shared/communication-contract.js';
import { scrubPlayerFacingIntentCopy } from '../../shared/ai-director-contract.js';
import type {
  RulesCatalogCategory,
  RulesCatalogProjection,
} from '../../shared/rules-catalog-contract.js';
import { RULES_CATALOG_CATEGORY_LABELS } from '../../shared/rules-catalog-contract.js';
import type { CampaignPresenceProjection } from '../../shared/presence-contract.js';
import { PRESENCE_HEARTBEAT_INTERVAL_MS } from '../../shared/presence-contract.js';
import type { MapBundleProjection, MapEdgeRecord } from '../../shared/map-contract.js';
import {
  doorAuthorityFromStored,
  formatDoorAuthorityLabel,
} from '../../shared/play-authority-contract.js';
import type {
  PresentationCueKind,
  PresentationCuePlanProjection,
} from '../../shared/presentation-cue-contract.js';
import type {
  CharacterProgressionProjection,
  EncounterProjection,
  RulesCommandFields,
} from '../../shared/rules-combat-contract.js';
import type {
  ActionDraftSuggestion,
  TimingAuthorityProjection,
} from '../../shared/timing-authority-contract.js';
import {
  deriveEpicFramingTags,
  isRulesIntentDraftCommand,
} from '../../shared/intent-draft-contract.js';
import {
  isIntentDraftConfirmCopy,
  resolvedSummaryAfterTableConfirm,
} from '../../shared/play-beat-summary.js';
import { getAccount, subscribeAccount } from '../account-session.js';
import {
  ApiFailure,
  claimTimingAuthority,
  fetchCampaignDetail,
  fetchCampaignMemory,
  fetchCampaignMap,
  fetchChronicle,
  fetchPartyChat,
  fetchPlayerSettings,
  fetchPresentationCuePlan,
  fetchRulesCatalog,
  fetchRulesState,
  fetchTableState,
  fetchTimingAuthority,
  heartbeatCampaignPresence,
  interpretNaturalLanguage,
  postDirectorAddress,
  postPartyChat,
  previewTableMove,
  requestDirectorNarration,
  savePlayerSettings,
  submitTableCommand,
  updateCharacterTrackers,
  yieldNpcSpotlight,
} from '../api.js';
import { bindSignedOutGate, renderSignedOutGate } from '../auth-gate.js';
import { readTableNotesPreference, writeIntentDraftPreference, writeTableNotesPreference, readIntentDraftPreference, parseRestorableIntentDraft, shouldPersistIntentDraftState } from '../browser-preferences.js';
import { renderCharacterSheet } from '../character-sheet-view.js';
import { escapeHtml } from '../dom-utils.js';
import {
  bindLegalPlayGatePage,
  isLegalPlayBlocked,
  loadLegalPlayAcceptance,
  renderLegalPlayGatePage,
  type LegalAcceptanceProjection,
} from '../legal-play-gate.js';
import { beginPageMount, isPageMountCurrent } from '../page-mount.js';
import { isHostedPlayerSurface } from '../player-surface.js';
import { applyPresentationPreferences } from '../presentation-preferences.js';
import { navigate } from '../router.js';
import { clearPendingJoin, readPendingJoin } from '../pending-join.js';
import { mountTableStage, type TableStageHandle } from '../table/table-stage.js';
import { findWalkPathToTarget, ownTokenAnchor } from '../table/walk-path.js';
import type { PageHost } from './home.js';

function formatTimestamp(iso: string): string {
  return formatPlayerFacingTimestamp(iso);
}

/** Table-only statuses layered on top of SRD conditions (PQA-251). */
const TABLE_STATUS_CONDITION_IDS = new Set(['guiding-bolt-marked', 'shielded']);
function isTableStatusConditionId(conditionId: string): boolean {
  return TABLE_STATUS_CONDITION_IDS.has(conditionId);
}

/** Clarification-only sync drafts stay Got-it; skill checks start with Ready to. */
function isSyncClarificationOnly(
  interpreted: {
    readonly proposedCommandType: string;
    readonly edgeId?: string;
    readonly path?: readonly unknown[];
  },
  scrubbedSummary: string,
): boolean {
  return (
    interpreted.proposedCommandType === 'table.sync' &&
    interpreted.edgeId === undefined &&
    interpreted.path === undefined &&
    !/^Ready to /i.test(scrubbedSummary)
  );
}

/** Distinct short tone per cue kind so table events are at least audibly distinguishable. */
const CUE_TONE_FREQUENCY_HZ: Record<PresentationCueKind, number> = {
  attack_hit: 440,
  attack_miss: 260,
  critical_hit: 660,
  spell_cast: 520,
  door_opened: 300,
  creature_down: 180,
  creature_revived: 560,
  death_save_made: 340,
  rest_completed: 480,
  level_up: 720,
  token_moved: 200,
};

function edgeAccessibleLabelFromEdge(edge: MapEdgeRecord): string {
  const facing =
    edge.orientation === 'north'
      ? 'north'
      : edge.orientation === 'south'
        ? 'south'
        : edge.orientation === 'east'
          ? 'east'
          : 'west';
  if (edge.kind === 'door') {
    return `${formatDoorAuthorityLabel(doorAuthorityFromStored(edge.doorState))} facing ${facing}`;
  }
  return `Wall facing ${facing}`;
}

function doorDetailCopy(edge: MapEdgeRecord, mapTitle: string): string {
  const scene = mapTitle.trim().length > 0 ? mapTitle : 'this chamber';
  const stateLabel = formatDoorAuthorityLabel(doorAuthorityFromStored(edge.doorState)).replace(
    /^Wooden door \(/,
    '',
  ).replace(/\)$/, '');
  const facing =
    edge.orientation === 'north'
      ? 'north'
      : edge.orientation === 'south'
        ? 'south'
        : edge.orientation === 'east'
          ? 'east'
          : 'west';
  return `Selected wooden door in ${scene} — ${stateLabel}, facing ${facing}. Use Open adjacent door when you are next to a closed unlocked door, or declare an interaction in the play channel.`;
}

export function mountCampaignTablePage(host: PageHost, campaignId: string): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Campaign table');

  let campaignName = 'Campaign';
  let sessionZeroComplete = false;
  let sessionZeroGateActive = false;
  let directorIdentityLabel = 'the Game Director';
  type InfoTab = 'character' | 'notes' | 'people' | 'tools';
  let activeInfoTab: InfoTab = 'character';
  let infoRailCollapsed = false;
  let commsRailCollapsed = false;
  let doorRecoveryVisible = false;
  let lastSubmittedDeclaration = '';
  /** When true, the play timeline sticks to the newest beat (A3). */
  let dmThreadFollowLatest = true;
  /** Taller play timeline for reading long narration (TQA-074). */
  let dmThreadExpanded = false;
  /** Table character sheet overlay (TQA-061–066). */
  let sheetModalOpen = false;
  /** Mobile task surface: map / play / sheet / chat (TQA-098). */
  type MobileTaskMode = 'map' | 'play' | 'sheet' | 'chat';
  let mobileTaskMode: MobileTaskMode = 'play';
  /** Speak-as address helper from People NPCs (TQA-019). */
  let speakAsNpcName = '';
  let activeTab: DockTab = 'party_chat';
  let memory: CampaignMemoryProjection | null = null;
  let tableNotes = '';
  let chatMode: PartyChatMode = 'table_talk';
  let chronicle: ChronicleFeedProjection | null = null;
  let partyChat: PartyChatFeedProjection | null = null;
  let tableState: TableStateProjection | null = null;
  let mapBundle: MapBundleProjection | null = null;
  let timingAuthority: TimingAuthorityProjection | null = null;
  let encounter: EncounterProjection | null = null;
  let progression: CharacterProgressionProjection | null = null;
  let selectedCombatantId: string | null = null;
  let selectedSpellId = 'fire-bolt';
  let rulesCatalog: RulesCatalogProjection | null = null;
  let selectedRulesCategory: RulesCatalogCategory = 'core_mechanics';
  let selectedRulesEntryId: string | null = 'core:progression.xp';
  let rulesSearchQuery = '';
  let chronicleKindFilter: string = 'all';
  let intentDraft: ActionDraftSuggestion | null = restoreIntentDraft();
  let reducedMotion = false;
  let lowEffects = false;
  let textToSpeechEnabled = false;
  let speechToTextEnabled = false;
  /** Bumped on player-driven presentation saves so an in-flight table load cannot clobber them. */
  let presentationWriteEpoch = 0;
  let tableBootstrapped = false;
  let seated = false;
  let ownSeatId: string | null = null;
  let moveTarget: { column: number; row: number } | null = null;
  let movePreviewPath: { column: number; row: number }[] | null = null;
  let movePreviewNote: string | null = null;
  let pendingMoveConfirm = false;
  let undoMoveAnchor: { column: number; row: number } | null = null;
  let selectedEdgeId: string | null = null;
  let draft = '';
  let directorDraft = '';
  let askDmThread: DmThreadMessage[] = [];
  let dmThread: DmThreadMessage[] = [];
  let dmThreadOptimistic: DmThreadMessage[] = [];
  let lastChronicleSyncCount = 0;
  let playerActionDraft = '';
  let nlIntentText = '';
  let presence: CampaignPresenceProjection | null = null;
  let lastNarration: string | null = null;
  const playedCueDedupeKeys = new Set<string>();
  let cuePlanInFlight = false;
  let presentationAudioContext: AudioContext | null = null;
  let busy = false;
  let error: string | null = null;
  let gateBusy = false;
  let gateError: string | null = null;
  let legalAcceptance: LegalAcceptanceProjection | null = null;
  let legalGateBusy = false;
  let legalGateError: string | null = null;
  let legalGateLoading = false;
  let stageHandle: TableStageHandle | null = null;
  let stageMounting = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let presenceTimer: ReturnType<typeof setInterval> | null = null;
  let pollInFlight = false;
  let sheetEscapeListener: ((event: KeyboardEvent) => void) | null = null;
  const presenceTabId = crypto.randomUUID();
  const mountToken = beginPageMount(container);

  /** Local poll interval for two-client table projection sync (Phase 2e). */
  const TABLE_PROJECTION_POLL_MS = 2000;

  function mapSyncFingerprint(map: MapBundleProjection | null): string {
    if (map === null) {
      return '';
    }
    const tokens = map.tokens
      .map(
        (token) =>
          `${token.seatId}:${token.footprint.anchor.column},${token.footprint.anchor.row}`,
      )
      .sort()
      .join('|');
    const doors = map.edges
      .filter((edge) => edge.kind === 'door')
      .map((edge) => `${edge.edgeId}:${edge.doorState ?? 'closed'}`)
      .sort()
      .join('|');
    return `${map.mapBundleId}#${map.mapVersion}#${map.title}#${map.artProvenance}#${map.sceneBanner}#${tokens}#${doors}#${map.exploredSquareIds.join(',')}#${map.visibleSquareIds.join(',')}`;
  }

  /** "original_phase5_starter_v1" -> "original phase5 starter v1", never a fabricated art label. */
  function humanizeArtProvenance(provenance: string, title?: string): string {
    if (
      title === 'Blank table' ||
      provenance === 'blank_table' ||
      provenance === 'none' ||
      provenance === 'procedural_local_placeholder'
    ) {
      return '';
    }
    if (provenance === 'original_phase5_starter_v1') {
      return 'Emberferry starter presentation';
    }
    return provenance.replace(/_/g, ' ');
  }

  function formatEncounterStatus(): string {
    if (encounter === null) {
      return 'Not begun';
    }
    if (encounter.status === 'ended') {
      return `Encounter ended · round ${encounter.round}`;
    }
    if (encounter.status === 'setup') {
      return 'Setup — roll initiative to begin';
    }
    const current = encounter;
    const activeName =
      current.combatants.find((combatant) => combatant.combatantId === current.activeCombatantId)
        ?.name ?? 'none';
    return `Round ${current.round} · ${activeName}'s turn`;
  }

  function formatTimingCredential(): string {
    if (timingAuthority === null) {
      return encounter?.status === 'active'
        ? 'Waiting for your turn in initiative order.'
        : 'Waiting for initiative order.';
    }
    if (timingAuthority.timingAuthorityId === 'held-by-other') {
      return 'Another adventurer holds the active combat turn.';
    }
    const expiresLabel = (() => {
      const date = new Date(timingAuthority.expiresAt);
      return Number.isNaN(date.getTime()) ? '' : ` · until ${date.toLocaleTimeString()}`;
    })();
    if (timingAuthority.opportunityClass === 'reaction') {
      return `You may spend a reaction${expiresLabel}.`;
    }
    if (timingAuthority.opportunityClass === 'decision') {
      return `A decision window is open for you${expiresLabel}.`;
    }
    if (isOwnCombatTurn()) {
      return 'Initiative gave you the active combat turn.';
    }
    return `You hold the active turn${expiresLabel}.`;
  }

  function newThreadMessage(
    speaker: DmThreadMessage['speaker'],
    speakerLabel: string,
    body: string,
    kind: DmThreadMessage['kind'],
  ): DmThreadMessage {
    return {
      messageId: crypto.randomUUID(),
      speaker,
      speakerLabel,
      body,
      createdAt: new Date().toISOString(),
      kind,
    };
  }

  function syncDmThreadFromChronicle(): void {
    if (!seated) {
      return;
    }
    const scene = mapBundle?.sceneBanner?.trim() || 'The table is ready.';
    const fromChronicle = dmThreadFromChronicleEntries({
      entries: chronicle?.entries ?? [],
      directorLabel: directorIdentityLabel,
      sceneBanner: scene,
      now: new Date(),
    });
    const entryCount = chronicle?.entries.length ?? 0;
    if (entryCount > lastChronicleSyncCount) {
      dmThreadOptimistic = [];
      lastChronicleSyncCount = entryCount;
    }
    dmThread = [...fromChronicle, ...dmThreadOptimistic];
  }

  function seedDmThreadIfNeeded(): void {
    syncDmThreadFromChronicle();
  }

  function appendDmThread(
    speaker: DmThreadMessage['speaker'],
    speakerLabel: string,
    body: string,
    kind: DmThreadMessage['kind'],
  ): void {
    const message = newThreadMessage(speaker, speakerLabel, body, kind);
    dmThreadOptimistic = [...dmThreadOptimistic, message];
    dmThread = [...dmThread, message];
  }

  function appendAskDmThread(
    speaker: DmThreadMessage['speaker'],
    speakerLabel: string,
    body: string,
    kind: DmThreadMessage['kind'],
  ): void {
    askDmThread = [...askDmThread, newThreadMessage(speaker, speakerLabel, body, kind)];
  }

  function renderThreadMessages(
    messages: readonly DmThreadMessage[],
    options: { readonly latestReplyTestId?: string; readonly listTestId: string },
  ): string {
    if (messages.length === 0) {
      return `<p class="empty-state" data-testid="${options.listTestId}-empty">No messages yet.</p>`;
    }
    const lastDmIndex = [...messages]
      .map((message, index) => (message.speaker === 'dm' ? index : -1))
      .filter((index) => index >= 0)
      .at(-1);
    return `<ol class="record-list dm-thread-list" data-testid="${options.listTestId}">
      ${messages
        .map((message, index) => {
          const testId =
            options.latestReplyTestId !== undefined && index === lastDmIndex
              ? options.latestReplyTestId
              : 'dm-thread-message';
          const stamped =
            message.messageId === 'opening-prompt' || message.kind === 'prompt'
              ? 'Just now'
              : formatTimestamp(message.createdAt);
          return `<li class="dm-thread-message dm-thread-${escapeHtml(message.speaker)}" data-testid="${testId}">
            <span class="record-note"><strong>${escapeHtml(message.speakerLabel)}</strong></span>
            <p>${escapeHtml(formatDirectorProse(message.body))}</p>
            <span class="record-meta" data-testid="dm-thread-timestamp">${escapeHtml(stamped)}</span>
          </li>`;
        })
        .join('')}
    </ol>`;
  }

  /** Player-meaningful beats get DM narration; setup/turn-advance stays mechanical to avoid busy races. */
  function shouldAutoNarrateRulesCommand(commandType: string): boolean {
    return (
      commandType.startsWith('combat.') ||
      commandType.startsWith('inventory.') ||
      commandType.startsWith('progression.') ||
      commandType === 'table.move' ||
      commandType === 'table.open_door' ||
      commandType === 'table.build_scene' ||
      commandType === 'table.sync'
    );
  }

  function formatMoveSummary(options: {
    readonly path: readonly { readonly column: number; readonly row: number }[];
    readonly map: MapBundleProjection;
    readonly start: { readonly column: number; readonly row: number };
  }): string {
    const { path, map } = options;
    const squares = path.length;
    const feet = squares * map.coordinateSpace.feetPerSquare;
    const scene = map.title.trim().length > 0 ? map.title : 'the map';
    return `Moved ${squares} square${squares === 1 ? '' : 's'} (${feet} ft) across ${scene} toward the marked destination.`;
  }

  function persistIntentDraft(draft: ActionDraftSuggestion | null): void {
    if (draft === null || !shouldPersistIntentDraftState(draft.interceptState)) {
      writeIntentDraftPreference(campaignId, null);
      return;
    }
    writeIntentDraftPreference(campaignId, JSON.stringify(draft));
  }

  function setIntentDraft(next: ActionDraftSuggestion | null): void {
    intentDraft = next;
    persistIntentDraft(next);
  }

  function restoreIntentDraft(): ActionDraftSuggestion | null {
    const restored = parseRestorableIntentDraft(readIntentDraftPreference(campaignId), campaignId);
    if (restored === null) {
      return null;
    }
    if (restored.clearStored) {
      writeIntentDraftPreference(campaignId, null);
      return null;
    }
    return restored.draft as unknown as ActionDraftSuggestion;
  }

  let narrationChain: Promise<void> = Promise.resolve();

  function enqueueNarration(mechanicsSummary: string, rolls: readonly number[] = []): void {
    narrationChain = narrationChain
      .then(() => narrateIntoDmThread(mechanicsSummary, rolls))
      .catch(() => {
        // Keep the queue alive after a narration failure.
      });
  }

  function sessionIsSuspended(): boolean {
    return memory?.session.state === 'suspended';
  }

  function markIntentDraftStale(reason: string): void {
    if (intentDraft === null) {
      return;
    }
    if (intentDraft.interceptState !== 'stale') {
      setIntentDraft({ ...intentDraft, interceptState: 'stale' });
    }
    appendDmThread('system', 'Table', reason, 'system');
  }

  function presentTableConflict(failure: ApiFailure): void {
    const detail = failure.conflict;
    const headline =
      detail === undefined
        ? failure.message
        : detail.reason === 'same_door'
          ? `Conflict — same door: ${detail.message}`
          : detail.reason === 'overlapping_move'
            ? `Conflict — overlapping move: ${detail.message}`
            : detail.reason === 'scene_lock'
              ? `Conflict — scene lock: ${detail.message}`
              : detail.reason === 'npc_spotlight'
                ? `Conflict — NPC floor: ${detail.message}`
                : `Conflict — table moved: ${detail.message}`;
    if (intentDraft !== null) {
      markIntentDraftStale(headline);
    } else {
      appendDmThread('system', 'Table', headline, 'system');
    }
    if (detail?.competingSummary) {
      appendDmThread(
        'system',
        'Table',
        `Competing beat: ${detail.competingSummary}`,
        'system',
      );
    }
  }

  function draftFromInterpret(
    interpreted: import('../../shared/ai-director-contract.js').IntentInterpretResponse,
  ): ActionDraftSuggestion {
    const projectionVersionAtIssue =
      interpreted.projectionVersionAtIssue ?? tableState?.stateVersion;
    if (interpreted.edgeId !== undefined) {
      selectedEdgeId = interpreted.edgeId;
      stageHandle?.setSelectedEdge(interpreted.edgeId);
    }
    return {
      draftId: interpreted.draftId,
      source: 'action_composer_interpret',
      campaignId,
      proposedCommandType: interpreted.proposedCommandType,
      summary: interpreted.summary,
      ...(interpreted.path !== undefined ? { path: [...interpreted.path] } : {}),
      ...(interpreted.edgeId !== undefined ? { edgeId: interpreted.edgeId } : {}),
      ...(interpreted.targetCombatantId !== undefined
        ? { targetCombatantId: interpreted.targetCombatantId }
        : {}),
      ...(interpreted.spellId !== undefined ? { spellId: interpreted.spellId } : {}),
      ...(interpreted.itemId !== undefined ? { itemId: interpreted.itemId } : {}),
      ...(interpreted.attackId !== undefined ? { attackId: interpreted.attackId } : {}),
      ...(interpreted.area !== undefined ? { area: interpreted.area } : {}),
      ...(interpreted.declaredFoes !== undefined && interpreted.declaredFoes.length > 0
        ? { declaredFoes: interpreted.declaredFoes.map((foe) => ({ name: foe.name })) }
        : {}),
      ...(interpreted.arcaneRecovery === true ? { arcaneRecovery: true } : {}),
      ...(projectionVersionAtIssue !== undefined ? { projectionVersionAtIssue } : {}),
      interceptState: interpreted.interceptState,
      createdAt: interpreted.createdAt,
    };
  }

  async function resumeCompoundDeclarationAfterBuild(
    declaration: string,
    options: { readonly narrateSteps?: boolean; readonly stopAfterFirstMove?: boolean } = {},
  ): Promise<void> {
    if (
      candidate === null ||
      !/\b(walk|go|step|approach|enter|through|beyond|room beyond)\b/i.test(declaration)
    ) {
      return;
    }
    const narrateSteps = options.narrateSteps !== false;
    const stopAfterFirstMove = options.stopAfterFirstMove === true;
    const maxSteps = 12;
    for (let step = 0; step < maxSteps; step += 1) {
      if (candidate === null || tableState === null) {
        break;
      }
      const moveTargetForInterpret =
        moveTarget !== null && !/\b(door|gate|entryway|entry|room beyond|through)\b/i.test(declaration)
          ? moveTarget
          : undefined;
      let interpreted: Awaited<ReturnType<typeof interpretNaturalLanguage>>;
      try {
        interpreted = await interpretNaturalLanguage({
          candidateId: candidate.candidateId,
          campaignId,
          text: declaration,
          ...(moveTargetForInterpret !== undefined ? { moveTarget: moveTargetForInterpret } : {}),
        });
      } catch {
        break;
      }
      if (
        interpreted.proposedCommandType !== 'table.move' &&
        interpreted.proposedCommandType !== 'table.open_door'
      ) {
        break;
      }
      if (
        interpreted.proposedCommandType === 'table.move' &&
        (interpreted.path === undefined || interpreted.path.length === 0)
      ) {
        break;
      }
      try {
        const accepted = await submitTableCommand({
          candidateId: candidate.candidateId,
          campaignId,
          requestId: crypto.randomUUID(),
          commandType: interpreted.proposedCommandType,
          expectedStateVersion: tableState.stateVersion,
          ...(explorationMode() || timingAuthority === null
            ? {}
            : { timingAuthorityId: timingAuthority.timingAuthorityId }),
          ...(interpreted.path !== undefined ? { path: interpreted.path } : {}),
          ...(interpreted.edgeId !== undefined ? { edgeId: interpreted.edgeId } : {}),
        });
        tableState = accepted.table;
        mapBundle = await fetchCampaignMap(campaignId);
        stageHandle?.renderMap(mapBundle);
        const summary =
          accepted.event.summary?.trim() ||
          'Action committed on the table.';
        appendDmThread('system', 'Table', playerFacingMechanicsCopy(summary), 'mechanics');
        if (narrateSteps && shouldAutoNarrateRulesCommand(interpreted.proposedCommandType)) {
          await narrateIntoDmThread(summary, accepted.event.rolls ?? []);
        }
        // Open+cross only needs one through-step; another interpret would chronicle
        // a spurious "already through" clarification into Story so far.
        if (stopAfterFirstMove && interpreted.proposedCommandType === 'table.move') {
          break;
        }
      } catch {
        break;
      }
    }
    patchDmPlayThread();
  }

  function fieldsFromIntentDraft(draft: ActionDraftSuggestion): RulesCommandFields {
    const seatedCombatant = ownCombatant();
    if (draft.proposedCommandType === 'combat.cast_spell' && draft.spellId === 'burning-hands') {
      return {
        spellId: 'burning-hands',
        area: {
          shape: 'cone',
          origin: {
            column: moveTarget?.column ?? seatedCombatant?.position.column ?? 1,
            row: moveTarget?.row ?? seatedCombatant?.position.row ?? 1,
            elevationFeet: seatedCombatant?.position.elevationFeet ?? 0,
          },
          sizeFeet: 15,
          heightFeet: 10,
          direction: 'east',
        },
      };
    }
    return {
      ...(draft.targetCombatantId !== undefined
        ? { targetCombatantId: draft.targetCombatantId }
        : {}),
      ...(draft.spellId !== undefined ? { spellId: draft.spellId } : {}),
      ...(draft.itemId !== undefined ? { itemId: draft.itemId } : {}),
      ...(draft.attackId !== undefined ? { attackId: draft.attackId } : {}),
      ...(draft.area !== undefined ? { area: draft.area } : {}),
      ...(draft.declaredFoes !== undefined && draft.declaredFoes.length > 0
        ? { declaredFoes: draft.declaredFoes.map((foe) => ({ name: foe.name })) }
        : {}),
      ...(draft.arcaneRecovery === true ? { arcaneRecovery: true } : {}),
    };
  }

  function isDmThreadNearBottom(host: HTMLElement): boolean {
    return host.scrollHeight - host.scrollTop - host.clientHeight < 56;
  }

  function updateDmThreadJumpVisibility(): void {
    const jump = container.querySelector<HTMLButtonElement>('[data-testid="dm-thread-jump-latest"]');
    if (jump === null) {
      return;
    }
    jump.hidden = dmThreadFollowLatest;
  }

  function scrollDmPlayThreadToLatest(behavior: ScrollBehavior = 'auto'): void {
    const host = container.querySelector<HTMLElement>('[data-testid="dm-play-thread"]');
    if (host === null) {
      return;
    }
    host.scrollTo({ top: host.scrollHeight, behavior });
    dmThreadFollowLatest = true;
    updateDmThreadJumpVisibility();
  }

  function bindDmPlayThreadScroll(): void {
    const host = container.querySelector<HTMLElement>('[data-testid="dm-play-thread"]');
    if (host === null || host.dataset.scrollBound === '1') {
      return;
    }
    host.dataset.scrollBound = '1';
    host.addEventListener('scroll', () => {
      const nearBottom = isDmThreadNearBottom(host);
      if (nearBottom) {
        dmThreadFollowLatest = true;
      } else if (host.scrollHeight > host.clientHeight + 24) {
        dmThreadFollowLatest = false;
      }
      updateDmThreadJumpVisibility();
    });
  }

  function patchDmPlayThread(): void {
    const host = container.querySelector('[data-testid="dm-play-thread"]');
    if (host === null) {
      return;
    }
    const list = host.querySelector('[data-testid="dm-play-thread-list"]');
    const empty = host.querySelector('[data-testid="dm-play-thread-list-empty"]');
    const rendered = renderThreadMessages(dmThread, { listTestId: 'dm-play-thread-list' });
    if (list !== null) {
      list.outerHTML = rendered;
    } else if (empty !== null) {
      empty.outerHTML = rendered;
    }
    bindDmPlayThreadScroll();
    if (dmThreadFollowLatest) {
      requestAnimationFrame(() => scrollDmPlayThreadToLatest('auto'));
    } else {
      updateDmThreadJumpVisibility();
    }
  }

  async function narrateIntoDmThread(
    mechanicsSummary: string,
    rolls: readonly number[] = [],
  ): Promise<void> {
    if (candidate === null || mechanicsSummary.trim().length === 0) {
      return;
    }
    try {
      const narration = await requestDirectorNarration({
        candidateId: candidate.candidateId,
        campaignId,
        mechanicsSummary,
        rolls,
      });
      lastNarration = narration.body;
      const tags = narration.framingTags ?? deriveEpicFramingTags(mechanicsSummary, rolls);
      // Narration is persisted to Chronicle server-side. Re-sync so Story so far does not
      // keep both the optimistic append and the chronicle copy of the same beat.
      try {
        chronicle = await fetchChronicle(campaignId);
        dmThreadOptimistic = [];
        lastChronicleSyncCount = chronicle.entries.length;
        syncDmThreadFromChronicle();
      } catch {
        // Fall through to optimistic append when chronicle refresh fails.
      }
      const normalizedNarration = narration.body.trim();
      const alreadyOnThread = dmThread.some((message) => {
        if (message.speaker !== 'dm') {
          return false;
        }
        const existing = message.body.trim();
        return (
          existing === normalizedNarration ||
          (normalizedNarration.length > 24 &&
            (existing.includes(normalizedNarration) || normalizedNarration.includes(existing)))
        );
      });
      // Never surface post-commit draft copy ("Ready to… Confirm to…") as Director narration.
      if (!alreadyOnThread && !isIntentDraftConfirmCopy(normalizedNarration)) {
        appendDmThread(
          'dm',
          narration.directorIdentityLabel || directorIdentityLabel,
          narration.body,
          'narration',
        );
      }
      if (tags.length > 0) {
        const framingBody = `Epic framing (outcome unchanged): ${tags.map((tag) => tag.replace(/_/g, ' ')).join(', ')}.`;
        const framingAlready = dmThread.some(
          (message) => message.speaker === 'system' && message.body === framingBody,
        );
        if (!framingAlready) {
          appendDmThread('system', 'Table', framingBody, 'system');
        }
      }
      if (textToSpeechEnabled && 'speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(narration.body);
        window.speechSynthesis.speak(utterance);
      }
    } catch {
      appendDmThread('system', 'Table', mechanicsSummary, 'mechanics');
    }
    if (isPageMountCurrent(container, mountToken)) {
      patchDmPlayThread();
    }
  }

  function getPresentationAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') {
      return null;
    }
    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextCtor === undefined) {
      return null;
    }
    if (presentationAudioContext === null) {
      presentationAudioContext = new AudioContextCtor();
    }
    return presentationAudioContext;
  }

  /** Short sine-tone burst — never speech, never longer than the contract's SFX budget. */
  function playCueTone(context: AudioContext, frequencyHz: number, durationMs: number): void {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequencyHz;
    const now = context.currentTime;
    const seconds = Math.max(durationMs, 1) / 1000;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.2, now + Math.min(0.02, seconds / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + seconds);
  }

  /** Gate per Section 25 Phase 5: never play SFX under reduced motion, low effects, or over live TTS. */
  function presentationCuesAllowed(): boolean {
    if (reducedMotion || lowEffects) {
      return false;
    }
    if (
      textToSpeechEnabled &&
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      window.speechSynthesis.speaking
    ) {
      return false;
    }
    return true;
  }

  /**
   * Marks every cue currently on the server plan as already-seen without
   * playing any sound. Called once on page load so a returning player is not
   * greeted with a burst of tones replaying recent table history.
   */
  async function establishPresentationCueBaseline(): Promise<void> {
    try {
      const plan = await fetchPresentationCuePlan(campaignId);
      for (const cue of plan.cues) {
        playedCueDedupeKeys.add(cue.dedupeKey);
      }
    } catch {
      // Best-effort baseline; a later refresh can still establish it.
    }
  }

  /**
   * Fetches the server-derived Presentation Cue Plan and plays short Web
   * Audio tones for cues not yet seen. Cues are derived only from committed
   * events server-side (`presentation-cues.ts`) — this function never invents
   * state and never reads Director narration text.
   */
  async function processPresentationCues(): Promise<void> {
    if (!isPageMountCurrent(container, mountToken) || cuePlanInFlight) {
      return;
    }
    cuePlanInFlight = true;
    try {
      const plan: PresentationCuePlanProjection = await fetchPresentationCuePlan(campaignId);
      const freshCues = plan.cues.filter((cue) => !playedCueDedupeKeys.has(cue.dedupeKey));
      for (const cue of freshCues) {
        playedCueDedupeKeys.add(cue.dedupeKey);
      }
      if (freshCues.length === 0 || !presentationCuesAllowed()) {
        return;
      }
      const context = getPresentationAudioContext();
      if (context === null) {
        return;
      }
      for (const cue of freshCues.slice(0, plan.maxConcurrentSounds)) {
        playCueTone(context, CUE_TONE_FREQUENCY_HZ[cue.kind] ?? 400, plan.maxCueSoundDurationMs);
      }
    } catch {
      // Presentation cues are best-effort flavor; never block the table on failure.
    } finally {
      cuePlanInFlight = false;
    }
  }

  function explorationMode(): boolean {
    return encounter === null || encounter.status !== 'active';
  }

  function ownCombatant(): EncounterProjection['combatants'][number] | null {
    if (encounter === null || ownSeatId === null) {
      return null;
    }
    return encounter.combatants.find((combatant) => combatant.seatId === ownSeatId) ?? null;
  }

  function activeCombatant(): EncounterProjection['combatants'][number] | null {
    if (encounter === null || encounter.activeCombatantId === null) {
      return null;
    }
    return (
      encounter.combatants.find(
        (combatant) => combatant.combatantId === encounter!.activeCombatantId,
      ) ?? null
    );
  }

  function isOwnCombatTurn(): boolean {
    const own = ownCombatant();
    return (
      encounter?.status === 'active' &&
      own !== null &&
      encounter.activeCombatantId === own.combatantId
    );
  }

  function canMoveOnMap(): boolean {
    if (!seated || mapBundle === null || sessionIsSuspended()) {
      return false;
    }
    if (explorationMode()) {
      return true;
    }
    return isOwnCombatTurn();
  }

  function holdsOwnAuthority(): boolean {
    return (
      timingAuthority !== null &&
      timingAuthority.state === 'issued' &&
      timingAuthority.timingAuthorityId !== 'held-by-other' &&
      timingAuthority.permittedCommandTypes.length > 0
    );
  }

  function authorityMeta(): string {
    if (explorationMode()) {
      return 'Exploration — move freely until the Game Director calls for initiative.';
    }
    return formatTimingCredential();
  }

  function turnBanner(): { readonly title: string; readonly detail: string; readonly tone: 'waiting' | 'yours' | 'spectator' | 'exploration' } {
    if (sessionIsSuspended()) {
      return {
        tone: 'spectator',
        title: 'Session suspended',
        detail: 'Resume the campaign from the campaign page before playing at this table.',
      };
    }
    if (!seated) {
      return {
        tone: 'spectator',
        title: 'You are watching this table',
        detail: 'Seat a character on the campaign page to join the party.',
      };
    }
    if (encounter !== null && encounter.status === 'active') {
      const active = activeCombatant();
      if (isOwnCombatTurn()) {
        return {
          tone: 'yours',
          title: `It's your turn, ${ownCombatant()?.name ?? 'adventurer'}`,
          detail: 'Describe what you do, move on the map if you need to, then end your turn.',
        };
      }
      if (active !== null) {
        return {
          tone: 'waiting',
          title: `${active.name}'s turn`,
          detail:
            active.side === 'foe'
              ? 'Hostile turns resolve automatically. If the fight stalls, use End encounter on this play bar.'
              : 'The Game Director is running the scene. Review your sheet, chat, or ask the Game Director while you wait.',
        };
      }
    }
    if (encounter !== null && encounter.status === 'setup') {
      return {
        tone: 'waiting',
        title: 'Combat is forming',
        detail: 'The Game Director will call for initiative when the fight begins.',
      };
    }
    return {
      tone: 'exploration',
      title: 'Exploring freely',
      detail: 'Move where you like until the Game Director calls for initiative. Chat and ask the Game Director anytime.',
    };
  }

  function initiativeStrip(): string {
    // Only show initiative while combat is active (PQA-172).
    if (encounter === null || encounter.status !== 'active' || encounter.initiativeOrder.length === 0) {
      return '';
    }
    const items = encounter.initiativeOrder
      .map((combatantId) => {
        const combatant =
          encounter!.combatants.find((entry) => entry.combatantId === combatantId) ?? null;
        const active = combatantId === encounter!.activeCombatantId;
        const context =
          combatant === null
            ? combatantId
            : combatant.seatId !== null
              ? `${formatCombatantLabel(combatant.name, combatant.combatantId)} · ${formatCombatantSide(combatant.side, combatant.combatantId)} · HP ${combatant.currentHitPoints}/${combatant.maxHitPoints}`
              : `${formatCombatantLabel(combatant.name, combatant.combatantId)} · ${formatCombatantSide(combatant.side, combatant.combatantId)} · ${formatCombatantHealth(combatant)}`;
        return `<li class="${active ? 'initiative-active' : ''}" data-testid="initiative-entry-${escapeHtml(combatantId)}">
          ${escapeHtml(context)}${active ? ' · now' : ''}
        </li>`;
      })
      .join('');
    return `
      <ol class="initiative-order" data-testid="initiative-order" aria-label="Initiative order">
        ${items}
      </ol>`;
  }

  function characterSheetPanel(): string {
    if (!seated || progression === null) {
      return `<p class="record-meta" data-testid="table-character-sheet-empty">
        Seat a character to keep your sheet open at the table.
      </p>`;
    }
    const sheet = progression.sheet;
    const label =
      mapBundle?.tokens.find((token) => token.seatId === ownSeatId)?.label ?? 'Your character';
    return `
      <div class="table-character-compact" data-testid="table-character-compact">
        <p><strong>${escapeHtml(label)}</strong> · Level ${sheet.level}</p>
        <p class="record-meta">HP ${sheet.hitPoints.value} · AC ${sheet.armorClass.value} · Speed ${sheet.speed.value} ft</p>
        <button type="button" class="table-secondary-action" data-testid="open-table-sheet-modal">
          Open sheet at table
        </button>
        <a href="/characters/${escapeHtml(progression.characterId)}" data-link data-testid="table-character-sheet-link">Open full sheet page</a>
      </div>`;
  }

  function characterSheetModalHtml(): string {
    if (!sheetModalOpen || !seated || progression === null) {
      return '';
    }
    const sheet = progression.sheet;
    const label =
      mapBundle?.tokens.find((token) => token.seatId === ownSeatId)?.label ?? 'Your character';
    return `
      <div class="modal-backdrop sheet-modal-backdrop" data-testid="table-sheet-modal" role="presentation">
        <div class="modal-dialog sheet-modal-dialog" role="dialog" aria-modal="true"
          aria-labelledby="table-sheet-modal-title" tabindex="-1">
          <div class="sheet-modal-chrome">
            <h2 id="table-sheet-modal-title">${escapeHtml(label)}</h2>
            <button type="button" class="table-secondary-action" data-testid="close-table-sheet-modal">Close</button>
          </div>
          <p class="record-meta">Escape or backdrop closes this overlay and keeps you at the table.</p>
          <div data-testid="table-character-sheet">${renderCharacterSheet(sheet, { compact: true })}</div>
        </div>
      </div>`;
  }

  function loadTableNotesPreference(): string {
    return readTableNotesPreference(campaignId);
  }

  function saveTableNotesPreference(value: string): void {
    writeTableNotesPreference(campaignId, value);
  }

  function scrubTrainingFoeCopy(text: string): string {
    if (trainingToolsVisible() || !explorationMode()) {
      return text;
    }
    return text
      .replace(/\bTraining Dummy\b/gi, 'a practice foe')
      .replace(/\bPractice Goblin\b/gi, 'a practice foe')
      .replace(/\bpractice foes and practice foes\b/gi, 'practice foes')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function formatCombatantSide(
    side: string,
    combatantId?: string,
  ): string {
    if (side === 'foe') {
      if (
        combatantId === 'training-dummy' ||
        combatantId === 'practice-goblin'
      ) {
        return 'hostile (practice)';
      }
      return 'hostile';
    }
    if (side === 'party') {
      return 'party';
    }
    return side;
  }

  function formatCombatantHealth(
    combatant: EncounterProjection['combatants'][number],
  ): string {
    const isOwn = combatant.seatId !== null;
    const temp =
      combatant.temporaryHitPoints > 0 ? ` +${combatant.temporaryHitPoints} temp` : '';
    if (isOwn) {
      return `HP ${combatant.currentHitPoints}/${combatant.maxHitPoints}${temp} · AC ${combatant.armorClass}`;
    }
    const ratio =
      combatant.maxHitPoints <= 0
        ? 0
        : combatant.currentHitPoints / combatant.maxHitPoints;
    let band = 'unharmed';
    if (combatant.currentHitPoints <= 0) {
      band = 'defeated';
    } else if (ratio <= 0.25) {
      band = 'bloodied';
    } else if (ratio < 1) {
      band = 'wounded';
    }
    const purpose =
      combatant.combatantId === 'training-dummy' || combatant.combatantId === 'practice-goblin'
        ? ' · practice foe for rules training (no story arrival)'
        : '';
    return `Condition ${band}${temp} · AC ${combatant.armorClass}${purpose}`;
  }

  function formatCombatantLabel(name: string, combatantId: string): string {
    if (trainingToolsVisible() || !explorationMode()) {
      return name;
    }
    if (combatantId === 'training-dummy' || combatantId === 'practice-goblin') {
      return 'Practice foe';
    }
    return name;
  }

  function formatCombatantConditions(
    conditions: EncounterProjection['combatants'][number]['conditions'],
  ): string {
    if (conditions.length === 0) {
      return 'No conditions';
    }
    const srdLabels = conditions
      .filter((condition) => !isTableStatusConditionId(condition.conditionId))
      .map((condition) => condition.label);
    const tableStatusLabels = conditions
      .filter((condition) => isTableStatusConditionId(condition.conditionId))
      .map((condition) => condition.label);
    if (srdLabels.length > 0 && tableStatusLabels.length > 0) {
      return `SRD conditions: ${srdLabels.join(', ')} · Table statuses: ${tableStatusLabels.join(', ')}`;
    }
    if (tableStatusLabels.length > 0) {
      return `Table status: ${tableStatusLabels.join(', ')}`;
    }
    return srdLabels.join(', ');
  }

  function playerFacingMechanicsCopy(text: string): string {
    return scrubTrainingFoeCopy(scrubPlayerFacingIntentCopy(text));
  }

  const INFO_TAB_LABELS: Record<InfoTab, string> = {
    character: 'Character',
    notes: 'Notes',
    people: 'People',
    tools: 'Tools',
  };

  function trainingToolsVisible(): boolean {
    // Hosted players get fiction-first play only (PQA-148). Local Arena keeps Tools for QA.
    return !isHostedPlayerSurface(candidate);
  }

  function visibleInfoTabs(): InfoTab[] {
    const tabs: InfoTab[] = ['character', 'notes', 'people'];
    if (trainingToolsVisible()) {
      tabs.push('tools');
    }
    return tabs;
  }

  function partyChatMessageBody(raw: string = draft): string {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return '';
    }
    if (chatMode !== 'speak_as_character' || speakAsNpcName.trim().length === 0) {
      return trimmed;
    }
    const escaped = speakAsNpcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return trimmed
      .replace(new RegExp(`^@?${escaped}\\s*[,:]\\s*`, 'i'), '')
      .trim();
  }

  function partyChatSendBlocked(): boolean {
    if (busy || candidate === null) {
      return true;
    }
    if (chatMode === 'speak_as_character') {
      if (speakAsNpcName.trim().length === 0) {
        return true;
      }
      return partyChatMessageBody().length === 0;
    }
    return draft.trim().length === 0;
  }

  function syncPartyChatSendState(root: ParentNode = container): void {
    root
      .querySelector<HTMLButtonElement>('[data-testid="party-chat-send"]')
      ?.setAttribute('aria-disabled', String(partyChatSendBlocked()));
  }

  function peoplePanelBody(): string {
    if (memory === null) {
      return '<p class="record-meta" data-testid="table-people-loading">Campaign memory is loading…</p>';
    }
    const currentChapter =
      memory.chapters.find((chapter) => chapter.chapterId === memory!.currentChapterId) ?? null;
    const sceneContext =
      mapBundle?.sceneBanner?.trim() ||
      mapBundle?.title?.trim() ||
      (mapBundle?.notableFeatures.length
        ? mapBundle.notableFeatures.map((feature) => feature.label).join(', ')
        : '');
    return `
      <p class="record-meta" data-testid="table-people-time">${escapeHtml(memory.campaignTime.label)}</p>
      ${
        sceneContext.length > 0
          ? `<p data-testid="table-scene-context"><strong>Current scene:</strong> ${escapeHtml(sceneContext)}</p>`
          : ''
      }
      ${
        currentChapter === null
          ? '<p class="empty-state">No current chapter yet.</p>'
          : `<p data-testid="table-current-chapter">
               <strong>${escapeHtml(currentChapter.sessionLabel)}: ${escapeHtml(currentChapter.title)}</strong><br />
               ${escapeHtml(currentChapter.planSummary)}
             </p>`
      }
      <h3 class="preview-subheading">NPCs encountered</h3>
      ${
        memory.npcs.filter((npc) => npc.audience === 'public' || npc.audience === 'private')
          .length === 0
          ? `<p class="empty-state" data-testid="table-npc-empty">None yet — the Game Director introduces people during play. Players cannot invent NPCs.</p>`
          : `<ul class="record-list compact" data-testid="table-npc-list">
               ${memory.npcs
                 .filter((npc) => npc.audience === 'public' || npc.audience === 'private')
                 .map(
                   (npc) => `
                 <li data-testid="table-npc-item" data-npc-id="${escapeHtml(npc.npcId)}">
                   <span class="record-note"><strong>${escapeHtml(npc.name)}</strong></span>
                   <span class="record-meta" data-testid="table-npc-role">${escapeHtml(npc.role)}</span>
                   <span class="npc-disposition-badge" data-testid="table-npc-disposition">${escapeHtml(npc.motive)}</span>
                 </li>`,
                 )
                 .join('')}
             </ul>`
      }
      ${
        memory.quests.length === 0
          ? ''
          : `<h3 class="preview-subheading">Quests</h3>
             <ul class="record-list compact" data-testid="quest-list">
               ${memory.quests
                 .map(
                   (quest) => `
                 <li data-testid="quest-item">
                   <span class="record-note">${escapeHtml(quest.title)}</span>
                   <span class="record-meta">${escapeHtml(quest.status)} · ${escapeHtml(quest.summary)}</span>
                 </li>`,
                 )
                 .join('')}
             </ul>`
      }
      ${
        memory.openThreads.length === 0
          ? ''
          : `<h3 class="preview-subheading">Open threads</h3>
             <ul class="record-list compact" data-testid="open-thread-list">
               ${memory.openThreads
                 .map(
                   (thread) => `
                 <li data-testid="open-thread-item"><span class="record-note">${escapeHtml(thread.summary)}</span></li>`,
                 )
                 .join('')}
             </ul>`
      }`;
  }

  function notesPanelBody(): string {
    return `
      <p class="record-meta">Private scratch notes — saved on this device for this campaign. They start empty; campaign prompts live under People and Story so far.</p>
      <label class="field">
        <span class="visually-hidden">Table notes</span>
        <textarea data-testid="table-notes-input" rows="12"
          placeholder="Track clues, NPC impressions, loot, plans…">${escapeHtml(tableNotes)}</textarea>
      </label>`;
  }

  function infoTabBody(): string {
    switch (activeInfoTab) {
      case 'character':
        return `
          <section class="table-info-pane" data-testid="table-character-sheet-pane">
            ${characterSheetPanel()}
          </section>`;
      case 'notes':
        return `<section class="table-info-pane" data-testid="table-notes-panel">${notesPanelBody()}</section>`;
      case 'people':
        return `<section class="table-info-pane" data-testid="table-people-panel">${peoplePanelBody()}</section>`;
      case 'tools':
        return `
          <section class="table-info-pane" data-testid="table-tools-panel">
            <details class="table-advanced-controls" data-testid="table-advanced-controls">
              <summary>Training and combat tools</summary>
              ${advancedControlsBody()}
            </details>
          </section>`;
    }
  }

  function infoRailBody(): string {
    const tabs = visibleInfoTabs();
    if (!tabs.includes(activeInfoTab)) {
      activeInfoTab = 'character';
    }
    return `
      <button type="button" class="table-rail-collapse" data-testid="collapse-info-rail"
        aria-expanded="${!infoRailCollapsed}" ${infoRailCollapsed ? 'hidden' : ''}>
        Hide reference
      </button>
      ${
        infoRailCollapsed
          ? `<button type="button" class="table-rail-restore" data-testid="expand-info-rail-inline">Show reference</button>`
          : `<div class="info-rail-tabs" role="tablist" aria-label="Table reference">
        ${tabs
          .map(
            (tab) => `
          <button type="button" role="tab" class="info-rail-tab${activeInfoTab === tab ? ' active' : ''}"
            aria-selected="${activeInfoTab === tab}" data-testid="table-info-tab-${tab}" data-info-tab="${tab}">
            ${escapeHtml(INFO_TAB_LABELS[tab])}
          </button>`,
          )
          .join('')}
      </div>
      <div class="info-rail-viewport" role="tabpanel">
        ${infoTabBody()}
      </div>`
      }`;
  }

  function commsDockBody(): string {
    return `
      <button type="button" class="table-rail-collapse" data-testid="collapse-comms-rail"
        aria-expanded="${!commsRailCollapsed}" ${commsRailCollapsed ? 'hidden' : ''}>
        Hide chat
      </button>
      ${
        commsRailCollapsed
          ? `<button type="button" class="table-rail-restore" data-testid="expand-comms-rail-inline">Show chat</button>`
          : `<div class="dock-tabs" role="tablist" aria-label="Table conversations">
        ${PLAYER_DOCK_TAB_ORDER.map(
          (tab) => `
          <button type="button" role="tab" class="dock-tab${activeTab === tab ? ' active' : ''}"
            aria-selected="${activeTab === tab}" data-testid="dock-tab-${tab}" data-dock-tab="${tab}">
            ${escapeHtml(DOCK_TAB_LABELS[tab])}
          </button>`,
        ).join('')}
      </div>
      <div class="dock-viewport" role="tabpanel">
        ${dockBody()}
      </div>`
      }`;
  }

  function compactPresenceLine(): string {
    if (presence === null || presence.devices.length === 0) {
      return 'No one else is at the table yet.';
    }
    const accountId = getAccount()?.accountId ?? null;
    const labels = presence.devices
      .filter((device) => device.status === 'online' || device.status === 'grace')
      .map((device) => {
        const name = device.displayLabel.trim() || 'Player';
        return device.accountId === accountId ? `${name} (you)` : name;
      });
    const unique = [...new Set(labels)];
    return unique.length === 0 ? 'No one else is at the table yet.' : `At the table: ${unique.join(', ')}`;
  }

  /** Visible prerequisite copy for disabled training controls. */
  function composerGateHint(): string {
    if (candidate === null) {
      return 'Arena candidate is still loading.';
    }
    if (!seated) {
      return 'Seat a character you own on the campaign page before using training controls.';
    }
    if (encounter?.status === 'active') {
      if (!isOwnCombatTurn()) {
        return 'Initiative order is active. Training combat controls unlock on your turn.';
      }
      const own = ownCombatant();
      if (own?.actionEconomy.actionAvailable !== true) {
        return 'Your action is spent for this turn. End your turn or use a still-available control.';
      }
    }
    return explorationMode()
      ? 'Exploration mode — move freely on the map. Training controls are optional.'
      : 'Your combat turn is active. Training controls are available if you need them.';
  }

  function presentationMeta(): string {
    const motion = reducedMotion ? 'reduced motion on' : 'reduced motion off';
    const effects = lowEffects ? 'low effects on' : 'low effects off';
    const tts = textToSpeechEnabled ? 'TTS on' : 'TTS off';
    const stt = speechToTextEnabled ? 'STT on' : 'STT off';
    return `Table presentation: ${motion} · ${effects} · ${tts} · ${stt}.`;
  }

  function presenceStatusRank(status: string): number {
    switch (status) {
      case 'online':
        return 0;
      case 'grace':
        return 1;
      case 'spectator':
        return 2;
      case 'offline':
        return 3;
      default:
        return 4;
    }
  }

  function presenceStatusLabel(status: string, deviceCount: number): string {
    const base =
      status === 'online'
        ? 'Online'
        : status === 'grace'
          ? 'Reconnecting'
          : status === 'spectator'
            ? 'Spectating'
            : status === 'offline'
              ? 'Offline'
              : 'Away';
    // Multi-tab heartbeats are one person — do not inflate the label with device counts.
    void deviceCount;
    return base;
  }

  function presenceBody(): string {
    if (presence === null) {
      return '<p class="record-meta" data-testid="presence-empty">Presence not yet heartbeated.</p>';
    }
    // Group by account so multi-tab heartbeats do not look like duplicate people.
    const byAccount = new Map<
      string,
      {
        displayLabel: string;
        devices: Array<(typeof presence.devices)[number]>;
      }
    >();
    for (const device of presence.devices) {
      const existing = byAccount.get(device.accountId);
      if (existing === undefined) {
        byAccount.set(device.accountId, {
          displayLabel: device.displayLabel,
          devices: [device],
        });
      } else {
        existing.devices.push(device);
      }
    }
    const rows = [...byAccount.values()]
      .map((group) => {
        const primary = [...group.devices].sort(
          (left, right) => presenceStatusRank(left.status) - presenceStatusRank(right.status),
        )[0]!;
        return `
        <li data-testid="presence-device">
          <strong>${escapeHtml(group.displayLabel)}</strong>
          · ${escapeHtml(presenceStatusLabel(primary.status, group.devices.length))}
        </li>`;
      })
      .join('');
    const onlineCount = [...byAccount.values()].filter((group) =>
      group.devices.some((device) => device.status === 'online' || device.status === 'spectator'),
    ).length;
    const reconnectingCount = [...byAccount.values()].filter(
      (group) =>
        group.devices.some((device) => device.status === 'grace') &&
        !group.devices.some((device) => device.status === 'online'),
    ).length;
    return `
      <div data-testid="presence-panel">
        <p class="record-meta" data-testid="presence-meta">
          Who is here · online ${onlineCount}${reconnectingCount > 0 ? ` · reconnecting ${reconnectingCount}` : ''}
        </p>
        <ul class="record-list" data-testid="presence-list">${rows || '<li>No one at the table yet.</li>'}</ul>
      </div>`;
  }

  function dockBody(): string {
    if (activeTab === 'chronicle') {
      const allEntries = chronicle?.entries ?? [];
      const entries =
        chronicleKindFilter === 'all'
          ? allEntries
          : allEntries.filter((entry) => entry.kind === chronicleKindFilter);
      return `
        <div class="dock-pane" data-testid="chronicle-pane">
          <h3 data-testid="session-record-heading">Session record</h3>
          <p class="record-meta">Campaign history only. Players cannot post here.</p>
          <p class="record-meta" data-testid="session-record-privacy-note">
            Play declarations, rulings, narration, and map events appear here. Private Ask the Game
            Director advice stays in Ask DM and is never merged into this public session record.
          </p>
          <label class="field">
            <span>Filter by kind</span>
            <select data-testid="chronicle-kind-filter">
              <option value="all" ${chronicleKindFilter === 'all' ? 'selected' : ''}>All kinds</option>
              ${CHRONICLE_ENTRY_KINDS.map(
                (kind) =>
                  `<option value="${escapeHtml(kind)}" ${
                    chronicleKindFilter === kind ? 'selected' : ''
                  }>${escapeHtml(CHRONICLE_ENTRY_KIND_LABELS[kind])}</option>`,
              ).join('')}
            </select>
          </label>
          ${
            entries.length === 0
              ? '<p class="empty-state" data-testid="chronicle-empty">No Chronicle entries yet.</p>'
              : `<ol class="record-list chronicle-list" data-testid="chronicle-list">
                  ${entries
                    .map(
                      (entry) => `
                    <li data-testid="chronicle-entry">
                      <span class="record-note">${escapeHtml(
                        scrubChronicleCheckpointZero(entry.body),
                      )}</span>
                      <span class="record-meta">${escapeHtml(CHRONICLE_ENTRY_KIND_LABELS[entry.kind] ?? entry.kind)} · ${escapeHtml(formatTimestamp(entry.createdAt))}</span>
                    </li>`,
                    )
                    .join('')}
                </ol>`
          }
          ${
            lastNarration === null
              ? ''
              : `<article class="rules-explanation" data-testid="director-narration">
                  <h3>Director narration</h3>
                  <p>${escapeHtml(lastNarration)}</p>
                </article>`
          }
        </div>`;
    }

    if (activeTab === 'rules_desk') {
      const categoryEntries =
        rulesCatalog?.entries.filter((entry) => entry.category === selectedRulesCategory) ?? [];
      const search = rulesSearchQuery.trim().toLowerCase();
      const filteredEntries =
        search.length === 0
          ? categoryEntries
          : categoryEntries.filter(
              (entry) =>
                entry.title.toLowerCase().includes(search) ||
                entry.summary.toLowerCase().includes(search),
            );
      const selectedEntry =
        filteredEntries.find((entry) => entry.entryId === selectedRulesEntryId) ??
        filteredEntries[0] ??
        null;
      if (selectedEntry !== null && selectedRulesEntryId !== selectedEntry.entryId) {
        selectedRulesEntryId = selectedEntry.entryId;
      }
      return `
        <div class="dock-pane" data-testid="rules-desk-pane">
          <p data-testid="rules-desk-notice">${escapeHtml(rulesCatalog?.notice ?? RULES_DESK_NOTICE)}</p>
          <p class="record-meta" data-testid="rules-catalog-meta">
            ${
              rulesCatalog === null
                ? 'Loading SRD reference…'
                : 'SRD 5.2.1 reference'
            }
          </p>
          <label class="field">
            <span>Search rules</span>
            <input type="search" data-testid="rules-catalog-search" placeholder="Filter by title or summary"
              value="${escapeHtml(rulesSearchQuery)}" />
          </label>
          <label class="field">
            <span>Category</span>
            <select data-testid="rules-catalog-category">
              ${(rulesCatalog?.categories ?? [])
                .map(
                  (category) =>
                    `<option value="${escapeHtml(category.id)}" ${
                      selectedRulesCategory === category.id ? 'selected' : ''
                    }>${escapeHtml(category.label)}</option>`,
                )
                .join('')}
            </select>
          </label>
          <div class="rules-catalog-entries" data-testid="rules-catalog-entries">
            ${
              filteredEntries.length === 0
                ? '<p class="record-meta">No entries match this search in this category.</p>'
                : `<ul class="record-list compact">
                    ${filteredEntries
                      .map(
                        (entry) => `
                      <li>
                        <button type="button" class="rules-catalog-entry${
                          selectedEntry?.entryId === entry.entryId ? ' selected' : ''
                        }" data-testid="rules-catalog-entry" data-entry-id="${escapeHtml(entry.entryId)}">
                          ${escapeHtml(entry.title)}
                        </button>
                      </li>`,
                      )
                      .join('')}
                  </ul>`
            }
          </div>
          ${
            selectedEntry === null
              ? '<p class="record-meta">Choose an entry to read the reference.</p>'
              : `<article class="rules-explanation" data-testid="rules-explanation">
                  <h3>${escapeHtml(selectedEntry.title)}</h3>
                  <p>${escapeHtml(selectedEntry.summary)}</p>
                  <ol class="rules-explanation-steps">${selectedEntry.details
                    .map((detail) => `<li>${escapeHtml(detail)}</li>`)
                    .join('\n')}</ol>
                  <p class="record-meta">${escapeHtml(selectedEntry.source)} · ${escapeHtml(
                    RULES_CATALOG_CATEGORY_LABELS[selectedEntry.category],
                  )}</p>
                </article>`
          }
        </div>`;
    }

    if (activeTab === 'director_address') {
      return `
        <div class="dock-pane" data-testid="director-address-pane">
          <p data-testid="director-address-notice">${escapeHtml(DIRECTOR_ADDRESS_NOTICE)}</p>
          <p class="record-meta" data-testid="ask-dm-identity">Consulting ${escapeHtml(directorIdentityLabel)}</p>
          ${renderThreadMessages(askDmThread, {
            listTestId: 'ask-dm-thread',
            latestReplyTestId: 'director-address-reply',
          })}
          <form class="dock-composer" data-testid="director-address-composer">
            <label class="field">
              <span>Ask ${escapeHtml(directorIdentityLabel)} about rules or feasibility</span>
              <textarea data-testid="director-address-input" rows="3" placeholder="Example: Can I climb that wall and cast Magic Missile in the same turn?">${escapeHtml(directorDraft)}</textarea>
            </label>
            <button type="submit" data-testid="director-address-send" aria-disabled="${busy || candidate === null || directorDraft.trim().length === 0}">
              ${busy ? 'Sending…' : `Ask ${escapeHtml(directorIdentityLabel)}`}
            </button>
          </form>
        </div>`;
    }

    const messages = partyChat?.messages ?? [];
    const spotlight = tableState?.npcSpotlight ?? null;
    const holdOwnSpotlight =
      spotlight !== null && ownSeatId !== null && spotlight.holderSeatId === ownSeatId;
    return `
      <div class="dock-pane" data-testid="party-chat-pane">
        ${
          spotlight === null
            ? '<p class="record-meta" data-testid="npc-spotlight-empty">NPC floor is for in-character roleplay. Messages here are player-authored, not Director canon — Speak as Character and address an NPC by the name already established at your table.</p>'
            : `<div class="npc-spotlight-banner" data-testid="npc-spotlight-banner">
                <p data-testid="npc-spotlight-meta">
                  Floor with <strong>${escapeHtml(spotlight.npcName)}</strong>:
                  ${escapeHtml(spotlight.holderDisplayName)}
                  ${holdOwnSpotlight ? '(you)' : ''}
                </p>
                ${
                  spotlight.lastMessagePreview === null
                    ? ''
                    : `<p class="record-meta" data-testid="npc-spotlight-preview">${escapeHtml(spotlight.lastMessagePreview)}</p>`
                }
                ${
                  holdOwnSpotlight
                    ? `<button type="button" data-testid="yield-npc-spotlight">Yield floor</button>`
                    : `<p class="record-meta">Wait for the spotlight to clear before addressing ${escapeHtml(spotlight.npcName)}.</p>`
                }
              </div>`
        }
        ${
          messages.length === 0
            ? '<p class="empty-state" data-testid="party-chat-empty">No messages yet. Say hello to your party.</p>'
            : `<ul class="record-list" data-testid="party-chat-list">
                ${messages
                  .map(
                    (message) => `
                  <li data-testid="party-chat-message">
                    <span class="record-note">
                      <strong>${escapeHtml(message.senderDisplayLabel)}</strong>
                      · ${escapeHtml(PARTY_CHAT_MODE_LABELS[message.mode])}
                      ${
                        message.addressedNpcName
                          ? ` · to ${escapeHtml(message.addressedNpcName)}`
                          : ''
                      }
                    </span>
                    <p>${escapeHtml(message.body)}</p>
                    <span class="record-meta">${escapeHtml(formatTimestamp(message.createdAt))}</span>
                  </li>`,
                  )
                  .join('')}
              </ul>`
        }
        <form class="dock-composer" data-testid="party-chat-composer">
          <fieldset class="option-list compact chat-mode-fieldset">
            <legend class="visually-hidden">Chat mode</legend>
            ${PARTY_CHAT_MODES.map(
              (mode) => `
              <label class="option${chatMode === mode ? ' selected' : ''}${mode === 'speak_as_character' && !seated ? ' disabled' : ''}">
                <input type="radio" name="chat-mode" value="${mode}"
                  ${chatMode === mode ? 'checked' : ''}
                  ${mode === 'speak_as_character' && !seated ? 'disabled' : ''}
                  data-testid="chat-mode-${mode}" />
                <span class="option-label">${escapeHtml(PARTY_CHAT_MODE_LABELS[mode])}</span>
              </label>`,
            ).join('')}
          </fieldset>
          ${
            !seated
              ? '<p class="record-meta" data-testid="speak-as-character-gate">Seat a character to use Speak as Character.</p>'
              : chatMode === 'speak_as_character'
                ? (() => {
                    const known = memory?.npcs.filter(
                      (npc) => npc.audience === 'public' || npc.audience === 'private',
                    ) ?? [];
                    if (known.length === 0) {
                      return '<p class="record-meta" data-testid="speak-as-npc-empty">No established NPCs yet — the Game Director introduces people first.</p>';
                    }
                    return `
                      <label class="field" data-testid="speak-as-npc-picker">
                        <span>Address NPC</span>
                        <select data-testid="speak-as-npc-select">
                          <option value="">Choose who you speak to…</option>
                          ${known
                            .map(
                              (npc) => `
                            <option value="${escapeHtml(npc.name)}" ${
                              speakAsNpcName === npc.name ? 'selected' : ''
                            }>${escapeHtml(npc.name)}</option>`,
                            )
                            .join('')}
                        </select>
                      </label>`;
                  })()
                : ''
          }
          <label class="field">
            <span>Message</span>
            <textarea data-testid="party-chat-input" rows="3" placeholder="${
              chatMode === 'speak_as_character'
                ? 'Speak in character to an established NPC…'
                : 'Talk with your party…'
            }">${escapeHtml(draft)}</textarea>
          </label>
          <button type="submit" data-testid="party-chat-send" aria-disabled="${partyChatSendBlocked()}">
            ${busy ? 'Sending…' : 'Send'}
          </button>
          ${
            speechToTextEnabled
              ? `<button type="button" data-testid="party-chat-dictate" aria-disabled="${busy}">
                   Dictate into draft
                 </button>`
              : ''
          }
        </form>
      </div>`;
  }

  function encounterBody(): string {
    if (!seated) {
      return '<p class="record-meta">Seat a character to start the training encounter.</p>';
    }
    const seatedCombatant = ownCombatant();
    const availableSpells = [
      ...(progression?.sheet.spellcasting?.cantrips ?? []),
      ...(progression?.sheet.spellcasting?.spells ?? []),
    ].filter((spell) =>
      ['fire-bolt', 'sacred-flame', 'guiding-bolt', 'cure-wounds', 'burning-hands', 'bless', 'shield'].includes(
        spell.id,
      ),
    );
    if (
      availableSpells.length > 0 &&
      !availableSpells.some((spell) => spell.id === selectedSpellId)
    ) {
      selectedSpellId = availableSpells[0]!.id;
    }
    const ownTurn =
      encounter?.status === 'active' &&
      encounter.activeCombatantId === seatedCombatant?.combatantId;
    const actionAvailable = ownTurn && seatedCombatant?.actionEconomy.actionAvailable === true;
    const deathSaveAvailable =
      ownTurn &&
      seatedCombatant?.currentHitPoints === 0 &&
      seatedCombatant.deathSaves.dead !== true &&
      seatedCombatant.deathSaves.stable !== true &&
      seatedCombatant.actionEconomy.deathSaveAvailable === true;
    const longRestAvailable =
      encounter !== null &&
      encounter.status !== 'active' &&
      encounter.status !== 'setup' &&
      seatedCombatant?.deathSaves.dead !== true;
    const shortRestAvailable =
      longRestAvailable && (seatedCombatant?.hitDiceRemaining ?? 0) > 0;
    const outOfCombatProgression =
      encounter === null || (encounter.status !== 'active' && encounter.status !== 'setup');
    const xpAwardAvailable =
      outOfCombatProgression && encounter !== null && encounter.status === 'ended';
    const openWindow = encounter?.decisionWindows.find(
      (window) =>
        window.state === 'open' &&
        window.eligibleCombatantId === seatedCombatant?.combatantId,
    );
    const disable = busy || tableState === null || sessionIsSuspended();
    const combatDisabled = disable || (encounter?.status === 'active' && !ownTurn);
    const livingFoeTargets =
      encounter?.combatants.filter(
        (combatant) =>
          combatant.side === 'foe' &&
          combatant.currentHitPoints > 0 &&
          !combatant.deathSaves.dead &&
          !combatant.conditions.some((condition) => condition.conditionId === 'unconscious'),
      ) ?? [];
    const attackTargets =
      encounter?.combatants.filter(
        (combatant) =>
          combatant.combatantId !== seatedCombatant?.combatantId &&
          !combatant.deathSaves.dead &&
          (combatant.side !== 'foe' ||
            (combatant.currentHitPoints > 0 &&
              !combatant.conditions.some((condition) => condition.conditionId === 'unconscious'))),
      ) ?? [];
    const targets = attackTargets;
    if (
      attackTargets.length > 0 &&
      !attackTargets.some((combatant) => combatant.combatantId === selectedCombatantId)
    ) {
      selectedCombatantId =
        livingFoeTargets[0]?.combatantId ?? attackTargets[0]!.combatantId;
    }
    const potionCount =
      seatedCombatant?.inventory.find((entry) => entry.itemId === 'healing-potion')?.quantity ?? 0;
    const potionUsable =
      actionAvailable &&
      potionCount > 0 &&
      (seatedCombatant?.currentHitPoints ?? 0) < (seatedCombatant?.maxHitPoints ?? 0);
    return `
      <section class="rules-encounter" aria-labelledby="rules-encounter-heading" data-testid="rules-encounter">
        <div class="rules-heading-row">
          <div>
            <h3 id="rules-encounter-heading">Training encounter</h3>
            <p class="record-meta" data-testid="rules-tools-secondary-note">
              Prefer declaring what you do in the ${PLAY_CHANNEL_LABEL}. These controls are training shortcuts.
            </p>
            <p class="record-meta" data-testid="progression-meta">
              Level ${progression?.level ?? 1} · ${progression?.experiencePoints ?? 0} XP
              ${progression?.levelUpAvailable === true ? ' · Level Up available' : ''}
            </p>
          </div>
          <p class="record-meta" data-testid="encounter-meta">
            ${escapeHtml(formatEncounterStatus())}
          </p>
        </div>
        ${
          encounter === null
            ? `<p>${
                trainingToolsVisible()
                  ? 'Begin a local rules encounter against a Training Dummy and Practice Goblin.'
                  : 'Begin a local rules encounter against practice foes.'
              }</p>`
            : `<ul class="combatant-grid" data-testid="combatant-list">
                ${encounter.combatants
                  .map(
                    (combatant) => `
                    <li class="combatant-card${encounter?.activeCombatantId === combatant.combatantId ? ' active' : ''}"
                      data-testid="combatant-${escapeHtml(combatant.combatantId)}"
                      ${combatant.seatId !== null ? 'data-own-combatant="true"' : ''}>
                      <strong>${escapeHtml(formatCombatantLabel(combatant.name, combatant.combatantId))}</strong>
                      <span data-testid="${combatant.seatId !== null ? 'own-combatant-hp' : `combatant-hp-${escapeHtml(combatant.combatantId)}`}">${escapeHtml(formatCombatantHealth(combatant))}</span>
                      <span>Initiative ${combatant.initiative ?? '—'} · ${escapeHtml(formatCombatantSide(combatant.side, combatant.combatantId))}</span>
                      <span data-testid="${combatant.seatId !== null ? 'own-combatant-conditions' : `combatant-conditions-${escapeHtml(combatant.combatantId)}`}">${escapeHtml(formatCombatantConditions(combatant.conditions))}</span>
                      ${
                        combatant.seatId !== null && combatant.inventory.length > 0
                          ? `<span data-testid="own-combatant-inventory">${combatant.inventory
                              .map((item) => `${escapeHtml(item.label)} ×${item.quantity}`)
                              .join(' · ')}</span>`
                          : ''
                      }
                    </li>`,
                  )
                  .join('')}
              </ul>`
        }
        <div class="rules-targeting">
          <label class="field compact">
            <span>Selected combatant</span>
            <select data-testid="rules-target">
              ${targets
                .map(
                  (combatant) =>
                    `<option value="${escapeHtml(combatant.combatantId)}" ${
                      selectedCombatantId === combatant.combatantId ? 'selected' : ''
                    }>${escapeHtml(formatCombatantLabel(combatant.name, combatant.combatantId))}</option>`,
                )
                .join('')}
            </select>
          </label>
          <label class="field compact">
            <span>Spell</span>
            <select data-testid="rules-spell">
              ${
                availableSpells.length === 0
                  ? '<option value="">No implemented spell prepared</option>'
                  : availableSpells
                      .map(
                        (spell) =>
                          `<option value="${escapeHtml(spell.id)}" ${selectedSpellId === spell.id ? 'selected' : ''}>${escapeHtml(spell.name)}</option>`,
                      )
                      .join('')
              }
            </select>
          </label>
        </div>
        <div class="action-composer-controls rules-controls">
          <button type="button" data-rules-command="encounter.begin" data-testid="begin-encounter"
            aria-disabled="${disable || encounter !== null}" aria-describedby="composer-gate-hint">Begin encounter</button>
          <button type="button" data-rules-command="initiative.roll" data-testid="roll-initiative"
            aria-disabled="${disable || encounter?.status !== 'setup'}" aria-describedby="composer-gate-hint">Roll initiative</button>
          <button type="button" data-rules-command="encounter.next_turn" data-testid="next-encounter-turn"
            aria-disabled="${disable || encounter?.status !== 'active'}" aria-describedby="composer-gate-hint">Next turn</button>
          <button type="button" data-rules-command="encounter.end" data-testid="end-encounter"
            aria-disabled="${disable || encounter === null || encounter.status === 'ended'}" aria-describedby="composer-gate-hint">End encounter</button>
          <button type="button" data-rules-command="combat.attack" data-testid="rules-attack"
            aria-disabled="${combatDisabled || !actionAvailable || selectedCombatantId === null}" aria-describedby="composer-gate-hint">Attack selected</button>
          <button type="button" data-rules-command="combat.cast_spell" data-testid="rules-cast-spell"
            aria-disabled="${combatDisabled || !actionAvailable || availableSpells.length === 0}" aria-describedby="composer-gate-hint">Cast spell</button>
          <button type="button" data-rules-command="combat.ready" data-testid="rules-ready"
            aria-disabled="${combatDisabled || !actionAvailable}" aria-describedby="composer-gate-hint">Ready opportunity attack</button>
          <button type="button" data-rules-command="combat.reaction" data-testid="rules-reaction"
            aria-disabled="${combatDisabled || openWindow === undefined}" aria-describedby="composer-gate-hint">Spend Reaction</button>
          <button type="button" data-rules-command="inventory.use_item" data-testid="rules-use-potion"
            aria-disabled="${combatDisabled || !potionUsable}" aria-describedby="composer-gate-hint">Use healing potion${potionCount > 0 ? ` (${potionCount})` : ''}</button>
          <button type="button" data-rules-command="combat.death_save" data-testid="rules-death-save"
            aria-disabled="${combatDisabled || !deathSaveAvailable}" aria-describedby="composer-gate-hint">Death Save</button>
          <button type="button" data-rules-command="combat.training_drop" data-testid="rules-training-drop"
            aria-disabled="${combatDisabled || !actionAvailable || seatedCombatant?.currentHitPoints === 0}" aria-describedby="composer-gate-hint">Training: drop to 0 HP</button>
          <button type="button" data-rules-command="combat.short_rest" data-testid="rules-short-rest"
            aria-disabled="${disable || !shortRestAvailable}">Short Rest</button>
          <button type="button" data-rules-command="combat.long_rest" data-testid="rules-long-rest"
            aria-disabled="${disable || !longRestAvailable}">Long Rest</button>
          <button type="button" data-rules-command="progression.award_xp" data-testid="rules-award-xp"
            aria-disabled="${disable || !xpAwardAvailable}">Award 300 XP</button>
          <button type="button" data-rules-command="progression.level_up" data-testid="rules-level-up"
            aria-disabled="${disable || !outOfCombatProgression || progression?.levelUpAvailable !== true}">Level Up</button>
        </div>
        <p class="record-meta" data-testid="rules-last-result">
          ${escapeHtml(
            playerFacingMechanicsCopy(
              encounter?.log.at(-1)?.summary ?? 'Server dice and results will appear here.',
            ),
          )}
        </p>
      </section>`;
  }

  function playerActionBar(): string {
    seedDmThreadIfNeeded();
    const banner = turnBanner();
    const showEndTurn = isOwnCombatTurn() && !sessionIsSuspended();
    const canDescribeTurn =
      seated && !sessionIsSuspended() && (explorationMode() || isOwnCombatTurn());
    // NEW-PQA-02: hosted has no Tools tab — End encounter must stay on the play bar.
    const showEndEncounter =
      seated &&
      !sessionIsSuspended() &&
      encounter !== null &&
      encounter.status !== 'ended';
    return `
      <div class="table-action-bar-inner table-action-bar-dm">
        <section class="table-turn-banner table-turn-banner-${banner.tone}" data-testid="table-turn-banner" aria-live="polite">
          <p class="table-turn-title" data-testid="table-turn-title">${escapeHtml(banner.title)}</p>
          <p class="table-turn-detail" data-testid="table-turn-detail">${escapeHtml(banner.detail)}</p>
          ${
            sessionIsSuspended()
              ? `<p class="message notice" data-testid="table-suspended-notice">This session is suspended. Resume it on the campaign page to continue play.</p>`
              : ''
          }
          ${initiativeStrip()}
          <p class="table-turn-presence visually-hidden" data-testid="table-turn-presence">${escapeHtml(compactPresenceLine())}</p>
          ${
            movePreviewNote === null
              ? seated && !sessionIsSuspended()
                ? `<p class="table-move-status" data-testid="move-preview-hint">Click an adjacent map square to preview a move, then Confirm or Cancel. After a committed move, Undo last move appears here.</p>`
                : ''
              : `<p class="table-move-status" data-testid="move-target-meta">${escapeHtml(movePreviewNote)}</p>`
          }
          ${
            (() => {
              const edge =
                selectedEdgeId === null || mapBundle === null
                  ? undefined
                  : mapBundle.edges.find((entry) => entry.edgeId === selectedEdgeId);
              if (edge === undefined || edge.kind !== 'door') {
                return '';
              }
              return `<p class="message notice" data-testid="door-selection-detail">${escapeHtml(
                doorDetailCopy(edge, mapBundle?.title ?? ''),
              )}</p>`;
            })()
          }
          ${
            pendingMoveConfirm
              ? `<div class="table-player-actions" data-testid="pending-move-actions">
                   <button type="button" class="table-primary-action" data-testid="confirm-pending-move"
                     aria-disabled="${busy}">Confirm move</button>
                   <button type="button" class="table-secondary-action" data-testid="cancel-pending-move"
                     aria-disabled="${busy}">Cancel move</button>
                 </div>`
              : undoMoveAnchor !== null && seated && !sessionIsSuspended()
                ? `<div class="table-player-actions" data-testid="undo-move-actions">
                     <button type="button" class="table-secondary-action" data-testid="undo-last-move-play"
                       aria-disabled="${busy}">Undo last move</button>
                   </div>`
                : ''
          }
          ${
            showEndEncounter
              ? `<div class="table-player-actions" data-testid="end-encounter-play-actions">
                   <button type="button" class="table-secondary-action" data-testid="end-encounter-play"
                     aria-disabled="${busy}">End encounter</button>
                 </div>`
              : ''
          }
        </section>
        <div class="dm-play-thread${dmThreadExpanded ? ' is-expanded' : ''}" data-testid="dm-play-thread">
          <div class="dm-play-thread-chrome">
            <p class="record-meta" data-testid="dm-play-identity">${escapeHtml(directorIdentityLabel)} · table beats</p>
            <div class="dm-play-thread-chrome-actions">
              <button type="button" class="table-secondary-action dm-thread-expand" data-testid="dm-thread-expand"
                aria-pressed="${dmThreadExpanded}">
                ${dmThreadExpanded ? 'Compact timeline' : 'Expand timeline'}
              </button>
              <button type="button" class="table-secondary-action dm-thread-jump-latest" data-testid="dm-thread-jump-latest" hidden>
                Jump to latest
              </button>
            </div>
          </div>
          <p class="record-meta" data-testid="dm-beat-queue-hint">
            Declarations, rulings, mechanics, and narration share one timeline. Confirm drafts before the scene moves on.
          </p>
          ${renderThreadMessages(dmThread, { listTestId: 'dm-play-thread-list' })}
          ${
            intentDraft === null
              ? ''
              : `<div class="intent-intercept dm-thread-intent${
                  intentDraft.interceptState === 'stale' || intentDraft.interceptState === 'failed'
                    ? ' intent-stale'
                    : ''
                }" data-testid="intent-intercept" data-intercept-state="${escapeHtml(intentDraft.interceptState)}">
                  ${
                    lastSubmittedDeclaration.trim().length > 0
                      ? `<p class="record-meta" data-testid="intent-intercept-declaration">You declared: ${escapeHtml(lastSubmittedDeclaration.trim())}</p>`
                      : ''
                  }
                  <p data-testid="intent-intercept-summary">${escapeHtml(
                    playerFacingMechanicsCopy(intentDraft.summary),
                  )}</p>
                  ${
                    intentDraft.interceptState === 'stale'
                      ? `<p class="message error" data-testid="intent-intercept-stale">Scene changed — cancel and re-declare.</p>
                         <div class="action-composer-controls">
                           <button type="button" data-testid="cancel-intent-intercept" aria-disabled="${busy}">Dismiss stale draft</button>
                         </div>`
                      : intentDraft.interceptState === 'failed'
                        ? `<p class="message error" data-testid="intent-intercept-failed">That action could not be completed. Edit your declaration and try again.</p>
                         <div class="action-composer-controls">
                           <button type="button" data-testid="edit-failed-declaration" aria-disabled="${busy}">Edit declaration</button>
                           <button type="button" data-testid="retry-failed-intent" aria-disabled="${busy}">Retry</button>
                           <button type="button" data-testid="cancel-intent-intercept" aria-disabled="${busy}">Dismiss</button>
                         </div>`
                        : isSyncClarificationOnly(intentDraft, intentDraft.summary)
                          ? `<div class="action-composer-controls">
                           <button type="button" data-testid="cancel-intent-intercept" aria-disabled="${busy}">Got it</button>
                         </div>`
                          : `<div class="action-composer-controls">
                    <button type="button" data-testid="confirm-intent-intercept"
                      aria-disabled="${busy || (!explorationMode() && !holdsOwnAuthority())}">Confirm action</button>
                    <button type="button" data-testid="cancel-intent-intercept"
                      aria-disabled="${busy}">Cancel draft</button>
                  </div>`
                  }
                </div>`
          }
        </div>
        ${
          doorRecoveryVisible
            ? `<div class="door-recovery-panel" data-testid="door-recovery-panel">
                <p class="record-meta">No door is ready on this scene yet. Place one ahead, or ask the Director what you can interact with.</p>
                <div class="door-recovery-actions">
                  <button type="button" class="table-secondary-action" data-testid="place-door-ahead">Place door ahead</button>
                </div>
              </div>`
            : ''
        }
        ${
          canDescribeTurn
            ? `<div class="table-player-turn-composer" data-testid="table-player-turn-composer">
                <p class="record-meta" data-testid="action-channel-hint">
                  This is the play channel — declarations can change the table. Chat stays social; Ask the Director is advice only.
                </p>
                <label class="field table-action-field">
                  <span class="visually-hidden">What do you do?</span>
                  <textarea data-testid="player-action-input" rows="2"
                    placeholder="Examples: open the door · step through · follow the passage · return to the courtyard">${escapeHtml(playerActionDraft)}</textarea>
                </label>
                <div class="table-player-actions" data-testid="table-player-actions">
                  <button type="button" class="table-primary-action" data-testid="submit-player-action"
                    aria-disabled="${busy || candidate === null || playerActionDraft.trim().length === 0}">
                    ${busy ? 'Sending…' : `Tell ${escapeHtml(directorIdentityLabel)}`}
                  </button>
                  ${
                    showEndTurn
                      ? `<button type="button" class="table-secondary-action" data-testid="end-combat-turn"
                          aria-disabled="${busy || candidate === null}">
                          End turn
                        </button>`
                      : ''
                  }
                </div>
              </div>`
            : `<div class="table-player-actions table-player-actions-compact" data-testid="table-player-actions">
                <p class="record-meta">${
                  seated
                    ? 'Watch the scene or use chat while others act.'
                    : 'Seat a character to play in this Game Director thread.'
                }</p>
              </div>`
        }
      </div>`;
  }

  function advancedControlsBody(): string {
    const ownAuthority = holdsOwnAuthority();
    const needsAuthority = !explorationMode();
    const syncDisabled =
      busy ||
      candidate === null ||
      !seated ||
      tableState === null ||
      sessionIsSuspended() ||
      (needsAuthority && !ownAuthority);
    const interpretDisabled =
      busy ||
      candidate === null ||
      !seated ||
      sessionIsSuspended() ||
      (needsAuthority && !ownAuthority) ||
      (encounter?.status === 'active' &&
        (() => {
          const own = ownCombatant();
          if (own === null) return true;
          if (own.currentHitPoints <= 0 || own.deathSaves.dead) return true;
          if (encounter.activeCombatantId !== own.combatantId) return true;
          return own.actionEconomy.actionAvailable !== true;
        })());
    const gateHint = sessionIsSuspended()
      ? 'Session suspended — resume from the campaign page before playing.'
      : composerGateHint();
    const hasClosedDoor =
      mapBundle !== null &&
      mapBundle.edges.some((edge) => edge.kind === 'door' && edge.doorState !== 'open');
    const moveDestinations =
      mapBundle === null || !seated
        ? []
        : mapBundle.cells
            .filter((cell) => cell.terrain !== 'blocked' && cell.known)
            .slice(0, 96)
            .map((cell) => ({ column: cell.column, row: cell.row }));
    const canClaimActiveTurn =
      seated &&
      explorationMode() &&
      candidate !== null &&
      !sessionIsSuspended() &&
      (timingAuthority === null ||
        timingAuthority.timingAuthorityId === 'held-by-other' ||
        timingAuthority.state !== 'issued');
    return `
      <p class="record-meta" data-testid="timing-authority-meta">${escapeHtml(authorityMeta())}</p>
      ${
        canClaimActiveTurn
          ? `<div class="action-composer-authority">
               <button type="button" data-testid="claim-active-turn"
                 aria-disabled="${busy || candidate === null ? 'true' : 'false'}">
                 Claim active turn
               </button>
               <p class="record-meta">Take the action window when you are ready to move or declare.</p>
             </div>`
          : ''
      }
      ${
        sessionIsSuspended()
          ? ''
          : `<p class="composer-gate-hint" role="status" id="composer-gate-hint" data-testid="composer-gate-hint">${escapeHtml(gateHint)}</p>`
      }
      ${
        sessionIsSuspended()
          ? `<p class="message notice" data-testid="table-tools-suspended-hint">Session suspended — table tools stay read-only until you resume.</p>`
          : ''
      }
      <div class="table-a11y-panel" data-testid="table-a11y-panel">
        <p class="record-meta" data-testid="table-presentation-meta">${escapeHtml(presentationMeta())}</p>
        <label class="option compact">
          <input type="checkbox" data-testid="table-reduced-motion" ${reducedMotion ? 'checked' : ''}
            ${busy || candidate === null ? 'disabled' : ''} />
          <span class="option-label">Reduced motion</span>
        </label>
        <label class="option compact">
          <input type="checkbox" data-testid="table-low-effects" ${lowEffects ? 'checked' : ''}
            ${busy || candidate === null ? 'disabled' : ''} />
          <span class="option-label">Low effects</span>
        </label>
      </div>
      ${encounterBody()}
      <div class="action-composer-controls">
        <label class="field compact">
          <span>Move destination (square)</span>
          <select data-testid="move-destination-select" ${syncDisabled || !canMoveOnMap() ? 'disabled' : ''}>
            <option value="">Choose a square…</option>
            ${moveDestinations
              .map(
                (square, index) =>
                  `<option value="${square.column},${square.row}" ${
                    moveTarget?.column === square.column && moveTarget?.row === square.row
                      ? 'selected'
                      : ''
                  }>Near destination ${index + 1}</option>`,
              )
              .join('')}
          </select>
        </label>
        <button type="button" data-testid="refresh-table-projection"
          aria-disabled="${busy || candidate === null}">
          Refresh table projection
        </button>
        <button type="button" data-testid="commit-table-sync"
          aria-disabled="${syncDisabled}"
          aria-describedby="composer-gate-hint">
          ${busy ? 'Committing…' : escapeHtml(ACTION_COMPOSER_STRUCTURE.tableSyncLabel)}
        </button>
        <button type="button" data-testid="commit-table-move"
          aria-disabled="${syncDisabled || moveTarget === null}"
          aria-describedby="composer-gate-hint">
          ${busy ? 'Moving…' : 'Commit move'}
        </button>
        ${
          undoMoveAnchor === null
            ? ''
            : `<button type="button" data-testid="undo-last-move"
          aria-disabled="${syncDisabled}"
          aria-describedby="composer-gate-hint">
          Undo last move
        </button>`
        }
        <button type="button" data-testid="open-adjacent-door"
          aria-disabled="${syncDisabled || !hasClosedDoor}"
          aria-describedby="composer-gate-hint">
          Open adjacent door
        </button>
        <button type="button" data-testid="interpret-action"
          aria-disabled="${interpretDisabled}"
          aria-describedby="composer-gate-hint">
          ${escapeHtml(ACTION_COMPOSER_STRUCTURE.interpretActionLabel)}
        </button>
        <button type="button" data-testid="request-narration"
          aria-disabled="${busy || candidate === null || !seated || sessionIsSuspended()}">
          Request Director narration
        </button>
      </div>
      <label class="field">
        <span>Describe your action</span>
        <textarea data-testid="nl-intent-input" rows="2" placeholder="Examples: open the door · step through · follow the passage · return to the courtyard" ${sessionIsSuspended() ? 'disabled' : ''}>${escapeHtml(nlIntentText)}</textarea>
      </label>
      <button type="button" data-testid="interpret-nl-intent"
        aria-disabled="${interpretDisabled}"
        aria-describedby="composer-gate-hint">
        Plan from description
      </button>
      ${
        intentDraft === null
          ? `<p class="record-meta" data-testid="interpret-action-notice">
              ${escapeHtml(ACTION_COMPOSER_STRUCTURE.interpretActionNotice)}
            </p>`
          : `<p class="record-meta" data-testid="interpret-action-notice">
              Draft ready in the Game Director play thread below the map — confirm or cancel there.
            </p>`
      }`;
  }

  function handleMapEdgeSelected(edgeId: string): void {
    selectedEdgeId = edgeId;
    const edge = mapBundle?.edges.find((entry) => entry.edgeId === edgeId) ?? null;
    if (edge === null) {
      render();
      return;
    }
    if (edge.kind === 'door') {
      // Visible copy lives in door-selection-detail; announce once for assistive tech.
      shell.announce(doorDetailCopy(edge, mapBundle?.title ?? ''));
    } else {
      movePreviewNote = `Selected ${edgeAccessibleLabelFromEdge(edge)}. Declare an interaction in the play channel.`;
      shell.announce(movePreviewNote);
    }
    render();
  }

  function ensurePageShell(): void {
    if (container.querySelector('[data-testid="table-page-shell"]')) {
      const shellEl = container.querySelector<HTMLElement>('[data-testid="table-page-shell"]');
      if (shellEl !== null && shellEl.querySelector('[data-testid="table-sheet-modal-slot"]') === null) {
        const modalSlot = document.createElement('div');
        modalSlot.dataset.testid = 'table-sheet-modal-slot';
        shellEl.appendChild(modalSlot);
      }
      if (shellEl !== null && shellEl.querySelector('[data-testid="table-mobile-task-nav"]') === null) {
        const nav = document.createElement('nav');
        nav.className = 'table-mobile-task-nav';
        nav.dataset.testid = 'table-mobile-task-nav';
        nav.setAttribute('aria-label', 'Table task');
        nav.innerHTML = `
          <button type="button" data-mobile-task="map" data-testid="mobile-task-map" aria-pressed="false">Map</button>
          <button type="button" data-mobile-task="play" data-testid="mobile-task-play" aria-pressed="true">Play</button>
          <button type="button" data-mobile-task="sheet" data-testid="mobile-task-sheet" aria-pressed="false">Sheet</button>
          <button type="button" data-mobile-task="chat" data-testid="mobile-task-chat" aria-pressed="false">Chat</button>`;
        const body = shellEl.querySelector('.table-dashboard-body');
        if (body !== null) {
          shellEl.insertBefore(nav, body);
        }
      }
      return;
    }
    container.innerHTML = `
      <div class="page page-wide table-dashboard" data-testid="table-page-shell" data-mobile-task="${mobileTaskMode}">
        <header class="table-dashboard-header" data-testid="table-heading-slot"></header>
        <nav class="table-mobile-task-nav" data-testid="table-mobile-task-nav" aria-label="Table task">
          <button type="button" data-mobile-task="map" data-testid="mobile-task-map" aria-pressed="false">Map</button>
          <button type="button" data-mobile-task="play" data-testid="mobile-task-play" aria-pressed="true">Play</button>
          <button type="button" data-mobile-task="sheet" data-testid="mobile-task-sheet" aria-pressed="false">Sheet</button>
          <button type="button" data-mobile-task="chat" data-testid="mobile-task-chat" aria-pressed="false">Chat</button>
        </nav>
        <div class="table-dashboard-body">
          <aside class="table-info-rail panel" aria-label="Reference" data-testid="table-info-rail">
            <div data-testid="table-info-slot"></div>
          </aside>
          <main class="table-play-column" aria-label="Play area">
            <div class="table-focus-restore" data-testid="table-focus-restore" hidden></div>
            <section class="table-stage-frame${lowEffects || reducedMotion ? ' table-stage-low-effects' : ''}" aria-label="Tactical map" data-testid="table-stage-slot">
              <p class="record-meta" data-testid="table-stage-loading">Loading tactical map…</p>
            </section>
            <section class="panel action-composer table-action-bar" aria-labelledby="action-composer-heading" data-testid="action-composer">
              <h2 id="action-composer-heading" class="visually-hidden">${escapeHtml(ACTION_COMPOSER_STRUCTURE.heading)}</h2>
              <div data-testid="table-action-slot"></div>
            </section>
          </main>
          <aside class="table-comms-rail panel communication-dock" aria-label="Conversation dock" data-testid="communication-dock">
            <div data-testid="table-comms-slot"></div>
          </aside>
        </div>
        <footer class="table-dashboard-footer" data-testid="table-footer-slot"></footer>
        <div data-testid="table-sheet-modal-slot"></div>
      </div>`;
  }

  function syncStageFrameEffects(): void {
    const slot = container.querySelector<HTMLElement>('[data-testid="table-stage-slot"]');
    if (slot === null) {
      return;
    }
    slot.classList.toggle('table-stage-low-effects', lowEffects || reducedMotion);
  }

  async function ensureStage(): Promise<void> {
    if (!isPageMountCurrent(container, mountToken) || stageMounting) {
      return;
    }
    const slot = container.querySelector<HTMLElement>('[data-testid="table-stage-slot"]');
    if (slot === null) {
      return;
    }
    if (
      stageHandle !== null &&
      (slot.querySelector('[data-testid="table-stage-canvas"]') ||
        slot.querySelector('[data-testid="table-stage-semantic"]'))
    ) {
      if (mapBundle !== null) {
        stageHandle.renderMap(mapBundle);
        stageHandle.setMoveTarget(moveTarget);
        stageHandle.setSelectedEdge(selectedEdgeId);
        stageHandle.setSquareClickHandler((square) => {
          void onSquareSelected(square);
        });
        stageHandle.setEdgeClickHandler((edgeId) => {
          handleMapEdgeSelected(edgeId);
        });
      }
      return;
    }
    stageMounting = true;
    try {
      stageHandle?.destroy();
      stageHandle = await mountTableStage(slot);
      if (!isPageMountCurrent(container, mountToken)) {
        stageHandle.destroy();
        stageHandle = null;
        return;
      }
      if (mapBundle !== null) {
        stageHandle.renderMap(mapBundle);
        stageHandle.setMoveTarget(moveTarget);
        stageHandle.setSelectedEdge(selectedEdgeId);
        stageHandle.setSquareClickHandler((square) => {
          void onSquareSelected(square);
        });
        stageHandle.setEdgeClickHandler((edgeId) => {
          handleMapEdgeSelected(edgeId);
        });
      }
    } catch (failure) {
      slot.innerHTML = `<p class="message error" data-testid="table-stage-error">
        The tactical map stage could not start.
        ${failure instanceof Error ? escapeHtml(failure.message) : ''}
      </p>`;
    } finally {
      stageMounting = false;
    }
  }

  async function onSquareSelected(square: { column: number; row: number }): Promise<void> {
    if (candidate === null || !seated || mapBundle === null || ownSeatId === null) {
      movePreviewNote = 'Seat a character before moving on the map.';
      moveTarget = square;
      movePreviewPath = null;
      pendingMoveConfirm = false;
      render();
      return;
    }
    if (busy) {
      return;
    }

    const start = ownTokenAnchor(mapBundle, ownSeatId);
    if (start === null) {
      movePreviewNote = 'Your token is not on the map yet.';
      moveTarget = square;
      movePreviewPath = null;
      pendingMoveConfirm = false;
      render();
      return;
    }
    if (start.column === square.column && start.row === square.row) {
      moveTarget = null;
      movePreviewPath = null;
      movePreviewNote = null;
      pendingMoveConfirm = false;
      stageHandle?.setMoveTarget(null);
      render();
      return;
    }

    busy = true;
    error = null;
    moveTarget = square;
    stageHandle?.setMoveTarget(square);
    movePreviewNote = 'Checking path…';
    pendingMoveConfirm = false;
    movePreviewPath = null;
    render();

    try {
      if (!canMoveOnMap()) {
        movePreviewNote =
          encounter?.status === 'active'
            ? 'Initiative is active — wait for your turn to move.'
            : 'Seat a character before moving on the map.';
        return;
      }
      if (tableState === null) {
        movePreviewNote = 'Table state is still loading.';
        return;
      }

      const candidatePath =
        findWalkPathToTarget({
          map: mapBundle,
          start,
          target: square,
          actorSeatId: ownSeatId,
        }) ?? [square];

      const preview = await previewTableMove({
        candidateId: candidate.candidateId,
        campaignId,
        path: candidatePath,
      });
      if (!preview.legal) {
        movePreviewNote = preview.rejectionMessage ?? 'That square is not reachable.';
        movePreviewPath = null;
        pendingMoveConfirm = false;
        return;
      }

      const commitPath = preview.path.map((step) => ({
        column: step.column,
        row: step.row,
      }));
      movePreviewPath = commitPath;
      pendingMoveConfirm = true;
      movePreviewNote = `${formatMoveSummary({ path: commitPath, map: mapBundle, start })} Confirm to commit, or Cancel to clear.`;
      shell.announce('Move ready — confirm or cancel.');
    } catch (failure) {
      movePreviewNote =
        failure instanceof ApiFailure ? failure.message : 'That move could not be previewed.';
      movePreviewPath = null;
      pendingMoveConfirm = false;
      if (failure instanceof ApiFailure && failure.code === 'STALE_STATE_VERSION') {
        presentTableConflict(failure);
        try {
          tableState = await fetchTableState(campaignId);
          mapBundle = await fetchCampaignMap(campaignId);
        } catch {
          // Keep the move error visible.
        }
      }
    } finally {
      busy = false;
      render();
    }
  }

  function cancelPendingMove(): void {
    moveTarget = null;
    movePreviewPath = null;
    movePreviewNote = null;
    pendingMoveConfirm = false;
    stageHandle?.setMoveTarget(null);
    shell.announce('Move canceled.');
    render();
  }

  async function confirmPendingMove(): Promise<void> {
    if (
      candidate === null ||
      !seated ||
      mapBundle === null ||
      ownSeatId === null ||
      tableState === null ||
      movePreviewPath === null ||
      !pendingMoveConfirm ||
      busy
    ) {
      return;
    }
    const start = ownTokenAnchor(mapBundle, ownSeatId);
    if (start === null) {
      return;
    }
    const commitPath = movePreviewPath;
    busy = true;
    error = null;
    render();
    try {
      const accepted = await submitTableCommand({
        candidateId: candidate.candidateId,
        campaignId,
        requestId: crypto.randomUUID(),
        commandType: 'table.move',
        expectedStateVersion: tableState.stateVersion,
        ...(explorationMode() || timingAuthority === null
          ? {}
          : { timingAuthorityId: timingAuthority.timingAuthorityId }),
        path: commitPath,
      });
      tableState = accepted.table;
      mapBundle = await fetchCampaignMap(campaignId);
      undoMoveAnchor = start;
      moveTarget = null;
      movePreviewPath = null;
      pendingMoveConfirm = false;
      movePreviewNote = null;
      stageHandle?.setMoveTarget(null);
      shell.announce(
        commitPath.length <= 1
          ? 'You moved to the selected square.'
          : `You moved ${commitPath.length} squares.`,
      );
      const moveSummary = formatMoveSummary({
        path: commitPath,
        map: mapBundle,
        start,
      });
      appendDmThread('system', 'Table', moveSummary, 'mechanics');
      void narrateIntoDmThread(moveSummary);
    } catch (failure) {
      movePreviewNote =
        failure instanceof ApiFailure ? failure.message : 'That move could not be completed.';
      if (failure instanceof ApiFailure && failure.code === 'STALE_STATE_VERSION') {
        presentTableConflict(failure);
        try {
          tableState = await fetchTableState(campaignId);
          mapBundle = await fetchCampaignMap(campaignId);
        } catch {
          // Keep the move error visible.
        }
      }
    } finally {
      busy = false;
      render();
    }
  }

  async function undoLastMove(): Promise<void> {
    if (undoMoveAnchor === null || mapBundle === null || ownSeatId === null) {
      return;
    }
    const target = undoMoveAnchor;
    undoMoveAnchor = null;
    moveTarget = target;
    pendingMoveConfirm = false;
    movePreviewPath = null;
    await onSquareSelected(target);
    if (pendingMoveConfirm) {
      await confirmPendingMove();
    }
  }

  async function submitRulesAction(
    commandType: string,
    fields: RulesCommandFields = {},
  ): Promise<boolean> {
    const setupCommand =
      commandType === 'encounter.begin' ||
      commandType === 'initiative.roll' ||
      commandType === 'encounter.end';
    const explorationRest =
      (commandType === 'combat.short_rest' || commandType === 'combat.long_rest') &&
      explorationMode();
    if (candidate === null || tableState === null) {
      return false;
    }
    if (busy) {
      // A prior command is still committing — do not drop this click silently.
      for (let attempt = 0; attempt < 40 && busy; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
      if (busy || tableState === null || candidate === null) {
        error = 'The table is still resolving the previous action. Try again in a moment.';
        render();
        return false;
      }
    }
    if (
      !setupCommand &&
      !explorationRest &&
      commandType !== 'encounter.next_turn' &&
      !holdsOwnAuthority() &&
      encounter?.status === 'active'
    ) {
      return false;
    }
    busy = true;
    error = null;
    render();
    try {
      const activeEncounter = encounter;
      const activeCombatant =
        activeEncounter === null
          ? null
          : (activeEncounter.combatants.find(
              (combatant) => combatant.combatantId === activeEncounter.activeCombatantId,
            ) ?? null);
      const omitTimingAuthority =
        setupCommand ||
        explorationRest ||
        timingAuthority === null ||
        (commandType === 'encounter.next_turn' && activeCombatant?.side === 'foe');
      const accepted = await submitTableCommand({
        candidateId: candidate.candidateId,
        campaignId,
        requestId: crypto.randomUUID(),
        commandType,
        expectedStateVersion: tableState.stateVersion,
        ...(omitTimingAuthority || timingAuthority === null
          ? {}
          : { timingAuthorityId: timingAuthority.timingAuthorityId }),
        ...fields,
      });
      tableState = accepted.table;
      if (accepted.encounter !== undefined) encounter = accepted.encounter;
      if (accepted.progression !== undefined) progression = accepted.progression;
      if (commandType === 'encounter.begin' || commandType === 'initiative.roll') {
        markIntentDraftStale(
          commandType === 'encounter.begin'
            ? 'Scene lock: encounter began. Open free-roam drafts are stale — re-declare if you still want that action.'
            : 'Scene lock: initiative is live. Open free-roam drafts are stale — re-declare on your turn.',
        );
      }
      shell.announce(accepted.event.summary ?? `${commandType} resolved by the server.`);
      const summary = accepted.event.summary?.trim() ?? null;
      const rolls = accepted.event.rolls ?? [];
      if (summary) {
        appendDmThread('system', 'Table', summary, 'mechanics');
        if (shouldAutoNarrateRulesCommand(commandType)) {
          enqueueNarration(summary, rolls);
        } else {
          patchDmPlayThread();
        }
      }
      // Paint committed encounter meta before Timing Authority refresh so the
      // tools panel cannot linger on setup while the authority GET is in flight.
      render();
      if (
        commandType === 'initiative.roll' ||
        commandType === 'encounter.next_turn' ||
        commandType === 'combat.ready' ||
        commandType === 'combat.reaction'
      ) {
        try {
          timingAuthority = (await fetchTimingAuthority(campaignId)).authority;
        } catch {
          // Authority refresh is best-effort after a successful commit.
        }
      }
      return true;
    } catch (failure) {
      error =
        failure instanceof ApiFailure
          ? failure.message
          : 'The rules action could not be resolved.';
      if (failure instanceof ApiFailure && failure.code === 'STALE_STATE_VERSION') {
        presentTableConflict(failure);
        const [tableFeed, rulesFeed] = await Promise.all([
          fetchTableState(campaignId),
          fetchRulesState(campaignId),
        ]);
        tableState = tableFeed;
        encounter = rulesFeed.encounter;
        progression = rulesFeed.progression;
      }
      return false;
    } finally {
      busy = false;
      render();
    }
  }

  function bindPanelEvents(root: HTMLElement): void {
    bindDmPlayThreadScroll();
    if (dmThreadFollowLatest) {
      requestAnimationFrame(() => scrollDmPlayThreadToLatest('auto'));
    } else {
      updateDmThreadJumpVisibility();
    }
    root
      .querySelector<HTMLButtonElement>('[data-testid="dm-thread-jump-latest"]')
      ?.addEventListener('click', () => {
        scrollDmPlayThreadToLatest('smooth');
        shell.announce('Jumped to the latest table beat.');
      });
    root
      .querySelector<HTMLButtonElement>('[data-testid="dm-thread-expand"]')
      ?.addEventListener('click', () => {
        dmThreadExpanded = !dmThreadExpanded;
        render();
        shell.announce(dmThreadExpanded ? 'Timeline expanded.' : 'Timeline compacted.');
      });
    root
      .querySelector<HTMLButtonElement>('[data-testid="open-table-sheet-modal"]')
      ?.addEventListener('click', () => {
        sheetModalOpen = true;
        render();
        root.querySelector<HTMLElement>('[data-testid="close-table-sheet-modal"]')?.focus();
      });
    const closeSheetModal = () => {
      if (!sheetModalOpen) {
        return;
      }
      sheetModalOpen = false;
      document.body.classList.remove('sheet-modal-open');
      if (sheetEscapeListener !== null) {
        document.removeEventListener('keydown', sheetEscapeListener, true);
        sheetEscapeListener = null;
      }
      render();
      root.querySelector<HTMLButtonElement>('[data-testid="open-table-sheet-modal"]')?.focus();
    };
    root
      .querySelector<HTMLButtonElement>('[data-testid="close-table-sheet-modal"]')
      ?.addEventListener('click', () => closeSheetModal());
    root
      .querySelector<HTMLElement>('[data-testid="table-sheet-modal"]')
      ?.addEventListener('click', (event) => {
        if (event.target === event.currentTarget) {
          closeSheetModal();
        }
      });
    if (sheetModalOpen) {
      document.body.classList.add('sheet-modal-open');
      if (sheetEscapeListener === null) {
        sheetEscapeListener = (event: KeyboardEvent) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            closeSheetModal();
          }
        };
        document.addEventListener('keydown', sheetEscapeListener, true);
      }
    } else {
      document.body.classList.remove('sheet-modal-open');
    }
    root.querySelectorAll<HTMLButtonElement>('[data-mobile-task]').forEach((button) => {
      button.addEventListener('click', () => {
        const mode = button.dataset.mobileTask as MobileTaskMode | undefined;
        if (mode === undefined) {
          return;
        }
        mobileTaskMode = mode;
        if (mode === 'sheet') {
          activeInfoTab = 'character';
          infoRailCollapsed = false;
        } else if (mode === 'chat') {
          commsRailCollapsed = false;
          activeTab = 'party_chat';
        }
        render();
      });
    });
    root
      .querySelector<HTMLSelectElement>('[data-testid="speak-as-npc-select"]')
      ?.addEventListener('change', (event) => {
        const select = event.currentTarget as HTMLSelectElement;
        const previous = speakAsNpcName;
        speakAsNpcName = select.value;
        // Address lives in the picker — do not enable Send on "Nib," alone.
        if (previous.length > 0) {
          const escaped = previous.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          draft = draft.replace(new RegExp(`^@?${escaped}\\s*[,:]\\s*`, 'i'), '').trimStart();
        }
        render();
      });
    root.querySelectorAll<HTMLButtonElement>('[data-sheet-resource]').forEach((button) => {
      button.addEventListener('click', () => {
        void (async () => {
          if (
            progression === null ||
            candidate === null ||
            busy ||
            button.getAttribute('aria-disabled') === 'true'
          ) {
            return;
          }
          const resourceId = button.dataset.sheetResource;
          const resource = progression.sheet.classResources?.find(
            (entry) => entry.id === resourceId,
          );
          if (resourceId === undefined || resource === undefined || resource.remaining <= 0) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            const updated = await updateCharacterTrackers({
              candidateId: candidate.candidateId,
              characterId: progression.characterId,
              resourceRemaining: { [resourceId]: resource.remaining - 1 },
            });
            // updated.sheet is the same DerivedCharacterSheet shape as progression.sheet.
            progression = { ...progression, sheet: updated.sheet };
            shell.announce(`Spent ${resourceId.replace(/-/g, ' ')}.`);
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'That resource could not be spent.';
          } finally {
            busy = false;
            render();
          }
        })();
      });
    });
    root
      .querySelector<HTMLButtonElement>('[data-testid="spend-spell-slot"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (
            progression === null ||
            candidate === null ||
            busy ||
            progression.sheet.spellcasting === null ||
            progression.sheet.spellcasting.level1SlotsRemaining <= 0
          ) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            const updated = await updateCharacterTrackers({
              candidateId: candidate.candidateId,
              characterId: progression.characterId,
              level1SlotsRemaining: progression.sheet.spellcasting.level1SlotsRemaining - 1,
            });
            // updated.sheet is the same DerivedCharacterSheet shape as progression.sheet.
            progression = { ...progression, sheet: updated.sheet };
            shell.announce('Spent a level 1 spell slot.');
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'That spell slot could not be spent.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    root.querySelectorAll<HTMLButtonElement>('[data-info-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        activeInfoTab = button.dataset.infoTab as InfoTab;
        render();
      });
    });

    root
      .querySelector<HTMLButtonElement>('[data-testid="collapse-info-rail"]')
      ?.addEventListener('click', () => {
        infoRailCollapsed = !infoRailCollapsed;
        render();
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="collapse-comms-rail"]')
      ?.addEventListener('click', () => {
        commsRailCollapsed = !commsRailCollapsed;
        render();
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="expand-info-rail-inline"]')
      ?.addEventListener('click', () => {
        infoRailCollapsed = false;
        render();
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="expand-comms-rail-inline"]')
      ?.addEventListener('click', () => {
        commsRailCollapsed = false;
        render();
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="expand-info-rail"]')
      ?.addEventListener('click', () => {
        infoRailCollapsed = false;
        render();
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="expand-comms-rail"]')
      ?.addEventListener('click', () => {
        commsRailCollapsed = false;
        render();
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="claim-active-turn"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy || !seated) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            const claimed = await claimTimingAuthority({
              candidateId: candidate.candidateId,
              campaignId,
            });
            timingAuthority = claimed.authority;
            shell.announce('You claimed the active turn.');
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'The active turn could not be claimed.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="confirm-pending-move"]')
      ?.addEventListener('click', () => {
        void confirmPendingMove();
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="cancel-pending-move"]')
      ?.addEventListener('click', () => {
        cancelPendingMove();
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="undo-last-move-play"]')
      ?.addEventListener('click', () => {
        void undoLastMove();
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="end-encounter-play"]')
      ?.addEventListener('click', () => {
        void submitRulesAction('encounter.end');
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="undo-last-move"]')
      ?.addEventListener('click', () => {
        void undoLastMove();
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="place-door-ahead"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy || !seated) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            if ((mapBundle?.edges.length ?? 0) > 0) {
              doorRecoveryVisible = false;
              const sceneTitle = mapBundle?.title?.trim() || 'this chamber';
              const acknowledgment = `${sceneTitle} already has walls and a doorway on the table. Move your token or declare your next action.`;
              appendDmThread('dm', directorIdentityLabel, acknowledgment, 'ruling_hint');
              shell.announce(`${directorIdentityLabel} acknowledged the committed scene.`);
              return;
            }
            const interpreted = await interpretNaturalLanguage({
              candidateId: candidate.candidateId,
              campaignId,
              text: 'Raise a wall and wooden door ahead on this blank table.',
            });
            const scrubbedSummary = playerFacingMechanicsCopy(interpreted.summary);
            const clarificationOnly = isSyncClarificationOnly(interpreted, scrubbedSummary);
            doorRecoveryVisible = false;
            if (clarificationOnly) {
              setIntentDraft(null);
              appendDmThread('dm', directorIdentityLabel, scrubbedSummary, 'ruling_hint');
              shell.announce(`${directorIdentityLabel} replied in the play thread.`);
            } else {
              setIntentDraft(draftFromInterpret({
                ...interpreted,
                summary: scrubbedSummary,
              }));
              shell.announce(`${directorIdentityLabel} prepared a scene draft — confirm to place the door.`);
            }
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? playerFacingMechanicsCopy(failure.message)
                : `${directorIdentityLabel} could not prepare that scene right now.`;
          } finally {
            busy = false;
            render();
          }
        })();
      });

    root.querySelectorAll<HTMLButtonElement>('[data-dock-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        activeTab = button.dataset.dockTab as DockTab;
        render();
      });
    });

    root.querySelectorAll<HTMLInputElement>('input[name="chat-mode"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (input.value === 'speak_as_character' && !seated) {
          chatMode = 'table_talk';
          render();
          return;
        }
        const nextMode = input.value as PartyChatMode;
        if (nextMode === 'table_talk' && chatMode === 'speak_as_character') {
          if (speakAsNpcName.length > 0) {
            const escaped = speakAsNpcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            draft = draft.replace(new RegExp(`^@?${escaped}\\s*[,:]\\s*`, 'i'), '').trimStart();
          }
          speakAsNpcName = '';
        }
        chatMode = nextMode;
        render();
      });
    });

    root
      .querySelector<HTMLSelectElement>('[data-testid="chronicle-kind-filter"]')
      ?.addEventListener('change', (event) => {
        if (event.target instanceof HTMLSelectElement) {
          chronicleKindFilter = event.target.value;
          render();
        }
      });

    root
      .querySelector<HTMLInputElement>('[data-testid="rules-catalog-search"]')
      ?.addEventListener('input', (event) => {
        if (event.target instanceof HTMLInputElement) {
          rulesSearchQuery = event.target.value;
          render();
        }
      });

    root
      .querySelector<HTMLSelectElement>('[data-testid="rules-catalog-category"]')
      ?.addEventListener('change', (event) => {
        if (event.target instanceof HTMLSelectElement) {
          selectedRulesCategory = event.target.value as RulesCatalogCategory;
          const first =
            rulesCatalog?.entries.find((entry) => entry.category === selectedRulesCategory) ?? null;
          selectedRulesEntryId = first?.entryId ?? null;
          render();
        }
      });

    root.querySelectorAll<HTMLButtonElement>('[data-testid="rules-catalog-entry"]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedRulesEntryId = button.dataset.entryId ?? null;
        render();
      });
    });

    root
      .querySelector<HTMLSelectElement>('[data-testid="rules-target"]')
      ?.addEventListener('change', (event) => {
        if (event.target instanceof HTMLSelectElement) {
          selectedCombatantId = event.target.value;
        }
      });

    root
      .querySelector<HTMLSelectElement>('[data-testid="rules-spell"]')
      ?.addEventListener('change', (event) => {
        if (event.target instanceof HTMLSelectElement) {
          selectedSpellId = event.target.value;
        }
      });

    root.querySelectorAll<HTMLButtonElement>('[data-rules-command]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.getAttribute('aria-disabled') === 'true') return;
        const commandType = button.dataset.rulesCommand;
        if (commandType === undefined) return;
        const seatedCombatant = ownCombatant();
        const window = encounter?.decisionWindows.find(
          (entry) =>
            entry.state === 'open' &&
            entry.eligibleCombatantId === seatedCombatant?.combatantId,
        );
        const fields: RulesCommandFields =
          commandType === 'combat.attack'
            ? {
                ...(selectedCombatantId === null
                  ? {}
                  : { targetCombatantId: selectedCombatantId }),
              }
            : commandType === 'combat.cast_spell'
              ? {
                  spellId: selectedSpellId,
                  ...(selectedSpellId === 'burning-hands'
                    ? {
                        area: {
                          shape: 'cone',
                          origin: {
                            column: moveTarget?.column ?? seatedCombatant?.position.column ?? 1,
                            row: moveTarget?.row ?? seatedCombatant?.position.row ?? 1,
                            elevationFeet: seatedCombatant?.position.elevationFeet ?? 0,
                          },
                          sizeFeet: 15,
                          heightFeet: 10,
                          direction: 'east',
                        } as const,
                      }
                    : selectedCombatantId === null
                      ? {}
                      : { targetCombatantId: selectedCombatantId }),
                }
              : commandType === 'combat.ready'
                ? {
                    reactionKind: 'opportunity_attack',
                    ...(selectedCombatantId === null
                      ? {}
                      : { targetCombatantId: selectedCombatantId }),
                    readyTrigger: 'When the selected foe moves out of reach',
                  }
                : commandType === 'combat.reaction'
                  ? {
                      ...(window === undefined
                        ? {}
                        : {
                            reactionKind: window.reactionKind,
                            decisionWindowId: window.decisionWindowId,
                          }),
                    }
                  : commandType === 'progression.award_xp'
                    ? { xpAmount: 300 }
                    : commandType === 'inventory.use_item'
                      ? {
                          itemId: 'healing-potion',
                          ...(seatedCombatant === null
                            ? {}
                            : { targetCombatantId: seatedCombatant.combatantId }),
                        }
                      : {};
        void submitRulesAction(commandType, fields);
      });
    });

    root
      .querySelector<HTMLFormElement>('[data-testid="party-chat-composer"]')
      ?.addEventListener('submit', (event) => {
        event.preventDefault();
        void (async () => {
          if (partyChatSendBlocked()) {
            syncPartyChatSendState(root);
            return;
          }
          if (chatMode === 'speak_as_character' && !seated) {
            error = 'Seat a character before using Speak as Character.';
            chatMode = 'table_talk';
            render();
            return;
          }
          const messageBody = partyChatMessageBody();
          const outbound =
            chatMode === 'speak_as_character' && speakAsNpcName.trim().length > 0
              ? `${speakAsNpcName}, ${messageBody}`
              : messageBody;
          busy = true;
          error = null;
          render();
          try {
            await postPartyChat({
              candidateId: candidate!.candidateId,
              campaignId,
              mode: chatMode,
              body: outbound,
            });
            draft = '';
            const [chatFeed, tableFeed] = await Promise.all([
              fetchPartyChat(campaignId),
              fetchTableState(campaignId),
            ]);
            partyChat = chatFeed;
            tableState = tableFeed;
            shell.announce(
              chatMode === 'speak_as_character'
                ? 'Spoken in character. Party Chat never becomes a mechanical command.'
                : 'Party Chat message sent. It did not become a command.',
            );
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Party Chat message could not be sent.';
            if (
              failure instanceof ApiFailure &&
              (failure.code === 'NPC_SPOTLIGHT_HELD' || failure.code === 'STALE_STATE_VERSION')
            ) {
              presentTableConflict(failure);
              try {
                tableState = await fetchTableState(campaignId);
              } catch {
                // Keep the spotlight conflict visible.
              }
            }
          } finally {
            busy = false;
            render();
          }
        })();
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="yield-npc-spotlight"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            await yieldNpcSpotlight({
              candidateId: candidate.candidateId,
              campaignId,
            });
            tableState = await fetchTableState(campaignId);
            appendDmThread('system', 'Table', 'You yielded the NPC floor.', 'system');
            shell.announce('NPC floor yielded.');
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Could not yield the NPC floor.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="party-chat-dictate"]')
      ?.addEventListener('click', () => {
        const SpeechRecognitionCtor =
          (
            window as unknown as {
              SpeechRecognition?: new () => {
                continuous: boolean;
                interimResults: boolean;
                onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
                onerror: (() => void) | null;
                start: () => void;
              };
              webkitSpeechRecognition?: new () => {
                continuous: boolean;
                interimResults: boolean;
                onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
                onerror: (() => void) | null;
                start: () => void;
              };
            }
          ).SpeechRecognition ??
          (
            window as unknown as {
              webkitSpeechRecognition?: new () => {
                continuous: boolean;
                interimResults: boolean;
                onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
                onerror: (() => void) | null;
                start: () => void;
              };
            }
          ).webkitSpeechRecognition;
        if (!speechToTextEnabled || SpeechRecognitionCtor === undefined) {
          shell.announce(
            'Speech-to-text is enabled in settings but this browser has no recognition API. Drafts stay editable and unsent.',
          );
          return;
        }
        const recognition = new SpeechRecognitionCtor();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.onresult = (event) => {
          const transcript = event.results[0]?.[0]?.transcript?.trim() ?? '';
          if (transcript.length > 0) {
            draft = draft.length === 0 ? transcript : `${draft} ${transcript}`;
            render();
            shell.announce('Dictation placed into an editable unsent Party Chat draft.');
          }
        };
        recognition.onerror = () => {
          shell.announce('Dictation did not capture audio. Nothing was sent.');
        };
        recognition.start();
      });

    const input = root.querySelector<HTMLTextAreaElement>('[data-testid="party-chat-input"]');
    input?.addEventListener('input', () => {
      draft = input.value;
      syncPartyChatSendState(root);
    });

    const directorInput = root.querySelector<HTMLTextAreaElement>(
      '[data-testid="director-address-input"]',
    );
    directorInput?.addEventListener('input', () => {
      directorDraft = directorInput.value;
      const send = root.querySelector<HTMLButtonElement>('[data-testid="director-address-send"]');
      send?.setAttribute(
        'aria-disabled',
        String(busy || candidate === null || directorDraft.trim().length === 0),
      );
    });

    root
      .querySelector<HTMLFormElement>('[data-testid="director-address-composer"]')
      ?.addEventListener('submit', (event) => {
        event.preventDefault();
        void (async () => {
          if (candidate === null || busy || directorDraft.trim().length === 0) {
            return;
          }
          const question = directorDraft.trim();
          busy = true;
          error = null;
          appendAskDmThread('player', 'You', question, 'declaration');
          directorDraft = '';
          render();
          try {
            const answered = await postDirectorAddress({
              candidateId: candidate.candidateId,
              campaignId,
              body: question,
            });
            directorIdentityLabel = answered.directorIdentityLabel || directorIdentityLabel;
            appendAskDmThread(
              'dm',
              answered.directorIdentityLabel,
              answered.body,
              'ruling_hint',
            );
            if (textToSpeechEnabled && 'speechSynthesis' in window) {
              const utterance = new SpeechSynthesisUtterance(answered.body);
              window.speechSynthesis.speak(utterance);
            }
            shell.announce(`${answered.directorIdentityLabel} answered. No table state changed.`);
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Ask the Game Director could not be sent.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    const nlInput = root.querySelector<HTMLTextAreaElement>('[data-testid="nl-intent-input"]');
    nlInput?.addEventListener('input', () => {
      nlIntentText = nlInput.value;
      root
        .querySelector<HTMLButtonElement>('[data-testid="interpret-nl-intent"]')
        ?.setAttribute(
          'aria-disabled',
          String(
            busy ||
              candidate === null ||
              !seated ||
              (!explorationMode() && !holdsOwnAuthority()) ||
              nlIntentText.trim().length === 0,
          ),
        );
    });

    root
      .querySelector<HTMLButtonElement>('[data-testid="interpret-nl-intent"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (
            candidate === null ||
            busy ||
            nlIntentText.trim().length === 0
          ) {
            return;
          }
          if (!explorationMode() && !holdsOwnAuthority()) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            const interpreted = await interpretNaturalLanguage({
              candidateId: candidate.candidateId,
              campaignId,
              text: nlIntentText.trim(),
              moveTarget,
            });
            setIntentDraft(draftFromInterpret(interpreted));
            shell.announce('Natural-language Intent Intercept draft ready for confirmation.');
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Natural-language intent could not be interpreted.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="request-narration"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy) return;
          busy = true;
          error = null;
          render();
          try {
            const narration = await requestDirectorNarration({
              candidateId: candidate.candidateId,
              campaignId,
              mechanicsSummary:
                mapBundle?.sceneBanner?.trim() ||
                (tableState === null ? 'The table is quiet.' : 'The party is gathered at the table.'),
            });
            lastNarration = narration.body;
            directorIdentityLabel = narration.directorIdentityLabel || directorIdentityLabel;
            appendDmThread('dm', narration.directorIdentityLabel, narration.body, 'narration');
            activeTab = 'chronicle';
            if (textToSpeechEnabled && 'speechSynthesis' in window) {
              const utterance = new SpeechSynthesisUtterance(narration.body);
              window.speechSynthesis.speak(utterance);
            }
            shell.announce(`${narration.directorIdentityLabel} narrated the beat.`);
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Director narration is unavailable.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="refresh-table-projection"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy) return;
          busy = true;
          error = null;
          render();
          try {
            await refreshSharedProjections({ forceRender: true });
            shell.announce('Table projection refreshed from server.');
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Table projection could not be refreshed.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    root
      .querySelector<HTMLInputElement>('[data-testid="table-reduced-motion"]')
      ?.addEventListener('change', (event) => {
        void (async () => {
          if (candidate === null || busy || !(event.target instanceof HTMLInputElement)) {
            return;
          }
          presentationWriteEpoch += 1;
          busy = true;
          error = null;
          render();
          try {
            const settings = await savePlayerSettings({
              candidateId: candidate.candidateId,
              reducedMotion: event.target.checked,
              lowEffects,
            });
            reducedMotion = settings.reducedMotion;
            lowEffects = settings.lowEffects;
            applyPresentationPreferences({ reducedMotion, lowEffects });
            shell.announce(
              reducedMotion
                ? 'Reduced motion applied on the tactical table.'
                : 'Reduced motion cleared for this account.',
            );
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Presentation preference could not be saved.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    root
      .querySelector<HTMLInputElement>('[data-testid="table-low-effects"]')
      ?.addEventListener('change', (event) => {
        void (async () => {
          if (candidate === null || busy || !(event.target instanceof HTMLInputElement)) {
            return;
          }
          presentationWriteEpoch += 1;
          busy = true;
          error = null;
          render();
          try {
            const settings = await savePlayerSettings({
              candidateId: candidate.candidateId,
              reducedMotion,
              lowEffects: event.target.checked,
            });
            reducedMotion = settings.reducedMotion;
            lowEffects = settings.lowEffects;
            applyPresentationPreferences({ reducedMotion, lowEffects });
            if (mapBundle !== null) {
              stageHandle?.renderMap(mapBundle);
            }
            shell.announce(
              lowEffects
                ? 'Low effects applied on the tactical table.'
                : 'Low effects cleared for this account.',
            );
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Presentation preference could not be saved.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    root
      .querySelector<HTMLTextAreaElement>('[data-testid="table-notes-input"]')
      ?.addEventListener('input', (event) => {
        if (event.target instanceof HTMLTextAreaElement) {
          tableNotes = event.target.value;
          saveTableNotesPreference(tableNotes);
        }
      });

    root
      .querySelector<HTMLTextAreaElement>('[data-testid="player-action-input"]')
      ?.addEventListener('input', (event) => {
        if (event.target instanceof HTMLTextAreaElement) {
          playerActionDraft = event.target.value;
          root
            .querySelector<HTMLButtonElement>('[data-testid="submit-player-action"]')
            ?.setAttribute(
              'aria-disabled',
              String(busy || candidate === null || playerActionDraft.trim().length === 0),
            );
        }
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="submit-player-action"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy || playerActionDraft.trim().length === 0) {
            return;
          }
          if (!explorationMode() && !holdsOwnAuthority()) {
            return;
          }
          const declaration = playerActionDraft.trim();
          lastSubmittedDeclaration = declaration;
          busy = true;
          error = null;
          playerActionDraft = '';
          render();
          try {
            const moveTargetForInterpret =
              moveTarget !== null && !/\b(door|gate|entryway|entry|room beyond)\b/i.test(declaration)
                ? moveTarget
                : undefined;
            const interpreted = await interpretNaturalLanguage({
              candidateId: candidate.candidateId,
              campaignId,
              text: declaration,
              ...(moveTargetForInterpret !== undefined ? { moveTarget: moveTargetForInterpret } : {}),
            });
            const scrubbedSummary = playerFacingMechanicsCopy(interpreted.summary);
            const clarificationOnly = isSyncClarificationOnly(interpreted, scrubbedSummary);
            if (clarificationOnly) {
              // Server chronicles declaration + ruling immediately; resync once and do not
              // optimistic-append (that duplicated Story so far).
              setIntentDraft(null);
              doorRecoveryVisible =
                (mapBundle?.edges.length ?? 0) === 0 &&
                /no door|open floor|interact with here/i.test(scrubbedSummary);
              try {
                chronicle = await fetchChronicle(campaignId);
                // Emulator / eventual read: one short retry if the ruling is not visible yet.
                const hasRuling = (chronicle.entries ?? []).some(
                  (entry) =>
                    entry.kind === 'director_ruling' &&
                    entry.body.trim() === scrubbedSummary.trim(),
                );
                if (!hasRuling) {
                  await new Promise((resolve) => setTimeout(resolve, 150));
                  chronicle = await fetchChronicle(campaignId);
                }
                dmThreadOptimistic = [];
                lastChronicleSyncCount = chronicle.entries.length;
                syncDmThreadFromChronicle();
                const stillMissingRuling = !dmThread.some(
                  (message) =>
                    message.speaker === 'dm' &&
                    message.body.trim().includes(scrubbedSummary.trim().slice(0, 48)),
                );
                if (stillMissingRuling) {
                  appendDmThread('player', 'You', declaration, 'declaration');
                  appendDmThread('dm', directorIdentityLabel, scrubbedSummary, 'ruling_hint');
                }
              } catch {
                appendDmThread('player', 'You', declaration, 'declaration');
                appendDmThread('dm', directorIdentityLabel, scrubbedSummary, 'ruling_hint');
              }
              shell.announce(`${directorIdentityLabel} replied in the play thread.`);
            } else {
              setIntentDraft(draftFromInterpret({
                ...interpreted,
                summary: scrubbedSummary,
              }));
              shell.announce(`${directorIdentityLabel} prepared a draft — confirm to resolve it.`);
            }
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? playerFacingMechanicsCopy(failure.message)
                : `${directorIdentityLabel} could not interpret that action right now.`;
          } finally {
            busy = false;
            render();
          }
        })();
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="end-combat-turn"]')
      ?.addEventListener('click', () => {
        void submitRulesAction('encounter.next_turn');
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="commit-table-sync"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy || !seated || tableState === null) {
            return;
          }
          if (!explorationMode() && !holdsOwnAuthority()) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            const accepted = await submitTableCommand({
              candidateId: candidate.candidateId,
              campaignId,
              requestId: crypto.randomUUID(),
              commandType: 'table.sync',
              expectedStateVersion: tableState.stateVersion,
              ...(explorationMode() || timingAuthority === null
                ? {}
                : { timingAuthorityId: timingAuthority.timingAuthorityId }),
            });
            tableState = accepted.table;
            mapBundle = await fetchCampaignMap(campaignId);
            shell.announce(
              accepted.duplicate
                ? 'Prior table sync recovered (same request).'
                : 'Table sync committed.',
            );
          } catch (failure) {
            error =
              failure instanceof ApiFailure ? failure.message : 'Table sync could not be committed.';
            if (failure instanceof ApiFailure && failure.code === 'STALE_STATE_VERSION') {
              presentTableConflict(failure);
              try {
                tableState = await fetchTableState(campaignId);
              } catch {
                // Keep the sync error; refresh is best-effort.
              }
            }
          } finally {
            busy = false;
            render();
          }
        })();
      });

    root
      .querySelector<HTMLSelectElement>('[data-testid="move-destination-select"]')
      ?.addEventListener('change', (event) => {
        if (!(event.target instanceof HTMLSelectElement) || !canMoveOnMap()) {
          return;
        }
        const value = event.target.value;
        if (value === '') {
          moveTarget = null;
          movePreviewNote = null;
          stageHandle?.setMoveTarget(null);
          render();
          return;
        }
        const [columnText, rowText] = value.split(',');
        const column = Number(columnText);
        const row = Number(rowText);
        if (!Number.isInteger(column) || !Number.isInteger(row)) {
          return;
        }
        void onSquareSelected({ column, row });
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="commit-table-move"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (
            candidate === null ||
            busy ||
            !seated ||
            tableState === null ||
            moveTarget === null ||
            !canMoveOnMap()
          ) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            const start =
              mapBundle === null || ownSeatId === null
                ? moveTarget
                : (ownTokenAnchor(mapBundle, ownSeatId) ?? moveTarget);
            const accepted = await submitTableCommand({
              candidateId: candidate.candidateId,
              campaignId,
              requestId: crypto.randomUUID(),
              commandType: 'table.move',
              expectedStateVersion: tableState.stateVersion,
              ...(explorationMode() || timingAuthority === null
                ? {}
                : { timingAuthorityId: timingAuthority.timingAuthorityId }),
              path: [moveTarget],
            });
            tableState = accepted.table;
            mapBundle = await fetchCampaignMap(campaignId);
            if (mapBundle !== null) {
              movePreviewNote = formatMoveSummary({
                path: [moveTarget],
                map: mapBundle,
                start,
              });
            }
            shell.announce('Move committed on the table.');
          } catch (failure) {
            error = failure instanceof ApiFailure ? failure.message : 'Move could not be committed.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="open-adjacent-door"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (
            candidate === null ||
            busy ||
            !seated ||
            tableState === null ||
            mapBundle === null ||
            !canMoveOnMap()
          ) {
            return;
          }
          const ownToken = mapBundle.tokens.find((token) => token.seatId === ownSeatId);
          const door = mapBundle.edges.find((edge) => {
            if (edge.kind !== 'door' || edge.doorState === 'open') {
              return false;
            }
            if (ownToken === undefined) {
              return true;
            }
            const anchor = ownToken.footprint.anchor;
            const adjacent =
              (edge.orientation === 'east' &&
                edge.row === anchor.row &&
                (edge.column === anchor.column || edge.column === anchor.column - 1)) ||
              (edge.orientation === 'north' &&
                edge.column === anchor.column &&
                (edge.row === anchor.row || edge.row === anchor.row - 1));
            return adjacent;
          });
          if (door === undefined) {
            error =
              mapBundle.edges.some((edge) => edge.kind === 'door' && edge.doorState !== 'open')
                ? 'No closed door is adjacent to your token.'
                : 'No closed door is visible on your map projection.';
            render();
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            const accepted = await submitTableCommand({
              candidateId: candidate.candidateId,
              campaignId,
              requestId: crypto.randomUUID(),
              commandType: 'table.open_door',
              expectedStateVersion: tableState.stateVersion,
              ...(explorationMode() || timingAuthority === null
                ? {}
                : { timingAuthorityId: timingAuthority.timingAuthorityId }),
              edgeId: door.edgeId,
            });
            tableState = accepted.table;
            mapBundle = await fetchCampaignMap(campaignId);
            shell.announce('Door opened on the table.');
          } catch (failure) {
            error =
              failure instanceof ApiFailure ? failure.message : 'The door could not be opened.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="interpret-action"]')
      ?.addEventListener('click', () => {
        if (!holdsOwnAuthority() || timingAuthority === null) {
          return;
        }
        if (moveTarget !== null) {
          setIntentDraft({
            draftId: crypto.randomUUID(),
            source: 'action_composer_interpret',
            campaignId,
            proposedCommandType: 'table.move',
            summary: 'Intent Intercept draft: move toward the marked destination.',
            path: [moveTarget],
            interceptState: 'awaiting_confirmation',
            createdAt: new Date().toISOString(),
          });
          render();
          return;
        }
        error = 'Select a destination square on the map before planning a move.';
        setIntentDraft(null);
        render();
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="cancel-intent-intercept"]')
      ?.addEventListener('click', () => {
        setIntentDraft(null);
        render();
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="edit-failed-declaration"]')
      ?.addEventListener('click', () => {
        playerActionDraft = lastSubmittedDeclaration;
        setIntentDraft(null);
        error = null;
        render();
        const composer = root.querySelector<HTMLTextAreaElement>('[data-testid="player-action-input"]');
        composer?.focus();
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="retry-failed-intent"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy || lastSubmittedDeclaration.trim().length === 0) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            const declaration = lastSubmittedDeclaration.trim();
            const moveTargetForInterpret =
              moveTarget !== null && !/\b(door|gate|entryway|entry|room beyond)\b/i.test(declaration)
                ? moveTarget
                : undefined;
            const interpreted = await interpretNaturalLanguage({
              candidateId: candidate.candidateId,
              campaignId,
              text: declaration,
              ...(moveTargetForInterpret !== undefined ? { moveTarget: moveTargetForInterpret } : {}),
            });
            const scrubbedSummary = playerFacingMechanicsCopy(interpreted.summary);
            setIntentDraft(draftFromInterpret({
              ...interpreted,
              summary: scrubbedSummary,
            }));
            shell.announce(`${directorIdentityLabel} prepared a fresh draft — confirm to resolve it.`);
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? playerFacingMechanicsCopy(failure.message)
                : `${directorIdentityLabel} could not interpret that action right now.`;
          } finally {
            busy = false;
            render();
          }
        })();
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="confirm-intent-intercept"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (
            candidate === null ||
            busy ||
            intentDraft === null ||
            tableState === null
          ) {
            return;
          }
          if (intentDraft.interceptState === 'stale') {
            error = 'That draft is stale — the scene moved on. Re-declare your action.';
            render();
            return;
          }
          if (
            intentDraft.projectionVersionAtIssue !== undefined &&
            intentDraft.projectionVersionAtIssue !== tableState.stateVersion
          ) {
            markIntentDraftStale(
              'Table conflict: the scene changed while this draft was open. Re-declare against the current beat.',
            );
            render();
            return;
          }
          if (!explorationMode() && (timingAuthority === null || !holdsOwnAuthority())) {
            return;
          }
          const own = ownCombatant();
          if (
            encounter?.status === 'active' &&
            own !== null &&
            (own.currentHitPoints <= 0 ||
              own.deathSaves.dead ||
              own.conditions.some((condition) => condition.conditionId === 'unconscious'))
          ) {
            error = 'Your character is incapacitated and cannot confirm that action.';
            render();
            return;
          }
          const draft = intentDraft;
          if (isRulesIntentDraftCommand(draft.proposedCommandType)) {
            const chainInitiative =
              draft.proposedCommandType === 'encounter.begin' &&
              /initiative/i.test(draft.summary);
            setIntentDraft(null);
            const began = await submitRulesAction(
              draft.proposedCommandType,
              fieldsFromIntentDraft(draft),
            );
            if (!began) {
              setIntentDraft({
                ...draft,
                interceptState: 'failed',
                summary: playerFacingMechanicsCopy(
                  `${draft.summary} — ${error ?? 'That action could not be confirmed.'}`,
                ),
              });
              render();
              return;
            }
            if (chainInitiative && encounter !== null && encounter.status === 'setup') {
              const rolled = await submitRulesAction('initiative.roll');
              if (!rolled) {
                error =
                  error ??
                  'Encounter began, but initiative could not be rolled. Declare roll initiative again.';
                render();
              }
            }
            return;
          }
          busy = true;
          error = null;
          const declarationText = lastSubmittedDeclaration.trim();
          const resumeAfterSceneBuild = draft.proposedCommandType === 'table.build_scene';
          const resumeAfterOpenCross =
            draft.proposedCommandType === 'table.open_door' &&
            declarationText.length > 0 &&
            /\b(walk|go|step|approach|enter|through|beyond|room beyond)\b/i.test(declarationText);
          const resumeCompound = resumeAfterSceneBuild || resumeAfterOpenCross;
          // Intent drafts stay local until Confirm; only skill-check sync needs the Ready-to summary.
          const summaryForCommand =
            draft.proposedCommandType === 'table.sync' && draft.summary.trim().length > 0
              ? draft.summary.trim()
              : undefined;
          render();
          try {
            const accepted = await submitTableCommand({
              candidateId: candidate.candidateId,
              campaignId,
              requestId: crypto.randomUUID(),
              commandType: draft.proposedCommandType,
              expectedStateVersion: tableState.stateVersion,
              ...(explorationMode() || timingAuthority === null
                ? {}
                : { timingAuthorityId: timingAuthority.timingAuthorityId }),
              ...(draft.path !== undefined ? { path: draft.path } : {}),
              ...(draft.edgeId !== undefined ? { edgeId: draft.edgeId } : {}),
              ...(summaryForCommand !== undefined ? { summary: summaryForCommand } : {}),
              ...(declarationText.length > 0 ? { declaration: declarationText } : {}),
            });
            tableState = accepted.table;
            mapBundle = await fetchCampaignMap(campaignId);
            const resolvedSummary = resolvedSummaryAfterTableConfirm({
              commandType: draft.proposedCommandType,
              draftSummary: draft.summary,
              declaration: declarationText,
              eventSummary: accepted.event.summary,
              openCross: resumeAfterOpenCross,
            });
            if (declarationText.length > 0) {
              appendDmThread('player', 'You', declarationText, 'declaration');
            }
            appendDmThread('system', 'Table', playerFacingMechanicsCopy(resolvedSummary), 'mechanics');
            shell.announce('Action confirmed on the table.');
            setIntentDraft(null);
            doorRecoveryVisible = false;
            if (resumeCompound && declarationText.length > 0) {
              // Open/build first, then chain the through-step without double-narrating.
              await resumeCompoundDeclarationAfterBuild(declarationText, {
                narrateSteps: false,
                stopAfterFirstMove: resumeAfterOpenCross,
              });
              if (
                shouldAutoNarrateRulesCommand(draft.proposedCommandType) ||
                /^Trap search|^Lock attempt|Investigation|Sleight of Hand/i.test(resolvedSummary)
              ) {
                await narrateIntoDmThread(resolvedSummary, accepted.event.rolls ?? []);
              } else {
                patchDmPlayThread();
              }
            } else if (
              shouldAutoNarrateRulesCommand(draft.proposedCommandType) ||
              /^Trap search|^Lock attempt|Investigation|Sleight of Hand/i.test(resolvedSummary)
            ) {
              await narrateIntoDmThread(resolvedSummary, accepted.event.rolls ?? []);
            } else {
              patchDmPlayThread();
            }
          } catch (failure) {
            const raw =
              failure instanceof ApiFailure
                ? failure.message
                : 'That action could not be confirmed.';
            error = playerFacingMechanicsCopy(raw);
            if (intentDraft !== null) {
              setIntentDraft({
                ...intentDraft,
                interceptState: 'failed',
                summary: playerFacingMechanicsCopy(
                  `${intentDraft.summary} — ${error}`,
                ),
              });
            }
            if (failure instanceof ApiFailure && failure.code === 'STALE_STATE_VERSION') {
              presentTableConflict(failure);
              try {
                tableState = await fetchTableState(campaignId);
              } catch {
                // Keep the conflict message visible.
              }
            }
          } finally {
            busy = false;
            render();
          }
        })();
      });
  }

  function captureFocusedField(root: HTMLElement): {
    readonly testId: string;
    readonly start: number;
    readonly end: number;
  } | null {
    const active = document.activeElement;
    if (
      !(active instanceof HTMLTextAreaElement) &&
      !(active instanceof HTMLInputElement)
    ) {
      return null;
    }
    if (!root.contains(active)) {
      return null;
    }
    const testId = active.getAttribute('data-testid');
    if (testId === null) {
      return null;
    }
    return {
      testId,
      start: active.selectionStart ?? 0,
      end: active.selectionEnd ?? 0,
    };
  }

  function restoreFocusedField(
    root: HTMLElement,
    saved: { readonly testId: string; readonly start: number; readonly end: number } | null,
  ): void {
    if (saved === null) {
      return;
    }
    const el = root.querySelector(`[data-testid="${saved.testId}"]`);
    if (!(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLInputElement)) {
      return;
    }
    el.focus({ preventScroll: true });
    try {
      el.setSelectionRange(saved.start, saved.end);
    } catch {
      // Some input types reject selection ranges.
    }
  }

  function patchPresenceSection(): void {
    const turnPresence = container.querySelector('[data-testid="table-turn-presence"]');
    if (turnPresence !== null) {
      turnPresence.textContent = compactPresenceLine();
    }
    const host = container.querySelector('[data-testid="presence-section"] section');
    if (host !== null) {
      host.innerHTML = `<h2 id="presence-heading">Who is connected</h2>${presenceBody()}`;
    }
  }

  function presenceFingerprint(
    projection: typeof presence,
  ): string {
    if (projection === null) {
      return 'null';
    }
    return [
      projection.stateVersion,
      projection.onlineAccountIds.join(','),
      projection.graceAccountIds.join(','),
      ...projection.devices.map(
        (device) =>
          `${device.accountId}:${device.status}:${device.tabId}:${device.lastHeartbeatAt}`,
      ),
    ].join('|');
  }

  function renderTable(): void {
    ensurePageShell();
    const pageShell = container.querySelector<HTMLElement>('[data-testid="table-page-shell"]');
    const heading = container.querySelector<HTMLElement>('[data-testid="table-heading-slot"]');
    const infoSlot = container.querySelector<HTMLElement>('[data-testid="table-info-slot"]');
    const actionSlot = container.querySelector<HTMLElement>('[data-testid="table-action-slot"]');
    const commsSlot = container.querySelector<HTMLElement>('[data-testid="table-comms-slot"]');
    const footer = container.querySelector<HTMLElement>('[data-testid="table-footer-slot"]');
    const sheetModalSlot = container.querySelector<HTMLElement>(
      '[data-testid="table-sheet-modal-slot"]',
    );
    if (
      pageShell === null ||
      heading === null ||
      infoSlot === null ||
      actionSlot === null ||
      commsSlot === null ||
      footer === null ||
      sheetModalSlot === null
    ) {
      return;
    }

    pageShell.dataset.mobileTask = mobileTaskMode;
    pageShell.querySelectorAll<HTMLButtonElement>('[data-mobile-task]').forEach((button) => {
      const mode = button.dataset.mobileTask;
      button.setAttribute('aria-pressed', String(mode === mobileTaskMode));
    });

    const focused = captureFocusedField(pageShell);
    const scrollY = window.scrollY;
    const presenceOpen =
      container.querySelector<HTMLDetailsElement>('[data-testid="presence-section"]')?.open === true;
    const advancedOpen =
      container.querySelector<HTMLDetailsElement>('[data-testid="table-advanced-controls"]')?.open ===
      true;
    const toolsWereActive = activeInfoTab === 'tools';

    const mapMeta =
      mapBundle === null
        ? 'Map projection pending.'
        : (() => {
            const art = humanizeArtProvenance(mapBundle.artProvenance, mapBundle.title);
            const checkpoint = mapBundle.title.trim().length > 0 ? mapBundle.title : 'Blank table';
            const base = `Shared scene checkpoint: ${escapeHtml(checkpoint)} · ${mapBundle.coordinateSpace.columns}×${mapBundle.coordinateSpace.rows} squares · ${mapBundle.coordinateSpace.feetPerSquare} ft/square`;
            return art.length === 0 ? base : `${base} · ${escapeHtml(art)}`;
          })();

    heading.innerHTML = `
      <div class="table-header-main">
        <h1 data-testid="campaign-table-heading">${escapeHtml(campaignName)}</h1>
        ${
          mapBundle === null
            ? ''
            : `<p class="scene-banner" data-testid="map-scene-banner">${escapeHtml(mapBundle.sceneBanner)}</p>`
        }
      </div>
      <nav class="table-header-links" aria-label="Table navigation">
        <a href="/campaigns/${escapeHtml(campaignId)}" data-link data-testid="table-back">Campaign</a>
        <a href="/campaigns/${escapeHtml(campaignId)}/settings" data-link data-testid="table-settings">Settings</a>
      </nav>
      <p class="visually-hidden" data-testid="action-composer-notice">${escapeHtml(ACTION_COMPOSER_STRUCTURE.notice)}</p>
      ${
        error === null
          ? ''
          : `<div class="message error" role="alert" data-testid="table-error">${escapeHtml(error)}</div>`
      }`;

    infoSlot.innerHTML = infoRailBody();
    actionSlot.innerHTML = playerActionBar();
    commsSlot.innerHTML = commsDockBody();
    sheetModalSlot.innerHTML = characterSheetModalHtml();

    const infoRail = container.querySelector<HTMLElement>('[data-testid="table-info-rail"]');
    const commsRail = container.querySelector<HTMLElement>('[data-testid="communication-dock"]');
    const dashboardBody = container.querySelector<HTMLElement>('.table-dashboard-body');
    const focusMode = infoRailCollapsed && commsRailCollapsed;
    infoRail?.classList.toggle('is-collapsed', infoRailCollapsed);
    commsRail?.classList.toggle('is-collapsed', commsRailCollapsed);
    dashboardBody?.classList.toggle('table-focus-mode', focusMode);
    const focusRestore = container.querySelector<HTMLElement>('[data-testid="table-focus-restore"]');
    if (focusRestore !== null) {
      focusRestore.hidden = !focusMode;
      focusRestore.innerHTML = focusMode
        ? `<div class="table-focus-restore-actions" data-testid="table-focus-restore-actions">
             <button type="button" class="table-secondary-action" data-testid="expand-info-rail">Show reference</button>
             <button type="button" class="table-secondary-action" data-testid="expand-comms-rail">Show chat</button>
           </div>`
        : '';
    }

    footer.innerHTML = `
      <details class="table-meta-panel" data-testid="presence-section"${presenceOpen ? ' open' : ''}>
        <summary>Table details</summary>
        <section aria-labelledby="presence-heading">
          <h2 id="presence-heading">Who is connected</h2>
          ${presenceBody()}
        </section>
        <p class="record-meta" data-testid="table-state-meta"
          data-state-version="${tableState?.stateVersion ?? 0}"
          data-event-sequence="${tableState?.lastEventSequence ?? 0}">
          ${escapeHtml(turnBanner().title)} · ${escapeHtml(mapBundle?.title ?? 'Blank table')}
        </p>
        <p class="record-meta" data-testid="shared-scene-status">
          Everyone at this table sees the same current scene. When the Director changes the map, you will hear a brief update.
        </p>
        ${
          mapBundle?.title === 'Blank table' && (mapBundle.edges.length ?? 0) === 0
            ? `<p class="record-meta" data-testid="blank-table-start-hint">
                 This blank table starts unexplored. Ask the Director to establish the first scene, or declare what you do so the scene can unfold.
               </p>`
            : mapBundle?.title === 'Quiet chamber'
              ? `<p class="record-meta" data-testid="blank-table-start-hint">
                   Quiet chamber is ready — inspect or open the wooden doorway, or declare what you do next.
                 </p>`
              : ''
        }
        <p class="record-meta" data-testid="map-bundle-meta">${mapMeta}</p>
        ${
          mapBundle === null || mapBundle.notableFeatures.length === 0
            ? ''
            : `<ul class="record-list compact" data-testid="map-notable-features">
                ${mapBundle.notableFeatures
                  .map(
                    (feature) => `
                  <li data-testid="map-notable-feature">
                    ${escapeHtml(feature.label)}
                  </li>`,
                  )
                  .join('')}
              </ul>`
        }
      </details>`;

    if (toolsWereActive && advancedOpen) {
      const advanced = infoSlot.querySelector<HTMLDetailsElement>(
        '[data-testid="table-advanced-controls"]',
      );
      if (advanced !== null) {
        advanced.open = true;
      }
    }

    bindPanelEvents(pageShell);
    restoreFocusedField(pageShell, focused);
    if (focused !== null) {
      window.scrollTo(0, scrollY);
    }
    syncStageFrameEffects();
    void ensureStage();
  }

  function render(): void {
    if (!isPageMountCurrent(container, mountToken)) return;
    if (getAccount() === null) {
      stopProjectionPoll();
      stageHandle?.destroy();
      stageHandle = null;
      if (isHostedPlayerSurface(candidate)) {
        navigate('/', { replace: true });
        return;
      }
      container.innerHTML = renderSignedOutGate({
        title: 'Campaign table',
        body: 'Sign in to open the Communication Dock for a campaign you belong to.',
        candidate,
        busy: gateBusy,
        error: gateError,
      });
      bindSignedOutGate({
        container,
        shell,
        candidate,
        onSignedIn: () => void loadLegalThenTable(),
        setBusy: (value) => {
          gateBusy = value;
        },
        setError: (message) => {
          gateError = message;
        },
        render,
      });
      return;
    }
    if (legalGateLoading) {
      stopProjectionPoll();
      stageHandle?.destroy();
      stageHandle = null;
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="campaign-table-heading">Campaign table</h1>
          <p class="tagline">Checking legal acceptance…</p>
        </div>`;
      return;
    }
    if (isLegalPlayBlocked(legalAcceptance)) {
      stopProjectionPoll();
      stageHandle?.destroy();
      stageHandle = null;
      container.innerHTML = renderLegalPlayGatePage({
        title: 'Campaign table',
        body: 'The tactical table opens after you accept every current legal document.',
        acceptance: legalAcceptance,
        candidate,
        busy: legalGateBusy,
        error: legalGateError,
      });
      bindLegalPlayGatePage({
        container,
        shell,
        candidate,
        getAcceptance: () => legalAcceptance,
        setAcceptance: (next) => {
          legalAcceptance = next;
        },
        onUnblocked: () => {
          void load();
        },
        setBusy: (value) => {
          legalGateBusy = value;
        },
        setError: (message) => {
          legalGateError = message;
        },
        render,
      });
      return;
    }
    if (sessionZeroGateActive) {
      stopProjectionPoll();
      stageHandle?.destroy();
      stageHandle = null;
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="campaign-table-heading">Campaign table</h1>
          <p class="message notice" data-testid="table-session-zero-gate">
            Record Session Zero in Campaign settings before opening the tactical table. You can still review campaign
            settings and seat characters from the campaign page afterward.
          </p>
          <div class="actions">
            <a href="/campaigns/${escapeHtml(campaignId)}/settings" data-link data-testid="table-session-zero-settings">Campaign settings</a>
            <a href="/campaigns/${escapeHtml(campaignId)}" data-link data-testid="table-session-zero-campaign">Campaign overview</a>
          </div>
        </div>`;
      return;
    }
    if (!tableBootstrapped) {
      stopProjectionPoll();
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="campaign-table-heading">${escapeHtml(campaignName)}</h1>
          <p class="tagline" data-testid="table-joining">Joining the table…</p>
        </div>`;
      return;
    }
    renderTable();
  }

  async function loadLegalThenTable(): Promise<void> {
    if (getAccount() === null) {
      render();
      return;
    }
    legalGateLoading = true;
    render();
    legalAcceptance = await loadLegalPlayAcceptance();
    legalGateLoading = false;
    if (isLegalPlayBlocked(legalAcceptance)) {
      render();
      return;
    }
    await load();
  }

  async function refreshSharedProjections(options?: {
    readonly forceRender?: boolean;
  }): Promise<void> {
    if (!isPageMountCurrent(container, mountToken) || getAccount() === null) {
      return;
    }
    const [tableFeed, mapFeed, timingFeed, rulesFeed, chatFeed, chronicleFeed, memoryFeed] =
      await Promise.all([
      fetchTableState(campaignId),
      fetchCampaignMap(campaignId),
      fetchTimingAuthority(campaignId),
      seated ? fetchRulesState(campaignId) : Promise.resolve(null),
      fetchPartyChat(campaignId),
      fetchChronicle(campaignId),
      fetchCampaignMemory(campaignId).catch(() => null),
    ]);
    if (!isPageMountCurrent(container, mountToken)) {
      return;
    }
    const priorVersion = tableState?.stateVersion ?? -1;
    const priorMap = mapSyncFingerprint(mapBundle);
    const priorAuthorityId = timingAuthority?.timingAuthorityId ?? null;
    const priorAuthorityState = timingAuthority?.state ?? null;
    const priorChatCount = partyChat?.messages.length ?? 0;
    const priorChronicleCount = chronicle?.entries.length ?? 0;
    const priorMemoryUpdatedAt = memory?.updatedAt ?? null;
    const priorSpotlightKey = tableState?.npcSpotlight
      ? `${tableState.npcSpotlight.npcId}:${tableState.npcSpotlight.holderSeatId}:${tableState.npcSpotlight.expiresAt}`
      : null;
    tableState = tableFeed;
    mapBundle = mapFeed;
    timingAuthority = timingFeed.authority;
    partyChat = chatFeed;
    chronicle = chronicleFeed;
    if (memoryFeed !== null) {
      memory = memoryFeed;
    }
    if (rulesFeed !== null) {
      encounter = rulesFeed.encounter;
      progression = rulesFeed.progression;
    }
    const nextSpotlightKey = tableFeed.npcSpotlight
      ? `${tableFeed.npcSpotlight.npcId}:${tableFeed.npcSpotlight.holderSeatId}:${tableFeed.npcSpotlight.expiresAt}`
      : null;
    const changed =
      options?.forceRender === true ||
      tableFeed.stateVersion !== priorVersion ||
      mapSyncFingerprint(mapFeed) !== priorMap ||
      (timingFeed.authority?.timingAuthorityId ?? null) !== priorAuthorityId ||
      (timingFeed.authority?.state ?? null) !== priorAuthorityState ||
      chatFeed.messages.length !== priorChatCount ||
      chronicleFeed.entries.length !== priorChronicleCount ||
      (memoryFeed?.updatedAt ?? null) !== priorMemoryUpdatedAt ||
      nextSpotlightKey !== priorSpotlightKey;
    // Only announce scene changes after the first load has a prior map to compare against (PQA-183).
    if (priorMap.length > 0 && mapSyncFingerprint(mapFeed) !== priorMap) {
      shell.announce(`Scene updated: ${mapFeed.title || 'Map changed'}.`);
    }
    if (changed) {
      if (chronicleFeed.entries.length !== priorChronicleCount) {
        syncDmThreadFromChronicle();
      }
      render();
    } else if (mapBundle !== null && stageHandle !== null) {
      stageHandle.renderMap(mapBundle);
    }
    void processPresentationCues();
  }

  function stopProjectionPoll(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (presenceTimer !== null) {
      clearInterval(presenceTimer);
      presenceTimer = null;
    }
  }

  async function sendPresenceHeartbeat(): Promise<void> {
    if (candidate === null || getAccount() === null) {
      return;
    }
    const result = await heartbeatCampaignPresence({
      candidateId: candidate.candidateId,
      campaignId,
      tabId: presenceTabId,
      spectator: !seated,
    });
    presence = result.presence;
  }

  function startProjectionPoll(): void {
    stopProjectionPoll();
    pollTimer = setInterval(() => {
      if (!isPageMountCurrent(container, mountToken)) {
        stopProjectionPoll();
        return;
      }
      if (busy || pollInFlight || getAccount() === null || candidate === null) {
        return;
      }
      pollInFlight = true;
      void refreshSharedProjections()
        .catch(() => {
          // Soft-fail: keep showing the last good projection until the next tick.
        })
        .finally(() => {
          pollInFlight = false;
        });
    }, TABLE_PROJECTION_POLL_MS);

    presenceTimer = setInterval(() => {
      if (!isPageMountCurrent(container, mountToken) || getAccount() === null) {
        return;
      }
      const before = presenceFingerprint(presence);
      void sendPresenceHeartbeat()
        .then(() => {
          // Presence heartbeats must not wipe Director Address / NL textareas.
          // Patch the presence panel only when the projection actually changes.
          if (presenceFingerprint(presence) === before) {
            return;
          }
          patchPresenceSection();
        })
        .catch(() => {
          // Soft-fail presence; next heartbeat retries.
        });
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);
  }

  function onVisibilityRefresh(): void {
    if (document.visibilityState !== 'visible' || busy || getAccount() === null) {
      return;
    }
    void refreshSharedProjections({ forceRender: true }).catch(() => {
      // Soft-fail on focus refresh.
    });
  }

  async function load(): Promise<void> {
    if (getAccount() === null) {
      stopProjectionPoll();
      render();
      return;
    }
    error = null;
    tableNotes = loadTableNotesPreference();
    if (!tableBootstrapped) {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="campaign-table-heading">${escapeHtml(campaignName)}</h1>
          <p class="tagline" data-testid="table-joining">Joining the table…</p>
        </div>`;
    } else {
      render();
    }
    const presentationEpochAtLoad = presentationWriteEpoch;
    const pendingCharacterId = readPendingJoin(campaignId);
    try {
      let detail = await fetchCampaignDetail(campaignId);
      if (detail.ownSeat === null && pendingCharacterId !== null) {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          detail = await fetchCampaignDetail(campaignId);
          if (detail.ownSeat !== null) {
            break;
          }
        }
      }
      campaignName = detail.campaign.name;
      sessionZeroComplete = detail.settings.sessionZero.completed;
      sessionZeroGateActive = !sessionZeroComplete;
      directorIdentityLabel = detail.campaign.director.identityLabel;
      seated = detail.ownSeat !== null;
      ownSeatId = detail.ownSeat?.seatId ?? null;
      if (seated) {
        clearPendingJoin(campaignId);
      }
      // Stay on Joining… until projections finish — never paint spectator mid-load.
      tableBootstrapped = false;
      if (!seated && chatMode === 'speak_as_character') {
        chatMode = 'table_talk';
      }
      shell.setDocumentTitle(`Table · ${campaignName}`);
      const [chronicleFeed, chatFeed, tableFeed, mapFeed, timingFeed, presentation, rulesFeed, memoryFeed, catalogFeed] =
        await Promise.all([
          fetchChronicle(campaignId),
          fetchPartyChat(campaignId),
          fetchTableState(campaignId),
          fetchCampaignMap(campaignId),
          fetchTimingAuthority(campaignId),
          fetchPlayerSettings(),
          seated ? fetchRulesState(campaignId) : Promise.resolve(null),
          fetchCampaignMemory(campaignId).catch(() => null),
          fetchRulesCatalog().catch(() => null),
        ]);
      chronicle = chronicleFeed;
      partyChat = chatFeed;
      tableState = tableFeed;
      mapBundle = mapFeed;
      timingAuthority = timingFeed.authority;
      memory = memoryFeed;
      rulesCatalog = catalogFeed;
      encounter = rulesFeed?.encounter ?? null;
      progression = rulesFeed?.progression ?? null;
      seedDmThreadIfNeeded();
      if (presentationEpochAtLoad === presentationWriteEpoch) {
        reducedMotion = presentation.reducedMotion;
        lowEffects = presentation.lowEffects;
        textToSpeechEnabled = presentation.reserved.textToSpeechEnabled;
        speechToTextEnabled = presentation.reserved.speechToTextEnabled;
        applyPresentationPreferences({ reducedMotion, lowEffects });
      }
      startProjectionPoll();
      try {
        await sendPresenceHeartbeat();
      } catch {
        // Presence soft-fails on first load.
      }
      await establishPresentationCueBaseline();
      tableBootstrapped = true;
      if (seated) {
        clearPendingJoin(campaignId);
      }
    } catch (failure) {
      error = failure instanceof ApiFailure ? failure.message : 'The campaign table could not load.';
      stopProjectionPoll();
      tableBootstrapped = true;
    }
    render();
  }

  document.addEventListener('visibilitychange', onVisibilityRefresh);
  subscribeAccount(() => {
    void loadLegalThenTable();
  });
  void loadLegalThenTable();
}
