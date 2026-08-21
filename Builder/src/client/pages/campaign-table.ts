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
  type DockTab,
  type PartyChatMode,
} from '../../shared/communication-contract.js';
import type {
  RulesCatalogCategory,
  RulesCatalogProjection,
} from '../../shared/rules-catalog-contract.js';
import { RULES_CATALOG_CATEGORY_LABELS } from '../../shared/rules-catalog-contract.js';
import type { CampaignPresenceProjection } from '../../shared/presence-contract.js';
import { PRESENCE_HEARTBEAT_INTERVAL_MS } from '../../shared/presence-contract.js';
import type { MapBundleProjection } from '../../shared/map-contract.js';
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
import { getAccount, subscribeAccount } from '../account-session.js';
import {
  ApiFailure,
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
} from '../api.js';
import { bindSignedOutGate, renderSignedOutGate } from '../auth-gate.js';
import { renderCharacterSheet } from '../character-sheet-view.js';
import { escapeHtml } from '../dom-utils.js';
import { beginPageMount, isPageMountCurrent } from '../page-mount.js';
import { isHostedPlayerSurface } from '../player-surface.js';
import { applyPresentationPreferences } from '../presentation-preferences.js';
import { navigate } from '../router.js';
import { mountTableStage, type TableStageHandle } from '../table/table-stage.js';
import { findWalkPathToTarget, ownTokenAnchor } from '../table/walk-path.js';
import type { PageHost } from './home.js';

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
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

/** Non-authoritative private notes preference for the current tab session. */
const tableNotesPreferences = new Map<string, string>();

