/**
 * Join a table: optional password, character pick, then route to /table.
 */

import type { TablesHubProjection } from '../../shared/campaign-contract.js';
import { CAMPAIGN_JOIN_LEVEL_TOLERANCE } from '../../shared/campaign-contract.js';
import { ERROR_CODES } from '../../shared/contract.js';
import { getAccount, subscribeAccount } from '../account-session.js';
import {
  ApiFailure,
  createCampaignInvitation,
  deleteCampaign,
  discardDraft,
  fetchCampaignDetail,
  fetchTablesHub,
  fetchVault,
  joinCampaignTable,
} from '../api.js';
import { bindSignedOutGate, renderSignedOutGate } from '../auth-gate.js';
import { escapeHtml } from '../dom-utils.js';
import { beginPageMount, isPageMountCurrent } from '../page-mount.js';
import { isHostedPlayerSurface } from '../player-surface.js';
import { confirmInApp } from '../confirm-dialog.js';
import { navigate } from '../router.js';
import { rememberPendingJoin } from '../pending-join.js';
import type { PageHost } from './home.js';

type VaultCharacterOption = {
  readonly characterId: string;
  readonly label: string;
  readonly level: number;
  readonly seatedElsewhere: boolean;
  readonly seatedCampaignName: string | null;
};

function joinQueryFlags(): { created: boolean; privateTable: boolean } {
  const params = new URLSearchParams(window.location.search);
  return {
    created: params.get('created') === '1',
    privateTable: params.get('private') === '1',
  };
}

