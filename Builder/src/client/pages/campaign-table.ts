/**
 * Campaign table shell: map stage, Communication Dock, and Action Composer.
 *
 * Blueprint ownership: Sections 1.5.2.1–1.5.2.5 and Phase 2 map/Pixi stage.
 * Party Chat stays social-only. Table sync uses the command gateway.
 * The Pixi stage renders only server map projections (Section 1.10.9).
 */

import type { TableStateProjection } from '../../shared/command-contract.js';
import type { ChronicleFeedProjection, PartyChatFeedProjection } from '../../shared/communication-contract.js';
import {
  ACTION_COMPOSER_STRUCTURE,
  DIRECTOR_ADDRESS_NOTICE,
  DOCK_TAB_LABELS,
  DOCK_TABS,
  PARTY_CHAT_MODE_LABELS,
  PARTY_CHAT_MODES,
  RULES_DESK_NOTICE,
  type DockTab,
  type PartyChatMode,
} from '../../shared/communication-contract.js';
import type { CampaignPresenceProjection } from '../../shared/presence-contract.js';
import { PRESENCE_HEARTBEAT_INTERVAL_MS } from '../../shared/presence-contract.js';
import type { MapBundleProjection } from '../../shared/map-contract.js';
import type {
  CharacterProgressionProjection,
  EncounterProjection,
  RuleExplanationProjection,
  RulesCommandFields,
} from '../../shared/rules-combat-contract.js';
import type {
  ActionDraftSuggestion,
  TimingAuthorityProjection,
} from '../../shared/timing-authority-contract.js';
import { getAccount, subscribeAccount } from '../account-session.js';
import {
  ApiFailure,
  claimTimingAuthority,
  endTimingAuthority,
  fetchCampaignDetail,
  fetchCampaignMap,
  fetchChronicle,
  fetchPartyChat,
  fetchPlayerSettings,
  fetchRuleExplanation,
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
import { escapeHtml } from '../dom-utils.js';
import { beginPageMount, isPageMountCurrent } from '../page-mount.js';
import { applyPresentationPreferences } from '../presentation-preferences.js';
import { mountTableStage, type TableStageHandle } from '../table/table-stage.js';
import type { PageHost } from './home.js';

export function mountCampaignTablePage(host: PageHost, campaignId: string): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Campaign table');

  let campaignName = 'Campaign';
  let activeTab: DockTab = 'chronicle';
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
  let selectedRuleId = 'combat.attack';
  let ruleExplanation: RuleExplanationProjection | null = null;
  let intentDraft: ActionDraftSuggestion | null = null;
  let reducedMotion = false;
  let lowEffects = false;
  let textToSpeechEnabled = false;
  let speechToTextEnabled = false;
  let seated = false;
  let moveTarget: { column: number; row: number } | null = null;
  let movePreviewNote: string | null = null;
  let draft = '';
  let directorDraft = '';
  let directorReply: string | null = null;
  let nlIntentText = '';
  let presence: CampaignPresenceProjection | null = null;
  let lastNarration: string | null = null;
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
    return `${tokens}#${doors}#${map.exploredSquareIds.join(',')}#${map.visibleSquareIds.join(',')}`;
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
    if (timingAuthority === null) {
      return 'No Active Turn Authority on this campaign.';
    }
    if (timingAuthority.timingAuthorityId === 'held-by-other') {
      return 'Another seat holds Active Turn Authority.';
    }
    const label =
      timingAuthority.opportunityClass === 'active_turn'
        ? 'Active Turn'
        : timingAuthority.opportunityClass === 'reaction'
          ? 'Reaction'
          : 'Decision Window';
    return `You hold ${label} · expires ${timingAuthority.expiresAt}`;
  }

  function presentationMeta(): string {
    const motion = reducedMotion ? 'reduced motion on' : 'reduced motion off';
    const effects = lowEffects ? 'low effects on' : 'low effects off';
    const tts = textToSpeechEnabled ? 'TTS on' : 'TTS off';
    const stt = speechToTextEnabled ? 'STT on' : 'STT off';
    return `Table presentation: ${motion} · ${effects} · ${tts} · ${stt}.`;
  }

  function presenceBody(): string {
    if (presence === null) {
      return '<p class="record-meta" data-testid="presence-empty">Presence not yet heartbeated.</p>';
    }
    const rows = presence.devices
      .map(
        (device) => `
        <li data-testid="presence-device">
          <strong>${escapeHtml(device.displayLabel)}</strong>
          · ${escapeHtml(device.status)}
          <span class="record-meta">${escapeHtml(device.deviceSessionId.slice(0, 8))}… · tab ${escapeHtml(device.tabId.slice(0, 8))}…</span>
        </li>`,
      )
      .join('');
    return `
      <div data-testid="presence-panel">
        <p class="record-meta" data-testid="presence-meta">
          Presence v${presence.stateVersion} · online ${presence.onlineAccountIds.length} · grace ${presence.graceAccountIds.length}
        </p>
        <ul class="record-list" data-testid="presence-list">${rows || '<li>No devices yet.</li>'}</ul>
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
                      <span class="record-meta">${escapeHtml(entry.kind)} · ${escapeHtml(entry.createdAt)}</span>
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
      return `
        <div class="dock-pane" data-testid="rules-desk-pane">
          <p data-testid="rules-desk-notice">${escapeHtml(RULES_DESK_NOTICE)}</p>
          <label class="field">
            <span>Structured rule</span>
            <select data-testid="rules-desk-rule">
              ${[
                ['combat.attack', 'Attack rolls'],
                ['combat.action-economy', 'Action economy'],
                ['combat.death-saves', 'Death Saving Throws'],
                ['combat.reactions', 'Reactions and Ready'],
                ['combat.rests', 'Short and Long Rests'],
                ['spell.areas', 'Three-dimensional areas'],
                ['spell.concentration', 'Concentration'],
                ['progression.xp', 'XP-only progression'],
                ['condition.prone', 'Prone condition'],
                ['condition.unconscious', 'Unconscious condition'],
              ]
                .map(
                  ([id, label]) =>
                    `<option value="${id}" ${selectedRuleId === id ? 'selected' : ''}>${escapeHtml(label!)}</option>`,
                )
                .join('')}
            </select>
          </label>
          <button type="button" data-testid="rules-desk-explain" aria-disabled="${busy}">
            Explain rule
          </button>
          ${
            ruleExplanation === null
              ? '<p class="record-meta">Choose a rule for a read-only explanation from structured data.</p>'
              : `<article class="rules-explanation" data-testid="rules-explanation">
                  <h3>${escapeHtml(ruleExplanation.title)}</h3>
                  <p>${escapeHtml(ruleExplanation.summary)}</p>
                  <ol>${ruleExplanation.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
                  <p class="record-meta">${escapeHtml(ruleExplanation.ruleId)} · ${escapeHtml(ruleExplanation.source)}</p>
                </article>`
          }
        </div>`;
    }

    if (activeTab === 'director_address') {
      return `
        <div class="dock-pane" data-testid="director-address-pane">
          <p data-testid="director-address-notice">${escapeHtml(DIRECTOR_ADDRESS_NOTICE)}</p>
          ${
            directorReply === null
              ? ''
              : `<article class="rules-explanation" data-testid="director-address-reply">
                  <h3>Director reply</h3>
                  <p>${escapeHtml(directorReply)}</p>
                </article>`
          }
          <form class="dock-composer" data-testid="director-address-composer">
            <label class="field">
              <span>Private question to the Director</span>
              <textarea data-testid="director-address-input" rows="3">${escapeHtml(directorDraft)}</textarea>
            </label>
            <button type="submit" data-testid="director-address-send" aria-disabled="${busy || candidate === null}">
              ${busy ? 'Sending…' : 'Address the Director'}
            </button>
          </form>
        </div>`;
    }

    const messages = partyChat?.messages ?? [];
    return `
      <div class="dock-pane" data-testid="party-chat-pane">
        ${
          messages.length === 0
            ? '<p class="empty-state" data-testid="party-chat-empty">No Party Chat messages yet.</p>'
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
                    <span class="record-meta">${escapeHtml(message.createdAt)}</span>
                  </li>`,
                  )
                  .join('')}
              </ul>`
        }
        <form class="dock-composer" data-testid="party-chat-composer">
          <fieldset class="option-list compact">
            <legend>Before send</legend>
            ${PARTY_CHAT_MODES.map(
              (mode) => `
              <label class="option${chatMode === mode ? ' selected' : ''}">
                <input type="radio" name="chat-mode" value="${mode}"
                  ${chatMode === mode ? 'checked' : ''} data-testid="chat-mode-${mode}" />
                <span class="option-label">${escapeHtml(PARTY_CHAT_MODE_LABELS[mode])}</span>
              </label>`,
            ).join('')}
          </fieldset>
          <p class="record-meta" data-testid="chat-send-clarity">
            This text becomes ${escapeHtml(PARTY_CHAT_MODE_LABELS[chatMode])} for campaign members.
            It cannot spend resources, open objects, or become a mechanical action.
          </p>
          <label class="field">
            <span>Message</span>
            <textarea data-testid="party-chat-input" rows="3">${escapeHtml(draft)}</textarea>
          </label>
          <button type="submit" data-testid="party-chat-send" aria-disabled="${busy || candidate === null}">
            ${busy ? 'Sending…' : 'Send to Party Chat'}
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
    const ownCombatant =
      encounter?.combatants.find((combatant) => combatant.seatId !== null) ?? null;
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
      encounter.activeCombatantId === ownCombatant?.combatantId;
    const actionAvailable = ownTurn && ownCombatant?.actionEconomy.actionAvailable === true;
    const deathSaveAvailable =
      ownTurn &&
      ownCombatant?.currentHitPoints === 0 &&
      ownCombatant.deathSaves.dead !== true &&
      ownCombatant.deathSaves.stable !== true &&
      ownCombatant.actionEconomy.deathSaveAvailable === true;
    const longRestAvailable =
      ownTurn &&
      ownCombatant?.deathSaves.dead !== true &&
      (actionAvailable || ownCombatant?.currentHitPoints === 0);
    const openWindow = encounter?.decisionWindows.find(
      (window) =>
        window.state === 'open' &&
        window.eligibleCombatantId === ownCombatant?.combatantId,
    );
    const authorityReady = holdsOwnAuthority();
    const disable = busy || tableState === null || !authorityReady;
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
            aria-disabled="${disable || encounter !== null}">Begin encounter</button>
          <button type="button" data-rules-command="initiative.roll" data-testid="roll-initiative"
            aria-disabled="${disable || encounter?.status !== 'setup'}">Roll initiative</button>
          <button type="button" data-rules-command="encounter.next_turn" data-testid="next-encounter-turn"
            aria-disabled="${disable || encounter?.status !== 'active'}">Next turn</button>
          <button type="button" data-rules-command="combat.attack" data-testid="rules-attack"
            aria-disabled="${disable || !actionAvailable || selectedCombatantId === null}">Attack selected</button>
          <button type="button" data-rules-command="combat.cast_spell" data-testid="rules-cast-spell"
            aria-disabled="${disable || !actionAvailable || availableSpells.length === 0}">Cast spell</button>
          <button type="button" data-rules-command="combat.ready" data-testid="rules-ready"
            aria-disabled="${disable || !actionAvailable}">Ready opportunity attack</button>
          <button type="button" data-rules-command="combat.reaction" data-testid="rules-reaction"
            aria-disabled="${disable || openWindow === undefined}">Spend Reaction</button>
          <button type="button" data-rules-command="inventory.use_item" data-testid="rules-use-potion"
            aria-disabled="${disable || !actionAvailable}">Use healing potion</button>
          <button type="button" data-rules-command="combat.death_save" data-testid="rules-death-save"
            aria-disabled="${disable || !deathSaveAvailable}">Death Save</button>
          <button type="button" data-rules-command="combat.training_drop" data-testid="rules-training-drop"
            aria-disabled="${disable || !actionAvailable || ownCombatant?.currentHitPoints === 0}">Training: drop to 0 HP</button>
          <button type="button" data-rules-command="combat.short_rest" data-testid="rules-short-rest"
            aria-disabled="${disable || !actionAvailable}">Short Rest</button>
          <button type="button" data-rules-command="combat.long_rest" data-testid="rules-long-rest"
            aria-disabled="${disable || !longRestAvailable}">Long Rest</button>
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

  function actionComposerBody(): string {
    const version = tableState?.stateVersion ?? 0;
    const sequence = tableState?.lastEventSequence ?? 0;
    const ownAuthority = holdsOwnAuthority();
    const syncDisabled = busy || candidate === null || !seated || tableState === null || !ownAuthority;
    const interpretDisabled = busy || candidate === null || !seated || !ownAuthority;
    return `
      <p data-testid="action-composer-notice">${escapeHtml(ACTION_COMPOSER_STRUCTURE.notice)}</p>
      <p class="record-meta" data-testid="table-state-meta">
        Table state version ${version} · last event sequence ${sequence}
      </p>
      <p class="record-meta" data-testid="timing-authority-meta">${escapeHtml(authorityMeta())}</p>
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
      </div>
      ${
        seated
          ? ''
          : `<p class="record-meta" data-testid="table-sync-seat-hint">
              Seat a character you own on the campaign page before claiming Active Turn.
            </p>`
      }
      <div class="action-composer-controls">
        <button type="button" data-testid="claim-active-turn"
          aria-disabled="${busy || candidate === null || !seated}">
          ${busy ? 'Working…' : 'Claim Active Turn'}
        </button>
        <button type="button" data-testid="end-active-turn"
          aria-disabled="${busy || candidate === null || !ownAuthority}">
          End Active Turn
        </button>
        <button type="button" data-testid="commit-table-sync"
          aria-disabled="${syncDisabled}">
          ${busy ? 'Committing…' : escapeHtml(ACTION_COMPOSER_STRUCTURE.tableSyncLabel)}
        </button>
        <button type="button" data-testid="commit-table-move"
          aria-disabled="${syncDisabled || moveTarget === null}">
          ${busy ? 'Moving…' : 'Commit move'}
        </button>
        <button type="button" data-testid="open-adjacent-door"
          aria-disabled="${syncDisabled}">
          Open adjacent door
        </button>
        <button type="button" data-testid="interpret-action"
          aria-disabled="${interpretDisabled}">
          ${escapeHtml(ACTION_COMPOSER_STRUCTURE.interpretActionLabel)}
        </button>
        <button type="button" data-testid="request-narration"
          aria-disabled="${busy || candidate === null || !seated}">
          Request Director narration
        </button>
      </div>
      <label class="field">
        <span>Natural-language intent (Intent Intercept via Director gateway)</span>
        <textarea data-testid="nl-intent-input" rows="2">${escapeHtml(nlIntentText)}</textarea>
      </label>
      <button type="button" data-testid="interpret-nl-intent"
        aria-disabled="${interpretDisabled}">
        Interpret natural language
      </button>
      <p class="record-meta" data-testid="move-target-meta">
        ${
          moveTarget === null
            ? 'Click a known map square to set a one-step move destination.'
            : `Move target: column ${moveTarget.column}, row ${moveTarget.row}${movePreviewNote ? ` · ${escapeHtml(movePreviewNote)}` : ''}`
        }
      </p>
      ${
        intentDraft === null
          ? `<p class="record-meta" data-testid="interpret-action-notice">
              ${escapeHtml(ACTION_COMPOSER_STRUCTURE.interpretActionNotice)}
            </p>`
          : `<div class="intent-intercept" data-testid="intent-intercept">
              <p data-testid="intent-intercept-summary">${escapeHtml(intentDraft.summary)}</p>
              <p class="record-meta">State: ${escapeHtml(intentDraft.interceptState)} · draft ${escapeHtml(intentDraft.draftId)}</p>
              <div class="action-composer-controls">
                <button type="button" data-testid="confirm-intent-intercept"
                  aria-disabled="${busy || !ownAuthority}">Confirm Intent Intercept</button>
                <button type="button" data-testid="cancel-intent-intercept"
                  aria-disabled="${busy}">Cancel draft</button>
              </div>
            </div>`
      }`;
  }

  function ensurePageShell(): void {
    if (container.querySelector('[data-testid="table-page-shell"]')) {
      return;
    }
    container.innerHTML = `
      <div class="page page-wide" data-testid="table-page-shell">
        <div data-testid="table-heading-slot"></div>
        <section class="table-stage-frame${lowEffects || reducedMotion ? ' table-stage-low-effects' : ''}" aria-label="Tactical map" data-testid="table-stage-slot">
          <p class="record-meta" data-testid="table-stage-loading">Loading tactical map…</p>
        </section>
        <div data-testid="table-panels-slot"></div>
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
    if (stageHandle !== null && slot.querySelector('[data-testid="table-stage-canvas"]')) {
      if (mapBundle !== null) {
        stageHandle.renderMap(mapBundle);
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
    if (candidate === null || !seated) {
      movePreviewNote = 'Seat a character before choosing a move target.';
      moveTarget = square;
      render();
      return;
    }
    moveTarget = square;
    movePreviewNote = 'Checking path…';
    render();
    try {
      const preview = await previewTableMove({
        candidateId: candidate.candidateId,
        campaignId,
        path: [square],
      });
      movePreviewNote = preview.legal
        ? `Legal · ${preview.totalCostFeet} ft · ${preview.remainingBudgetFeet} ft remain`
        : preview.rejectionMessage ?? 'Illegal path';
    } catch (failure) {
      movePreviewNote =
        failure instanceof ApiFailure ? failure.message : 'Move preview failed.';
    }
    render();
  }

  async function submitRulesAction(
    commandType: string,
    fields: RulesCommandFields = {},
  ): Promise<void> {
    if (
      candidate === null ||
      busy ||
      tableState === null ||
      timingAuthority === null ||
      !holdsOwnAuthority()
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
        timingAuthorityId: timingAuthority.timingAuthorityId,
        ...fields,
      });
      tableState = accepted.table;
      if (accepted.encounter !== undefined) encounter = accepted.encounter;
      if (accepted.progression !== undefined) progression = accepted.progression;
      if (commandType === 'combat.ready' || commandType === 'combat.reaction') {
        timingAuthority = (await fetchTimingAuthority(campaignId)).authority;
      }
      shell.announce(accepted.event.summary ?? `${commandType} resolved by the server.`);
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

  function bindPanelEvents(panels: HTMLElement): void {
    panels.querySelectorAll<HTMLButtonElement>('[data-dock-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        activeTab = button.dataset.dockTab as DockTab;
        render();
      });
    });

    panels.querySelectorAll<HTMLInputElement>('input[name="chat-mode"]').forEach((input) => {
      input.addEventListener('change', () => {
        chatMode = input.value as PartyChatMode;
        render();
      });
    });

    panels
      .querySelector<HTMLSelectElement>('[data-testid="rules-desk-rule"]')
      ?.addEventListener('change', (event) => {
        if (event.target instanceof HTMLSelectElement) {
          selectedRuleId = event.target.value;
        }
      });

    panels
      .querySelector<HTMLButtonElement>('[data-testid="rules-desk-explain"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (busy) return;
          busy = true;
          error = null;
          render();
          try {
            ruleExplanation = await fetchRuleExplanation(selectedRuleId);
            shell.announce(`${ruleExplanation.title} explanation loaded from structured rules.`);
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'The structured rule explanation could not be loaded.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    panels
      .querySelector<HTMLSelectElement>('[data-testid="rules-target"]')
      ?.addEventListener('change', (event) => {
        if (event.target instanceof HTMLSelectElement) {
          selectedCombatantId = event.target.value;
        }
      });

    panels
      .querySelector<HTMLSelectElement>('[data-testid="rules-spell"]')
      ?.addEventListener('change', (event) => {
        if (event.target instanceof HTMLSelectElement) {
          selectedSpellId = event.target.value;
        }
      });

    panels.querySelectorAll<HTMLButtonElement>('[data-rules-command]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.getAttribute('aria-disabled') === 'true') return;
        const commandType = button.dataset.rulesCommand;
        if (commandType === undefined) return;
        const ownCombatant =
          encounter?.combatants.find((combatant) => combatant.seatId !== null) ?? null;
        const window = encounter?.decisionWindows.find(
          (entry) =>
            entry.state === 'open' &&
            entry.eligibleCombatantId === ownCombatant?.combatantId,
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
                            column: moveTarget?.column ?? ownCombatant?.position.column ?? 1,
                            row: moveTarget?.row ?? ownCombatant?.position.row ?? 1,
                            elevationFeet: ownCombatant?.position.elevationFeet ?? 0,
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
                          ...(ownCombatant === null
                            ? {}
                            : { targetCombatantId: ownCombatant.combatantId }),
                        }
                      : {};
        void submitRulesAction(commandType, fields);
      });
    });

    panels
      .querySelector<HTMLFormElement>('[data-testid="party-chat-composer"]')
      ?.addEventListener('submit', (event) => {
        event.preventDefault();
        void (async () => {
          if (candidate === null || busy || draft.trim().length === 0) {
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

    panels
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

    const input = panels.querySelector<HTMLTextAreaElement>('[data-testid="party-chat-input"]');
    input?.addEventListener('input', () => {
      draft = input.value;
    });

    const directorInput = panels.querySelector<HTMLTextAreaElement>(
      '[data-testid="director-address-input"]',
    );
    directorInput?.addEventListener('input', () => {
      directorDraft = directorInput.value;
    });

    panels
      .querySelector<HTMLFormElement>('[data-testid="director-address-composer"]')
      ?.addEventListener('submit', (event) => {
        event.preventDefault();
        void (async () => {
          if (candidate === null || busy || directorDraft.trim().length === 0) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            const answered = await postDirectorAddress({
              candidateId: candidate.candidateId,
              campaignId,
              body: directorDraft.trim(),
            });
            directorReply = answered.body;
            directorDraft = '';
            if (textToSpeechEnabled && 'speechSynthesis' in window) {
              const utterance = new SpeechSynthesisUtterance(answered.body);
              window.speechSynthesis.speak(utterance);
            }
            shell.announce('Director Address reply received. No table state changed.');
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Director Address could not be sent.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    const nlInput = panels.querySelector<HTMLTextAreaElement>('[data-testid="nl-intent-input"]');
    nlInput?.addEventListener('input', () => {
      nlIntentText = nlInput.value;
    });

    panels
      .querySelector<HTMLButtonElement>('[data-testid="interpret-nl-intent"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (
            candidate === null ||
            busy ||
            !holdsOwnAuthority() ||
            nlIntentText.trim().length === 0
          ) {
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

    panels
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
                tableState === null
                  ? 'The table is quiet.'
                  : `Table state version ${tableState.stateVersion} is visible to seated players.`,
            });
            lastNarration = narration.body;
            activeTab = 'chronicle';
            if (textToSpeechEnabled && 'speechSynthesis' in window) {
              const utterance = new SpeechSynthesisUtterance(narration.body);
              window.speechSynthesis.speak(utterance);
            }
            shell.announce('Director narration delivered mechanics-first.');
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

    panels
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

    panels
      .querySelector<HTMLInputElement>('[data-testid="table-reduced-motion"]')
      ?.addEventListener('change', (event) => {
        void (async () => {
          if (candidate === null || busy || !(event.target instanceof HTMLInputElement)) {
            return;
          }
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

    panels
      .querySelector<HTMLInputElement>('[data-testid="table-low-effects"]')
      ?.addEventListener('change', (event) => {
        void (async () => {
          if (candidate === null || busy || !(event.target instanceof HTMLInputElement)) {
            return;
          }
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

    panels
      .querySelector<HTMLButtonElement>('[data-testid="claim-active-turn"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy || !seated) return;
          busy = true;
          error = null;
          render();
          try {
            const claimed = await claimTimingAuthority({
              candidateId: candidate.candidateId,
              campaignId,
            });
            timingAuthority = claimed.authority;
            intentDraft = null;
            shell.announce('Active Turn Authority claimed.');
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Active Turn could not be claimed.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    panels
      .querySelector<HTMLButtonElement>('[data-testid="end-active-turn"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy || !holdsOwnAuthority() || timingAuthority === null) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            await endTimingAuthority({
              candidateId: candidate.candidateId,
              campaignId,
              timingAuthorityId: timingAuthority.timingAuthorityId,
            });
            timingAuthority = null;
            intentDraft = null;
            shell.announce('Active Turn ended.');
          } catch (failure) {
            error =
              failure instanceof ApiFailure ? failure.message : 'Active Turn could not be ended.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    panels
      .querySelector<HTMLButtonElement>('[data-testid="commit-table-sync"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (
            candidate === null ||
            busy ||
            !seated ||
            tableState === null ||
            !holdsOwnAuthority() ||
            timingAuthority === null
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
              commandType: 'table.sync',
              expectedStateVersion: tableState.stateVersion,
              timingAuthorityId: timingAuthority.timingAuthorityId,
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

    panels
      .querySelector<HTMLButtonElement>('[data-testid="commit-table-move"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (
            candidate === null ||
            busy ||
            !seated ||
            tableState === null ||
            moveTarget === null ||
            !holdsOwnAuthority() ||
            timingAuthority === null
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
              timingAuthorityId: timingAuthority.timingAuthorityId,
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

    panels
      .querySelector<HTMLButtonElement>('[data-testid="open-adjacent-door"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (
            candidate === null ||
            busy ||
            !seated ||
            tableState === null ||
            mapBundle === null ||
            !holdsOwnAuthority() ||
            timingAuthority === null
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
              timingAuthorityId: timingAuthority.timingAuthorityId,
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

    panels
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

    panels
      .querySelector<HTMLButtonElement>('[data-testid="cancel-intent-intercept"]')
      ?.addEventListener('click', () => {
        intentDraft = null;
        render();
      });

    panels
      .querySelector<HTMLButtonElement>('[data-testid="confirm-intent-intercept"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (
            candidate === null ||
            busy ||
            intentDraft === null ||
            tableState === null ||
            !holdsOwnAuthority() ||
            timingAuthority === null
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
              commandType: intentDraft.proposedCommandType,
              expectedStateVersion: tableState.stateVersion,
              timingAuthorityId: timingAuthority.timingAuthorityId,
              ...(intentDraft.path !== undefined ? { path: intentDraft.path } : {}),
              ...(intentDraft.edgeId !== undefined ? { edgeId: intentDraft.edgeId } : {}),
            });
            tableState = accepted.table;
            mapBundle = await fetchCampaignMap(campaignId);
            intentDraft = { ...intentDraft, interceptState: 'confirmed' };
            shell.announce(
              `Intent Intercept confirmed · ${intentDraft.proposedCommandType} · version ${accepted.table.stateVersion}.`,
            );
            intentDraft = null;
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

  function renderTable(): void {
    ensurePageShell();
    const heading = container.querySelector<HTMLElement>('[data-testid="table-heading-slot"]');
    const panels = container.querySelector<HTMLElement>('[data-testid="table-panels-slot"]');
    if (heading === null || panels === null) {
      return;
    }

    const mapMeta =
      mapBundle === null
        ? 'Map projection pending.'
        : `${escapeHtml(mapBundle.title)} · ${mapBundle.coordinateSpace.columns}×${mapBundle.coordinateSpace.rows} squares · ${mapBundle.coordinateSpace.feetPerSquare} ft/square · art: procedural local placeholder`;

    heading.innerHTML = `
      <h1 data-testid="campaign-table-heading">${escapeHtml(campaignName)}</h1>
      <p class="tagline">
        Tactical map stage, Communication Dock, and Action Composer. Party Chat stays social;
        table sync goes through the command gateway. This client polls shared table projections
        so a second local seat can recover the same state.
      </p>
      <p class="record-meta" data-testid="map-bundle-meta">${mapMeta}</p>
      ${
        error === null
          ? ''
          : `<div class="message error" role="alert" data-testid="table-error">${escapeHtml(error)}</div>`
      }`;

    panels.innerHTML = `
      <section class="panel" aria-labelledby="presence-heading" data-testid="presence-section">
        <h2 id="presence-heading">Table presence</h2>
        ${presenceBody()}
      </section>

      <section class="panel communication-dock" aria-label="Communication Dock" data-testid="communication-dock">
        <div class="dock-tabs" role="tablist" aria-label="Dock destinations">
          ${DOCK_TABS.map(
            (tab) => `
            <button type="button" role="tab" class="dock-tab${activeTab === tab ? ' active' : ''}"
              aria-selected="${activeTab === tab}" data-testid="dock-tab-${tab}" data-dock-tab="${tab}">
              ${escapeHtml(DOCK_TAB_LABELS[tab])}
            </button>`,
          ).join('')}
        </div>
        <div class="dock-viewport" role="tabpanel">
          ${dockBody()}
        </div>
      </section>

      <section class="panel action-composer" aria-labelledby="action-composer-heading" data-testid="action-composer">
        <h2 id="action-composer-heading">${escapeHtml(ACTION_COMPOSER_STRUCTURE.heading)}</h2>
        ${actionComposerBody()}
      </section>

      <p>
        <a href="/campaigns/${escapeHtml(campaignId)}" data-link data-testid="table-back">Back to campaign</a>
        ·
        <a href="/campaigns/${escapeHtml(campaignId)}/settings" data-link data-testid="table-settings">Campaign settings</a>
      </p>`;

    bindPanelEvents(panels);
    syncStageFrameEffects();
    void ensureStage();
  }

  function render(): void {
    if (!isPageMountCurrent(container, mountToken)) return;
    if (getAccount() === null) {
      stopProjectionPoll();
      stageHandle?.destroy();
      stageHandle = null;
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
    const [tableFeed, mapFeed, timingFeed, rulesFeed, chatFeed, chronicleFeed] = await Promise.all([
      fetchTableState(campaignId),
      fetchCampaignMap(campaignId),
      fetchTimingAuthority(campaignId),
      seated ? fetchRulesState(campaignId) : Promise.resolve(null),
      fetchPartyChat(campaignId),
      fetchChronicle(campaignId),
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
    tableState = tableFeed;
    mapBundle = mapFeed;
    timingAuthority = timingFeed.authority;
    partyChat = chatFeed;
    chronicle = chronicleFeed;
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
      chronicleFeed.entries.length !== priorChronicleCount;
    if (changed) {
      render();
    } else if (mapBundle !== null && stageHandle !== null) {
      stageHandle.renderMap(mapBundle);
    }
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
      void sendPresenceHeartbeat()
        .then(() => {
          render();
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
    render();
    try {
      const detail = await fetchCampaignDetail(campaignId);
      campaignName = detail.campaign.name;
      seated = detail.ownSeat !== null;
      shell.setDocumentTitle(`Table · ${campaignName}`);
      const [chronicleFeed, chatFeed, tableFeed, mapFeed, timingFeed, presentation, rulesFeed] =
        await Promise.all([
          fetchChronicle(campaignId),
          fetchPartyChat(campaignId),
          fetchTableState(campaignId),
          fetchCampaignMap(campaignId),
          fetchTimingAuthority(campaignId),
          fetchPlayerSettings(),
          seated ? fetchRulesState(campaignId) : Promise.resolve(null),
        ]);
      chronicle = chronicleFeed;
      partyChat = chatFeed;
      tableState = tableFeed;
      mapBundle = mapFeed;
      timingAuthority = timingFeed.authority;
      encounter = rulesFeed?.encounter ?? null;
      progression = rulesFeed?.progression ?? null;
      reducedMotion = presentation.reducedMotion;
      lowEffects = presentation.lowEffects;
      textToSpeechEnabled = presentation.reserved.textToSpeechEnabled;
      speechToTextEnabled = presentation.reserved.speechToTextEnabled;
      applyPresentationPreferences({ reducedMotion, lowEffects });
      startProjectionPoll();
      try {
        await sendPresenceHeartbeat();
      } catch {
        // Presence soft-fails on first load.
      }
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
