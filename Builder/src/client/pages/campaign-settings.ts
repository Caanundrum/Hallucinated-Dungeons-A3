/**
 * Campaign settings and Session Zero for Phase 1.
 *
 * Blueprint ownership: Sections 1.5.21, 4.4, 13.18. Owner edits; members read.
 * Copy states these settings configure the later AI-enabled table.
 */

import type { CampaignSettingsProjection } from '../../shared/settings-contract.js';
import {
  CONTENT_PROFILES,
  CONTENT_PROFILE_LABELS,
  CONTENT_PROFILE_SUMMARIES,
  CHARACTER_CONFLICT_POLICIES,
  CHARACTER_CONFLICT_POLICY_LABELS,
  CONTENT_SOURCE_FLAGS,
  CONTENT_SOURCE_FLAG_LABELS,
  DROP_IN_OUT_POLICIES,
  DROP_IN_OUT_POLICY_LABELS,
  ENEMY_HEALTH_PRESENTATIONS,
  ENEMY_HEALTH_PRESENTATION_LABELS,
  GROUP_DECISION_POLICIES,
  GROUP_DECISION_POLICY_LABELS,
  GROUP_DECISION_POLICY_SUMMARIES,
  type GroupDecisionPolicy,
  LETHALITY_PREFERENCES,
  LETHALITY_PREFERENCE_LABELS,
  REACTION_WINDOW_SECONDS_DEFAULT,
  REACTION_WINDOW_SECONDS_MAX,
  REACTION_WINDOW_SECONDS_MIN,
  ROMANCE_POLICIES,
  ROMANCE_POLICY_LABELS,
  SESSION_TONES,
  SESSION_TONE_LABELS,
} from '../../shared/settings-contract.js';
import { getAccount, subscribeAccount } from '../account-session.js';
import { ApiFailure, fetchCampaignDetail, saveCampaignSettings } from '../api.js';
import { bindSignedOutGate, renderSignedOutGate } from '../auth-gate.js';
import { confirmInApp } from '../confirm-dialog.js';
import { escapeHtml } from '../dom-utils.js';
import { beginPageMount, isPageMountCurrent } from '../page-mount.js';
import { isHostedPlayerSurface } from '../player-surface.js';
import { navigate } from '../router.js';
import type { PageHost } from './home.js';

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function mountCampaignSettingsPage(host: PageHost, campaignId: string): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Campaign settings');

  let settings: CampaignSettingsProjection | null = null;
  let isOwner = false;
  let members: readonly { accountId: string; displayLabel: string; seated: boolean }[] = [];
  let busy = false;
  let error: string | null = null;
  let notice: string | null = null;
  let gateBusy = false;
  let gateError: string | null = null;
  const mountToken = beginPageMount(container);

  // Editable draft of the form (owner only).
  let draft: CampaignSettingsProjection | null = null;
  let savedGroupDecisionPolicy: GroupDecisionPolicy | null = null;

  function renderForm(): void {
    if (settings === null || draft === null) {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="campaign-settings-heading">Campaign settings</h1>
          <p class="tagline">${error === null ? 'Loading settings…' : escapeHtml(error)}</p>
          <p><a href="/campaigns/${escapeHtml(campaignId)}" data-link>Back to campaign</a></p>
        </div>`;
      return;
    }

    const disabled = !isOwner || busy;
    container.innerHTML = `
      <div class="page page-wide">
        <h1 data-testid="campaign-settings-heading">Campaign settings</h1>
        <p class="tagline">
          Session Zero and table configuration for this campaign. Saved settings recover after
          leave/return.
        </p>
        <p class="message notice" data-testid="settings-config-notice">${escapeHtml(draft.configurationNotice)}</p>
        ${
          notice === null
            ? ''
            : `<div class="message success" data-testid="settings-notice">${escapeHtml(notice)}</div>`
        }
        ${
          error === null
            ? ''
            : `<div class="message error" role="alert" data-testid="settings-error">${escapeHtml(error)}</div>`
        }

        <section class="panel" aria-labelledby="content-profile-heading">
          <h2 id="content-profile-heading">Content profile</h2>
          <ul class="option-list" data-testid="content-profile-list">
            ${CONTENT_PROFILES.map(
              (profile) => `
              <li>
                <label class="option${draft!.contentProfile === profile ? ' selected' : ''}${disabled ? ' disabled' : ''}">
                  <input type="radio" name="content-profile" value="${profile}"
                    ${draft!.contentProfile === profile ? 'checked' : ''} ${disabled ? 'disabled' : ''}
                    data-testid="content-profile-${profile}" />
                  <span class="option-label">${escapeHtml(CONTENT_PROFILE_LABELS[profile])}</span>
                  <span class="option-summary">${escapeHtml(CONTENT_PROFILE_SUMMARIES[profile])}</span>
                </label>
              </li>`,
            ).join('')}
          </ul>
          <label class="field">
            <span>Lines, veils, and safety boundaries</span>
            <textarea data-testid="safety-boundaries" rows="3" placeholder="Example: No harm to children on screen. Fade to black for romance." ${disabled ? 'disabled' : ''}>${escapeHtml(draft.safetyBoundaries)}</textarea>
            <span class="record-meta">Required when you record Session Zero. List at least one line, veil, or boundary your table agrees on.</span>
          </label>
        </section>

        <section class="panel" aria-labelledby="group-decision-heading">
          <h2 id="group-decision-heading">Group-decision policy</h2>
          ${
            draft.sessionZero.completed
              ? `<p class="message notice" data-testid="group-decision-consent-notice">
                   Session Zero already recorded this policy. Changing it requires table consent — you will confirm before Save settings writes the new policy. No automatic change history is stored in Alpha; note the prior choice with your players.
                 </p>`
              : ''
          }
          <ul class="option-list" data-testid="group-decision-list">
            ${GROUP_DECISION_POLICIES.map(
              (policy) => `
              <li>
                <label class="option${draft!.groupDecisionPolicy === policy ? ' selected' : ''}${disabled ? ' disabled' : ''}">
                  <input type="radio" name="group-decision" value="${policy}"
                    ${draft!.groupDecisionPolicy === policy ? 'checked' : ''} ${disabled ? 'disabled' : ''}
                    data-testid="group-decision-${policy}" />
                  <span class="option-label">${escapeHtml(GROUP_DECISION_POLICY_LABELS[policy])}</span>
                  <span class="option-summary">${escapeHtml(GROUP_DECISION_POLICY_SUMMARIES[policy])}</span>
                </label>
              </li>`,
            ).join('')}
          </ul>
          ${
            draft.groupDecisionPolicy === 'designated_caller'
              ? `<label class="field">
                   <span>Designated caller</span>
                   <select data-testid="designated-caller" ${disabled ? 'disabled' : ''}>
                     <option value="">Choose a member</option>
                     ${members
                       .filter((member) => member.seated)
                       .map(
                         (member) => `
                       <option value="${escapeHtml(member.accountId)}"
                         ${draft!.designatedCallerAccountId === member.accountId ? 'selected' : ''}>
                         ${escapeHtml(member.displayLabel)}
                       </option>`,
                       )
                       .join('')}
                   </select>
                   <span class="record-meta">Only seated party members can be the designated caller.</span>
                 </label>`
              : ''
          }
        </section>

        <section class="panel" aria-labelledby="table-defaults-heading">
          <h2 id="table-defaults-heading">Table defaults</h2>
          <label class="field">
            <span>Reaction window (seconds)</span>
            <input type="number" data-testid="reaction-window"
              min="${REACTION_WINDOW_SECONDS_MIN}" max="${REACTION_WINDOW_SECONDS_MAX}"
              value="${draft.reactionWindowSeconds}" ${disabled ? 'disabled' : ''} />
            <span class="record-meta">Allowed range ${REACTION_WINDOW_SECONDS_MIN}–${REACTION_WINDOW_SECONDS_MAX} seconds. Example: ${REACTION_WINDOW_SECONDS_DEFAULT} seconds gives one beat to declare a reaction before play moves on.</span>
          </label>
          <p class="record-meta">Rules transparency: ${escapeHtml(draft.rulesTransparencyLabel)} (locked default).</p>
          <ul class="option-list compact" data-testid="enemy-health-list">
            ${ENEMY_HEALTH_PRESENTATIONS.map(
              (option) => `
              <li>
                <label class="option${draft!.enemyHealthPresentation === option ? ' selected' : ''}${disabled ? ' disabled' : ''}">
                  <input type="radio" name="enemy-health" value="${option}"
                    ${draft!.enemyHealthPresentation === option ? 'checked' : ''} ${disabled ? 'disabled' : ''}
                    data-testid="enemy-health-${option}" />
                  <span class="option-label">${escapeHtml(ENEMY_HEALTH_PRESENTATION_LABELS[option])}</span>
                </label>
              </li>`,
            ).join('')}
          </ul>
        </section>

        <section class="panel" aria-labelledby="session-zero-heading">
          <h2 id="session-zero-heading">Session Zero</h2>
          <p class="record-meta" data-testid="session-zero-status">
            ${
              draft.sessionZero.completed
                ? `Recorded${draft.sessionZero.completedAt === null ? '' : ` at ${escapeHtml(formatTimestamp(draft.sessionZero.completedAt))}`}.`
                : 'Not completed yet — record the social contract before the later live table.'
            }
          </p>
          <label class="field">
            <span>Intended tone</span>
            <select data-testid="session-tone" ${disabled ? 'disabled' : ''}>
              ${SESSION_TONES.map(
                (tone) =>
                  `<option value="${tone}" ${draft!.sessionZero.tone === tone ? 'selected' : ''}>${escapeHtml(SESSION_TONE_LABELS[tone])}</option>`,
              ).join('')}
            </select>
          </label>
          <label class="field">
            <span>Character conflict</span>
            <select data-testid="character-conflict" ${disabled ? 'disabled' : ''}>
              ${CHARACTER_CONFLICT_POLICIES.map(
                (policy) =>
                  `<option value="${policy}" ${draft!.sessionZero.characterConflictPolicy === policy ? 'selected' : ''}>${escapeHtml(CHARACTER_CONFLICT_POLICY_LABELS[policy])}</option>`,
              ).join('')}
            </select>
          </label>
          <label class="field">
            <span>Romance policy</span>
            <select data-testid="romance-policy" ${disabled ? 'disabled' : ''}>
              ${ROMANCE_POLICIES.map(
                (policy) =>
                  `<option value="${policy}" ${draft!.sessionZero.romancePolicy === policy ? 'selected' : ''}>${escapeHtml(ROMANCE_POLICY_LABELS[policy])}</option>`,
              ).join('')}
            </select>
          </label>
          <label class="field">
            <span>Lethality preference</span>
            <select data-testid="lethality" ${disabled ? 'disabled' : ''}>
              ${LETHALITY_PREFERENCES.map(
                (policy) =>
                  `<option value="${policy}" ${draft!.sessionZero.lethalityPreference === policy ? 'selected' : ''}>${escapeHtml(LETHALITY_PREFERENCE_LABELS[policy])}</option>`,
              ).join('')}
            </select>
          </label>
          <label class="field">
            <span>Expected session length</span>
            <input type="text" data-testid="session-length" placeholder="Example: 3–5 sessions"
              value="${escapeHtml(draft.sessionZero.expectedSessionLength)}" ${disabled ? 'disabled' : ''} />
            <span class="record-meta">Required to record Session Zero. Clearing this field cannot fall back to a hidden default.</span>
          </label>
          <label class="field">
            <span>Drop-in / drop-out</span>
            <select data-testid="drop-in-out" ${disabled ? 'disabled' : ''}>
              ${DROP_IN_OUT_POLICIES.map(
                (policy) =>
                  `<option value="${policy}" ${draft!.sessionZero.dropInOutPolicy === policy ? 'selected' : ''}>${escapeHtml(DROP_IN_OUT_POLICY_LABELS[policy])}</option>`,
              ).join('')}
            </select>
          </label>
          <label class="field">
            <span>Text-chat expectations</span>
            <input type="text" data-testid="text-chat-expectations" value="${escapeHtml(draft.sessionZero.textChatExpectations)}" ${disabled ? 'disabled' : ''} />
          </label>
          <label class="field">
            <span>External voice note (optional)</span>
            <input type="text" data-testid="external-voice-note" value="${escapeHtml(draft.sessionZero.externalVoiceNote)}" ${disabled ? 'disabled' : ''} />
          </label>
          <label class="field">
            <span>Accessibility needs</span>
            <textarea data-testid="accessibility-needs" rows="2" ${disabled ? 'disabled' : ''}>${escapeHtml(draft.sessionZero.accessibilityNeeds)}</textarea>
          </label>
          <label class="field">
            <span>Content source</span>
            <select data-testid="content-source" ${disabled ? 'disabled' : ''}>
              ${CONTENT_SOURCE_FLAGS.map(
                (flag) =>
                  `<option value="${flag}" ${draft!.sessionZero.contentSource === flag ? 'selected' : ''}>${escapeHtml(CONTENT_SOURCE_FLAG_LABELS[flag])}</option>`,
              ).join('')}
            </select>
          </label>
          <p class="record-meta">PvP policy remains consent-required. Director discretion remains moderate and bounded.</p>
        </section>

        <div class="actions">
          ${
            isOwner
              ? `<p class="record-meta" data-testid="settings-save-hint">
                   <strong>Save settings</strong> commits content profile, group-decision policy, table defaults
                   (reaction window and enemy health), and safety boundaries without recording Session Zero.
                   <strong>Record Session Zero</strong> also commits the Session Zero fields below and marks the
                   social contract as recorded — required before seating characters or opening live play.
                 </p>
                 <button type="button" data-testid="save-settings" aria-disabled="${busy}">
                   ${busy ? 'Saving…' : 'Save settings'}
                 </button>
                 <button type="button" class="secondary" data-testid="complete-session-zero" aria-disabled="${busy}">
                   ${draft.sessionZero.completed ? 'Update Session Zero' : 'Record Session Zero'}
                 </button>`
              : '<p class="record-meta" data-testid="settings-read-only">Only the campaign owner can edit these settings.</p>'
          }
          <a href="/campaigns/${escapeHtml(campaignId)}" data-link data-testid="settings-back">Back to campaign</a>
          ${
            draft.sessionZero.completed
              ? `<a href="/campaigns/${escapeHtml(campaignId)}/table" data-link data-testid="settings-open-table">Open table dock</a>`
              : `<span class="record-meta" data-testid="settings-open-table-gated">Open table after Session Zero is recorded</span>`
          }
        </div>
      </div>`;

    if (!isOwner) {
      return;
    }

    const syncText = (): void => {
      if (draft === null) return;
      const boundaries = container.querySelector<HTMLTextAreaElement>('[data-testid="safety-boundaries"]');
      const reaction = container.querySelector<HTMLInputElement>('[data-testid="reaction-window"]');
      const caller = container.querySelector<HTMLSelectElement>('[data-testid="designated-caller"]');
      const tone = container.querySelector<HTMLSelectElement>('[data-testid="session-tone"]');
      const conflict = container.querySelector<HTMLSelectElement>('[data-testid="character-conflict"]');
      const romance = container.querySelector<HTMLSelectElement>('[data-testid="romance-policy"]');
      const lethality = container.querySelector<HTMLSelectElement>('[data-testid="lethality"]');
      const length = container.querySelector<HTMLInputElement>('[data-testid="session-length"]');
      const drop = container.querySelector<HTMLSelectElement>('[data-testid="drop-in-out"]');
      const chat = container.querySelector<HTMLInputElement>('[data-testid="text-chat-expectations"]');
      const voice = container.querySelector<HTMLInputElement>('[data-testid="external-voice-note"]');
      const access = container.querySelector<HTMLTextAreaElement>('[data-testid="accessibility-needs"]');
      const source = container.querySelector<HTMLSelectElement>('[data-testid="content-source"]');
      draft = {
        ...draft,
        safetyBoundaries: boundaries?.value ?? '',
        reactionWindowSeconds: Number(reaction?.value ?? draft.reactionWindowSeconds),
        designatedCallerAccountId: caller?.value === '' ? null : caller?.value ?? null,
        sessionZero: {
          ...draft.sessionZero,
          tone: (tone?.value ?? draft.sessionZero.tone) as typeof draft.sessionZero.tone,
          characterConflictPolicy: (conflict?.value ??
            draft.sessionZero.characterConflictPolicy) as typeof draft.sessionZero.characterConflictPolicy,
          romancePolicy: (romance?.value ??
            draft.sessionZero.romancePolicy) as typeof draft.sessionZero.romancePolicy,
          lethalityPreference: (lethality?.value ??
            draft.sessionZero.lethalityPreference) as typeof draft.sessionZero.lethalityPreference,
          expectedSessionLength: length?.value ?? draft.sessionZero.expectedSessionLength,
          dropInOutPolicy: (drop?.value ??
            draft.sessionZero.dropInOutPolicy) as typeof draft.sessionZero.dropInOutPolicy,
          textChatExpectations: chat?.value ?? draft.sessionZero.textChatExpectations,
          externalVoiceNote: voice?.value ?? draft.sessionZero.externalVoiceNote,
          accessibilityNeeds: access?.value ?? draft.sessionZero.accessibilityNeeds,
          contentSource: (source?.value ??
            draft.sessionZero.contentSource) as typeof draft.sessionZero.contentSource,
        },
      };
    };

    container.querySelectorAll<HTMLInputElement>('input[name="content-profile"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (draft === null) return;
        syncText();
        draft = { ...draft, contentProfile: input.value as typeof draft.contentProfile };
      });
    });
    container.querySelectorAll<HTMLInputElement>('input[name="group-decision"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (draft === null) return;
        syncText();
        draft = {
          ...draft,
          groupDecisionPolicy: input.value as typeof draft.groupDecisionPolicy,
        };
        render();
      });
    });
    container.querySelectorAll<HTMLInputElement>('input[name="enemy-health"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (draft === null) return;
        syncText();
        draft = {
          ...draft,
          enemyHealthPresentation: input.value as typeof draft.enemyHealthPresentation,
        };
      });
    });

    // Keep draft.sessionZero.expectedSessionLength aligned with keystrokes so a
    // cleared field cannot fall back to the previous default on Record (PQA-108).
    container
      .querySelector<HTMLInputElement>('[data-testid="session-length"]')
      ?.addEventListener('input', () => {
        syncText();
      });

    const save = async (completeSessionZero: boolean): Promise<void> => {
      if (candidate === null || draft === null || busy) return;
      syncText();
      if (completeSessionZero) {
        const lengthField = container.querySelector<HTMLInputElement>('[data-testid="session-length"]');
        // Prefer the live DOM value so an uncleared draft default cannot mask a blank field (PQA-108).
        const liveLength = (lengthField?.value ?? '').trim();
        if (liveLength.length === 0) {
          error = 'Expected session length is required for Session Zero.';
          notice = null;
          shell.announce(error);
          render();
          return;
        }
        draft = {
          ...draft,
          sessionZero: { ...draft.sessionZero, expectedSessionLength: liveLength },
        };
        if (/^0(\s|$)|zero\s+session/i.test(liveLength) || liveLength === '0 sessions') {
          error = 'Expected session length must describe at least one session (for example, “3–5 sessions”).';
          notice = null;
          shell.announce(error);
          render();
          return;
        }
        if (draft.sessionZero.textChatExpectations.trim().length === 0) {
          error = 'Text-chat expectations are required for Session Zero.';
          notice = null;
          shell.announce(error);
          render();
          return;
        }
        if (draft.safetyBoundaries.trim().length === 0) {
          error = 'Record at least one line, veil, or safety boundary before recording Session Zero.';
          notice = null;
          shell.announce(error);
          render();
          return;
        }
      }
      const reactionSeconds = draft.reactionWindowSeconds;
      if (
        !Number.isInteger(reactionSeconds) ||
        reactionSeconds < REACTION_WINDOW_SECONDS_MIN ||
        reactionSeconds > REACTION_WINDOW_SECONDS_MAX
      ) {
        error = `Reaction window must be ${REACTION_WINDOW_SECONDS_MIN}–${REACTION_WINDOW_SECONDS_MAX} seconds.`;
        notice = null;
        shell.announce(error);
        render();
        return;
      }
      if (draft.contentProfile === 'custom_restricted' && draft.safetyBoundaries.trim().length === 0) {
        error = 'Custom Restricted requires at least one line, veil, or safety boundary.';
        notice = null;
        shell.announce(error);
        render();
        return;
      }
      if (
        draft.groupDecisionPolicy === 'designated_caller' &&
        (draft.designatedCallerAccountId === null ||
          !members.some(
            (member) => member.seated && member.accountId === draft!.designatedCallerAccountId,
          ))
      ) {
        error = 'Designated caller must be a seated campaign member.';
        notice = null;
        shell.announce(error);
        render();
        return;
      }
      const sessionZeroAlreadyRecorded = draft.sessionZero.completed;
      const groupDecisionChanged =
        savedGroupDecisionPolicy !== null &&
        draft.groupDecisionPolicy !== savedGroupDecisionPolicy;
      if (sessionZeroAlreadyRecorded && groupDecisionChanged) {
        const confirmed = await confirmInApp({
          title: 'Change group-decision policy?',
          body:
            'Session Zero was already recorded. Confirm with your table members before saving a new group-decision policy.',
          confirmLabel: 'Save policy change',
          testId: 'group-decision-change-confirm',
        });
        if (!confirmed) {
          return;
        }
      }
      const payload: Record<string, unknown> = {
        contentProfile: draft.contentProfile,
        safetyBoundaries: draft.safetyBoundaries,
        groupDecisionPolicy: draft.groupDecisionPolicy,
        designatedCallerAccountId: draft.designatedCallerAccountId,
        reactionWindowSeconds: draft.reactionWindowSeconds,
        enemyHealthPresentation: draft.enemyHealthPresentation,
        sessionZero: {
          tone: draft.sessionZero.tone,
          characterConflictPolicy: draft.sessionZero.characterConflictPolicy,
          romancePolicy: draft.sessionZero.romancePolicy,
          lethalityPreference: draft.sessionZero.lethalityPreference,
          expectedSessionLength: draft.sessionZero.expectedSessionLength,
          dropInOutPolicy: draft.sessionZero.dropInOutPolicy,
          textChatExpectations: draft.sessionZero.textChatExpectations,
          externalVoiceNote: draft.sessionZero.externalVoiceNote,
          accessibilityNeeds: draft.sessionZero.accessibilityNeeds,
          contentSource: draft.sessionZero.contentSource,
          complete: completeSessionZero,
        },
      };
      busy = true;
      error = null;
      notice = null;
      try {
        settings = await saveCampaignSettings({
          candidateId: candidate.candidateId,
          campaignId,
          payload,
        });
        draft = structuredClone(settings);
        savedGroupDecisionPolicy = settings.groupDecisionPolicy;
        notice = completeSessionZero
          ? sessionZeroAlreadyRecorded
            ? 'Session Zero updated and settings saved.'
            : 'Session Zero recorded and settings saved.'
          : 'Campaign settings saved.';
        shell.announce(notice);
      } catch (failure) {
        error = failure instanceof ApiFailure ? failure.message : 'Settings could not be saved.';
        notice = null;
        shell.announce(error);
      } finally {
        busy = false;
        render();
      }
    };

    container
      .querySelector<HTMLButtonElement>('[data-testid="save-settings"]')
      ?.addEventListener('click', () => void save(false));
    container
      .querySelector<HTMLButtonElement>('[data-testid="complete-session-zero"]')
      ?.addEventListener('click', () => void save(true));
  }

  function render(): void {
    if (!isPageMountCurrent(container, mountToken)) return;
    if (getAccount() === null) {
      if (isHostedPlayerSurface(candidate)) {
        navigate('/', { replace: true });
        return;
      }
      container.innerHTML = renderSignedOutGate({
        title: 'Campaign settings',
        body: 'Sign in to view or edit campaign settings.',
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
    renderForm();
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
      isOwner = detail.campaign.isCampaignOwner;
      const seatedAccountIds = new Set(detail.seats.map((seat) => seat.ownerAccountId));
      members = detail.members.map((member) => ({
        accountId: member.accountId,
        displayLabel: member.displayLabel,
        seated: seatedAccountIds.has(member.accountId),
      }));
      settings = detail.settings;
      draft = structuredClone(detail.settings);
      savedGroupDecisionPolicy = detail.settings.groupDecisionPolicy;
      shell.setDocumentTitle(`Settings · ${detail.campaign.name}`);
    } catch (failure) {
      settings = null;
      draft = null;
      error =
        failure instanceof ApiFailure ? failure.message : 'Campaign settings could not be loaded.';
    }
    render();
  }

  subscribeAccount(() => {
    // Do not reload settings while the owner is mid-edit — account heartbeats were
    // restoring the prior Expected session length over a cleared field (PQA-108).
    if (getAccount() === null) {
      void load();
      return;
    }
    if (settings === null || draft === null) {
      void load();
    }
  });
  void load();
}
