/**
 * A single account-owned character's sheet.
 *
 * Blueprint ownership: Sections 6.5 (derivation and audit) and 7.7 (the
 * server resolves ownership on every sensitive operation — a character
 * belonging to another account is reported exactly as one that does not
 * exist).
 */

import type { CharacterProjection } from '../../shared/character-contract.js';
import { getAccount, subscribeAccount } from '../account-session.js';
import { ApiFailure, fetchCharacter } from '../api.js';
import { bindSignedOutGate, renderSignedOutGate } from '../auth-gate.js';
import { renderCharacterSheet } from '../character-sheet-view.js';
import { escapeHtml } from '../dom-utils.js';
import type { PageHost } from './home.js';

export function mountCharacterSheetPage(host: PageHost, characterId: string): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Character');

  let character: CharacterProjection | null = null;
  let error: string | null = null;
  let gateBusy = false;
  let gateError: string | null = null;
  let active = true;

  function renderSignedIn(): void {
    if (error !== null) {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="character-sheet-heading">Character unavailable</h1>
          <div class="message error" role="alert" tabindex="-1" data-testid="character-error">${escapeHtml(error)}</div>
          <p><a href="/characters" data-link data-testid="back-to-vault">Back to the Character Vault</a></p>
        </div>`;
      return;
    }

    if (character === null) {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="character-sheet-heading">Loading character…</h1>
        </div>`;
      return;
    }

    shell.setDocumentTitle(character.identity.name);
    container.innerHTML = `
      <div class="page">
        <h1 data-testid="character-sheet-heading">${escapeHtml(character.identity.name)}</h1>
        <p class="tagline" data-testid="character-summary">
          Level ${character.level} ${escapeHtml(character.speciesLabel)} ${escapeHtml(character.classLabel)}
          · ${escapeHtml(character.backgroundLabel)}
          ${character.identity.pronouns.length > 0 ? `· ${escapeHtml(character.identity.pronouns)}` : ''}
        </p>
        ${
          character.identity.concept.length > 0
            ? `<p>${escapeHtml(character.identity.concept)}</p>`
            : ''
        }
        ${
          character.identity.appearance.length > 0
            ? `<p class="record-meta">${escapeHtml(character.identity.appearance)}</p>`
            : ''
        }
        ${renderCharacterSheet(character.sheet)}
        <p class="record-meta">Created from rules version ${escapeHtml(character.rulesVersion)}.</p>
        <p><a href="/characters" data-link data-testid="back-to-vault">Back to the Character Vault</a></p>
      </div>`;
  }

  function render(): void {
    if (!active) {
      return;
    }
    if (getAccount() === null) {
      container.innerHTML = renderSignedOutGate({
        title: 'Character',
        body: 'Sign in with a Local Arena development account to view characters you own.',
        candidate,
        busy: gateBusy,
        error: gateError,
      });
      bindSignedOutGate({
        container,
        shell,
        candidate,
        onSignedIn: () => {
          void loadCharacter();
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
    renderSignedIn();
  }

  async function loadCharacter(): Promise<void> {
    error = null;
    character = null;
    render();
    try {
      character = await fetchCharacter(characterId);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'NOT_AUTHENTICATED') {
        render();
        return;
      }
      error =
        failure instanceof ApiFailure
          ? failure.message
          : 'That character could not be loaded.';
    }
    render();
  }

  const unsubscribe = subscribeAccount(() => {
    if (getAccount() === null) {
      character = null;
      error = null;
      render();
      return;
    }
    void loadCharacter();
  });

  const observer = new MutationObserver(() => {
    if (
      !container.querySelector('[data-testid="character-sheet-heading"]') &&
      !container.querySelector('[data-testid="signed-out-heading"]')
    ) {
      active = false;
      unsubscribe();
      observer.disconnect();
    }
  });
  observer.observe(container, { childList: true });

  render();
  if (getAccount() !== null) {
    void loadCharacter();
  }
}
