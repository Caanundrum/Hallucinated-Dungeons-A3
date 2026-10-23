/**
 * Chaos Standard Studio Splash Reveal.
 *
 * Exact replication of the Chaos Standard studio splash reveal
 * (Chaos-Standard-Home StudioSplashReveal.tsx):
 *
 * Symmetrical 70/30 studio aesthetic:
 * 70% Prestige Gaming Studio (A24 meets CERN laboratory, obsidian voids, CRT telemetry)
 * 30% Controlled Anomaly & 4th-Wall sentience.
 *
 * Timeline:
 *  - 0ms: Pitch black void, initial CRT warmup telemetry
 *  - 200ms: Horizontal electron beam ignites with glitch chirp
 *  - 650ms: Deflection coils open, beam blooms vertically into Bewildered Terminal monitor
 *  - 1250ms: Terminal stabilized, AI interface online
 *  - 1650ms: Master Chaos Standard wordmark smoothly glides up with electric studio chord
 *  - 2450ms: Settled calibration complete
 *  - 3850ms: Smooth cinematic fadeout to the sign-in page
 *  - 4450ms: Sequence complete / dismissed
 *
 * Controls:
 *  - Click anywhere, press Space, Escape, or Enter, or click "SKIP INTRO" to skip.
 *  - Sound toggle with procedural Web Audio synthesis.
 */

import {
  hasSeenChaosBootPreference,
  markChaosBootSeenPreference,
  resetChaosBootSeenPreference,
} from './browser-preferences.js';
import { sound } from './sound.js';

type AnimationStep =
  | 'idle'
  | 'beam'
  | 'blossom'
  | 'stabilize'
  | 'wordmark'
  | 'complete'
  | 'fadeout';

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function hasSeenChaosBoot(): boolean {
  return hasSeenChaosBootPreference();
}

export function markChaosBootSeen(): void {
  markChaosBootSeenPreference();
}

export function resetChaosBootSeen(): void {
  resetChaosBootSeenPreference();
}

const VOLUME_ON_SVG = `
  <svg class="chaos-boot-vol-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF6A00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
  </svg>`;

const VOLUME_MUTED_SVG = `
  <svg class="chaos-boot-vol-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
    <line x1="23" y1="9" x2="17" y2="15"></line>
    <line x1="17" y1="9" x2="23" y2="15"></line>
  </svg>`;

const FAST_FORWARD_SVG = `
  <svg class="chaos-boot-ff-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polygon points="13 19 22 12 13 5 13 19"></polygon>
    <polygon points="2 19 11 12 2 5 2 19"></polygon>
  </svg>`;

/**
 * Plays the official Chaos Standard Studio Reveal.
 * Transitions directly to the sign-in / welcome page without a second splash screen.
 */
