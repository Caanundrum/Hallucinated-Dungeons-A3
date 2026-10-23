/**
 * The Home page: Chaos Standard × Hallucinated Dungeons Command Deck.
 *
 * Blueprint & UX ownership:
 * - Directs the player intuitively on what Hallucinated Dungeons is
 * - Clearly lays out where to go next (3-Step Adventurer's Roadmap)
 * - Quick-jumps to active characters and seated tables
 * - Embeds authentic Chaos Standard studio branding and design cues
 * - Preserves all required test IDs and browser certification matrix
 */

import type { CandidateIdentity } from '../../shared/contract.js';
import type { ActiveSeatedTableProjection } from '../../shared/campaign-contract.js';
import { BROWSER_SUPPORT_MATRIX } from '../../shared/public-surface-contract.js';
import { getAccount } from '../account-session.js';
import { fetchActiveSeatedTable, fetchCampaigns, fetchVault } from '../api.js';
import { escapeHtml } from '../dom-utils.js';
import { beginPageMount, isPageMountCurrent, registerPageCleanup } from '../page-mount.js';
import { isHostedPlayerSurface } from '../player-surface.js';
import type { ShellHandle } from '../shell.js';

export interface PageHost {
  readonly container: HTMLElement;
  readonly shell: ShellHandle;
  readonly candidate: CandidateIdentity | null;
}

function browserStatusLabel(entry: (typeof BROWSER_SUPPORT_MATRIX)[number]): string {
  switch (entry.status) {
    case 'certified_chromium_class':
      return 'Certified on this candidate (Chromium-class automated evidence)';
    case 'ordinary_regression_when_available':
      return 'Ordinary regression when available — not a full certification claim on this host';
    case 'not_yet_certified':
      return 'Not yet certified for this milestone';
    case 'unsupported':
      if (entry.id === 'phone') {
        return 'Partial support — the tactical table is usable at 390px width, but phone browsers are not certified for the full experience';
      }
      return 'Unsupported for the full tactical table';
  }
}

