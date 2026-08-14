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
  DOCK_TAB_LABELS,
  DOCK_TABS,
  PARTY_CHAT_MODE_LABELS,
  PARTY_CHAT_MODES,
  RULES_DESK_NOTICE,
  type DockTab,
  type PartyChatMode,
} from '../../shared/communication-contract.js';
import type { MapBundleProjection } from '../../shared/map-contract.js';
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
  fetchTableState,
  fetchTimingAuthority,
  postPartyChat,
  previewTableMove,
  submitTableCommand,
} from '../api.js';
import { bindSignedOutGate, renderSignedOutGate } from '../auth-gate.js';
import { escapeHtml } from '../dom-utils.js';
import { beginPageMount, isPageMountCurrent } from '../page-mount.js';
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
  let intentDraft: ActionDraftSuggestion | null = null;
  let seated = false;
  let moveTarget: { column: number; row: number } | null = null;
  let movePreviewNote: string | null = null;
  let draft = '';
  let busy = false;
  let error: string | null = null;
  let gateBusy = false;
  let gateError: string | null = null;
  let stageHandle: TableStageHandle | null = null;
  let stageMounting = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let pollInFlight = false;
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
    return `You hold Active Turn · expires ${timingAuthority.expiresAt}`;
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
        </div>`;
    }

    if (activeTab === 'rules_desk') {
      return `
        <div class="dock-pane" data-testid="rules-desk-pane">
          <p data-testid="rules-desk-notice">${escapeHtml(RULES_DESK_NOTICE)}</p>
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
        </form>
      </div>`;
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
      </div>
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
        <section class="table-stage-frame" aria-label="Tactical map" data-testid="table-stage-slot">
          <p class="record-meta" data-testid="table-stage-loading">Loading tactical map…</p>
        </section>
        <div data-testid="table-panels-slot"></div>
      </div>`;
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

    const input = panels.querySelector<HTMLTextAreaElement>('[data-testid="party-chat-input"]');
    input?.addEventListener('input', () => {
      draft = input.value;
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
      .querySelector<HTMLFormElement>('[data-testid="party-chat-composer"]')
      ?.addEventListener('submit', (event) => {
        event.preventDefault();
        void (async () => {
          if (candidate === null || busy) return;
          const body = input?.value.trim() ?? '';
          if (body.length === 0) return;
          busy = true;
          error = null;
          render();
          try {
            await postPartyChat({
              candidateId: candidate.candidateId,
              campaignId,
              mode: chatMode,
              body,
            });
            draft = '';
            partyChat = await fetchPartyChat(campaignId);
            shell.announce('Message sent to Party Chat.');
          } catch (failure) {
            error =
              failure instanceof ApiFailure ? failure.message : 'Party Chat message failed.';
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
    const [tableFeed, mapFeed, timingFeed] = await Promise.all([
      fetchTableState(campaignId),
      fetchCampaignMap(campaignId),
      fetchTimingAuthority(campaignId),
    ]);
    if (!isPageMountCurrent(container, mountToken)) {
      return;
    }
    const priorVersion = tableState?.stateVersion ?? -1;
    const priorMap = mapSyncFingerprint(mapBundle);
    const priorAuthorityId = timingAuthority?.timingAuthorityId ?? null;
    const priorAuthorityState = timingAuthority?.state ?? null;
    tableState = tableFeed;
    mapBundle = mapFeed;
    timingAuthority = timingFeed.authority;
    const changed =
      options?.forceRender === true ||
      tableFeed.stateVersion !== priorVersion ||
      mapSyncFingerprint(mapFeed) !== priorMap ||
      (timingFeed.authority?.timingAuthorityId ?? null) !== priorAuthorityId ||
      (timingFeed.authority?.state ?? null) !== priorAuthorityState;
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
      const [chronicleFeed, chatFeed, tableFeed, mapFeed, timingFeed] = await Promise.all([
        fetchChronicle(campaignId),
        fetchPartyChat(campaignId),
        fetchTableState(campaignId),
        fetchCampaignMap(campaignId),
        fetchTimingAuthority(campaignId),
      ]);
      chronicle = chronicleFeed;
      partyChat = chatFeed;
      tableState = tableFeed;
      mapBundle = mapFeed;
      timingAuthority = timingFeed.authority;
      startProjectionPoll();
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
