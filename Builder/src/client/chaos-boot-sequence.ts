/**
 * Chaos Standard studio splash → Hallucinated Dungeons game splash.
 *
 * Phase 1 matches the shared Chaos Standard mark (teal icon + wordmark).
 * Phase 2 is this game only — never the HCOS boot screen from other titles.
 * Skippable; once per browser session.
 */

const SESSION_KEY = 'hd.chaosBoot.seen.v1';

const CHAOS_MARK_SVG = `
  <svg class="chaos-mark-icon" viewBox="0 0 64 64" width="88" height="88" aria-hidden="true" focusable="false">
    <defs>
      <filter id="chaos-mark-glow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="2.2" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    <rect x="4" y="4" width="56" height="56" rx="14" fill="#0a1218" stroke="#4dd4d4" stroke-width="2.5" filter="url(#chaos-mark-glow)" />
    <rect x="14" y="14" width="12" height="12" rx="2" fill="#6ee7e7" />
    <rect x="28" y="40" width="22" height="6" rx="2" fill="#7dffb0" />
  </svg>`;

const HD_MARK_SVG = `
  <svg class="hd-boot-logo-mark" width="112" height="112" viewBox="0 0 96 96" fill="none" aria-hidden="true" focusable="false">
    <path d="M20 88 V48 A28 28 0 0 1 76 48 V88" stroke="currentColor" stroke-width="4" stroke-linecap="round" />
    <path d="M12 88 H84" stroke="currentColor" stroke-width="4" stroke-linecap="round" />
    <path d="M30 88 V56" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity="0.6" />
    <path d="M66 88 V56" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity="0.6" />
  </svg>`;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function sessionAlreadySeen(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

function markSessionSeen(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    // sessionStorage may be unavailable; ignore.
  }
}

/**
 * Plays the Chaos Standard → Hallucinated Dungeons boot sequence over the page.
 * Resolves when finished or skipped. No-ops if already seen this session.
 */
export async function playChaosBootSequence(options?: {
  readonly force?: boolean;
}): Promise<void> {
  if (options?.force !== true && sessionAlreadySeen()) {
    return;
  }

  const reduced = prefersReducedMotion();
  const chaosMs = reduced ? 400 : 2200;
  const gameMs = reduced ? 500 : 2800;

  await new Promise<void>((resolve) => {
    const root = document.createElement('div');
    root.className = 'chaos-boot-root';
    root.setAttribute('data-testid', 'chaos-boot-root');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Chaos Standard and Hallucinated Dungeons intro');
    root.innerHTML = `
      <div class="chaos-boot-layer chaos-boot-chaos is-active" data-testid="chaos-boot-chaos" data-boot-phase="chaos">
        <div class="chaos-boot-chaos-inner">
          ${CHAOS_MARK_SVG}
          <p class="chaos-boot-studio">Chaos Standard</p>
        </div>
      </div>
      <div class="chaos-boot-layer chaos-boot-game" data-testid="chaos-boot-game" data-boot-phase="game" hidden>
        <div class="chaos-boot-game-inner">
          ${HD_MARK_SVG}
          <p class="chaos-boot-eyebrow">A Chaos Standard table</p>
          <h1 class="chaos-boot-title">Hallucinated Dungeons</h1>
          <p class="chaos-boot-tagline">Forge a hero. Gather your party. Step into a living story.</p>
        </div>
      </div>
      <button type="button" class="chaos-boot-skip" data-testid="chaos-boot-skip">Skip</button>
    `;

    document.body.appendChild(root);
    document.body.classList.add('chaos-boot-active');

    const chaosLayer = root.querySelector<HTMLElement>('[data-testid="chaos-boot-chaos"]');
    const gameLayer = root.querySelector<HTMLElement>('[data-testid="chaos-boot-game"]');
    const skipButton = root.querySelector<HTMLButtonElement>('[data-testid="chaos-boot-skip"]');
    let finished = false;
    let timers: number[] = [];

    function cleanup(): void {
      if (finished) {
        return;
      }
      finished = true;
      for (const id of timers) {
        window.clearTimeout(id);
      }
      timers = [];
      markSessionSeen();
      root.classList.add('is-exiting');
      window.setTimeout(() => {
        root.remove();
        document.body.classList.remove('chaos-boot-active');
        resolve();
      }, reduced ? 80 : 280);
    }

    function showGame(): void {
      if (finished || chaosLayer === null || gameLayer === null) {
        return;
      }
      chaosLayer.classList.remove('is-active');
      chaosLayer.hidden = true;
      gameLayer.hidden = false;
      // Force reflow so the enter animation runs.
      void gameLayer.offsetWidth;
      gameLayer.classList.add('is-active');
      timers.push(window.setTimeout(cleanup, gameMs));
    }

    skipButton?.addEventListener('click', cleanup);
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        cleanup();
      }
    });

    skipButton?.focus({ preventScroll: true });
    timers.push(window.setTimeout(showGame, chaosMs));
  });
}
