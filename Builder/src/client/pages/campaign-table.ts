/**
 * Campaign table shell: Communication Dock + structural Action Composer.
 *
 * Blueprint ownership: Sections 1.5.2.1–1.5.2.5. Phase 1 exposes real Party Chat
 * and server-authored Chronicle entries. Rules Desk and Action Composer are
 * honest structural panels without fake AI or mechanical submission.
 */

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
import { getAccount, subscribeAccount } from '../account-session.js';
import {
  ApiFailure,
  fetchCampaignDetail,
  fetchChronicle,
  fetchPartyChat,
  postPartyChat,
} from '../api.js';
import { bindSignedOutGate, renderSignedOutGate } from '../auth-gate.js';
import { escapeHtml } from '../dom-utils.js';
import { beginPageMount, isPageMountCurrent } from '../page-mount.js';
import type { PageHost } from './home.js';

export function mountCampaignTablePage(host: PageHost, campaignId: string): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Campaign table');

  let campaignName = 'Campaign';
  let activeTab: DockTab = 'chronicle';
  let chatMode: PartyChatMode = 'table_talk';
  let chronicle: ChronicleFeedProjection | null = null;
  let partyChat: PartyChatFeedProjection | null = null;
  let draft = '';
  let busy = false;
  let error: string | null = null;
  let gateBusy = false;
  let gateError: string | null = null;
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

  function renderTable(): void {
    container.innerHTML = `
      <div class="page page-wide">
        <h1 data-testid="campaign-table-heading">${escapeHtml(campaignName)}</h1>
        <p class="tagline">
          Communication Dock and Action Composer structure for this campaign. No AI narration or
          tactical commands in Phase 1.
        </p>
        ${
          error === null
            ? ''
            : `<div class="message error" role="alert" data-testid="table-error">${escapeHtml(error)}</div>`
        }

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
          <p data-testid="action-composer-notice">${escapeHtml(ACTION_COMPOSER_STRUCTURE.notice)}</p>
          <button type="button" aria-disabled="true" data-testid="action-composer-disabled">
            Interpret Action (unavailable in Phase 1)
          </button>
        </section>

        <p>
          <a href="/campaigns/${escapeHtml(campaignId)}" data-link data-testid="table-back">Back to campaign</a>
          ·
          <a href="/campaigns/${escapeHtml(campaignId)}/settings" data-link data-testid="table-settings">Campaign settings</a>
        </p>
      </div>`;

    container.querySelectorAll<HTMLButtonElement>('[data-dock-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        activeTab = button.dataset.dockTab as DockTab;
        render();
      });
    });

    container.querySelectorAll<HTMLInputElement>('input[name="chat-mode"]').forEach((input) => {
      input.addEventListener('change', () => {
        chatMode = input.value as PartyChatMode;
        render();
      });
    });

    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="party-chat-input"]');
    input?.addEventListener('input', () => {
      draft = input.value;
    });

    container
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
  }

  function render(): void {
    if (!isPageMountCurrent(container, mountToken)) return;
    if (getAccount() === null) {
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
      shell.setDocumentTitle(`Table · ${campaignName}`);
      const [chronicleFeed, chatFeed] = await Promise.all([
        fetchChronicle(campaignId),
        fetchPartyChat(campaignId),
      ]);
      chronicle = chronicleFeed;
      partyChat = chatFeed;
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