export async function playChaosBootSequence(options?: {
  readonly force?: boolean;
}): Promise<void> {
  if (options?.force !== true && hasSeenChaosBoot()) {
    return;
  }

  const reduced = prefersReducedMotion();

  await new Promise<void>((resolve) => {
    let finished = false;
    const timers: number[] = [];

    const root = document.createElement('div');
    root.className = 'chaos-boot-root';
    root.setAttribute('data-testid', 'chaos-boot-root');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Chaos Standard Reveal');

    root.innerHTML = `
      <!-- Top Telemetry Bar -->
      <div class="chaos-boot-topbar">
        <div class="chaos-boot-topbar-title">CHAOS_STANDARD // REVEAL_SEQUENCE</div>
        <div class="chaos-boot-topbar-actions">
          <button type="button" class="chaos-boot-sound-toggle" data-testid="chaos-boot-sound" title="Toggle Audio">
            <span class="chaos-boot-sound-icon">${sound.isMuted() ? VOLUME_MUTED_SVG : VOLUME_ON_SVG}</span>
            <span class="chaos-boot-sound-label">${sound.isMuted() ? 'MUTED' : 'AUDIO ACTIVE'}</span>
          </button>
          <button type="button" class="chaos-boot-skip" data-testid="chaos-boot-skip" title="Skip Intro">
            <span>SKIP INTRO</span>
            ${FAST_FORWARD_SVG}
          </button>
        </div>
      </div>

      <!-- Bottom Telemetry Bar -->
      <div class="chaos-boot-bottombar">
        <div class="chaos-boot-bottombar-status" data-testid="chaos-boot-telemetry">
          &gt; <span class="chaos-boot-telemetry-text">SYS.BOOT_SEQUENCE // CRT_WARMUP</span>
        </div>
        <div class="chaos-boot-bottombar-hint">
          PRESS [ESC] OR CLICK ANYWHERE
        </div>
      </div>

      <!-- Ambient Orange Radial Backlight -->
      <div class="chaos-boot-backlight step-idle" aria-hidden="true"></div>

      <!-- Unified Reveal Stage -->
      <div class="chaos-boot-stage" data-testid="chaos-boot-chaos">
        <!-- Terminal Monitor Unit -->
        <div class="chaos-boot-monitor-unit">
          <div class="chaos-boot-monitor-graphic step-idle">
            <img
              src="/brand/chaos-mark-symbol.png"
              alt="The Bewildered Terminal - Chaos Standard Mascot"
              class="chaos-boot-monitor-img"
              width="224"
              height="224"
            />
          </div>
          <!-- CRT Deflection Electron Beam -->
          <div class="chaos-boot-electron-beam step-idle" aria-hidden="true"></div>
        </div>

        <!-- Wordmark Unit -->
        <div class="chaos-boot-wordmark-unit step-idle">
          <img
            src="/brand/chaos-wordmark.png"
            alt="Chaos Standard Wordmark"
            class="chaos-boot-wordmark-img"
            width="384"
            height="56"
          />
        </div>

        <!-- Subtitle Telemetry Line -->
        <div class="chaos-boot-subtitle step-idle">
          BROWSER-NATIVE EXPERIENCES
        </div>
      </div>
    `;

    document.body.appendChild(root);
    document.body.classList.add('chaos-boot-active');

    const soundToggle = root.querySelector<HTMLButtonElement>('[data-testid="chaos-boot-sound"]');
    const skipBtn = root.querySelector<HTMLButtonElement>('[data-testid="chaos-boot-skip"]');
    const telemetryEl = root.querySelector<HTMLElement>('.chaos-boot-telemetry-text');
    const backlight = root.querySelector<HTMLElement>('.chaos-boot-backlight');
    const monitorGraphic = root.querySelector<HTMLElement>('.chaos-boot-monitor-graphic');
    const electronBeam = root.querySelector<HTMLElement>('.chaos-boot-electron-beam');
    const wordmarkUnit = root.querySelector<HTMLElement>('.chaos-boot-wordmark-unit');
    const subtitle = root.querySelector<HTMLElement>('.chaos-boot-subtitle');

    function applyStep(step: AnimationStep): void {
      if (finished) return;

      // Update Backlight
      if (backlight) {
        backlight.className = `chaos-boot-backlight step-${step}`;
      }

      // Update Monitor Graphic
      if (monitorGraphic) {
        monitorGraphic.className = `chaos-boot-monitor-graphic step-${step}`;
      }

      // Update Electron Beam
      if (electronBeam) {
        electronBeam.className = `chaos-boot-electron-beam step-${step}`;
      }

      // Update Wordmark
      if (wordmarkUnit) {
        wordmarkUnit.className = `chaos-boot-wordmark-unit step-${step}`;
      }

      // Update Subtitle
      if (subtitle) {
        subtitle.className = `chaos-boot-subtitle step-${step}`;
      }

      // Step-specific effects & audio
      switch (step) {
        case 'beam':
          if (telemetryEl) telemetryEl.textContent = 'ELECTRON_BEAM // STABILIZING HORIZONTAL SWEEP';
          if (!reduced) sound.playGlitch();
          break;
        case 'blossom':
          if (telemetryEl) telemetryEl.textContent = 'DEFLECTION_COILS // RASTER EXPANSION NOMINAL';
          break;
        case 'stabilize':
          if (telemetryEl) telemetryEl.textContent = 'BEWILDERED_AI_INTERFACE // ONLINE';
          if (!reduced) sound.playHover();
          break;
        case 'wordmark':
          if (telemetryEl) telemetryEl.textContent = 'CHAOS_STANDARD // COGNITIVE_DISSONANCE_NOMINAL';
          if (!reduced) sound.playStudioReveal();
          break;
        case 'complete':
          if (telemetryEl) telemetryEl.textContent = 'CHAOS_STANDARD // CALIBRATION_COMPLETE';
          break;
        case 'fadeout':
          root.classList.add('is-exiting');
          break;
      }
    }

    function cleanup(): void {
      if (finished) return;
      finished = true;

      for (const id of timers) {
        window.clearTimeout(id);
      }
      timers.length = 0;

      window.removeEventListener('keydown', handleKeyDown);

      markChaosBootSeen();
      root.classList.add('is-exiting');

      window.setTimeout(() => {
        root.remove();
        document.body.classList.remove('chaos-boot-active');
        // Trigger welcome screen animated entrance if present
        const welcomeScreen = document.querySelector<HTMLElement>('.welcome-screen');
        if (welcomeScreen) {
          welcomeScreen.classList.add('welcome-entrance-active');
        }
        resolve();
      }, reduced ? 40 : 450);
    }

    // Interactive controls
    soundToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      const nextMuted = sound.toggleMute();
      const icon = soundToggle.querySelector('.chaos-boot-sound-icon');
      const label = soundToggle.querySelector('.chaos-boot-sound-label');
      if (icon) icon.innerHTML = nextMuted ? VOLUME_MUTED_SVG : VOLUME_ON_SVG;
      if (label) label.textContent = nextMuted ? 'MUTED' : 'AUDIO ACTIVE';
      if (!nextMuted) sound.playClick();
    });

    skipBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      cleanup();
    });

    // Click anywhere on root to dismiss
    root.addEventListener('click', () => {
      cleanup();
    });

    // Keyboard dismissal
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        cleanup();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    if (reduced) {
      applyStep('complete');
      timers.push(window.setTimeout(cleanup, 400));
      return;
    }

    // Coordinated Continuous Timeline matching StudioSplashReveal.tsx
    timers.push(window.setTimeout(() => applyStep('beam'), 200));
    timers.push(window.setTimeout(() => applyStep('blossom'), 650));
    timers.push(window.setTimeout(() => applyStep('stabilize'), 1250));
    timers.push(window.setTimeout(() => applyStep('wordmark'), 1650));
    timers.push(window.setTimeout(() => applyStep('complete'), 2450));
    timers.push(window.setTimeout(() => applyStep('fadeout'), 3850));
    timers.push(window.setTimeout(cleanup, 4450));
  });
}