export function mountHomePage(host: PageHost): void {
  const { container, shell, candidate } = host;
  shell.setPresentationMode('app');
  shell.setDocumentTitle('Home');

  const mountToken = beginPageMount(container);
  const account = getAccount();
  let tourKeydownListener: ((e: KeyboardEvent) => void) | null = null;
  registerPageCleanup(container, mountToken, () => {
    if (tourKeydownListener !== null) {
      window.removeEventListener('keydown', tourKeydownListener);
      tourKeydownListener = null;
    }
    document.body.style.overflow = '';
  });

  // Initial skeleton render while asynchronous user telemetry is fetched
  render({
    activeTable: null,
    characterCount: 0,
    tableCount: 0,
    loaded: false,
  });

  // Fetch live table and character telemetry to make the home screen dynamic and smart
  if (account !== null) {
    void Promise.allSettled([
      fetchActiveSeatedTable(),
      fetchVault(),
      fetchCampaigns(),
    ]).then(([tableResult, vaultResult, campaignsResult]) => {
      if (!isPageMountCurrent(container, mountToken)) {
        return;
      }
      const activeTable = tableResult.status === 'fulfilled' ? tableResult.value : null;
      const characterCount =
        vaultResult.status === 'fulfilled' && vaultResult.value.characters
          ? vaultResult.value.characters.length
          : 0;
      const tableCount =
        campaignsResult.status === 'fulfilled' && campaignsResult.value.campaigns
          ? campaignsResult.value.campaigns.length
          : 0;

      render({
        activeTable,
        characterCount,
        tableCount,
        loaded: true,
      });
    });
  }

  function render(state: {
    activeTable: ActiveSeatedTableProjection | null;
    characterCount: number;
    tableCount: number;
    loaded: boolean;
  }): void {
    if (!isPageMountCurrent(container, mountToken)) {
      return;
    }

    const { activeTable, characterCount, tableCount } = state;

    container.innerHTML = `
      <div class="page page-wide home-dashboard-page" data-testid="home-page">
        <!-- Hero Header with Chaos Standard Studio Lockup -->
        <header class="home-hero-header">
          <div class="home-brand-ribbon">
            <img src="/brand/chaos-mark-symbol.png" alt="Chaos Standard" class="home-brand-icon" width="28" height="28" />
            <span class="home-brand-tag">CHAOS STANDARD // TABLETOP ENGINE</span>
            <span class="home-brand-dot">·</span>
            <span class="home-brand-version">ALPHA 3 STAGING</span>
          </div>

          <h1 class="home-title" data-testid="home-heading">Hallucinated Dungeons</h1>
          <p class="home-lead">
            Shape a hero in the Character Vault, create or join a table, and play with an AI Game Director.
          </p>
        </header>

        <!-- Active Adventure Jump Banner (if seated at a table) -->
        ${
          activeTable !== null
            ? `
        <section class="home-active-banner" data-testid="home-active-table-banner">
          <div class="home-active-banner-content">
            <span class="active-badge">⚔️ CURRENTLY AT THE TABLE</span>
            <h2 class="active-table-name">${escapeHtml(activeTable.campaignName)}</h2>
            <p class="active-table-meta">Seated as <strong>${escapeHtml(activeTable.characterName)}</strong></p>
          </div>
          <div class="home-active-banner-action">
            <a href="/campaigns/${escapeHtml(activeTable.campaignId)}/table" data-link class="btn btn-primary" data-testid="home-resume-table-btn">
              Resume Tabletop Play &rarr;
            </a>
          </div>
        </section>`
            : ''
        }

        <!-- 3-Step Guided Roadmap: Where Should You Go Next? -->
        <section class="home-roadmap-section" aria-labelledby="roadmap-heading">
          <div class="section-title-wrap">
            <h2 id="roadmap-heading" class="section-title">Where to Go Next</h2>
            <p class="section-subtitle">Your path from creating a hero to playing at the table.</p>
          </div>

          <div class="home-step-cards">
            <!-- Step 1: Character Vault -->
            <article class="home-step-card ${characterCount === 0 ? 'is-recommended' : ''}" data-testid="home-step-characters">
              <div class="step-card-header">
                <div class="step-number">01</div>
                ${characterCount === 0 ? '<span class="step-badge-highlight">START HERE</span>' : '<span class="step-badge">HERO READY</span>'}
              </div>
              <div class="step-card-icon">🛡️</div>
              <h3 class="step-card-title">Forge Your Hero</h3>
              <p class="step-card-desc">
                Create a custom Level 1 adventurer using authentic 5.5e (SRD 5.2.1) rules. Choose from classic ancestries,
                classes, rolled ability scores, and equip starting gear &mdash; with an AI-painted fantasy oil portrait.
              </p>
              <p class="step-card-humor">
                <em>Spend 45 minutes agonizing over ability scores, or embrace an 8 in Wisdom for peak adventuring impulsiveness.</em>
              </p>
              <div class="step-card-meta">
                <span>Vault: <strong>${characterCount} ${characterCount === 1 ? 'Hero' : 'Heroes'}</strong></span>
              </div>
              <div class="step-card-actions">
                <a href="/characters/new" data-link class="btn btn-primary" data-testid="home-create-character-btn">
                  Forge New Hero
                </a>
                <a href="/characters" data-link class="btn btn-secondary" data-testid="home-characters-link">
                  Open Vault
                </a>
              </div>
            </article>

            <!-- Step 2: Campaigns & Tables -->
            <article class="home-step-card ${characterCount > 0 && tableCount === 0 ? 'is-recommended' : ''}" data-testid="home-step-tables">
              <div class="step-card-header">
                <div class="step-number">02</div>
                <span class="step-badge">TABLE HUB</span>
              </div>
              <div class="step-card-icon">🗺️</div>
              <h3 class="step-card-title">Create or Join a Table</h3>
              <p class="step-card-desc">
                World Forge any adventure premise into a multi-room dungeon graph with balanced leveling pacing.
                Select your Game Director personality (Veyra or Garrick) and invite friends via a single browser link.
              </p>
              <p class="step-card-humor">
                <em>From eerie sunken crypts to chaotic tavern heists &mdash; your AI Director seamlessly adapts to your party's collective bad decisions.</em>
              </p>
              <div class="step-card-meta">
                <span>Your Tables: <strong>${tableCount} ${tableCount === 1 ? 'Campaign' : 'Campaigns'}</strong></span>
              </div>
              <div class="step-card-actions">
                <a href="/campaigns/new" data-link class="btn btn-primary" data-testid="home-create-table-btn">
                  Forge New Table
                </a>
                <a href="/campaigns" data-link class="btn btn-secondary" data-testid="home-campaigns-link">
                  Browse Tables
                </a>
              </div>
            </article>

            <!-- Step 3: The Live Tabletop -->
            <article class="home-step-card" data-testid="home-step-play">
              <div class="step-card-header">
                <div class="step-number">03</div>
                <span class="step-badge">LIVE PLAY</span>
              </div>
              <div class="step-card-icon">⚔️</div>
              <h3 class="step-card-title">Play at the Table</h3>
              <p class="step-card-desc">
                Step onto tactical top-down battlemaps. Declare natural player actions ("I search the workbench", "I hide behind the bar"),
                roll 3D d20 checks against DC thresholds, and converse with sentient in-world NPCs.
              </p>
              <p class="step-card-humor">
                <em>Remember: inspecting every suspicious barrel for forgotten cheese wheels is an honored tabletop rite of passage.</em>
              </p>
              <div class="step-card-meta">
                <span>Rules Engine: <strong>5.5e Core (SRD 5.2.1)</strong></span>
              </div>
              <div class="step-card-actions">
                ${
                  activeTable !== null
                    ? `<a href="/campaigns/${escapeHtml(activeTable.campaignId)}/table" data-link class="btn btn-primary">Enter Table</a>`
                    : `<a href="/campaigns" data-link class="btn btn-secondary">Select Table to Play</a>`
                }
              </div>
            </article>
          </div>
        </section>

        <!-- How Play Works (Interactive Rules Primer & High-Level Tour) -->
        <section class="home-guide-section" aria-labelledby="guide-heading">
          <div class="home-guide-header-bar">
            <div class="section-title-wrap">
              <h2 id="guide-heading" class="section-title">How Play Works</h2>
              <p class="section-subtitle">
                An AI-directed tabletop roleplaying engine built on authentic 5.5e rules. Describe your actions in natural English without memorizing 300 pages of manuals, while tabletop veterans get full tactical combat, real modifier math, and dynamic battlemaps.
              </p>
            </div>
            <div class="home-guide-cta-wrap">
              <button type="button" class="btn btn-secondary home-tour-btn" data-testid="home-open-tour-btn">
                📖 Take the 2-Minute Tour
              </button>
            </div>
          </div>

          <div class="home-guide-grid">
            <div class="guide-box">
              <div class="guide-box-header">
                <span class="guide-box-num">01</span>
                <div>
                  <span class="guide-audience-badge badge-newcomer">FOR STORYTELLERS &amp; NEWCOMERS</span>
                  <h4>Speak Naturally &mdash; Zero Menu Clutter</h4>
                </div>
              </div>
              <p>
                No rigid branching dialogue trees. Describe what you want your character to attempt: <em>"I search the desk for hidden ledgers"</em> or <em>"I try to talk the city watch down."</em> The Game Director interprets your intent, respects line of sight, and resolves the scene dynamically.
              </p>
              <div class="guide-humor-note">
                💡 Zero rulebook homework required. (Though yes, opening the glowing sarcophagus will still have predictable consequences.)
              </div>
            </div>

            <div class="guide-box">
              <div class="guide-box-header">
                <span class="guide-box-num">02</span>
                <div>
                  <span class="guide-audience-badge badge-veteran">FOR TABLETOP VETERANS</span>
                  <h4>Real 5.5e Rules &amp; Physical 3D Dice</h4>
                </div>
              </div>
              <p>
                Under the hood runs a deterministic 5.5e / SRD 5.2.1 rules engine tracking ability modifiers, skill proficiencies, spell slots, and saving throws vs. target DCs. When stakes demand it, roll simulated 3D d20s with real-time physics.
              </p>
              <div class="guide-humor-note">
                🎲 The dice tray is 100% physically simulated. Your natural 1 on an easy DC 10 check is strictly between you and fate.
              </div>
            </div>

            <div class="guide-box">
              <div class="guide-box-header">
                <span class="guide-box-num">03</span>
                <div>
                  <span class="guide-audience-badge badge-tactical">TACTICAL EXPLORATION</span>
                  <h4>Living Battlemaps &amp; Fog of War</h4>
                </div>
              </div>
              <p>
                Point-and-click tactical pathfinding across rich environments. Dynamic Fog of War conceals unexplored corridors, hidden alcoves, traps, and lurking cellar denizens until your token actually turns the corner and steps into the light.
              </p>
              <div class="guide-humor-note">
                👁️ True line of sight &mdash; monsters will not politely wait in broad daylight while your party debates marching order.
              </div>
            </div>

            <div class="guide-box">
              <div class="guide-box-header">
                <span class="guide-box-num">04</span>
                <div>
                  <span class="guide-audience-badge badge-director">INTELLIGENT DM</span>
                  <h4>A Game Director Who Never Cancels</h4>
                </div>
              </div>
              <p>
                Choose your Director’s narrative style &mdash; Veyra for rich atmospheric storytelling or Garrick for gritty tactical challenge. Play solo whenever inspiration strikes, or send a single browser link to rally your party.
              </p>
              <div class="guide-humor-note">
                🍻 Zero group-chat scheduling paralysis. Your Director is always ready, never flakes 15 minutes before session time, and doesn't eat all the snacks.
              </div>
            </div>
          </div>
        </section>

        <!-- Chaos Standard Studio Card -->
        <section class="home-studio-card" data-testid="home-studio-card">
          <div class="studio-card-left">
            <img src="/brand/chaos-mark-symbol.png" alt="Chaos Standard" class="studio-mascot-img" width="56" height="56" />
            <div class="studio-copy">
              <h3 class="studio-name">Chaos Standard</h3>
              <p class="studio-bio">Unconventional browser games made with AI.</p>
            </div>
          </div>
          <div class="studio-card-actions">
            <a href="https://chaosstandard.com" target="_blank" rel="noopener noreferrer" class="btn btn-outline">
              chaosstandard.com &rarr;
            </a>
          </div>
        </section>

        <!-- High-Level 2-Minute Tour Modal Dialog -->
        <div class="home-tour-backdrop modal-backdrop" data-testid="home-tour-backdrop" role="dialog" aria-modal="true" aria-labelledby="tour-modal-title" style="display: none;">
          <div class="home-tour-dialog modal-dialog">
            <header class="home-tour-header">
              <div class="home-tour-title-wrap">
                <span class="home-tour-badge">QUICK TOUR</span>
                <h2 id="tour-modal-title" class="home-tour-title">How Hallucinated Dungeons Works</h2>
                <p class="home-tour-subtitle">Everything you need to know in under two minutes &mdash; whether you've rolled d20s for decades or never played a tabletop RPG.</p>
              </div>
              <button type="button" class="btn-icon home-tour-close-btn" data-testid="home-tour-close-btn" aria-label="Close tour">&times;</button>
            </header>

            <div class="home-tour-body">
              <div class="tour-pillars-grid">
                <!-- Pillar 1 -->
                <article class="tour-pillar-card">
                  <div class="tour-pillar-header">
                    <span class="tour-pillar-icon">🛡️</span>
                    <div>
                      <span class="tour-pillar-step">01</span>
                      <h3 class="tour-pillar-title">Forge or Import Your Hero</h3>
                    </div>
                  </div>
                  <p class="tour-pillar-desc">
                    Build a custom Level 1 adventurer using authentic 5.5e rules &mdash; ancestry, class, rolled ability scores, and equipment. The AI paints a bespoke oil portrait for your character sheet and map token.
                  </p>
                  <div class="tour-pillar-takeaway">
                    <span class="pillar-label-vet">Veterans:</span> Full 5.5e / SRD 5.2.1 modifier math &amp; spell slots.
                    <br />
                    <span class="pillar-label-new">Newcomers:</span> Zero manual math required &mdash; sheet handles the numbers.
                  </div>
                </article>

                <!-- Pillar 2 -->
                <article class="tour-pillar-card">
                  <div class="tour-pillar-header">
                    <span class="tour-pillar-icon">🗺️</span>
                    <div>
                      <span class="tour-pillar-step">02</span>
                      <h3 class="tour-pillar-title">The World Forge</h3>
                    </div>
                  </div>
                  <p class="tour-pillar-desc">
                    Type any premise &mdash; a misty port infested with sea cultists or a clockwork dwarven vault. The Forge drafts an interconnected multi-room dungeon graph with encounter budgets and milestone leveling pacing.
                  </p>
                  <div class="tour-pillar-takeaway">
                    <span class="pillar-label-note">Director Personalities:</span> Choose <strong>Veyra</strong> for rich atmospheric narrative or <strong>Garrick</strong> for gritty tactical danger.
                  </div>
                </article>

                <!-- Pillar 3 -->
                <article class="tour-pillar-card">
                  <div class="tour-pillar-header">
                    <span class="tour-pillar-icon">💬</span>
                    <div>
                      <span class="tour-pillar-step">03</span>
                      <h3 class="tour-pillar-title">Speak &amp; Act Naturally</h3>
                    </div>
                  </div>
                  <p class="tour-pillar-desc">
                    No rigid dialogue trees or pre-scripted choices. Type what you want your hero to do in plain English. The Director reads your intent, checks line of sight, and resolves the scene dynamically.
                  </p>
                  <div class="tour-pillar-takeaway">
                    <span class="pillar-label-humor">Humor Check:</span> <em>"I search the desk for false bottoms"</em> works. <em>"I seduce the dungeon door"</em> will result in a splinter check.
                  </div>
                </article>

                <!-- Pillar 4 -->
                <article class="tour-pillar-card">
                  <div class="tour-pillar-header">
                    <span class="tour-pillar-icon">🎲</span>
                    <div>
                      <span class="tour-pillar-step">04</span>
                      <h3 class="tour-pillar-title">Real Rules &amp; 3D Dice</h3>
                    </div>
                  </div>
                  <p class="tour-pillar-desc">
                    When risk arises, the Director calls for a roll with your character sheet's exact ability modifiers, skill proficiencies, and saving throws vs. target DCs. Simulated 3D dice tumble in real time.
                  </p>
                  <div class="tour-pillar-takeaway">
                    <span class="pillar-label-humor">Fate Note:</span> Yes, natural 1s happen to heroes too. The dice tray knows no mercy.
                  </div>
                </article>

                <!-- Pillar 5 -->
                <article class="tour-pillar-card">
                  <div class="tour-pillar-header">
                    <span class="tour-pillar-icon">⚔️</span>
                    <div>
                      <span class="tour-pillar-step">05</span>
                      <h3 class="tour-pillar-title">Tactical Battlemaps &amp; Fog of War</h3>
                    </div>
                  </div>
                  <p class="tour-pillar-desc">
                    Point-and-click pathfinding across atmospheric battlemaps. Dynamic Fog of War hides unvisited rooms, traps, and lurking cellar denizens until you open the door and step into the light.
                  </p>
                  <div class="tour-pillar-takeaway">
                    <span class="pillar-label-note">Grid Strategy:</span> Tactical positioning, cover, and line of sight all matter in combat.
                  </div>
                </article>

                <!-- Pillar 6 -->
                <article class="tour-pillar-card">
                  <div class="tour-pillar-header">
                    <span class="tour-pillar-icon">👥</span>
                    <div>
                      <span class="tour-pillar-step">06</span>
                      <h3 class="tour-pillar-title">Zero-Install Multiplayer</h3>
                    </div>
                  </div>
                  <p class="tour-pillar-desc">
                    Play solo or share your table URL with your adventuring party. Friends join instantly in their browser with zero client installs, seat their heroes, and share the live tactical stage.
                  </p>
                  <div class="tour-pillar-takeaway">
                    <span class="pillar-label-humor">Bonus:</span> Zero group-chat scheduling debates. Your AI Director never cancels 15 minutes before session time.
                  </div>
                </article>
              </div>
            </div>

            <footer class="home-tour-footer">
              <button type="button" class="btn btn-secondary" data-testid="home-tour-dismiss-btn">
                Close Tour
              </button>
              <a href="/characters/new" data-link class="btn btn-primary" data-testid="home-tour-start-btn">
                Forge Your First Hero &rarr;
              </a>
            </footer>
          </div>
        </div>

        <!-- Certified Browsers Panel (Local Arena only for compliance testing) -->
        ${
          isHostedPlayerSurface(candidate) || (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1')
            ? ''
            : `<section class="panel" aria-labelledby="browser-support-heading">
          <h2 id="browser-support-heading">Certified Browsers &amp; Hardware</h2>
          <p class="record-meta">
            Tactical table support is verified through automated Playwright and live browser regression suites.
          </p>
          <ul class="support-matrix" data-testid="browser-support-matrix">
            ${BROWSER_SUPPORT_MATRIX.map(
              (entry) => `
              <li data-testid="browser-support-${escapeHtml(entry.id)}" data-support-status="${escapeHtml(entry.status)}">
                <strong>${escapeHtml(entry.label)}</strong>
                — ${escapeHtml(browserStatusLabel(entry))}
              </li>`,
            ).join('')}
          </ul>
        </section>`
        }

        <!-- Account & Candidate Information -->
        <section class="home-footer-actions">
          <a href="/account" data-link data-testid="home-account-link" class="home-footer-link">Account Settings</a>
          <span class="sep">·</span>
          <a href="/characters" data-link class="home-footer-link">Character Vault</a>
          <span class="sep">·</span>
          <a href="/campaigns" data-link class="home-footer-link">Tables Hub</a>
          ${
            candidate?.publicSurface === 'gold_master'
              ? ''
              : `<span class="sep">·</span><a href="/diagnostics" data-link data-testid="home-diagnostics-link" class="home-footer-link">Diagnostics</a>`
          }
        </section>

        ${
          isHostedPlayerSurface(candidate)
            ? ''
            : `<div class="candidate-strip" data-testid="candidate-strip">
            ${
              candidate === null
                ? 'Contacting the Local Arena server…'
                : `<span>Candidate <b data-testid="candidate-id">${escapeHtml(candidate.candidateId)}</b></span>
                   <span>Environment <b data-testid="environment-class">${escapeHtml(candidate.environmentClass)}</b></span>
                   <span>Surface <b data-testid="public-surface">${escapeHtml(candidate.publicSurface)}</b></span>
                   <span>Blueprint <b>${escapeHtml(candidate.blueprintVersion)}</b></span>`
            }
          </div>`
        }
      </div>`;

    // High-Level Tour Modal Wiring
    const tourBackdrop = container.querySelector<HTMLElement>('[data-testid="home-tour-backdrop"]');
    const openTourBtn = container.querySelector<HTMLButtonElement>('[data-testid="home-open-tour-btn"]');
    const closeTourBtn = container.querySelector<HTMLButtonElement>('[data-testid="home-tour-close-btn"]');
    const dismissTourBtn = container.querySelector<HTMLButtonElement>('[data-testid="home-tour-dismiss-btn"]');
    const startTourBtn = container.querySelector<HTMLAnchorElement>('[data-testid="home-tour-start-btn"]');

    function openTour(): void {
      if (!tourBackdrop) return;
      tourBackdrop.style.display = 'grid';
      tourBackdrop.classList.add('is-open');
      document.body.style.overflow = 'hidden';
      closeTourBtn?.focus();
    }

    function closeTour(): void {
      if (!tourBackdrop) return;
      tourBackdrop.style.display = 'none';
      tourBackdrop.classList.remove('is-open');
      document.body.style.overflow = '';
      openTourBtn?.focus();
    }

    openTourBtn?.addEventListener('click', openTour);
    closeTourBtn?.addEventListener('click', closeTour);
    dismissTourBtn?.addEventListener('click', closeTour);
    startTourBtn?.addEventListener('click', closeTour);

    tourBackdrop?.addEventListener('click', (e) => {
      if (e.target === tourBackdrop) {
        closeTour();
      }
    });

    if (tourKeydownListener !== null) {
      window.removeEventListener('keydown', tourKeydownListener);
    }
    tourKeydownListener = (e: KeyboardEvent): void => {
      if (!isPageMountCurrent(container, mountToken)) {
        window.removeEventListener('keydown', tourKeydownListener!);
        return;
      }
      if (e.key === 'Escape' && tourBackdrop && tourBackdrop.style.display !== 'none') {
        closeTour();
      }
    };
    window.addEventListener('keydown', tourKeydownListener);
  }
}
