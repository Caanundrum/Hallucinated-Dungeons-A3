/**
 * Campaign detail: locked Director configuration, invitations, membership, seats.
 *
 * Blueprint ownership: Sections 1.5.21 (Director lock), 7.6 (invitations),
 * 7.7.2 (seats). Phase 1 proves membership and ownership persistence — not the
 * live AI table.
 */

import type { CampaignDetailProjection } from '../../shared/campaign-contract.js';
import type { CampaignMemoryProjection, PersonalRecapProjection } from '../../shared/campaign-memory-contract.js';
import { getAccount, subscribeAccount } from '../account-session.js';
import {
  ApiFailure,
  createCampaignInvitation,
  createCampaignSeat,
  leaveCampaignSeat,
  fetchCampaignDetail,
  fetchCampaignMemory,
  fetchPersonalRecap,
  fetchRulesState,
  resumeCampaignSession,
  revokeCampaignInvitation,
  suspendCampaignSession,
  closeCampaignChapter,
} from '../api.js';
import { bindSignedOutGate, renderSignedOutGate } from '../auth-gate.js';
import { bindDirectorAvatarFallback, directorAvatarMarkup } from '../director-avatars.js';
import { escapeHtml } from '../dom-utils.js';
import { beginPageMount, isPageMountCurrent } from '../page-mount.js';
import { isHostedPlayerSurface } from '../player-surface.js';
import { confirmInApp } from '../confirm-dialog.js';
import { navigate } from '../router.js';
import type { PageHost } from './home.js';

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function renderMemoryPanel(memory: CampaignMemoryProjection, sessionZeroComplete: boolean): string {
  const currentChapter =
    memory.chapters.find((chapter) => chapter.chapterId === memory.currentChapterId) ?? null;
  const sessionLabel = !sessionZeroComplete
    ? 'Not started'
    : memory.session.state === 'suspended'
      ? 'suspended'
      : 'active';
  return `
    <p class="record-meta" data-testid="campaign-time">
      ${escapeHtml(memory.campaignTime.label)} ·
      Session ${sessionLabel}
      ${
        memory.session.state === 'suspended' && memory.session.suspendedAt !== null
          ? `· suspended ${escapeHtml(formatTimestamp(memory.session.suspendedAt))}`
          : ''
      }
    </p>
    ${
      currentChapter === null
        ? '<p class="empty-state" data-testid="current-chapter-empty">No current chapter — this is a blank table.</p>'
        : `<p data-testid="current-chapter">
             <strong>${escapeHtml(currentChapter.sessionLabel)}: ${escapeHtml(currentChapter.title)}</strong><br />
             ${escapeHtml(currentChapter.planSummary)}
           </p>`
    }
    ${
      memory.chapters.length === 0
        ? ''
        : `<h3 class="preview-subheading">Chapters</h3>
           <ul class="record-list" data-testid="chapter-list">
             ${memory.chapters
               .map(
                 (chapter) => `
               <li data-testid="chapter-item">
                 <span class="record-note">${escapeHtml(chapter.sessionLabel)}: ${escapeHtml(chapter.title)}</span>
                 <span class="record-meta">
                   ${
                     chapter.recordedSummary === null
                       ? 'Not yet played'
                       : `Completed — ${escapeHtml(chapter.recordedSummary)}`
                   }
                 </span>
               </li>`,
               )
               .join('')}
           </ul>`
    }
    ${
      memory.quests.length === 0
        ? ''
        : `<h3 class="preview-subheading">Quests</h3>
           <ul class="record-list" data-testid="quest-list">
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
      memory.npcs.length === 0
        ? ''
        : `<h3 class="preview-subheading">Known NPCs</h3>
           <ul class="record-list" data-testid="npc-list">
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
      memory.factions.length === 0
        ? ''
        : `<h3 class="preview-subheading">Factions</h3>
           <ul class="record-list" data-testid="faction-list">
             ${memory.factions
               .map(
                 (faction) => `
               <li data-testid="faction-item">
                 <span class="record-note">${escapeHtml(faction.name)}</span>
                 <span class="record-meta">${escapeHtml(faction.stance)} · ${escapeHtml(faction.summary)}</span>
               </li>`,
               )
               .join('')}
           </ul>`
    }
    ${
      memory.socialLinks.length === 0
        ? ''
        : `<h3 class="preview-subheading">Social links</h3>
           <ul class="record-list" data-testid="social-link-list">
             ${memory.socialLinks
               .map(
                 (link) => `<li data-testid="social-link-item"><span class="record-note">${escapeHtml(link.description)}</span></li>`,
               )
               .join('')}
           </ul>`
    }
    ${
      memory.openThreads.length === 0
        ? ''
        : `<h3 class="preview-subheading">Open threads</h3>
           <ul class="record-list" data-testid="open-thread-list">
             ${memory.openThreads
               .map(
                 (thread) => `<li data-testid="open-thread-item"><span class="record-note">${escapeHtml(thread.summary)}</span></li>`,
               )
               .join('')}
           </ul>`
    }`;
}

