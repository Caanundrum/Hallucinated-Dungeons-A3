/**
 * The Account page: Phase 1's product surface for the Development Test Identity.
 *
 * Blueprint ownership: Section 1.5.20 and P1-ACCOUNT-PROJECTION. No second
 * identity provider, password, or Google flow appears here. The page projects
 * the existing Local Arena identity as the account that owns characters and
 * (later) campaigns.
 */

import {
  NARRATION_DENSITIES,
  NARRATION_DENSITY_LABELS,
  NARRATION_DENSITY_SUMMARIES,
  isNarrationDensity,
  type NarrationDensity,
} from '../../shared/settings-contract.js';
import { getAccount, signInAccount, signInGoogleEmulator, signInHostedGoogle, signOutAccount, subscribeAccount } from '../account-session.js';
import {
  ApiFailure,
  acceptLegalDocument,
  fetchAccountDeletionStatus,
  fetchGoldMasterPackage,
  fetchLegalAcceptance,
  fetchPlayerSettings,
  requestAccountDeletion,
  savePlayerSettings,
  type AccountDeletionStatusProjection,
  type GoldMasterPackageProjection,
  type LegalAcceptanceProjection,
} from '../api.js';
import { escapeHtml } from '../dom-utils.js';
import { beginPageMount, isPageMountCurrent } from '../page-mount.js';
import {
  applyPresentationPreferences,
  clearPresentationPreferences,
} from '../presentation-preferences.js';
import type { PageHost } from './home.js';

interface GoogleIdentityServices {
  readonly accounts: {
    readonly id: {
      initialize: (config: {
        client_id: string;
        callback: (response: { credential: string }) => void;
        ux_mode?: 'popup' | 'redirect' | string;
      }) => void;
      prompt: () => void;
      renderButton?: (parent: HTMLElement, options: Record<string, string>) => void;
    };
  };
}

function googleIdentity(): GoogleIdentityServices | undefined {
  return (window as unknown as { google?: GoogleIdentityServices }).google;
}