export function mountCampaignTablePage(host: PageHost, campaignId: string): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Campaign table');

  let campaignName = 'Campaign';
  let directorIdentityLabel = 'the DM';
  type InfoTab = 'character' | 'notes' | 'people' | 'tools';
  let activeInfoTab: InfoTab = 'character';
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
  let intentDraft: ActionDraftSuggestion | null = null;
  let reducedMotion = false;
  let lowEffects = false;
  let textToSpeechEnabled = false;
  let speechToTextEnabled = false;
  /** Bumped on player-driven presentation saves so an in-flight table load cannot clobber them. */
  let presentationWriteEpoch = 0;
  let seated = false;
  let ownSeatId: string | null = null;
  let moveTarget: { column: number; row: number } | null = null;
  let movePreviewNote: string | null = null;
  let draft = '';
  let directorDraft = '';
  let askDmThread: DmThreadMessage[] = [];
  let dmThread: DmThreadMessage[] = [];
  let dmThreadSeeded = false;
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
  let stageHandle: TableStageHandle | null = null;
  let stageMounting = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let presenceTimer: ReturnType<typeof setInterval> | null = null;
  let pollInFlight = false;
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
  function humanizeArtProvenance(provenance: string): string {
    return provenance.replace(/_/g, ' ');
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

  function seedDmThreadIfNeeded(): void {
    if (dmThreadSeeded || !seated) {
      return;
    }
    const scene = mapBundle?.sceneBanner?.trim() || 'The table is ready.';
    dmThread = [
      newThreadMessage(
        'dm',
        directorIdentityLabel,
        `${scene} What do you do?`,
        'prompt',
      ),
    ];
    dmThreadSeeded = true;
  }

  function appendDmThread(
    speaker: DmThreadMessage['speaker'],
    speakerLabel: string,
    body: string,
    kind: DmThreadMessage['kind'],
  ): void {
    dmThread = [...dmThread, newThreadMessage(speaker, speakerLabel, body, kind)];
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
          const replyAttr =
            options.latestReplyTestId !== undefined && index === lastDmIndex
              ? ` data-testid="${options.latestReplyTestId}"`
              : '';
          return `<li class="dm-thread-message dm-thread-${escapeHtml(message.speaker)}" data-testid="dm-thread-message"${replyAttr}>
            <span class="record-note"><strong>${escapeHtml(message.speakerLabel)}</strong></span>
            <p>${escapeHtml(message.body)}</p>
            <span class="record-meta">${escapeHtml(formatTimestamp(message.createdAt))}</span>
          </li>`;
        })
        .join('')}
    </ol>`;
  }

  async function narrateIntoDmThread(mechanicsSummary: string): Promise<void> {
    if (candidate === null || mechanicsSummary.trim().length === 0) {
      return;
    }
    try {
      const narration = await requestDirectorNarration({
        candidateId: candidate.candidateId,
        campaignId,
        mechanicsSummary,
      });
      lastNarration = narration.body;
      appendDmThread(
        'dm',
        narration.directorIdentityLabel || directorIdentityLabel,
        narration.body,
        'narration',
      );
      if (textToSpeechEnabled && 'speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(narration.body);
        window.speechSynthesis.speak(utterance);
      }
    } catch {
      appendDmThread('system', 'Table', mechanicsSummary, 'mechanics');
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
    if (!seated || mapBundle === null) {
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
    if (timingAuthority === null) {
      return encounter?.status === 'active'
        ? 'Waiting for your turn in initiative order.'
        : 'Waiting for initiative order.';
    }
    if (timingAuthority.timingAuthorityId === 'held-by-other') {
      return 'Another adventurer holds the active combat turn.';
    }
    if (isOwnCombatTurn()) {
      return 'Initiative gave you the active combat turn.';
    }
    const label =
      timingAuthority.opportunityClass === 'reaction'
        ? 'Reaction window'
        : timingAuthority.opportunityClass === 'decision'
          ? 'Decision window'
          : 'Combat turn';
    return `${label} credential active · expires ${timingAuthority.expiresAt}`;
  }

  function turnBanner(): { readonly title: string; readonly detail: string; readonly tone: 'waiting' | 'yours' | 'spectator' | 'exploration' } {
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
          detail: 'The Game Director is running the scene. Review your sheet, chat, or ask the Game Director while you wait.',
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
    if (encounter === null || encounter.initiativeOrder.length === 0) {
      return '';
    }
    const items = encounter.initiativeOrder
      .map((combatantId) => {
        const combatant =
          encounter!.combatants.find((entry) => entry.combatantId === combatantId) ?? null;
        const active = combatantId === encounter!.activeCombatantId;
        return `<li class="${active ? 'initiative-active' : ''}" data-testid="initiative-entry-${escapeHtml(combatantId)}">
          ${escapeHtml(combatant?.name ?? combatantId)}${active ? ' · now' : ''}
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
    return `<div data-testid="table-character-sheet">${renderCharacterSheet(progression.sheet)}</div>`;
  }

  function loadTableNotesPreference(): string {
    return tableNotesPreferences.get(campaignId) ?? '';
  }

  function saveTableNotesPreference(value: string): void {
    // Non-authoritative UI preference for this browser tab session only.
    tableNotesPreferences.set(campaignId, value);
  }

  const INFO_TAB_LABELS: Record<InfoTab, string> = {
    character: 'Character',
    notes: 'Notes',
    people: 'People',
    tools: 'Tools',
  };

  function peoplePanelBody(): string {
    if (memory === null) {
      return '<p class="record-meta" data-testid="table-people-loading">Campaign memory is loading…</p>';
    }
    const currentChapter =
      memory.chapters.find((chapter) => chapter.chapterId === memory!.currentChapterId) ?? null;
    return `
      <p class="record-meta" data-testid="table-people-time">${escapeHtml(memory.campaignTime.label)}</p>
      ${
        currentChapter === null
          ? '<p class="empty-state">No current chapter yet.</p>'
          : `<p data-testid="table-current-chapter">
               <strong>${escapeHtml(currentChapter.sessionLabel)}: ${escapeHtml(currentChapter.title)}</strong><br />
               ${escapeHtml(currentChapter.planSummary)}
             </p>`
      }
      ${
        memory.npcs.length === 0
          ? '<p class="empty-state" data-testid="table-npc-empty">No NPCs recorded yet.</p>'
          : `<h3 class="preview-subheading">NPCs encountered</h3>
             <ul class="record-list compact" data-testid="npc-list">
               ${memory.npcs
                 .map(
                   (npc) => `
                 <li data-testid="npc-item">
                   <span class="record-note">${escapeHtml(npc.name)} — ${escapeHtml(npc.role)}</span>
                   <span class="record-meta">${escapeHtml(npc.knowledge)}</span>
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
      <p class="record-meta">Private scratch notes — saved on this device for this browser tab only. They start empty; campaign prompts live under People and Story so far.</p>
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
          <section class="table-info-pane" data-testid="table-character-sheet-panel">
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
    return `
      <div class="info-rail-tabs" role="tablist" aria-label="Table reference">
        ${(Object.keys(INFO_TAB_LABELS) as InfoTab[]).map(
          (tab) => `
          <button type="button" role="tab" class="info-rail-tab${activeInfoTab === tab ? ' active' : ''}"
            aria-selected="${activeInfoTab === tab}" data-testid="table-info-tab-${tab}" data-info-tab="${tab}">
            ${escapeHtml(INFO_TAB_LABELS[tab])}
          </button>`,
        ).join('')}
      </div>
      <div class="info-rail-viewport" role="tabpanel">
        ${infoTabBody()}
      </div>`;
  }

  function commsDockBody(): string {
    return `
      <div class="dock-tabs" role="tablist" aria-label="Table conversations">
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
      </div>`;
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
    if (deviceCount <= 1) {
      return base;
    }
    return `${base} · ${deviceCount} devices/tabs`;
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
        const detail = group.devices
          .map(
            (device) =>
              `${device.status}${device.seatId !== null ? ' · seated' : ' · no seat'}`,
          )
          .join('; ');
        return `
        <li data-testid="presence-device" title="${escapeHtml(detail)}">
          <strong>${escapeHtml(group.displayLabel)}</strong>
          · ${escapeHtml(presenceStatusLabel(primary.status, group.devices.length))}
        </li>`;
      })
      .join('');
    return `
      <div data-testid="presence-panel">
        <p class="record-meta" data-testid="presence-meta">
          Who is here · online ${presence.onlineAccountIds.length} · reconnecting ${presence.graceAccountIds.length}
        </p>
        <ul class="record-list" data-testid="presence-list">${rows || '<li>No one at the table yet.</li>'}</ul>
      </div>`;
  }

  function dockBody(): string {
    if (activeTab === 'chronicle') {
      const entries = chronicle?.entries ?? [];
      return `
        <div class="dock-pane" data-testid="chronicle-pane">
          <p class="record-meta">Trusted system entries only. Players cannot post here.</p>
          ${
            entries.length === 0
              ? '<p class="empty-state" data-testid="chronicle-empty">No Chronicle entries yet.</p>'
              : `<ol class="record-list chronicle-list" data-testid="chronicle-list">
                  ${entries
                    .map(
                      (entry) => `
                    <li data-testid="chronicle-entry">
                      <span class="record-note">${escapeHtml(entry.body)}</span>
                      <span class="record-meta">${escapeHtml(entry.kind)} · ${escapeHtml(formatTimestamp(entry.createdAt))}</span>
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
      const selectedEntry =
        categoryEntries.find((entry) => entry.entryId === selectedRulesEntryId) ??
        categoryEntries[0] ??
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
                ? 'Loading SRD catalog…'
                : `${escapeHtml(rulesCatalog.rulesVersion)} · ${rulesCatalog.entries.length} entries`
            }
          </p>
          <label class="field">
            <span>Category</span>
            <select data-testid="rules-catalog-category">
              ${(rulesCatalog?.categories ?? [])
                .map(
                  (category) =>
                    `<option value="${escapeHtml(category.id)}" ${
                      selectedRulesCategory === category.id ? 'selected' : ''
                    }>${escapeHtml(category.label)} (${category.entryCount})</option>`,
                )
                .join('')}
            </select>
          </label>
          <div class="rules-catalog-entries" data-testid="rules-catalog-entries">
            ${
              categoryEntries.length === 0
                ? '<p class="record-meta">No entries in this category yet.</p>'
                : `<ul class="record-list compact">
                    ${categoryEntries
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
              ? '<p class="record-meta">Choose an entry to read the structured reference.</p>'
              : `<article class="rules-explanation" data-testid="rules-explanation">
                  <h3>${escapeHtml(selectedEntry.title)}</h3>
                  <p>${escapeHtml(selectedEntry.summary)}</p>
                  <ol>${selectedEntry.details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join('')}</ol>
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
    return `
      <div class="dock-pane" data-testid="party-chat-pane">
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
              : ''
          }
          <label class="field">
            <span>Message</span>
            <textarea data-testid="party-chat-input" rows="3" placeholder="Talk with your party…">${escapeHtml(draft)}</textarea>
          </label>
          <button type="submit" data-testid="party-chat-send" aria-disabled="${busy || candidate === null || draft.trim().length === 0}">
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
    const targets = encounter?.combatants.filter((combatant) => !combatant.deathSaves.dead) ?? [];
    if (
      targets.length > 0 &&
      !targets.some((combatant) => combatant.combatantId === selectedCombatantId)
    ) {
      selectedCombatantId =
        targets.find((combatant) => combatant.side === 'foe')?.combatantId ??
        targets[0]!.combatantId;
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
      ownTurn &&
      seatedCombatant?.deathSaves.dead !== true &&
      (actionAvailable || seatedCombatant?.currentHitPoints === 0);
    const openWindow = encounter?.decisionWindows.find(
      (window) =>
        window.state === 'open' &&
        window.eligibleCombatantId === seatedCombatant?.combatantId,
    );
    const disable = busy || tableState === null;
    const combatDisabled = disable || (encounter?.status === 'active' && !ownTurn);
    return `
      <section class="rules-encounter" aria-labelledby="rules-encounter-heading" data-testid="rules-encounter">
        <div class="rules-heading-row">
          <div>
            <h3 id="rules-encounter-heading">Training encounter</h3>
            <p class="record-meta" data-testid="progression-meta">
              Level ${progression?.level ?? 1} · ${progression?.experiencePoints ?? 0} XP
              ${progression?.levelUpAvailable === true ? ' · Level Up available' : ''}
            </p>
          </div>
          <p class="record-meta" data-testid="encounter-meta">
            ${
              encounter === null
                ? 'Not begun'
                : `${escapeHtml(encounter.status)} · round ${encounter.round} · active ${escapeHtml(
                    encounter.combatants.find(
                      (combatant) => combatant.combatantId === encounter?.activeCombatantId,
                    )?.name ?? 'none',
                  )}`
            }
          </p>
        </div>
        ${
          encounter === null
            ? '<p>Begin a local rules encounter against a Training Dummy and Practice Goblin.</p>'
            : `<ul class="combatant-grid" data-testid="combatant-list">
                ${encounter.combatants
                  .map(
                    (combatant) => `
                    <li class="combatant-card${encounter?.activeCombatantId === combatant.combatantId ? ' active' : ''}"
                      data-testid="combatant-${escapeHtml(combatant.combatantId)}"
                      ${combatant.seatId !== null ? 'data-own-combatant="true"' : ''}>
                      <strong>${escapeHtml(combatant.name)}</strong>
                      <span data-testid="${combatant.seatId !== null ? 'own-combatant-hp' : `combatant-hp-${escapeHtml(combatant.combatantId)}`}">HP ${combatant.currentHitPoints}/${combatant.maxHitPoints}${
                        combatant.temporaryHitPoints > 0 ? ` +${combatant.temporaryHitPoints} temp` : ''
                      } · AC ${combatant.armorClass}</span>
                      <span>Initiative ${combatant.initiative ?? '—'} · ${escapeHtml(combatant.side)}</span>
                      <span data-testid="${combatant.seatId !== null ? 'own-combatant-conditions' : `combatant-conditions-${escapeHtml(combatant.combatantId)}`}">${combatant.conditions.length === 0 ? 'No conditions' : combatant.conditions.map((condition) => escapeHtml(condition.label)).join(', ')}</span>
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
                    }>${escapeHtml(combatant.name)}</option>`,
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
          <button type="button" data-rules-command="combat.attack" data-testid="rules-attack"
            aria-disabled="${combatDisabled || !actionAvailable || selectedCombatantId === null}" aria-describedby="composer-gate-hint">Attack selected</button>
          <button type="button" data-rules-command="combat.cast_spell" data-testid="rules-cast-spell"
            aria-disabled="${combatDisabled || !actionAvailable || availableSpells.length === 0}" aria-describedby="composer-gate-hint">Cast spell</button>
          <button type="button" data-rules-command="combat.ready" data-testid="rules-ready"
            aria-disabled="${combatDisabled || !actionAvailable}" aria-describedby="composer-gate-hint">Ready opportunity attack</button>
          <button type="button" data-rules-command="combat.reaction" data-testid="rules-reaction"
            aria-disabled="${combatDisabled || openWindow === undefined}" aria-describedby="composer-gate-hint">Spend Reaction</button>
          <button type="button" data-rules-command="inventory.use_item" data-testid="rules-use-potion"
            aria-disabled="${combatDisabled || !actionAvailable}" aria-describedby="composer-gate-hint">Use healing potion</button>
          <button type="button" data-rules-command="combat.death_save" data-testid="rules-death-save"
            aria-disabled="${combatDisabled || !deathSaveAvailable}" aria-describedby="composer-gate-hint">Death Save</button>
          <button type="button" data-rules-command="combat.training_drop" data-testid="rules-training-drop"
            aria-disabled="${combatDisabled || !actionAvailable || seatedCombatant?.currentHitPoints === 0}" aria-describedby="composer-gate-hint">Training: drop to 0 HP</button>
          <button type="button" data-rules-command="combat.short_rest" data-testid="rules-short-rest"
            aria-disabled="${combatDisabled || !actionAvailable}">Short Rest</button>
          <button type="button" data-rules-command="combat.long_rest" data-testid="rules-long-rest"
            aria-disabled="${combatDisabled || !longRestAvailable}">Long Rest</button>
          <button type="button" data-rules-command="progression.award_xp" data-testid="rules-award-xp"
            aria-disabled="${disable}">Award 300 XP</button>
          <button type="button" data-rules-command="progression.level_up" data-testid="rules-level-up"
            aria-disabled="${disable || progression?.levelUpAvailable !== true}">Level Up</button>
        </div>
        <p class="record-meta" data-testid="rules-last-result">
          ${escapeHtml(encounter?.log.at(-1)?.summary ?? 'Server dice and results will appear here.')}
        </p>
      </section>`;
  }

  function playerActionBar(): string {
    seedDmThreadIfNeeded();
    const banner = turnBanner();
    const showEndTurn = isOwnCombatTurn();
    const canDescribeTurn = seated && (explorationMode() || isOwnCombatTurn());
    return `
      <div class="table-action-bar-inner table-action-bar-dm">
        <section class="table-turn-banner table-turn-banner-${banner.tone}" data-testid="table-turn-banner" aria-live="polite">
          <p class="table-turn-title" data-testid="table-turn-title">${escapeHtml(banner.title)}</p>
          <p class="table-turn-detail" data-testid="table-turn-detail">${escapeHtml(banner.detail)}</p>
          ${initiativeStrip()}
          <p class="table-turn-presence visually-hidden" data-testid="table-turn-presence">${escapeHtml(compactPresenceLine())}</p>
          ${
            movePreviewNote === null
              ? ''
              : `<p class="table-move-status" data-testid="move-target-meta">${escapeHtml(movePreviewNote)}</p>`
          }
        </section>
        <div class="dm-play-thread" data-testid="dm-play-thread">
          <p class="record-meta" data-testid="dm-play-identity">${escapeHtml(directorIdentityLabel)} · play thread</p>
          ${renderThreadMessages(dmThread, { listTestId: 'dm-play-thread-list' })}
          ${
            intentDraft === null
              ? ''
              : `<div class="intent-intercept dm-thread-intent" data-testid="intent-intercept">
                  <p data-testid="intent-intercept-summary">${escapeHtml(intentDraft.summary)}</p>
                  <div class="action-composer-controls">
                    <button type="button" data-testid="confirm-intent-intercept"
                      aria-disabled="${busy || (!explorationMode() && !holdsOwnAuthority())}">Confirm action</button>
                    <button type="button" data-testid="cancel-intent-intercept"
                      aria-disabled="${busy}">Cancel draft</button>
                  </div>
                </div>`
          }
        </div>
        ${
          canDescribeTurn
            ? `<div class="table-player-turn-composer" data-testid="table-player-turn-composer">
                <label class="field table-action-field">
                  <span class="visually-hidden">What do you do?</span>
                  <textarea data-testid="player-action-input" rows="2"
                    placeholder="What do you do? ${escapeHtml(directorIdentityLabel)} narrates from here.">${escapeHtml(playerActionDraft)}</textarea>
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
                    : 'Seat a character to play in this DM thread.'
                }</p>
              </div>`
        }
      </div>`;
  }

  function advancedControlsBody(): string {
    const ownAuthority = holdsOwnAuthority();
    const needsAuthority = !explorationMode();
    const syncDisabled =
      busy || candidate === null || !seated || tableState === null || (needsAuthority && !ownAuthority);
    const interpretDisabled =
      busy || candidate === null || !seated || (needsAuthority && !ownAuthority);
    const gateHint = composerGateHint();
    return `
      <p class="record-meta" data-testid="timing-authority-meta">${escapeHtml(authorityMeta())}</p>
      <p class="composer-gate-hint" role="status" id="composer-gate-hint" data-testid="composer-gate-hint">${escapeHtml(gateHint)}</p>
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
        <button type="button" data-testid="open-adjacent-door"
          aria-disabled="${syncDisabled}"
          aria-describedby="composer-gate-hint">
          Open adjacent door
        </button>
        <button type="button" data-testid="interpret-action"
          aria-disabled="${interpretDisabled}"
          aria-describedby="composer-gate-hint">
          ${escapeHtml(ACTION_COMPOSER_STRUCTURE.interpretActionLabel)}
        </button>
        <button type="button" data-testid="request-narration"
          aria-disabled="${busy || candidate === null || !seated}">
          Request Director narration
        </button>
      </div>
      <label class="field">
        <span>Describe your action</span>
        <textarea data-testid="nl-intent-input" rows="2" placeholder="Example: I open the door carefully and listen.">${escapeHtml(nlIntentText)}</textarea>
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
              Draft ready in the DM play thread below the map — confirm or cancel there.
            </p>`
      }`;
  }

  function ensurePageShell(): void {
    if (container.querySelector('[data-testid="table-page-shell"]')) {
      return;
    }
    container.innerHTML = `
      <div class="page page-wide table-dashboard" data-testid="table-page-shell">
        <header class="table-dashboard-header" data-testid="table-heading-slot"></header>
        <div class="table-dashboard-body">
          <aside class="table-info-rail panel" aria-label="Reference" data-testid="table-info-rail">
            <div data-testid="table-info-slot"></div>
          </aside>
          <main class="table-play-column" aria-label="Play area">
            <section class="table-stage-frame${lowEffects || reducedMotion ? ' table-stage-low-effects' : ''}" aria-label="Tactical map" data-testid="table-stage-slot">
              <p class="record-meta" data-testid="table-stage-loading">Loading tactical map…</p>
            </section>
            <section class="panel action-composer table-action-bar" aria-labelledby="action-composer-heading" data-testid="action-composer">
              <h2 id="action-composer-heading" class="visually-hidden">${escapeHtml(ACTION_COMPOSER_STRUCTURE.heading)}</h2>
              <div data-testid="table-action-slot"></div>
            </section>
          </main>
          <aside class="table-comms-rail panel communication-dock" aria-label="At the table" data-testid="communication-dock">
            <div data-testid="table-comms-slot"></div>
          </aside>
        </div>
        <footer class="table-dashboard-footer" data-testid="table-footer-slot"></footer>
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
        stageHandle.setSquareClickHandler((square) => {
          void onSquareSelected(square);
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
        stageHandle.setSquareClickHandler((square) => {
          void onSquareSelected(square);
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
      render();
      return;
    }
    if (start.column === square.column && start.row === square.row) {
      moveTarget = null;
      movePreviewNote = null;
      stageHandle?.setMoveTarget(null);
      render();
      return;
    }

    busy = true;
    error = null;
    moveTarget = square;
    stageHandle?.setMoveTarget(square);
    movePreviewNote = 'Moving…';
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
        return;
      }

      const commitPath = preview.path.map((step) => ({
        column: step.column,
        row: step.row,
      }));
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
      moveTarget = null;
      movePreviewNote = null;
      stageHandle?.setMoveTarget(null);
      shell.announce(
        commitPath.length <= 1
          ? 'You moved to the selected square.'
          : `You moved ${commitPath.length} squares.`,
      );
      const moveSummary =
        commitPath.length <= 1
          ? 'You moved to the selected square.'
          : `You moved ${commitPath.length} squares across the map.`;
      appendDmThread('system', 'Table', moveSummary, 'mechanics');
      await narrateIntoDmThread(moveSummary);
    } catch (failure) {
      movePreviewNote =
        failure instanceof ApiFailure ? failure.message : 'That move could not be completed.';
      if (failure instanceof ApiFailure && failure.code === 'STALE_STATE_VERSION') {
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

  async function submitRulesAction(
    commandType: string,
    fields: RulesCommandFields = {},
  ): Promise<void> {
    const setupCommand = commandType === 'encounter.begin' || commandType === 'initiative.roll';
    const endTurnCommand = commandType === 'encounter.next_turn';
    if (candidate === null || busy || tableState === null) {
      return;
    }
    if (endTurnCommand && !isOwnCombatTurn()) {
      return;
    }
    if (
      !setupCommand &&
      !endTurnCommand &&
      !holdsOwnAuthority() &&
      encounter?.status === 'active'
    ) {
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
        commandType,
        expectedStateVersion: tableState.stateVersion,
        ...(timingAuthority === null || setupCommand
          ? {}
          : { timingAuthorityId: timingAuthority.timingAuthorityId }),
        ...fields,
      });
      tableState = accepted.table;
      if (accepted.encounter !== undefined) encounter = accepted.encounter;
      if (accepted.progression !== undefined) progression = accepted.progression;
      if (
        commandType === 'initiative.roll' ||
        commandType === 'encounter.next_turn' ||
        commandType === 'combat.ready' ||
        commandType === 'combat.reaction'
      ) {
        timingAuthority = (await fetchTimingAuthority(campaignId)).authority;
      }
      shell.announce(accepted.event.summary ?? `${commandType} resolved by the server.`);
      const summary = accepted.event.summary?.trim();
      if (summary) {
        appendDmThread('system', 'Table', summary, 'mechanics');
        await narrateIntoDmThread(summary);
      }
    } catch (failure) {
      error =
        failure instanceof ApiFailure
          ? failure.message
          : 'The rules action could not be resolved.';
      if (failure instanceof ApiFailure && failure.code === 'STALE_STATE_VERSION') {
        const [tableFeed, rulesFeed] = await Promise.all([
          fetchTableState(campaignId),
          fetchRulesState(campaignId),
        ]);
        tableState = tableFeed;
        encounter = rulesFeed.encounter;
        progression = rulesFeed.progression;
      }
    } finally {
      busy = false;
      render();
    }
  }

  function bindPanelEvents(root: HTMLElement): void {
    root.querySelectorAll<HTMLButtonElement>('[data-info-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        activeInfoTab = button.dataset.infoTab as InfoTab;
        render();
      });
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
        chatMode = input.value as PartyChatMode;
        render();
      });
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
          if (candidate === null || busy || draft.trim().length === 0) {
            return;
          }
          if (chatMode === 'speak_as_character' && !seated) {
            error = 'Seat a character before using Speak as Character.';
            chatMode = 'table_talk';
            render();
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            await postPartyChat({
              candidateId: candidate.candidateId,
              campaignId,
              mode: chatMode,
              body: draft.trim(),
            });
            draft = '';
            partyChat = await fetchPartyChat(campaignId);
            shell.announce('Party Chat message sent. It did not become a command.');
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Party Chat message could not be sent.';
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
      const send = root.querySelector<HTMLButtonElement>('[data-testid="party-chat-send"]');
      send?.setAttribute(
        'aria-disabled',
        String(busy || candidate === null || draft.trim().length === 0),
      );
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
                : 'Ask the DM could not be sent.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    const nlInput = root.querySelector<HTMLTextAreaElement>('[data-testid="nl-intent-input"]');
    nlInput?.addEventListener('input', () => {
      nlIntentText = nlInput.value;
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
            intentDraft = {
              draftId: interpreted.draftId,
              source: 'action_composer_interpret',
              campaignId,
              proposedCommandType: interpreted.proposedCommandType,
              summary: interpreted.summary,
              ...(interpreted.path !== undefined ? { path: [...interpreted.path] } : {}),
              interceptState: interpreted.interceptState,
              createdAt: interpreted.createdAt,
            };
            appendDmThread('dm', directorIdentityLabel, interpreted.summary, 'ruling_hint');
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
          busy = true;
          error = null;
          appendDmThread('player', 'You', declaration, 'declaration');
          playerActionDraft = '';
          render();
          try {
            const interpreted = await interpretNaturalLanguage({
              candidateId: candidate.candidateId,
              campaignId,
              text: declaration,
              moveTarget,
            });
            intentDraft = {
              draftId: interpreted.draftId,
              source: 'action_composer_interpret',
              campaignId,
              proposedCommandType: interpreted.proposedCommandType,
              summary: interpreted.summary,
              ...(interpreted.path !== undefined ? { path: [...interpreted.path] } : {}),
              interceptState: interpreted.interceptState,
              createdAt: interpreted.createdAt,
            };
            appendDmThread('dm', directorIdentityLabel, interpreted.summary, 'ruling_hint');
            shell.announce(`${directorIdentityLabel} prepared a draft — confirm to resolve it.`);
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
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
                : `Table sync committed · version ${accepted.table.stateVersion}.`,
            );
          } catch (failure) {
            error =
              failure instanceof ApiFailure ? failure.message : 'Table sync could not be committed.';
            if (failure instanceof ApiFailure && failure.code === 'STALE_STATE_VERSION') {
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
            movePreviewNote = `Moved to column ${moveTarget.column}, row ${moveTarget.row}.`;
            shell.announce(`Move committed · version ${accepted.table.stateVersion}.`);
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
          const door = mapBundle.edges.find(
            (edge) => edge.kind === 'door' && edge.doorState !== 'open',
          );
          if (door === undefined) {
            error = 'No closed door is visible on your map projection.';
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
            shell.announce(`Door opened · version ${accepted.table.stateVersion}.`);
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
          intentDraft = {
            draftId: crypto.randomUUID(),
            source: 'action_composer_interpret',
            campaignId,
            proposedCommandType: 'table.move',
            summary: `Intent Intercept draft: move to column ${moveTarget.column}, row ${moveTarget.row}.`,
            path: [moveTarget],
            interceptState: 'awaiting_confirmation',
            createdAt: new Date().toISOString(),
          };
        } else {
          intentDraft = {
            draftId: crypto.randomUUID(),
            source: 'action_composer_interpret',
            campaignId,
            proposedCommandType: 'table.sync',
            summary: 'Intent Intercept draft: commit a table sync (no move target selected).',
            interceptState: 'awaiting_confirmation',
            createdAt: new Date().toISOString(),
          };
        }
        render();
      });

    root
      .querySelector<HTMLButtonElement>('[data-testid="cancel-intent-intercept"]')
      ?.addEventListener('click', () => {
        intentDraft = null;
        render();
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
          if (!explorationMode() && (timingAuthority === null || !holdsOwnAuthority())) {
            return;
          }
          const draft = intentDraft;
          busy = true;
          error = null;
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
            });
            tableState = accepted.table;
            mapBundle = await fetchCampaignMap(campaignId);
            const summary =
              accepted.event.summary?.trim() ||
              `${draft.proposedCommandType} committed · version ${accepted.table.stateVersion}.`;
            appendDmThread('system', 'Table', summary, 'mechanics');
            shell.announce(`Intent Intercept confirmed · ${draft.proposedCommandType}.`);
            intentDraft = null;
            await narrateIntoDmThread(summary);
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Intent Intercept could not be confirmed.';
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
    if (
      pageShell === null ||
      heading === null ||
      infoSlot === null ||
      actionSlot === null ||
      commsSlot === null ||
      footer === null
    ) {
      return;
    }

    const focused = captureFocusedField(pageShell);
    const scrollY = window.scrollY;

    const mapMeta =
      mapBundle === null
        ? 'Map projection pending.'
        : `${escapeHtml(mapBundle.title)} · ${mapBundle.coordinateSpace.columns}×${mapBundle.coordinateSpace.rows} squares · ${mapBundle.coordinateSpace.feetPerSquare} ft/square · art: ${escapeHtml(humanizeArtProvenance(mapBundle.artProvenance))}`;

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

    footer.innerHTML = `
      <details class="table-meta-panel" data-testid="presence-section">
        <summary>Table details</summary>
        <section aria-labelledby="presence-heading">
          <h2 id="presence-heading">Who is connected</h2>
          ${presenceBody()}
        </section>
        <p class="visually-hidden" data-testid="table-state-meta">
          Table state version ${tableState?.stateVersion ?? 0} · last event sequence ${tableState?.lastEventSequence ?? 0}
        </p>
        <p class="record-meta" data-testid="map-bundle-meta">${mapMeta}</p>
        ${
          mapBundle === null || mapBundle.notableFeatures.length === 0
            ? ''
            : `<ul class="record-list compact" data-testid="map-notable-features">
                ${mapBundle.notableFeatures
                  .map(
                    (feature) => `
                  <li data-testid="map-notable-feature">
                    ${escapeHtml(feature.label)} · column ${feature.column}, row ${feature.row}
                  </li>`,
                  )
                  .join('')}
              </ul>`
        }
      </details>`;

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
        onSignedIn: () => void load(),
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
    renderTable();
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
    const changed =
      options?.forceRender === true ||
      tableFeed.stateVersion !== priorVersion ||
      mapSyncFingerprint(mapFeed) !== priorMap ||
      (timingFeed.authority?.timingAuthorityId ?? null) !== priorAuthorityId ||
      (timingFeed.authority?.state ?? null) !== priorAuthorityState ||
      chatFeed.messages.length !== priorChatCount ||
      chronicleFeed.entries.length !== priorChronicleCount ||
      (memoryFeed?.updatedAt ?? null) !== priorMemoryUpdatedAt;
    if (changed) {
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
    render();
    const presentationEpochAtLoad = presentationWriteEpoch;
    try {
      const detail = await fetchCampaignDetail(campaignId);
      campaignName = detail.campaign.name;
      directorIdentityLabel = detail.campaign.director.identityLabel;
      seated = detail.ownSeat !== null;
      ownSeatId = detail.ownSeat?.seatId ?? null;
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
    } catch (failure) {
      error = failure instanceof ApiFailure ? failure.message : 'The campaign table could not load.';
      stopProjectionPoll();
    }
    render();
  }

  document.addEventListener('visibilitychange', onVisibilityRefresh);
  subscribeAccount(() => {
    void load();
  });
  void load();
}