function renderRecapPanel(recap: PersonalRecapProjection): string {
  return `
    <section class="panel panel-nested" aria-labelledby="recap-heading" data-testid="personal-recap-panel">
      <h3 id="recap-heading">Your personal recap</h3>
      <p data-testid="recap-headline">${escapeHtml(recap.headline)}</p>
      ${
        recap.recentChapterSummaries.length === 0
          ? ''
          : `<ul class="record-list" data-testid="recap-recent-chapters">
               ${recap.recentChapterSummaries
                 .map((summary) => `<li>${escapeHtml(summary)}</li>`)
                 .join('')}
             </ul>`
      }
      ${
        recap.activeQuests.length === 0
          ? ''
          : `<p class="record-meta" data-testid="recap-active-quests">Active quests: ${escapeHtml(recap.activeQuests.join(', '))}</p>`
      }
      ${
        recap.openThreads.length === 0
          ? ''
          : `<p class="record-meta" data-testid="recap-open-threads">Open threads: ${escapeHtml(recap.openThreads.join(', '))}</p>`
      }
      <p class="record-meta" data-testid="recap-campaign-time">${escapeHtml(recap.campaignTimeLabel)}</p>
    </section>`;
}

export function mountCampaignDetailPage(host: PageHost, campaignId: string): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Campaign');

  let detail: CampaignDetailProjection | null = null;
  let error: string | null = null;
  let unavailable = false;
  let loadingDetail = true;
  let busy = false;
  const seatCharacterFromQuery = new URLSearchParams(window.location.search).get('seatCharacter');
  let selectedCharacterId: string | null =
    seatCharacterFromQuery !== null && /^[A-Za-z0-9-]{1,64}$/.test(seatCharacterFromQuery)
      ? seatCharacterFromQuery
      : null;
  let copyFeedback: string | null = null;
  let gateBusy = false;
  let gateError: string | null = null;
  let memory: CampaignMemoryProjection | null = null;
  let memoryError: string | null = null;
  let recap: PersonalRecapProjection | null = null;
  let sessionBusy = false;
  let sessionMessage: string | null = null;
  let encounterActive = false;
  const mountToken = beginPageMount(container);

  function renderSignedIn(): void {
    if (loadingDetail && detail === null && !unavailable) {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="campaign-detail-heading">Loading campaign…</h1>
          <p class="tagline">Opening your campaign details.</p>
        </div>`;
      return;
    }
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
    const memorySnapshot = memory;
    const currentMemoryChapter =
      memorySnapshot === null
        ? null
        : (memorySnapshot.chapters.find(
            (chapter) => chapter.chapterId === memorySnapshot.currentChapterId,
          ) ?? null);
    const sessionZeroComplete = detail.settings.sessionZero.completed;
    const canCloseChapter =
      currentMemoryChapter !== null &&
      currentMemoryChapter.recordedSummary === null &&
      ownSeat !== null &&
      !encounterActive;
    const canSuspendSession =
      sessionZeroComplete &&
      memorySnapshot !== null &&
      memorySnapshot.session.state !== 'suspended' &&
      !encounterActive;
    const canSeatCharacter = sessionZeroComplete;
    const canInvitePlayers = sessionZeroComplete && campaign.isCampaignOwner;

    const nextStep =
      !sessionZeroComplete
        ? 'Next: record Session Zero in Campaign settings before seating a character or starting live play.'
        : ownSeat === null
          ? campaign.isCampaignOwner
            ? 'Next: seat a character you own, then invite friends or open the table to play.'
            : 'Next: seat a character you own to join this table.'
          : campaign.isCampaignOwner && members.length < 2
            ? 'Next: share an invite link so another player can join, or open the table to play.'
            : 'Your seat is ready. Open the table to play the current chapter.';

    container.innerHTML = `
      <div class="page">
        <h1 data-testid="campaign-detail-heading">${escapeHtml(campaign.name)}</h1>
        <p class="tagline">
          ${
            campaign.summary.length === 0
              ? 'Campaign membership, seats, and session memory for your table.'
              : escapeHtml(campaign.summary)
          }
        </p>
        <p class="message notice" data-testid="campaign-next-step">${escapeHtml(nextStep)}</p>
        <div class="actions">
          <a href="/campaigns/${escapeHtml(campaignId)}/settings" data-link data-testid="open-campaign-settings">Campaign settings</a>
          ${
            sessionZeroComplete
              ? `<a href="/campaigns/${escapeHtml(campaignId)}/table" data-link data-testid="open-campaign-table">Open table dock</a>`
              : `<span class="record-meta" data-testid="open-campaign-table-gated">Open table after Session Zero is recorded</span>`
          }
        </div>
        <p class="record-meta" data-testid="session-zero-summary">
          Session Zero:
          ${
            sessionZeroComplete
              ? 'recorded'
              : 'not recorded yet'
          }
          · Content profile: ${escapeHtml(detail.settings.contentProfileLabel)}
          · Group decisions: ${escapeHtml(detail.settings.groupDecisionPolicyLabel)}
        </p>
        ${
          sessionZeroComplete
            ? ''
            : `<p class="message notice" data-testid="session-zero-gate-notice">
                 Record Session Zero in Campaign settings before seating a character or starting combat.
               </p>`
        }
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
            Fixed after creation for ordinary users — there is no edit control here. The Game Director
            narrates at the table; this panel only records which voice you chose.
          </p>
          ${directorAvatarMarkup({
            avatarKey: campaign.director.avatarKey,
            label: `${campaign.director.identityLabel} — ${campaign.director.personalityLabel}`,
            testId: 'director-avatar',
            className: 'director-avatar director-avatar-detail',
          })}
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

        <section class="panel" aria-labelledby="campaign-memory-heading" data-testid="campaign-memory-panel">
          <h2 id="campaign-memory-heading">Campaign memory</h2>
          ${
            memoryError !== null
              ? `<p class="message error" role="alert" data-testid="campaign-memory-error">${escapeHtml(memoryError)}</p>`
              : memory === null
                ? '<p class="empty-state" data-testid="campaign-memory-empty">Campaign memory is loading…</p>'
                : renderMemoryPanel(memory, sessionZeroComplete)
          }
          ${
            sessionMessage === null
              ? ''
              : `<p class="message success" data-testid="session-action-message">${escapeHtml(sessionMessage)}</p>`
          }
          ${
            memory === null
              ? ''
              : `<div class="actions">
                   <button type="button" data-testid="suspend-session"
                     aria-disabled="${sessionBusy || !canSuspendSession ? 'true' : 'false'}">
                     ${sessionBusy ? 'Working…' : 'Suspend session'}
                   </button>
                   <button type="button" class="secondary" data-testid="resume-session"
                     aria-disabled="${sessionBusy || memory.session.state !== 'suspended' ? 'true' : 'false'}">
                     ${sessionBusy ? 'Working…' : 'Resume session'}
                   </button>
                   <button type="button" class="secondary" data-testid="view-recap" aria-disabled="${sessionBusy}">
                     View personal recap
                   </button>
                   <button type="button" class="secondary" data-testid="close-chapter"
                     aria-disabled="${sessionBusy || !canCloseChapter ? 'true' : 'false'}">
                     Close chapter &amp; travel
                   </button>
                 </div>
                 <p class="record-meta" data-testid="chapter-travel-hint">
                   ${
                     encounterActive
                       ? 'End the active encounter on the table before closing this chapter or suspending the session.'
                       : memorySnapshot?.adventureTemplateId === null ||
                           memorySnapshot?.adventureTemplateId === undefined
                         ? ownSeat === null
                           ? 'Seat a character before closing a chapter. Blank-table campaigns have no Emberferry chapter path.'
                           : 'This blank table has no Emberferry chapter path. Closing a chapter only applies when a starter adventure is seeded.'
                         : ownSeat === null
                           ? 'Seat a character before closing a chapter. Closing advances Emberferry to the next scene and needs confirmation.'
                           : 'Closing the current chapter asks for confirmation, then advances Emberferry to the next tactical scene (Mist Dock → Mist-Cut Caves → Drowned Bell Tower). End any active encounter first.'
                   }
                 </p>`
          }
          ${recap === null ? '' : renderRecapPanel(recap)}
        </section>

        ${
          campaign.isCampaignOwner
            ? `
        <section class="panel" aria-labelledby="invite-heading">
          <h2 id="invite-heading">Invitation</h2>
          <p>
            Share an invite link with another player. The link shows a bounded preview before
            sign-in, expires after 48 hours, and can be revoked.
          </p>
          ${
            !sessionZeroComplete
              ? `<p class="message notice" data-testid="invite-session-zero-gate">
                   Record Session Zero in Campaign settings before creating invite links.
                 </p>`
              : invitePath === null
              ? `<div class="actions">
                   <button type="button" data-testid="create-invite" aria-disabled="${busy || !canInvitePlayers}">
                     ${busy ? 'Creating…' : 'Create invite link'}
                   </button>
                 </div>`
              : `<p class="record-meta">Invite path</p>
                 <p><code data-testid="invite-path">${escapeHtml(openInvitation!.invitePath)}</code></p>
                 <p class="record-meta">Invite URL</p>
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
                   <button type="button" class="secondary" data-testid="create-invite" aria-disabled="${busy || !canInvitePlayers}">
                     ${busy ? 'Working…' : 'Refresh invite'}
                   </button>
                   <button type="button" class="secondary" data-testid="revoke-invite" aria-disabled="${busy || !canInvitePlayers}">
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
                      <span class="record-meta">Seated player</span>
                    </li>`,
                    )
                    .join('')}
                </ul>`
          }

          ${
            ownSeat !== null
              ? `<p class="message success" data-testid="own-seat">
                   You are seated as <strong>${escapeHtml(ownSeat.characterName)}</strong>.
                 </p>
                 <div class="actions">
                   <button type="button" class="secondary" data-testid="leave-seat" aria-disabled="${busy}">
                     ${busy ? 'Leaving…' : 'Leave seat'}
                   </button>
                 </div>`
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
                       aria-disabled="${busy || selectedCharacterId === null || !canSeatCharacter}">
                       ${busy ? 'Seating…' : canSeatCharacter ? 'Create seat' : 'Record Session Zero first'}
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
          if (detail !== null && !detail.settings.sessionZero.completed) {
            error = 'Record Session Zero in Campaign settings before creating invite links.';
            render();
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
          if (detail !== null && !detail.settings.sessionZero.completed) {
            error = 'Record Session Zero in Campaign settings before seating a character.';
            render();
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

    container
      .querySelector<HTMLButtonElement>('[data-testid="leave-seat"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy || ownSeat === null) {
            return;
          }
          const confirmed = await confirmInApp({
            title: 'Leave seat?',
            body: `Leave the table as ${ownSeat.characterName}? You can seat another character afterward.`,
            confirmLabel: 'Leave seat',
          });
          if (!confirmed) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            await leaveCampaignSeat({
              candidateId: candidate.candidateId,
              campaignId,
            });
            detail = await fetchCampaignDetail(campaignId);
            shell.announce('You left your seat.');
          } catch (failure) {
            error =
              failure instanceof ApiFailure ? failure.message : 'The seat could not be left.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    bindDirectorAvatarFallback(
      container,
      'director-avatar',
      `${campaign.director.identityLabel} — ${campaign.director.personalityLabel}`,
    );

    container
      .querySelector<HTMLButtonElement>('[data-testid="suspend-session"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || sessionBusy || memory?.session.state === 'suspended') {
            return;
          }
          if (encounterActive) {
            error = 'End the current encounter before suspending the session.';
            sessionMessage = null;
            render();
            return;
          }
          sessionBusy = true;
          error = null;
          render();
          try {
            const result = await suspendCampaignSession({
              candidateId: candidate.candidateId,
              campaignId,
            });
            memory = result.memory;
            sessionMessage = `Session suspended. ${result.tableStateVersionNote}`;
            shell.announce('Campaign session suspended.');
          } catch (failure) {
            error =
              failure instanceof ApiFailure ? failure.message : 'The session could not be suspended.';
            sessionMessage = null;
            shell.announce(error);
          } finally {
            sessionBusy = false;
            render();
          }
        })();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="resume-session"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || sessionBusy || memory?.session.state !== 'suspended') {
            return;
          }
          sessionBusy = true;
          error = null;
          render();
          try {
            const result = await resumeCampaignSession({
              candidateId: candidate.candidateId,
              campaignId,
            });
            memory = result.memory;
            recap = result.recap;
            sessionMessage = 'Session resumed.';
            shell.announce('Campaign session resumed.');
          } catch (failure) {
            error =
              failure instanceof ApiFailure ? failure.message : 'The session could not be resumed.';
          } finally {
            sessionBusy = false;
            render();
          }
        })();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="view-recap"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (sessionBusy) {
            return;
          }
          sessionBusy = true;
          error = null;
          render();
          try {
            recap = await fetchPersonalRecap(campaignId);
          } catch (failure) {
            error = failure instanceof ApiFailure ? failure.message : 'The recap could not be loaded.';
          } finally {
            sessionBusy = false;
            render();
          }
        })();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="close-chapter"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || sessionBusy || !canCloseChapter) {
            return;
          }
          const chapterTitle = currentMemoryChapter?.title ?? 'this chapter';
          if (
            !(await confirmInApp({
              title: 'Close this chapter?',
              body: `Close "${chapterTitle}" and travel to the next scene? Only do this after the table has played the chapter. This cannot be undone.`,
              confirmLabel: 'Close chapter',
              cancelLabel: 'Keep playing',
              testId: 'confirm-close-chapter',
            }))
          ) {
            return;
          }
          sessionBusy = true;
          error = null;
          render();
          try {
            memory = await closeCampaignChapter({
              candidateId: candidate.candidateId,
              campaignId,
            });
            recap = null;
            const nextTitle =
              memory.chapters.find((chapter) => chapter.chapterId === memory!.currentChapterId)
                ?.title ?? 'the next scene';
            sessionMessage = `Chapter closed. The table now opens on "${nextTitle}".`;
            shell.announce(sessionMessage);
            try {
              recap = await fetchPersonalRecap(campaignId);
            } catch {
              recap = null;
            }
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'The chapter could not be closed.';
          } finally {
            sessionBusy = false;
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
      if (isHostedPlayerSurface(candidate)) {
        navigate('/', { replace: true });
        return;
      }
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
      loadingDetail = false;
      render();
      return;
    }
    loadingDetail = true;
    unavailable = false;
    error = null;
    render();
    try {
      detail = await fetchCampaignDetail(campaignId);
      shell.setDocumentTitle(detail.campaign.name);
      unavailable = false;
    } catch (failure) {
      detail = null;
      unavailable = true;
      // Ownership misses and unknown ids both look "unavailable". Do not surface
      // the generic HTTP "No such route." string on top of the honest copy.
      if (failure instanceof ApiFailure && failure.code === 'NOT_FOUND') {
        error = null;
      } else {
        error =
          failure instanceof ApiFailure ? failure.message : 'This campaign could not be loaded.';
      }
    } finally {
      loadingDetail = false;
    }
    if (detail !== null) {
      memoryError = null;
      try {
        memory = await fetchCampaignMemory(campaignId);
      } catch (failure) {
        memory = null;
        memoryError =
          failure instanceof ApiFailure ? failure.message : 'Campaign memory could not be loaded.';
      }
      try {
        const rules = await fetchRulesState(campaignId);
        encounterActive =
          rules.encounter !== null &&
          (rules.encounter.status === 'active' || rules.encounter.status === 'setup');
      } catch {
        encounterActive = false;
      }
    }
    render();
  }

  subscribeAccount(() => {
    void load();
  });
  void load();
}