export function mountCampaignJoinPage(host: PageHost, campaignId: string): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Join Campaign');

  let hub: TablesHubProjection | null = null;
  let tableName = 'Campaign';
  let directorLabel: string | null = null;
  let campaignTargetLevel = 1;
  let passwordProtected = false;
  let password = '';
  let characterId = '';
  let characters: VaultCharacterOption[] = [];
  let draftCount = 0;
  let charactersLoading = false;
  let alreadySeatedHere = false;
  let seatedCharacterName: string | null = null;
  let isCampaignOwner = false;
  let busy = false;
  let error: string | null = null;
  let gateBusy = false;
  let gateError: string | null = null;
  let invitePath: string | null = null;
  let inviteCopyFeedback: string | null = null;
  const { created: justCreated, privateTable: createdPrivate } = joinQueryFlags();
  const mountToken = beginPageMount(container);

  function selectedCharacter(): VaultCharacterOption | null {
    return characters.find((character) => character.characterId === characterId) ?? null;
  }

  function renderOrientationCard(): string {
    if (!justCreated) {
      return '';
    }
    const privateInvite = createdPrivate
      ? `<div data-testid="join-created-invite-panel">
           <p class="record-meta" data-testid="join-created-invite-hint">
             Private tables use invite links. Create a link here to share — you can refresh or revoke it later
             on the campaign page. Rotation replaces the old link.
           </p>
           ${
             invitePath === null
               ? `<p>
                    <button type="button" data-testid="join-create-invite" ${busy ? 'aria-disabled="true"' : ''}>
                      Create invite link
                    </button>
                  </p>`
               : `<p class="record-meta" data-testid="join-invite-path">${escapeHtml(invitePath)}</p>
                  <p>
                    <button type="button" data-testid="join-copy-invite" ${busy ? 'aria-disabled="true"' : ''}>
                      Copy invite link
                    </button>
                  </p>`
           }
           ${
             inviteCopyFeedback === null
               ? ''
               : `<p class="message success" data-testid="join-invite-copy-feedback">${escapeHtml(inviteCopyFeedback)}</p>`
           }
         </div>`
      : '';
    return `
      <section class="panel" data-testid="join-created-orientation" aria-labelledby="join-created-heading">
        <h2 id="join-created-heading">Campaign created — now take a seat</h2>
        <p>
          ${escapeHtml(tableName)} is ready. Pick a character below to sit at this campaign the same way
          every other player does${
            directorLabel === null ? '' : ` with ${escapeHtml(directorLabel)} as Game Director`
          }.
        </p>
        ${privateInvite}
      </section>`;
  }

  function renderAlreadySeated(): void {
    const orientation =
      justCreated
        ? `<p class="message success" data-testid="join-created-orientation">
             You are seated at ${escapeHtml(tableName)}${
               seatedCharacterName === null ? '' : ` as ${escapeHtml(seatedCharacterName)}`
             }${
               directorLabel === null ? '' : ` with ${escapeHtml(directorLabel)}`
             }.
           </p>`
        : `<p class="message success" data-testid="join-already-seated">
             You are already seated here${
               seatedCharacterName === null ? '' : ` as ${escapeHtml(seatedCharacterName)}`
             }.
           </p>`;
    container.innerHTML = `
      <div class="page">
        <h1 data-testid="join-table-heading">Join ${escapeHtml(tableName)}</h1>
        ${orientation}
        <div class="actions">
          <a class="button" href="/campaigns/${escapeHtml(campaignId)}/table" data-link data-testid="join-open-table">
            Open table
          </a>
          <a class="button" href="/campaigns/${escapeHtml(campaignId)}" data-link data-testid="join-manage-campaign">
            Manage Campaign
          </a>
          ${
            createdPrivate
              ? `<a class="button secondary" href="/campaigns/${escapeHtml(campaignId)}" data-link data-testid="join-created-invite-link">
                   Copy invite from campaign
                 </a>`
              : ''
          }
          ${
            isCampaignOwner
              ? `<button type="button" class="danger" data-testid="join-delete-campaign" ${busy ? 'disabled' : ''}>
                   Delete Campaign
                 </button>`
              : ''
          }
          <a class="button secondary" href="/campaigns" data-link data-testid="join-table-back">Back to Campaigns</a>
        </div>
      </div>`;
    bindJoinDeleteButton();
  }

  function bindJoinDeleteButton(): void {
    container
      .querySelector<HTMLButtonElement>('[data-testid="join-delete-campaign"]')
      ?.addEventListener('click', () => {
        if (candidate === null || busy) {
          return;
        }
        void (async () => {
          const accepted = await confirmInApp({
            title: `Delete "${tableName}"?`,
            body: `Permanently delete "${tableName}" and remove its campaign records for all members? Characters keep their persistent inventory and cross-campaign history.`,
            confirmLabel: 'Delete campaign',
            cancelLabel: 'Keep campaign',
            testId: 'confirm-join-delete-campaign',
          });
          if (!accepted) {
            return;
          }
          busy = true;
          error = null;
          renderForm();
          try {
            await deleteCampaign({
              candidateId: candidate.candidateId,
              campaignId,
            });
            shell.announce(`Deleted campaign ${tableName}.`);
            navigate('/campaigns');
          } catch (failure) {
            busy = false;
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Campaign could not be deleted.';
            renderForm();
          }
        })();
      });
  }

  function renderForm(): void {
    if (alreadySeatedHere) {
      renderAlreadySeated();
      return;
    }
    const activeElsewhere =
      hub?.activeSeat !== null &&
      hub?.activeSeat !== undefined &&
      hub.activeSeat.campaignId !== campaignId
        ? hub.activeSeat
        : null;
    const selected = selectedCharacter();
    container.innerHTML = `
      <div class="page">
        <h1 data-testid="join-table-heading">Join ${escapeHtml(tableName)}</h1>
        ${renderOrientationCard()}
        <p class="tagline">Pick a character you own, then join the table.</p>
        ${
          activeElsewhere === null
            ? ''
            : `<p class="message notice" data-testid="join-active-seat-notice">
                 You are currently seated at
                 <a href="/campaigns/${escapeHtml(activeElsewhere.campaignId)}/table" data-link>
                   ${escapeHtml(activeElsewhere.campaignName)}
                 </a>
                 as ${escapeHtml(activeElsewhere.characterName)}. Joining here leaves that seat
                 but keeps the old table in your history.
               </p>`
        }
        ${
          error === null
            ? ''
            : `<div class="message error" role="alert" tabindex="-1" data-testid="join-table-error">${escapeHtml(error)}</div>`
        }
        ${
          passwordProtected
            ? `<label class="field">
                 <span>Table password</span>
                 <input type="password" data-testid="join-table-password" autocomplete="current-password"
                   value="${escapeHtml(password)}" />
               </label>`
            : ''
        }
        <label class="field">
          <span>Character</span>
          <select data-testid="join-character-select" ${busy || charactersLoading ? 'disabled' : ''}>
            <option value="">${charactersLoading ? 'Loading characters…' : 'Choose a character…'}</option>
            ${characters
              .map(
                (character) =>
                  `<option value="${escapeHtml(character.characterId)}" ${
                    character.characterId === characterId ? 'selected' : ''
                  }>${escapeHtml(character.label)}</option>`,
              )
              .join('')}
          </select>
        </label>
        ${
          selected?.seatedElsewhere
            ? `<p class="message notice" data-testid="join-character-seated-elsewhere">
                 ${escapeHtml(selected.label.split(' — ')[0] ?? 'This character')} is already seated
                 at ${escapeHtml(selected.seatedCampaignName ?? 'another campaign')}. Joining here
                 switches that seat while keeping their campaign history and inventory.
               </p>`
            : ''
        }
        ${
          selected !== null &&
          Math.abs(selected.level - campaignTargetLevel) > CAMPAIGN_JOIN_LEVEL_TOLERANCE
            ? `<p class="message notice" role="status" data-testid="join-level-mismatch-warning">
                 <strong>Level Mismatch Warning:</strong> ${escapeHtml(selected.label.split(' — ')[0] ?? 'This character')} is Level ${selected.level}, while ${escapeHtml(tableName)} is around Level ${campaignTargetLevel} (recommended range: Levels ${Math.max(1, campaignTargetLevel - CAMPAIGN_JOIN_LEVEL_TOLERANCE)}–${Math.min(20, campaignTargetLevel + CAMPAIGN_JOIN_LEVEL_TOLERANCE)}). You will be asked to confirm before joining.
               </p>`
            : ''
        }
        ${
          charactersLoading
            ? '<p class="record-meta" data-testid="join-characters-loading">Loading your characters…</p>'
            : ''
        }
        ${
          draftCount > 0
            ? `<p class="record-meta" data-testid="join-draft-warning">
                 You have an unfinished character draft. Starting New character discards that draft.
               </p>`
            : ''
        }
        <div class="actions">
          <button type="button" data-testid="join-table-submit"
            aria-disabled="${busy || charactersLoading || characterId.length === 0 ? 'true' : 'false'}">
            ${busy ? 'Joining…' : 'Join Campaign'}
          </button>
          <a class="button" href="/campaigns/${escapeHtml(campaignId)}" data-link data-testid="join-manage-campaign">
            Manage Campaign
          </a>
          ${
            isCampaignOwner
              ? `<button type="button" class="danger" data-testid="join-delete-campaign" ${busy ? 'disabled' : ''}>
                   Delete Campaign
                 </button>`
              : ''
          }
          <a class="button secondary" href="/characters/new?returnCampaign=${escapeHtml(campaignId)}" data-link data-testid="join-new-character">
            New character
          </a>
          <a class="button secondary" href="/campaigns" data-link data-testid="join-table-back">Back to Campaigns</a>
        </div>
      </div>`;
    bindJoinDeleteButton();

    container
      .querySelector<HTMLSelectElement>('[data-testid="join-character-select"]')
      ?.addEventListener('change', (event) => {
        if (event.target instanceof HTMLSelectElement) {
          characterId = event.target.value;
          renderForm();
        }
      });

    container
      .querySelector<HTMLInputElement>('[data-testid="join-table-password"]')
      ?.addEventListener('input', (event) => {
        if (event.target instanceof HTMLInputElement) {
          password = event.target.value;
        }
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="join-table-submit"]')
      ?.addEventListener('click', () => {
        void submitJoin(false);
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="join-create-invite"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy) {
            return;
          }
          busy = true;
          error = null;
          inviteCopyFeedback = null;
          renderForm();
          try {
            const invitation = await createCampaignInvitation({
              candidateId: candidate.candidateId,
              campaignId,
            });
            invitePath = `${window.location.origin}${invitation.invitePath}`;
            shell.announce('Invite link ready.');
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'The invitation could not be created.';
          } finally {
            busy = false;
            renderForm();
          }
        })();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="join-copy-invite"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (invitePath === null) {
            return;
          }
          try {
            await navigator.clipboard.writeText(invitePath);
            inviteCopyFeedback = 'Invite URL copied.';
            shell.announce('Invite URL copied.');
          } catch {
            inviteCopyFeedback = 'Could not copy automatically — select the URL above and copy it.';
          }
          renderForm();
        })();
      });

    container
      .querySelector<HTMLAnchorElement>('[data-testid="join-new-character"]')
      ?.addEventListener('click', (event) => {
        if (draftCount === 0) {
          return;
        }
        event.preventDefault();
        void (async () => {
          const accepted = await confirmInApp({
            title: 'Create new character?',
            body: 'This replaces your current draft with a fresh character. Your unfinished draft will be discarded.',
            confirmLabel: 'Discard draft and start',
            cancelLabel: 'Keep draft',
            testId: 'confirm-join-new-character',
          });
          if (!accepted || candidate === null) {
            return;
          }
          try {
            const vault = await fetchVault();
            for (const draft of vault.drafts) {
              await discardDraft({ candidateId: candidate.candidateId, draftId: draft.draftId });
            }
          } catch {
            // Navigation still proceeds; vault will show any leftover draft.
          }
          navigate(`/characters/new?returnCampaign=${encodeURIComponent(campaignId)}`);
        })();
      });
  }

  async function submitJoin(confirmSwitch: boolean): Promise<void> {
    if (candidate === null || characterId.length === 0) {
      error = 'Choose a character before joining.';
      render();
      return;
    }
    const chosen = selectedCharacter();
    if (
      !confirmSwitch &&
      chosen !== null &&
      Math.abs(chosen.level - campaignTargetLevel) > CAMPAIGN_JOIN_LEVEL_TOLERANCE
    ) {
      const proceed = await confirmInApp({
        title: 'Character level outside recommended range',
        body: `${chosen.label.split(' — ')[0] ?? 'Your character'} is Level ${chosen.level}, while ${tableName} is around Level ${campaignTargetLevel} (recommended ±${CAMPAIGN_JOIN_LEVEL_TOLERANCE} level range: Levels ${Math.max(1, campaignTargetLevel - CAMPAIGN_JOIN_LEVEL_TOLERANCE)}–${Math.min(20, campaignTargetLevel + CAMPAIGN_JOIN_LEVEL_TOLERANCE)}). Join this campaign anyway?`,
        confirmLabel: 'Join campaign anyway',
        cancelLabel: 'Pick another character',
        testId: 'confirm-join-level-mismatch',
      });
      if (!proceed) {
        return;
      }
    }
    busy = true;
    error = null;
    render();
    try {
      await joinCampaignTable({
        candidateId: candidate.candidateId,
        campaignId,
        characterId,
        ...(passwordProtected && password.length > 0 ? { password } : {}),
        ...(confirmSwitch ? { confirmSwitch: true } : {}),
      });
      rememberPendingJoin(campaignId, characterId);
      const joinedAs = selectedCharacter()?.label.split(' — ')[0] ?? 'your character';
      shell.announce(
        `Joined ${tableName} as ${joinedAs}${
          directorLabel === null ? '' : ` · Director ${directorLabel}`
        }.`,
      );
      navigate(`/campaigns/${campaignId}/table`);
    } catch (failure) {
      if (
        failure instanceof ApiFailure &&
        failure.code === ERROR_CODES.ALREADY_AT_ANOTHER_TABLE &&
        !confirmSwitch
      ) {
        const current = hub?.activeSeat;
        const ok = await confirmInApp({
          title: 'Switch tables?',
          body:
            current === null || current === undefined
              ? 'You are seated at another table. Leave that seat and join this one? Your old table stays in My tables.'
              : `You are seated at ${current.campaignName} as ${current.characterName}. Leave that seat and join ${tableName}? Your old table stays in My tables.`,
          confirmLabel: 'Switch tables',
          cancelLabel: 'Stay at current table',
          testId: 'confirm-switch-table',
        });
        if (ok) {
          await submitJoin(true);
          return;
        }
        error = null;
        shell.announce('Stayed at your current table.');
        return;
      }
      if (
        failure instanceof ApiFailure &&
        failure.code === ERROR_CODES.ALREADY_SEATED
      ) {
        alreadySeatedHere = true;
        error = null;
        render();
        return;
      }
      error =
        failure instanceof ApiFailure ? failure.message : 'Could not join this table.';
    } finally {
      busy = false;
      if (!alreadySeatedHere) {
        render();
      }
    }
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
        title: 'Join table',
        body: 'Sign in before joining a table.',
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
    if (hub === null && error === null) {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="join-table-heading">Join table</h1>
          <p class="tagline">Loading table…</p>
        </div>`;
      return;
    }
    renderForm();
  }

  async function loadCharacters(): Promise<void> {
    charactersLoading = true;
    renderForm();
    try {
      const vault = await fetchVault();
      draftCount = vault.drafts.length;
      characters = vault.characters.map((character) => {
        const seatedNames = character.seatedCampaignNames ?? [];
        const seatedElsewhere =
          seatedNames.length > 0 &&
          (character.seatedCampaignId === undefined ||
            character.seatedCampaignId === null ||
            character.seatedCampaignId !== campaignId);
        const seatHint =
          seatedNames.length === 0
            ? 'Not seated'
            : `Seated: ${seatedNames.join(', ')}`;
        return {
          characterId: character.characterId,
          label: `${character.name} — Level ${character.level} ${character.speciesLabel} ${character.classLabel} · ${seatHint}`,
          level: character.level,
          seatedElsewhere,
          seatedCampaignName: seatedNames[0] ?? null,
        };
      });
      if (characterId.length === 0 && characters.length > 0) {
        const seatFromQuery = new URLSearchParams(window.location.search).get('seatCharacter');
        const matchedQuery =
          seatFromQuery !== null
            ? characters.find((entry) => entry.characterId === seatFromQuery)
            : undefined;
        const firstUnseated = characters.find((entry) => !entry.seatedElsewhere);
        characterId = (matchedQuery ?? firstUnseated ?? characters[0]!).characterId;
      }
    } catch {
      characters = [];
      draftCount = 0;
    } finally {
      charactersLoading = false;
      if (isPageMountCurrent(container, mountToken)) {
        renderForm();
      }
    }
  }

  async function load(): Promise<void> {
    if (getAccount() === null) {
      render();
      return;
    }
    error = null;
    render();
    try {
      hub = await fetchTablesHub();
      alreadySeatedHere = hub.activeSeat?.campaignId === campaignId;
      seatedCharacterName = alreadySeatedHere ? (hub.activeSeat?.characterName ?? null) : null;
      try {
        const detail = await fetchCampaignDetail(campaignId);
        tableName = detail.campaign.name;
        passwordProtected = detail.campaign.passwordProtected;
        directorLabel = detail.campaign.director.identityLabel;
        isCampaignOwner = detail.campaign.isCampaignOwner;
        campaignTargetLevel =
          detail.campaign.partyAverageLevel ?? detail.campaign.recommendedStartLevel ?? 1;
        if (detail.ownSeat !== null) {
          alreadySeatedHere = true;
          seatedCharacterName = detail.ownSeat.characterName;
        } else {
          const account = getAccount();
          const ownSeat =
            account === null
              ? undefined
              : detail.seats.find((seat) => seat.ownerAccountId === account.accountId);
          if (ownSeat !== undefined) {
            alreadySeatedHere = true;
            seatedCharacterName = ownSeat.characterName;
          }
        }
      } catch (detailFailure) {
        const fromHub =
          hub.myTables.find((table) => table.campaignId === campaignId) ??
          hub.openTables.find((table) => table.campaignId === campaignId);
        if (fromHub === undefined) {
          throw detailFailure;
        }
        tableName = fromHub.name;
        passwordProtected = fromHub.passwordProtected;
        isCampaignOwner =
          ('isCampaignOwner' in fromHub && fromHub.isCampaignOwner) ||
          (fromHub.ownerAccountId !== undefined &&
            fromHub.ownerAccountId === getAccount()?.accountId);
        campaignTargetLevel =
          fromHub.partyAverageLevel ?? fromHub.recommendedStartLevel ?? 1;
        directorLabel =
          'director' in fromHub
            ? fromHub.director.identityLabel
            : fromHub.directorIdentityLabel;
      }
    } catch (failure) {
      hub = null;
      error =
        failure instanceof ApiFailure ? failure.message : 'This table could not be loaded.';
    }
    render();
    if (!alreadySeatedHere && getAccount() !== null) {
      void loadCharacters();
    }
  }

  subscribeAccount(() => {
    void load();
  });
  void load();
}
