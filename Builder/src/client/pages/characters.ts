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
import { ApiFailure, fetchVault } from '../api.js';
import { escapeHtml } from '../dom-utils.js';
import { navigate } from '../router.js';
import type { PageHost } from './home.js';

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function mountCharactersPage(host: PageHost): void {
  const { container, shell } = host;
  shell.setDocumentTitle('Character Vault');

  let vault: CharacterVaultProjection | null = null;
  let error: string | null = null;

  function render(): void {
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
        <div class="actions">
          <button type="button" data-testid="start-character">Create a character</button>
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
                    .map(
                      (draft) => `
                    <li data-testid="draft-item">
                      <a class="record-note" href="/characters/new" data-link data-testid="resume-draft">
                        ${draft.classLabel === null || draft.classLabel === 'Unchosen' ? 'Unnamed draft' : escapeHtml(draft.classLabel)}
                      </a>
                      <span class="record-meta">
                        ${draft.unresolvedCount === 0 ? 'Ready to create' : `${draft.unresolvedCount} decision(s) remaining`}
                        · last saved ${escapeHtml(formatTimestamp(draft.updatedAt))}
                      </span>
                    </li>`,
                    )
                    .join('')}
                </ul>
              </section>`
        }
      </div>`;

    container
      .querySelector<HTMLButtonElement>('[data-testid="start-character"]')
      ?.addEventListener('click', () => navigate('/characters/new'));
  }

  render();

  void (async () => {
    try {
      vault = await fetchVault();
    } catch (failure) {
      error =
        failure instanceof ApiFailure
          ? failure.message
          : 'The Character Vault could not be loaded.';
    }
    render();
  })();
}
