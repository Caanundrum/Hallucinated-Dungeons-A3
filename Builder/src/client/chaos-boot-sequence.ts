/**
 * Chaos Standard Studio Splash Reveal → Hallucinated Dungeons Title Card.
 *
 * Symmetrical 70/30 studio aesthetic:
 * 70% Prestige Gaming Studio (A24 meets CERN laboratory, obsidian voids, CRT telemetry)
 * 30% Controlled Anomaly & 4th-Wall sentience.
 *
 * Audio: Procedural Web Audio synthesis (zero external audio assets).
 * Skippable via Space, Escape, Enter, or Click.
 */

import { sound } from './sound.js';

const SESSION_KEY = 'hd.chaosBoot.seen.v2';

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function hasSeenChaosBoot(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

export function markChaosBootSeen(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    // sessionStorage may be unavailable in restricted contexts; ignore.
  }
}

export function resetChaosBootSeen(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

/**
 * Plays the official Chaos Standard Studio Reveal followed by the
 * Hallucinated Dungeons game splash card. Resolves when finished or skipped.
 */
export async function playChaosBootSequence(options?: {
  readonly force?: boolean;
}): Promise<void> {
  if (options?.force !== true && hasSeenChaosBoot()) {
    return;
  }

  const reduced = prefersReducedMotion();
  const phase1Duration = reduced ? 300 : 2200;
  const phase2Duration = reduced ? 300 : 2400;

  await new Promise<void>((resolve) => {
    const root = document.createElement('div');
    root.className = 'chaos-boot-root';
    root.setAttribute('data-testid', 'chaos-boot-root');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Chaos Standard presents Hallucinated Dungeons');

    root.innerHTML = `
      <div class="chaos-boot-backdrop">
        <div class="chaos-boot-crt-scanlines" aria-hidden="true"></div>
        <div class="chaos-boot-vignette" aria-hidden="true"></div>
      </div>

      <!-- Controls -->
      <div class="chaos-boot-controls">
        <button type="button" class="chaos-boot-sound-toggle" data-testid="chaos-boot-sound" aria-label="Toggle sound">
          <span class="chaos-boot-sound-icon">${sound.isMuted() ? '🔇' : '🔊'}</span>
          <span class="chaos-boot-sound-text">${sound.isMuted() ? 'Unmute' : 'Audio On'}</span>
        </button>
        <button type="button" class="chaos-boot-skip" data-testid="chaos-boot-skip" data-testid-alias="skip-intro">
          Skip <kbd aria-hidden="true">Space</kbd>
        </button>
      </div>

      <!-- Phase 1: Chaos Standard Studio Reveal -->
      <div class="chaos-boot-layer chaos-boot-studio is-active" data-testid="chaos-boot-chaos" data-boot-phase="chaos">
        <div class="chaos-boot-studio-inner">
          <div class="chaos-boot-terminal-mark-wrapper">
            <div class="chaos-boot-beam-line" aria-hidden="true"></div>
            <img
              src="/brand/chaos-mark-symbol.png"
              alt="The Bewildered Terminal - Chaos Standard Mascot"
              class="chaos-boot-terminal-img"
              width="140"
              height="140"
            />
          </div>
          <div class="chaos-boot-wordmark-wrapper">
            <h1 class="chaos-boot-studio-wordmark">
              <span class="chaos-word-chaos">CHAOS</span>
              <span class="chaos-word-standard">STANDARD</span>
            </h1>
            <p class="chaos-boot-studio-tagline">We take making ridiculous things extremely seriously.</p>
          </div>
          <div class="chaos-boot-telemetry" data-testid="chaos-boot-telemetry">
            <span class="telemetry-tick">SYS.BOOT_SEQUENCE // CRT_WARMUP</span>
            <span class="telemetry-dot"></span>
            <span class="telemetry-host">chaosstandard.com</span>
          </div>
        </div>
      </div>

      <!-- Phase 2: Hallucinated Dungeons Game Title Card -->
      <div class="chaos-boot-layer chaos-boot-game" data-testid="chaos-boot-game" data-boot-phase="game" hidden>
        <div class="chaos-boot-game-inner">
          <div class="chaos-boot-dungeon-portal">
            <svg class="chaos-boot-dungeon-arch" width="100" height="100" viewBox="0 0 96 96" fill="none" aria-hidden="true">
              <path class="arch-keystone" d="M48 16 L54 26 L42 26 Z" fill="#F5A623" />
              <path class="arch-vault" d="M20 88 V48 A28 28 0 0 1 76 48 V88" stroke="#8B5CF6" stroke-width="4.5" stroke-linecap="round" />
              <path class="arch-base" d="M12 88 H84" stroke="#94A3B8" stroke-width="4" stroke-linecap="round" />
              <path class="arch-pillar left" d="M30 88 V56" stroke="#8B5CF6" stroke-width="3" stroke-linecap="round" opacity="0.75" />
              <path class="arch-pillar right" d="M66 88 V56" stroke="#8B5CF6" stroke-width="3" stroke-linecap="round" opacity="0.75" />
              <circle class="arch-core" cx="48" cy="48" r="8" fill="#F5A623" opacity="0.85" />
            </svg>
          </div>
          <div class="chaos-boot-game-eyebrow">
            <span class="brand-pill">A CHAOS STANDARD TABLETOP EXPERIENCE</span>
          </div>
          <h2 class="chaos-boot-game-title">Hallucinated Dungeons</h2>
          <p class="chaos-boot-game-subtitle">Tabletop RPG Soul × Generative Fantasy Intelligence</p>
          <p class="chaos-boot-game-desc">
            Where the Dungeon Master never sleeps, never runs out of dice, and occasionally has questionable sanity.
          </p>
          <div class="chaos-boot-game-meta">
            <span class="meta-tag">SRD 5.2.1 AUTHENTIC RULES</span>
            <span class="meta-sep">·</span>
            <span class="meta-tag">AUTONOMOUS AI DIRECTOR</span>
            <span class="meta-sep">·</span>
            <span class="meta-tag">ZERO INSTALL</span>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(root);
    document.body.classList.add('chaos-boot-active');

    const studioLayer = root.querySelector<HTMLElement>('[data-testid="chaos-boot-chaos"]');
    const gameLayer = root.querySelector<HTMLElement>('[data-testid="chaos-boot-game"]');
    const skipButton = root.querySelector<HTMLButtonElement>('[data-testid="chaos-boot-skip"]');
    const soundButton = root.querySelector<HTMLButtonElement>('[data-testid="chaos-boot-sound"]');
    const telemetryText = root.querySelector<HTMLElement>('.telemetry-tick');

    let finished = false;
    let timerIds: number[] = [];

    // Trigger audio reveal on splash open (if not muted)
    if (!reduced) {
      sound.playStudioReveal();
    }

    function cleanup(): void {
      if (finished) return;
      finished = true;
      for (const id of timerIds) {
        window.clearTimeout(id);
      }
      timerIds = [];
      markChaosBootSeen();
      root.classList.add('is-exiting');
      window.setTimeout(() => {
        root.remove();
        document.body.classList.remove('chaos-boot-active');
        resolve();
      }, reduced ? 40 : 350);
    }

    function showGame(): void {
      if (finished || studioLayer === null || gameLayer === null) return;
      studioLayer.classList.remove('is-active');
      studioLayer.hidden = true;
      gameLayer.hidden = false;
      // Force layout reflow so animations play cleanly
      void gameLayer.offsetWidth;
      gameLayer.classList.add('is-active');
      if (!reduced) {
        sound.playHover();
      }
      timerIds.push(window.setTimeout(cleanup, phase2Duration));
    }

    // Interactive skip controls
    skipButton?.addEventListener('click', (e) => {
      e.stopPropagation();
      cleanup();
    });

    soundButton?.addEventListener('click', (e) => {
      e.stopPropagation();
      const nextMuted = sound.toggleMute();
      const icon = soundButton.querySelector('.chaos-boot-sound-icon');
      const text = soundButton.querySelector('.chaos-boot-sound-text');
      if (icon) icon.textContent = nextMuted ? '🔇' : '🔊';
      if (text) text.textContent = nextMuted ? 'Unmute' : 'Audio On';
      if (!nextMuted) {
        sound.playClick();
      }
    });

    const keyListener = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        cleanup();
      }
    };
    window.addEventListener('keydown', keyListener, { once: true });

    // Telemetry updates
    if (!reduced && telemetryText) {
      timerIds.push(
        window.setTimeout(() => {
          if (!finished) telemetryText.textContent = 'DEFLECTION_COILS // RASTER NOMINAL';
        }, 700),
      );
      timerIds.push(
        window.setTimeout(() => {
          if (!finished) telemetryText.textContent = 'CHAOS STANDARD // CALIBRATION COMPLETE';
        }, 1400),
      );
    }

    // Schedule phase 2 transition
    timerIds.push(window.setTimeout(showGame, phase1Duration));
  });
}
