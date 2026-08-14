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
import { getAccount, subscribeAccount } from '../account-session.js';
import {
  ApiFailure,
  fetchCampaignDetail,
  fetchCampaignMap,
  fetchChronicle,
  fetchPartyChat,
  fetchTableState,
  postPartyChat,
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
  let seated = false;
  let draft = '';
  let busy = false;
  let error: string | null = null;
  let gateBusy = false;
  let gateError: string | null = null;
  let stageHandle: TableStageHandle | null = null;
  let stageMounting = false;
  const mountToken = beginPageMount(container);

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
    const syncDisabled = busy || candidate === null || !seated || tableState === null;
    return `
      <p data-testid="action-composer-notice">${escapeHtml(ACTION_COMPOSER_STRUCTURE.notice)}</p>
      <p class="record-meta" data-testid="table-state-meta">
        Table state version ${version} · last event sequence ${sequence}
      </p>
      ${
        seated
          ? ''
          : `<p class="record-meta" data-testid="table-sync-seat-hint">
              Seat a character you own on the campaign page before committing table syncs.
            </p>`
      }
      <div class="action-composer-controls">
        <button type="button" data-testid="commit-table-sync"
          aria-disabled="${syncDisabled}">
          ${busy ? 'Committing…' : escapeHtml(ACTION_COMPOSER_STRUCTURE.tableSyncLabel)}
        </button>
        <button type="button" aria-disabled="true" data-testid="action-composer-disabled">
          ${escapeHtml(ACTION_COMPOSER_STRUCTURE.interpretActionLabel)} (unavailable until Timing Authority)
        </button>
      </div>
      <p class="record-meta" data-testid="interpret-action-notice">
        ${escapeHtml(ACTION_COMPOSER_STRUCTURE.interpretActionNotice)}
      </p>`;
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
      .querySelector<HTMLButtonElement>('[data-testid="commit-table-sync"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy || !seated || tableState === null) return;
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
            });
            tableState = accepted.table;
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
        table sync goes through the command gateway.
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

  async function load(): Promise<void> {
    if (getAccount() === null) {
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
      const [chronicleFeed, chatFeed, tableFeed, mapFeed] = await Promise.all([
        fetchChronicle(campaignId),
        fetchPartyChat(campaignId),
        fetchTableState(campaignId),
        fetchCampaignMap(campaignId),
      ]);
      chronicle = chronicleFeed;
      partyChat = chatFeed;
      tableState = tableFeed;
      mapBundle = mapFeed;
    } catch (failure) {
      error = failure instanceof ApiFailure ? failure.message : 'The campaign table could not load.';
    }
    render();
  }

  subscribeAccount(() => {
    void load();
  });
  void load();
}
