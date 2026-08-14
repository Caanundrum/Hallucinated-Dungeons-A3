/**
 * Campaign detail: locked Director configuration, invitations, membership, seats.
 *
 * Blueprint ownership: Sections 1.5.21 (Director lock), 7.6 (invitations),
 * 7.7.2 (seats). Phase 1 proves membership and ownership persistence — not the
 * live AI table.
 */

import type { CampaignDetailProjection } from '../../shared/campaign-contract.js';
import { getAccount, subscribeAccount } from '../account-session.js';
import {
  ApiFailure,
  createCampaignInvitation,
  createCampaignSeat,
  fetchCampaignDetail,
  revokeCampaignInvitation,
} from '../api.js';
import { bindSignedOutGate, renderSignedOutGate } from '../auth-gate.js';
import { escapeHtml } from '../dom-utils.js';
import { beginPageMount, isPageMountCurrent } from '../page-mount.js';
import type { PageHost } from './home.js';

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function mountCampaignDetailPage(host: PageHost, campaignId: string): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Campaign');

  let detail: CampaignDetailProjection | null = null;
  let error: string | null = null;
  let unavailable = false;
  let busy = false;
  const seatCharacterFromQuery = new URLSearchParams(window.location.search).get('seatCharacter');
  let selectedCharacterId: string | null =
    seatCharacterFromQuery !== null && /^[A-Za-z0-9-]{1,64}$/.test(seatCharacterFromQuery)
      ? seatCharacterFromQuery
      : null;
  let copyFeedback: string | null = null;
  let gateBusy = false;
  let gateError: string | null = null;
  const mountToken = beginPageMount(container);

  function renderSignedIn(): void {
    if (unavailable || detail === null) {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="campaign-detail-heading">Campaign unavailable</h1>
          <p class="tagline">
            This campaign is not available for your account. Foreign campaigns look the same as
            missing ones.
          </p>
          ${
            error === null
              ? ''
              : `<div class="message error" role="alert" tabindex="-1" data-testid="campaign-detail-error">${escapeHtml(error)}</div>`
          }
          <p><a href="/campaigns" data-link data-testid="back-to-campaigns">Back to campaigns</a></p>
        </div>`;
      return;
    }

    const { campaign, members, seats, openInvitation, ownSeat, ownCharacters } = detail;
    const invitePath =
      openInvitation === null
        ? null
        : `${window.location.origin}${openInvitation.invitePath}`;

    const nextStep =
      ownSeat === null
        ? campaign.isCampaignOwner
          ? 'Next: seat a character you own, then share an invite link with a second Local Arena account.'
          : 'Next: seat a character you own to finish joining this table’s membership proof.'
        : campaign.isCampaignOwner && members.length < 2
          ? 'Next: share the invite link so a second development account can join and seat their own character.'
          : 'Membership and seating are recorded. This Phase 1 build proves ownership continuity; the live tactical table is a later phase.';

    container.innerHTML = `
      <div class="page">
        <h1 data-testid="campaign-detail-heading">${escapeHtml(campaign.name)}</h1>
        <p class="tagline">
          ${
            campaign.summary.length === 0
              ? 'Campaign membership and seats for the Local Arena.'
              : escapeHtml(campaign.summary)
          }
        </p>
        <p class="message notice" data-testid="campaign-next-step">${escapeHtml(nextStep)}</p>
        <div class="actions">
          <a href="/campaigns/${escapeHtml(campaignId)}/settings" data-link data-testid="open-campaign-settings">Campaign settings</a>
          <a href="/campaigns/${escapeHtml(campaignId)}/table" data-link data-testid="open-campaign-table">Open table dock</a>
        </div>
        <p class="record-meta" data-testid="session-zero-summary">
          Session Zero:
          ${
            detail.settings.sessionZero.completed
              ? 'recorded'
              : 'not recorded yet'
          }
          · Content profile: ${escapeHtml(detail.settings.contentProfileLabel)}
          · Group decisions: ${escapeHtml(detail.settings.groupDecisionPolicyLabel)}
        </p>
        ${
          ownSeat === null &&
          selectedCharacterId !== null &&
          ownCharacters.some((character) => character.characterId === selectedCharacterId)
            ? `<p class="message success" data-testid="seat-return-prompt">
                 Your new character is ready to seat below.
               </p>`
            : ''
        }
        ${
          error === null
            ? ''
            : `<div class="message error" role="alert" tabindex="-1" data-testid="campaign-detail-error">${escapeHtml(error)}</div>`
        }

        <section class="panel locked-panel" aria-labelledby="director-heading">
          <h2 id="director-heading">
            <span class="lock-mark" aria-hidden="true">▣</span>
            Game Director configuration
            <span class="lock-badge" data-testid="director-lock-badge">Fixed</span>
          </h2>
          <p class="message notice" data-testid="director-locked-notice">
            Fixed after creation for ordinary users — there is no edit control here. This is
            configuration for the later AI-enabled table; it does not activate AI narration in this
            build.
          </p>
          <dl class="account-details locked-details" data-testid="director-config">
            <div>
              <dt>Identity</dt>
              <dd data-testid="director-identity-label">${escapeHtml(campaign.director.identityLabel)}</dd>
            </div>
            <div>
              <dt>Personality</dt>
              <dd data-testid="director-personality-label">${escapeHtml(campaign.director.personalityLabel)}</dd>
            </div>
            <div>
              <dt>Avatar key</dt>
              <dd><code data-testid="director-avatar-key">${escapeHtml(campaign.director.avatarKey)}</code></dd>
            </div>
            <div>
              <dt>Fixed at</dt>
              <dd data-testid="director-locked-at">${escapeHtml(formatTimestamp(campaign.director.lockedAt))}</dd>
            </div>
          </dl>
        </section>

        <section class="panel" aria-labelledby="members-heading">
          <h2 id="members-heading">Members</h2>
          <ul class="record-list" data-testid="member-list">
            ${members
              .map(
                (member) => `
              <li data-testid="member-item">
                <span class="record-note">${escapeHtml(member.displayLabel)}</span>
                <span class="record-meta">
                  ${member.role === 'owner' ? 'Campaign owner' : 'Player'}
                  · joined ${escapeHtml(formatTimestamp(member.joinedAt))}
                </span>
              </li>`,
              )
              .join('')}
          </ul>
        </section>

        ${
          campaign.isCampaignOwner
            ? `
        <section class="panel" aria-labelledby="invite-heading">
          <h2 id="invite-heading">Invitation</h2>
          <p>
            Share an invite link with a second Local Arena development account. The link shows a
            bounded preview before sign-in, expires after 48 hours, and can be revoked.
          </p>
          ${
            invitePath === null
              ? `<div class="actions">
                   <button type="button" data-testid="create-invite" aria-disabled="${busy}">
                     ${busy ? 'Creating…' : 'Create invite link'}
                   </button>
                 </div>`
              : `<p class="record-meta">Invite path</p>
                 <p><code data-testid="invite-path">${escapeHtml(openInvitation!.invitePath)}</code></p>
                 <p class="record-meta">Full local URL</p>
                 <p><code data-testid="invite-url">${escapeHtml(invitePath)}</code></p>
                 <p class="record-meta" data-testid="invite-expires">
                   Expires ${escapeHtml(formatTimestamp(openInvitation!.expiresAt))}
                 </p>
                 ${
                   copyFeedback === null
                     ? ''
                     : `<p class="message success" data-testid="invite-copy-feedback">${escapeHtml(copyFeedback)}</p>`
                 }
                 <div class="actions">
                   <button type="button" data-testid="copy-invite" aria-disabled="${busy}">
                     Copy invite URL
                   </button>
                   <button type="button" class="secondary" data-testid="create-invite" aria-disabled="${busy}">
                     ${busy ? 'Working…' : 'Refresh invite'}
                   </button>
                   <button type="button" class="secondary" data-testid="revoke-invite" aria-disabled="${busy}">
                     Revoke invite
                   </button>
                 </div>`
          }
        </section>`
            : ''
        }

        <section class="panel" aria-labelledby="seats-heading">
          <h2 id="seats-heading">Seats</h2>
          ${
            seats.length === 0
              ? '<p class="empty-state" data-testid="seats-empty">No seats yet.</p>'
              : `<ul class="record-list" data-testid="seat-list">
                  ${seats
                    .map(
                      (seat) => `
                    <li data-testid="seat-item">
                      <span class="record-note">${escapeHtml(seat.characterName)}</span>
                      <span class="record-meta">
                        Seat ${escapeHtml(seat.seatId.slice(0, 8))}…
                        · character ${escapeHtml(seat.characterId.slice(0, 8))}…
                        · event sequence ${seat.lastAcknowledgedEventSequence}
                      </span>
                    </li>`,
                    )
                    .join('')}
                </ul>`
          }

          ${
            ownSeat !== null
              ? `<p class="message success" data-testid="own-seat">
                   You are seated as <strong>${escapeHtml(ownSeat.characterName)}</strong>.
                 </p>`
              : ownCharacters.length === 0
                ? `<p class="record-meta" data-testid="seat-need-character">
                     Create a character you own in the Character Vault before seating.
                   </p>
                   <p><a href="/characters/new?returnCampaign=${escapeHtml(campaignId)}" data-link data-testid="seat-vault-link">Create a character for this campaign</a></p>`
                : `<div class="actions seat-actions">
                     <label class="field">
                       <span>Seat a character you own</span>
                       <select data-testid="seat-character-select">
                         <option value="">Choose a character</option>
                         ${ownCharacters
                           .map(
                             (character) => `
                           <option value="${escapeHtml(character.characterId)}"
                             ${selectedCharacterId === character.characterId ? 'selected' : ''}>
                             ${escapeHtml(character.name)} — ${escapeHtml(character.summary)}
                           </option>`,
                           )
                           .join('')}
                       </select>
                     </label>
                     <button type="button" data-testid="create-seat"
                       aria-disabled="${busy || selectedCharacterId === null}">
                       ${busy ? 'Seating…' : 'Create seat'}
                     </button>
                   </div>`
          }
        </section>

        <p><a href="/campaigns" data-link data-testid="back-to-campaigns">Back to campaigns</a></p>
      </div>`;

    container
      .querySelector<HTMLButtonElement>('[data-testid="create-invite"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy) {
            return;
          }
          busy = true;
          error = null;
          copyFeedback = null;
          render();
          try {
            await createCampaignInvitation({
              candidateId: candidate.candidateId,
              campaignId,
            });
            detail = await fetchCampaignDetail(campaignId);
            shell.announce('Invite link ready.');
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'The invitation could not be created.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="copy-invite"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (invitePath === null) {
            return;
          }
          try {
            await navigator.clipboard.writeText(invitePath);
            copyFeedback = 'Invite URL copied.';
            shell.announce('Invite URL copied.');
          } catch {
            copyFeedback = 'Could not copy automatically — select the URL above and copy it.';
          }
          render();
        })();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="revoke-invite"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy) {
            return;
          }
          busy = true;
          error = null;
          copyFeedback = null;
          render();
          try {
            await revokeCampaignInvitation({
              candidateId: candidate.candidateId,
              campaignId,
            });
            detail = await fetchCampaignDetail(campaignId);
            shell.announce('Invite revoked.');
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'The invitation could not be revoked.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    const seatSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="seat-character-select"]',
    );
    seatSelect?.addEventListener('change', () => {
      selectedCharacterId = seatSelect.value === '' ? null : seatSelect.value;
      render();
    });

    container
      .querySelector<HTMLButtonElement>('[data-testid="create-seat"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy || selectedCharacterId === null) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            await createCampaignSeat({
              candidateId: candidate.candidateId,
              campaignId,
              characterId: selectedCharacterId,
            });
            detail = await fetchCampaignDetail(campaignId);
            shell.announce('Seat created.');
            selectedCharacterId = null;
            if (window.location.search.includes('seatCharacter=')) {
              window.history.replaceState({}, '', `/campaigns/${campaignId}`);
            }
          } catch (failure) {
            error =
              failure instanceof ApiFailure ? failure.message : 'The seat could not be created.';
          } finally {
            busy = false;
            render();
          }
        })();
      });
  }

  function render(): void {
    if (!isPageMountCurrent(container, mountToken)) {
      return;
    }
    if (getAccount() === null) {
      container.innerHTML = renderSignedOutGate({
        title: 'Campaign',
        body: 'Sign in with a Local Arena development account to open this campaign.',
        candidate,
        busy: gateBusy,
        error: gateError,
      });
      bindSignedOutGate({
        container,
        shell,
        candidate,
        onSignedIn: () => {
          void load();
        },
        setBusy: (busyState) => {
          gateBusy = busyState;
        },
        setError: (message) => {
          gateError = message;
        },
        render,
      });
      return;
    }
    renderSignedIn();
  }

  async function load(): Promise<void> {
    if (getAccount() === null) {
      render();
      return;
    }
    unavailable = false;
    error = null;
    render();
    try {
      detail = await fetchCampaignDetail(campaignId);
      shell.setDocumentTitle(detail.campaign.name);
    } catch (failure) {
      detail = null;
      unavailable = true;
      error =
        failure instanceof ApiFailure ? failure.message : 'This campaign could not be loaded.';
    }
    render();
  }

  subscribeAccount(() => {
    void load();
  });
  void load();
}