function loadGoogleIdentityServices(): Promise<void> {
  if (googleIdentity()?.accounts.id !== undefined) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-hd-gis]');
    if (existing instanceof HTMLScriptElement) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Google Sign-In failed to load.')), {
        once: true,
      });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.dataset.hdGis = 'true';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Google Sign-In failed to load.')), {
      once: true,
    });
    document.head.appendChild(script);
  });
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function mountAccountPage(host: PageHost): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Account');

  let busy = false;
  let error: string | null = null;
  let reducedMotion = false;
  let lowEffects = false;
  let textToSpeechEnabled = false;
  let speechToTextEnabled = false;
  let narrationDensity: NarrationDensity = 'balanced';
  let deletionStatus: AccountDeletionStatusProjection | null = null;
  let googleEmail = 'phase7-player@example.com';
  let legalAcceptance: LegalAcceptanceProjection | null = null;
  let goldMaster: GoldMasterPackageProjection | null = null;
  const goldMasterSurface = candidate?.publicSurface === 'gold_master';
  const hostedGoogleClientId = candidate?.hostedGoogleClientId ?? null;
  const mountToken = beginPageMount(container);

  function render(): void {
    if (!isPageMountCurrent(container, mountToken)) {
      return;
    }
    const account = getAccount();

    if (account === null) {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="account-heading">Account</h1>
          <p class="tagline">
            ${
              goldMasterSurface
                ? 'Hosted player identity uses Google Sign-In only. This Gold Master artifact does not mint Local Arena development identities.'
                : 'Local Arena testing can mint a development account. Hosted Gold Master artifacts use Google Sign-In only.'
            }
          </p>
          ${
            error === null
              ? ''
              : `<div class="message error" role="alert" tabindex="-1" data-testid="account-error">${escapeHtml(error)}</div>`
          }
          ${
            goldMasterSurface
              ? ''
              : `<section class="panel" aria-labelledby="sign-in-heading">
            <h2 id="sign-in-heading">Development account</h2>
            <p>
              The server mints a temporary development identity for local testing.
              There is no password to create or store. This path is stripped from Gold Master artifacts.
            </p>
            <div class="actions">
              ${
                candidate === null
                  ? `<button type="button" data-testid="account-retry-candidate">Retry connection</button>`
                  : `<button type="button" data-testid="account-enter"
                       aria-disabled="${busy}">
                       ${busy ? 'Signing in…' : 'Sign in for local testing'}
                     </button>`
              }
            </div>
          </section>`
          }
          <section class="panel" aria-labelledby="google-sign-in-heading">
            <h2 id="google-sign-in-heading">Google Sign-In</h2>
            <p>
              ${
                hostedGoogleClientId !== null
                  ? 'Invite-Only Alpha uses Google Sign-In only. There is no development login and no password on this site.'
                  : 'Hosted player identity is Google-only. On this Local Arena host the control talks to the Auth emulator — it is not a live OAuth popup against a public Google Cloud project.'
              }
            </p>
            ${
              hostedGoogleClientId !== null
                ? `<div class="record-meta">
              <p class="record-meta">
                Welcome, player. Sign in to join as Codex / Antigravity and start creating characters.
              </p>
              <p class="record-meta">
                No passwords. One secure Google redirect, then you’re in the game.
              </p>
              <div class="actions">
                ${
                  candidate === null
                    ? `<button type="button" data-testid="account-retry-candidate">Retry connection</button>`
                    : `<button type="button" data-testid="account-hosted-begin" aria-disabled="${busy}">
                        ${busy ? 'Preparing…' : 'Begin your adventure'}
                      </button>`
                }
              </div>
            </div>`
                : `<label class="field">
              <span>Emulator email</span>
              <input type="email" data-testid="account-google-email" value="${escapeHtml(googleEmail)}" />
            </label>
            <div class="actions">
              ${
                candidate === null
                  ? `<button type="button" data-testid="account-retry-candidate">Retry connection</button>`
                  : `<button type="button" data-testid="account-google-emulator-enter"
                       aria-disabled="${busy}">
                       ${busy ? 'Signing in…' : 'Sign in with Google emulator'}
                     </button>`
              }
            </div>`
            }
          </section>
        </div>`;
    } else {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="account-heading">Account</h1>
          <p class="tagline">
            ${
              hostedGoogleClientId !== null
                ? 'Signed in with Google. Characters you create are owned by this account.'
                : 'Signed in for local testing. Characters you create are owned by this account.'
            }
          </p>
          ${
            error === null
              ? ''
              : `<div class="message error" role="alert" tabindex="-1" data-testid="account-error">${escapeHtml(error)}</div>`
          }
          <section class="panel" aria-labelledby="account-details-heading">
            <h2 id="account-details-heading">${hostedGoogleClientId !== null ? 'Your account' : 'Your development account'}</h2>
            <dl class="account-details" data-testid="account-details">
              <div>
                <dt>Display name</dt>
                <dd data-testid="account-display-label">${escapeHtml(account.displayLabel)}</dd>
              </div>
              <div>
                <dt>Account id</dt>
                <dd><code data-testid="account-page-id">${escapeHtml(account.accountId)}</code></dd>
              </div>
              <div>
                <dt>Identity mode</dt>
                <dd data-testid="account-identity-mode">${escapeHtml(account.identityMode)}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd data-testid="account-email">${escapeHtml(account.email ?? 'none')}</dd>
              </div>
              <div>
                <dt>Bootstrap admin</dt>
                <dd data-testid="account-is-bootstrap-admin">${account.isBootstrapAdmin ? 'yes' : 'no'}</dd>
              </div>
              <div>
                <dt>Session expires</dt>
                <dd data-testid="account-expires">${escapeHtml(formatTimestamp(account.expiresAt))}</dd>
              </div>
            </dl>
            <div class="actions">
              <button type="button" class="secondary" data-testid="account-leave"
                aria-disabled="${busy}">
                ${busy ? 'Signing out…' : 'Sign out'}
              </button>
              <a href="/characters" data-link data-testid="account-characters-link">Open Character Vault</a>
              <a href="/campaigns" data-link data-testid="account-campaigns-link">Open Campaigns</a>
              <a href="/admin" data-link data-testid="account-admin-link">Admin panel</a>
            </div>
          </section>
          <section class="panel" aria-labelledby="presentation-heading">
            <h2 id="presentation-heading">Presentation</h2>
            <p class="record-meta">
              Speech is player-optional. Text-to-speech only reads already-visible text.
              Speech-to-text only fills editable unsent drafts — never auto-submits.
            </p>
            <label class="option">
              <input type="checkbox" data-testid="account-reduced-motion" ${reducedMotion ? 'checked' : ''} />
              <span class="option-label">Prefer reduced motion</span>
            </label>
            <label class="option">
              <input type="checkbox" data-testid="account-low-effects" ${lowEffects ? 'checked' : ''} />
              <span class="option-label">Prefer low effects on the tactical table</span>
            </label>
            <label class="option">
              <input type="checkbox" data-testid="account-tts" ${textToSpeechEnabled ? 'checked' : ''} />
              <span class="option-label">Enable text-to-speech for visible Director text</span>
            </label>
            <label class="option">
              <input type="checkbox" data-testid="account-stt" ${speechToTextEnabled ? 'checked' : ''} />
              <span class="option-label">Enable speech-to-text draft dictation</span>
            </label>
            <label class="field">
              <span>Narration density</span>
              <select data-testid="account-narration-density">
                ${NARRATION_DENSITIES.map(
                  (density) => `
                  <option value="${escapeHtml(density)}" ${narrationDensity === density ? 'selected' : ''}>
                    ${escapeHtml(NARRATION_DENSITY_LABELS[density])}
                  </option>`,
                ).join('')}
              </select>
            </label>
            <p class="record-meta" data-testid="narration-density-summary">
              ${escapeHtml(NARRATION_DENSITY_SUMMARIES[narrationDensity])}
            </p>
          </section>
          <p class="record-meta">
            Signing out ends this browser session. It does not delete characters or other
            records already stored for this account.
          </p>
          <section class="panel" aria-labelledby="account-deletion-heading">
            <h2 id="account-deletion-heading">Local data deletion request</h2>
            <p class="record-meta">
              Local Arena clears local development data in the emulator when you request it.
              This is not a hosted production deletion claim.
            </p>
            <p class="record-meta" data-testid="account-deletion-status">
              ${
                deletionStatus === null
                  ? 'Deletion status has not been loaded yet.'
                  : deletionStatus.requested
                    ? `Deletion requested${
                        deletionStatus.requestedAt
                          ? ` at ${escapeHtml(formatTimestamp(deletionStatus.requestedAt))}`
                          : ''
                      }. ${escapeHtml(deletionStatus.notice)}`
                    : `No deletion request on file. ${escapeHtml(deletionStatus.notice)}`
              }
            </p>
            <div class="actions">
              <button type="button" class="secondary" data-testid="request-account-deletion"
                aria-disabled="${busy || (deletionStatus?.requested ?? false)}">
                ${
                  deletionStatus?.requested
                    ? 'Deletion already requested'
                    : busy
                      ? 'Requesting…'
                      : 'Request local data deletion'
                }
              </button>
            </div>
          </section>
          <section class="panel" aria-labelledby="legal-acceptance-heading">
            <h2 id="legal-acceptance-heading">Legal acceptance</h2>
            <p class="record-meta">
              Gold Master legal documents are versioned. Recording acceptance stores the current
              route, version, and content digest on the server — the browser does not invent them.
            </p>
            <ul data-testid="legal-acceptance-list">
              ${
                legalAcceptance === null
                  ? '<li>Acceptance status has not been loaded yet.</li>'
                  : legalAcceptance.documents
                      .map(
                        (document) => `
                  <li data-testid="legal-acceptance-${escapeHtml(document.route.replace(/\//g, '-'))}">
                    <a href="${escapeHtml(document.route)}" target="_blank" rel="noopener noreferrer">${escapeHtml(document.title)}</a>
                    — ${escapeHtml(document.version)}
                    ${document.accepted ? 'accepted' : 'not yet accepted'}
                    <button type="button" class="secondary" data-legal-route="${escapeHtml(document.route)}"
                      data-testid="accept-legal-${escapeHtml(document.route.replace(/\//g, '-'))}"
                      aria-disabled="${busy || document.accepted}">
                      ${document.accepted ? 'Accepted' : 'Record acceptance'}
                    </button>
                  </li>`,
                      )
                      .join('')
              }
            </ul>
            <p class="record-meta" data-testid="legal-acceptance-summary">
              ${
                legalAcceptance === null
                  ? ''
                  : legalAcceptance.allCurrentAccepted
                    ? 'All current legal documents are accepted.'
                    : 'One or more current legal documents still need acceptance.'
              }
            </p>
          </section>
          <section class="panel" aria-labelledby="gold-master-heading">
            <h2 id="gold-master-heading">Gold Master package</h2>
            <p class="record-meta" data-testid="gold-master-status">
              ${
                goldMaster === null
                  ? 'Gold Master package has not been loaded yet.'
                  : `Launch Production ${escapeHtml(goldMaster.launchProduction)}. Product Owner authorization ${escapeHtml(goldMaster.productOwnerAuthorization)}. Eligibility ${escapeHtml(goldMaster.eligibilityPolicy.status)}.`
              }
            </p>
            <p class="record-meta">
              Support: use the invitation channel named in the legal documents. Hosted on-call is
              not standing until Launch Production is authorized.
            </p>
          </section>
        </div>`;
    }

    container
      .querySelector<HTMLButtonElement>('[data-testid="account-retry-candidate"]')
      ?.addEventListener('click', () => {
        window.location.reload();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="account-enter"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            const next = await signInAccount(candidate);
            shell.announce(`Signed in as ${next.displayLabel}.`);
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Could not mint a development account.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    container
      .querySelector<HTMLInputElement>('[data-testid="account-google-email"]')
      ?.addEventListener('change', (event) => {
        if (event.target instanceof HTMLInputElement) {
          googleEmail = event.target.value;
        }
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="account-google-emulator-enter"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy) {
            return;
          }
          const emailInput = container.querySelector<HTMLInputElement>(
            '[data-testid="account-google-email"]',
          );
          googleEmail = emailInput?.value.trim() || googleEmail;
          busy = true;
          error = null;
          render();
          try {
            const next = await signInGoogleEmulator(candidate, googleEmail);
            shell.announce(`Signed in as ${next.displayLabel}.`);
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Google emulator sign-in failed.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    const hostedBeginButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="account-hosted-begin"]',
    );
    if (hostedBeginButton !== null && candidate !== null && hostedGoogleClientId !== null) {
      let hostedApi: GoogleIdentityServices | undefined;
      let hostedInitialized = false;

      void loadGoogleIdentityServices()
        .then(() => {
          hostedApi = googleIdentity();
          if (hostedApi === undefined || !isPageMountCurrent(container, mountToken)) {
            return;
          }
          hostedApi.accounts.id.initialize({
            client_id: hostedGoogleClientId,
            ux_mode: 'redirect',
            callback: (response) => {
              void (async () => {
                if (busy) {
                  return;
                }
                busy = true;
                error = null;
                render();
                try {
                  const next = await signInHostedGoogle(candidate, response.credential);
                  shell.announce(`Signed in as ${next.displayLabel}.`);
                } catch (failure) {
                  error =
                    failure instanceof ApiFailure
                      ? failure.message
                      : 'Google Sign-In failed.';
                } finally {
                  busy = false;
                  render();
                }
              })();
            },
          });
          hostedInitialized = true;
          render();
        })
        .catch(() => {
          error = 'Google Sign-In failed to load.';
          render();
        });

      hostedBeginButton.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy) {
            return;
          }
          if (hostedApi === undefined || !hostedInitialized) {
            error = 'Google Sign-In is still preparing. Try again in a moment.';
            render();
            return;
          }
          busy = true;
          error = null;
          render();
          hostedApi?.accounts.id.prompt();
        })();
      });
    }

    container.querySelectorAll<HTMLButtonElement>('[data-legal-route]').forEach((button) => {
      button.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy || button.getAttribute('aria-disabled') === 'true') {
            return;
          }
          const route = button.dataset.legalRoute;
          if (route === undefined || route.length === 0) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            legalAcceptance = await acceptLegalDocument(candidate.candidateId, route);
            shell.announce(`Recorded acceptance of ${route}.`);
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Legal acceptance could not be recorded.';
          } finally {
            busy = false;
            render();
          }
        })();
      });
    });

    container
      .querySelector<HTMLInputElement>('[data-testid="account-reduced-motion"]')
      ?.addEventListener('change', (event) => {
        void (async () => {
          if (candidate === null || busy || !(event.target instanceof HTMLInputElement)) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            const settings = await savePlayerSettings({
              candidateId: candidate.candidateId,
              reducedMotion: event.target.checked,
              lowEffects,
              speech: { textToSpeechEnabled, speechToTextEnabled },
            });
            reducedMotion = settings.reducedMotion;
            lowEffects = settings.lowEffects;
            textToSpeechEnabled = settings.reserved.textToSpeechEnabled;
            speechToTextEnabled = settings.reserved.speechToTextEnabled;
            applyPresentationPreferences({ reducedMotion, lowEffects });
            shell.announce(
              reducedMotion ? 'Reduced motion preference saved.' : 'Reduced motion preference cleared.',
            );
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Presentation settings could not be saved.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    container
      .querySelector<HTMLInputElement>('[data-testid="account-low-effects"]')
      ?.addEventListener('change', (event) => {
        void (async () => {
          if (candidate === null || busy || !(event.target instanceof HTMLInputElement)) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            const settings = await savePlayerSettings({
              candidateId: candidate.candidateId,
              reducedMotion,
              lowEffects: event.target.checked,
              speech: { textToSpeechEnabled, speechToTextEnabled },
            });
            reducedMotion = settings.reducedMotion;
            lowEffects = settings.lowEffects;
            textToSpeechEnabled = settings.reserved.textToSpeechEnabled;
            speechToTextEnabled = settings.reserved.speechToTextEnabled;
            applyPresentationPreferences({ reducedMotion, lowEffects });
            shell.announce(
              lowEffects ? 'Low effects preference saved.' : 'Low effects preference cleared.',
            );
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Presentation settings could not be saved.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    container
      .querySelector<HTMLInputElement>('[data-testid="account-tts"]')
      ?.addEventListener('change', (event) => {
        void (async () => {
          if (candidate === null || busy || !(event.target instanceof HTMLInputElement)) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            const settings = await savePlayerSettings({
              candidateId: candidate.candidateId,
              reducedMotion,
              lowEffects,
              speech: {
                textToSpeechEnabled: event.target.checked,
                speechToTextEnabled,
              },
            });
            textToSpeechEnabled = settings.reserved.textToSpeechEnabled;
            speechToTextEnabled = settings.reserved.speechToTextEnabled;
            shell.announce(
              textToSpeechEnabled ? 'Text-to-speech enabled.' : 'Text-to-speech disabled.',
            );
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Speech settings could not be saved.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    container
      .querySelector<HTMLInputElement>('[data-testid="account-stt"]')
      ?.addEventListener('change', (event) => {
        void (async () => {
          if (candidate === null || busy || !(event.target instanceof HTMLInputElement)) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            const settings = await savePlayerSettings({
              candidateId: candidate.candidateId,
              reducedMotion,
              lowEffects,
              speech: {
                textToSpeechEnabled,
                speechToTextEnabled: event.target.checked,
              },
            });
            textToSpeechEnabled = settings.reserved.textToSpeechEnabled;
            speechToTextEnabled = settings.reserved.speechToTextEnabled;
            shell.announce(
              speechToTextEnabled
                ? 'Speech-to-text draft dictation enabled.'
                : 'Speech-to-text disabled.',
            );
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Speech settings could not be saved.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    container
      .querySelector<HTMLSelectElement>('[data-testid="account-narration-density"]')
      ?.addEventListener('change', (event) => {
        void (async () => {
          if (candidate === null || busy || !(event.target instanceof HTMLSelectElement)) {
            return;
          }
          const nextDensity = event.target.value;
          if (!isNarrationDensity(nextDensity)) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            const settings = await savePlayerSettings({
              candidateId: candidate.candidateId,
              reducedMotion,
              lowEffects,
              speech: { textToSpeechEnabled, speechToTextEnabled },
              narrationDensity: nextDensity,
            });
            narrationDensity = settings.reserved.narrationDensity;
            shell.announce(`Narration density set to ${NARRATION_DENSITY_LABELS[narrationDensity]}.`);
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Narration density could not be saved.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="account-leave"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            await signOutAccount(candidate);
            clearPresentationPreferences();
            deletionStatus = null;
            legalAcceptance = null;
            shell.announce('Signed out.');
          } catch (failure) {
            error =
              failure instanceof ApiFailure ? failure.message : 'Could not sign out.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="request-account-deletion"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy || deletionStatus?.requested) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            deletionStatus = await requestAccountDeletion(candidate.candidateId);
            shell.announce('Local Arena deletion request recorded.');
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Could not record a deletion request.';
          } finally {
            busy = false;
            render();
          }
        })();
      });
  }

  async function loadDeletionStatus(): Promise<void> {
    try {
      deletionStatus = await fetchAccountDeletionStatus();
      render();
    } catch {
      // Status is optional on first paint; the button still works.
    }
  }

  async function loadLegalAndGoldMaster(): Promise<void> {
    try {
      goldMaster = await fetchGoldMasterPackage();
      render();
    } catch {
      // Package is optional on first paint.
    }
    if (getAccount() === null) {
      return;
    }
    try {
      legalAcceptance = await fetchLegalAcceptance();
      render();
    } catch {
      // Acceptance is optional on first paint.
    }
  }

  subscribeAccount(() => {
    if (!isPageMountCurrent(container, mountToken) || busy) {
      return;
    }
    render();
    if (getAccount() !== null) {
      void (async () => {
        try {
          const settings = await fetchPlayerSettings();
          reducedMotion = settings.reducedMotion;
          lowEffects = settings.lowEffects;
          textToSpeechEnabled = settings.reserved.textToSpeechEnabled;
          speechToTextEnabled = settings.reserved.speechToTextEnabled;
          narrationDensity = settings.reserved.narrationDensity;
          applyPresentationPreferences({ reducedMotion, lowEffects });
          render();
        } catch {
          // Presentation settings are optional on first paint.
        }
      })();
      void loadDeletionStatus();
      void loadLegalAndGoldMaster();
    } else {
      deletionStatus = null;
      legalAcceptance = null;
    }
  });

  render();
  void loadLegalAndGoldMaster();
  if (getAccount() !== null) {
    void (async () => {
      try {
        const settings = await fetchPlayerSettings();
        reducedMotion = settings.reducedMotion;
        lowEffects = settings.lowEffects;
        textToSpeechEnabled = settings.reserved.textToSpeechEnabled;
        speechToTextEnabled = settings.reserved.speechToTextEnabled;
        narrationDensity = settings.reserved.narrationDensity;
        applyPresentationPreferences({ reducedMotion, lowEffects });
        render();
      } catch {
        // ignore
      }
    })();
    void loadDeletionStatus();
  }
}
