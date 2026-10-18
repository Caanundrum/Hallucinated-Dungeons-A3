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
import { playChaosBootSequence } from '../chaos-boot-sequence.js';
import { escapeHtml } from '../dom-utils.js';
import { beginPageMount, isPageMountCurrent } from '../page-mount.js';
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
  const playerLabel = account?.displayLabel ?? 'Adventurer';

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
          <p class="home-greeting">
            Welcome to the table, <strong class="player-accent">${escapeHtml(playerLabel)}</strong>.
          </p>
          <p class="home-lead">
            An AI-moderated multiplayer tabletop roleplaying universe. Powered by official
            <strong>D&amp;D 5e SRD 5.2.1</strong> rules, dynamic battlemaps with Fog of War, physical 3D dice rolls,
            and an intelligent Game Director who authors every room in response to your party's choices.
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
            <p class="section-subtitle">Your step-by-step path from creating a hero to conquering living dungeons.</p>
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
                Create a custom Level 1 adventurer using authentic SRD 5.2.1 rules. Choose from classic ancestries,
                classes, rolled ability scores, and equip starting gear &mdash; with an AI-painted fantasy oil portrait.
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
                World Forge any adventure premise into a multi-room dungeon graph with leveling pacing.
                Select your Game Director personality (Veyra or Garrick) and invite friends via a single browser link.
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
              <div class="step-card-meta">
                <span>Rules Engine: <strong>SRD 5.2.1 Core</strong></span>
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

        <!-- How Play Works (Interactive Rules Primer) -->
        <section class="home-guide-section" aria-labelledby="guide-heading">
          <div class="section-title-wrap">
            <h2 id="guide-heading" class="section-title">How Play Works</h2>
            <p class="section-subtitle">No complicated menus. Speak and explore like you are sitting with friends at a physical gaming table.</p>
          </div>

          <div class="home-guide-grid">
            <div class="guide-box">
              <div class="guide-box-header">
                <span class="guide-box-num">A</span>
                <h4>Natural Language Declarations</h4>
              </div>
              <p>
                Type what your character attempts: <em>"I investigate the carved mark on the wall"</em> or <em>"I ask Orin what happened to the courier."</em>
                The AI Game Director interprets your intent, respects line of sight, and prepares rules-compliant action drafts.
              </p>
            </div>

            <div class="guide-box">
              <div class="guide-box-header">
                <span class="guide-box-num">B</span>
                <h4>Deterministic SRD 5.2.1 Checks</h4>
              </div>
              <p>
                When an action has risk or uncertainty, the Director calls for a roll with your character sheet's exact ability modifiers,
                skills, and proficiency bonuses vs. a hidden or disclosed DC.
              </p>
            </div>

            <div class="guide-box">
              <div class="guide-box-header">
                <span class="guide-box-num">C</span>
                <h4>Tactical Battlemaps &amp; Fog of War</h4>
              </div>
              <p>
                Click tokens to pathfind across rooms, open doors to reveal unvisited chambers, descend cellar stairs,
                and uncover loot containers and hidden secrets in real time.
              </p>
            </div>
          </div>
        </section>

        <!-- Chaos Standard Studio Card -->
        <section class="home-studio-card" data-testid="home-studio-card">
          <div class="studio-card-left">
            <img src="/brand/chaos-mark-symbol.png" alt="The Bewildered Terminal" class="studio-mascot-img" width="72" height="72" />
            <div class="studio-copy">
              <h3 class="studio-name">Chaos Standard</h3>
              <p class="studio-motto">"We take making ridiculous things extremely seriously."</p>
              <p class="studio-bio">
                Pioneering browser-native gaming with museum-grade artistic fidelity, unconventional mechanics,
                and an intentional streak of controlled chaos.
              </p>
            </div>
          </div>
          <div class="studio-card-actions">
            <button type="button" class="btn btn-secondary" data-testid="home-replay-intro-btn">
              🎬 Replay Studio Intro
            </button>
            <a href="https://chaosstandard.com" target="_blank" rel="noopener noreferrer" class="btn btn-outline">
              chaosstandard.com &rarr;
            </a>
          </div>
        </section>

        <!-- Certified Browsers Panel -->
        <section class="panel" aria-labelledby="browser-support-heading">
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
        </section>

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

    container
      .querySelector<HTMLButtonElement>('[data-testid="home-replay-intro-btn"]')
      ?.addEventListener('click', () => {
        void playChaosBootSequence({ force: true });
      });
  }
}
