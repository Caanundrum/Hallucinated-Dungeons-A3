/**
 * The Character Vault: every character this account owns, plus any draft
 * still in progress.
 *
 * Blueprint ownership: Section 25 Phase 1 build scope (Character Vault,
 * ownership) and Section 6.4 ("permit the player to leave and resume without
 * creating duplicate characters" — a draft in progress is shown here as a
 * resumable item rather than being silently replaced).
 */

import type { CharacterVaultProjection } from '../../shared/character-contract.js';
import { getAccount, isAccountHydrated, subscribeAccount } from '../account-session.js';
import { ApiFailure, discardDraft, fetchVault } from '../api.js';
import { bindSignedOutGate, renderSignedOutGate } from '../auth-gate.js';
import { confirmInApp } from '../confirm-dialog.js';
import { escapeHtml } from '../dom-utils.js';
import {
  isLegalPlayBlocked,
  loadLegalPlayAcceptance,
  renderLegalVaultPlayBarrier,
  type LegalAcceptanceProjection,
} from '../legal-play-gate.js';
import { beginPageMount, isPageMountCurrent } from '../page-mount.js';
import { isHostedPlayerSurface } from '../player-surface.js';
import { navigate } from '../router.js';
import type { PageHost } from './home.js';

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function mountCharactersPage(host: PageHost): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Character Vault');

  let vault: CharacterVaultProjection | null = null;
  let error: string | null = null;
  let gateBusy = false;
  let gateError: string | null = null;
  let legalAcceptance: LegalAcceptanceProjection | null = null;
  const mountToken = beginPageMount(container);

  function playActionsBlocked(): boolean {
    return isLegalPlayBlocked(legalAcceptance);
  }

  function renderSignedIn(): void {
    const characters = vault?.characters ?? [];
    const drafts = vault?.drafts ?? [];

    container.innerHTML = `
      <div class="page">
        <h1 data-testid="vault-heading">Character Vault</h1>
        <p class="tagline">
          Every character below belongs to your account. Characters are created and stored inside
          Hallucinated Dungeons; there is no import from a file or another service.
        </p>
        ${
          error === null
            ? ''
            : `<div class="message error" role="alert" tabindex="-1" data-testid="vault-error">${escapeHtml(error)}</div>`
        }
        ${renderLegalVaultPlayBarrier(legalAcceptance)}
        <div class="actions">
          ${
            drafts.length > 0
              ? `<button type="button" data-testid="resume-draft"
                   aria-disabled="${playActionsBlocked() ? 'true' : 'false'}">Resume draft</button>
                 <button type="button" data-testid="start-character"
                   aria-disabled="${playActionsBlocked() ? 'true' : 'false'}">Create new character</button>`
              : `<button type="button" data-testid="start-character"
                   aria-disabled="${playActionsBlocked() ? 'true' : 'false'}">Create a character</button>`
          }
        </div>

        <section class="panel" aria-labelledby="characters-heading">
          <h2 id="characters-heading">Your characters</h2>
          ${
            characters.length === 0
              ? '<p class="empty-state" data-testid="vault-empty">You have not created a character yet.</p>'
              : `<ul class="record-list" data-testid="character-list">
                  ${characters
                    .map(
                      (character) => `
                    <li data-testid="character-item">
                      <a class="record-note" href="/characters/${escapeHtml(character.characterId)}" data-link data-testid="character-link">
                        ${escapeHtml(character.name)}
                      </a>
                      <span class="record-meta">
                        Level ${character.level} ${escapeHtml(character.speciesLabel)} ${escapeHtml(character.classLabel)}
                        · ${escapeHtml(character.backgroundLabel)}
                        · created ${escapeHtml(formatTimestamp(character.createdAt))}
                      </span>
                    </li>`,
                    )
                    .join('')}
                </ul>`
          }
        </section>

        ${
          drafts.length === 0
            ? ''
            : `<section class="panel" aria-labelledby="drafts-heading">
                <h2 id="drafts-heading">Unfinished drafts</h2>
                <p>A draft is saved after every confirmed step. Resuming continues the same draft rather than starting a second one.</p>
                <ul class="record-list" data-testid="draft-list">
                  ${drafts
                    .map((draft) => {
                      const titleParts = [
                        draft.name.length > 0 ? draft.name : null,
                        draft.classLabel === null || draft.classLabel === 'Unchosen'
                          ? null
                          : draft.classLabel,
                        draft.backgroundLabel === null || draft.backgroundLabel === 'Unchosen'
                          ? null
                          : draft.backgroundLabel,
                        draft.speciesLabel === null || draft.speciesLabel === 'Unchosen'
                          ? null
                          : draft.speciesLabel,
                      ].filter((part): part is string => part !== null);
                      const title =
                        titleParts.length === 0
                          ? 'Unnamed draft'
                          : draft.name.length > 0
                            ? `${draft.name} · ${titleParts.slice(1).join(' · ') || 'In progress'}`
                            : titleParts.join(' · ');
                      const remaining =
                        draft.unresolvedCount === 0
                          ? 'Ready to create'
                          : draft.unresolvedCount === 1
                            ? '1 decision remaining'
                            : `${draft.unresolvedCount} decisions remaining`;
                      return `
                    <li data-testid="draft-item">
                      <a class="record-note" href="/characters/new" data-link data-testid="resume-draft"
                        ${playActionsBlocked() ? 'data-legal-gated-play="true"' : ''}>
                        ${escapeHtml(title)}
                      </a>
                      <span class="record-meta">
                        ${escapeHtml(remaining)}
                        · last saved ${escapeHtml(formatTimestamp(draft.updatedAt))}
                      </span>
                    </li>`;
                    })
                    .join('')}
                </ul>
              </section>`
        }
      </div>`;

    container
      .querySelector<HTMLButtonElement>('[data-testid="resume-draft"]')
      ?.addEventListener('click', () => {
        if (playActionsBlocked()) {
          navigate('/account');
          return;
        }
        navigate('/characters/new');
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="start-character"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (playActionsBlocked()) {
            navigate('/account');
            return;
          }
          if (drafts.length === 0) {
            navigate('/characters/new');
            return;
          }
          const accepted = await confirmInApp({
            title: 'Create new character?',
            body: 'This replaces your current draft with a fresh character. Your unfinished draft will be discarded.',
            confirmLabel: 'Discard draft and start',
            cancelLabel: 'Keep draft',
            testId: 'confirm-new-character',
          });
          if (!accepted || candidate === null) {
            return;
          }
          for (const draft of drafts) {
            await discardDraft({ candidateId: candidate.candidateId, draftId: draft.draftId });
          }
          navigate('/characters/new');
        })();
      });

    container.querySelectorAll<HTMLAnchorElement>('[data-legal-gated-play="true"]').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        navigate('/account');
      });
    });
  }

  function render(): void {
    if (!isPageMountCurrent(container, mountToken)) {
      return;
    }
    if (!isAccountHydrated()) {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="vault-heading">Character Vault</h1>
          <p class="tagline" data-testid="vault-loading">Checking your session…</p>
        </div>`;
      return;
    }
    if (getAccount() === null) {
      if (isHostedPlayerSurface(candidate)) {
        navigate('/', { replace: true });
        return;
      }
      container.innerHTML = renderSignedOutGate({
        title: 'Character Vault',
        body: 'Sign in with a Local Arena development account to see and create characters you own.',
        candidate,
        busy: gateBusy,
        error: gateError,
      });
      bindSignedOutGate({
        container,
        shell,
        candidate,
        onSignedIn: () => {
          void loadVault();
        },
        setBusy: (busy) => {
          gateBusy = busy;
        },
        setError: (message) => {
          gateError = message;
        },
        render,
      });
      return;
    }
    if (vault === null && error === null) {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="vault-heading">Character Vault</h1>
          <p class="tagline" data-testid="vault-loading">Loading your characters…</p>
        </div>`;
      return;
    }
    renderSignedIn();
  }

  async function loadVault(): Promise<void> {
    error = null;
    legalAcceptance = await loadLegalPlayAcceptance();
    try {
      vault = await fetchVault();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'NOT_AUTHENTICATED') {
        vault = null;
        render();
        return;
      }
      error =
        failure instanceof ApiFailure
          ? failure.message
          : 'The Character Vault could not be loaded.';
    }
    render();
  }

  subscribeAccount(() => {
    if (!isPageMountCurrent(container, mountToken)) {
      return;
    }
    if (getAccount() === null) {
      vault = null;
      render();
      return;
    }
    void loadVault();
  });

  render();
  if (getAccount() !== null) {
    void loadVault();
  }
}
