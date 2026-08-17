/**
 * In-memory sliding-window rate limiter for Local Arena HTTP abuse controls.
 *
 * Default Local Arena budgets (per accountId, per rolling window):
 * - Table commands (`POST …/commands`): 60 / 60s
 * - Party chat (`POST …/party-chat`): 30 / 60s
 * - AI gateway (`POST …/director-address`, `…/narrate`, `…/interpret-intent`): 20 / 60s
 *
 * Certification / e2e may tighten these via process env (read once per call):
 * - `HD_RATE_LIMIT_WINDOW_MS` (default 60000)
 * - `HD_RATE_LIMIT_COMMANDS_PER_WINDOW` (default 60)
 * - `HD_RATE_LIMIT_CHAT_PER_WINDOW` (default 30)
 * - `HD_RATE_LIMIT_AI_PER_WINDOW` (default 20)
 *
 * Buckets are process-local and keyed by caller-supplied strings (typically
 * `commands:<accountId>`, `party-chat:<accountId>`, `ai:<accountId>`).
 */

export interface RateLimitCheck {
  readonly key: string;
  readonly limit: number;
  readonly windowMs: number;
  /** Optional clock injection for unit tests. */
  readonly nowMs?: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly retryAfterMs?: number;
}

export interface ArenaRateLimitDefaults {
  readonly windowMs: number;
  readonly commandsPerWindow: number;
  readonly chatPerWindow: number;
  readonly aiPerWindow: number;
}

const buckets = new Map<string, number[]>();

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

/** Reads Local Arena rate-limit defaults, honoring optional env overrides. */
export function readArenaRateLimitDefaults(
  env: NodeJS.ProcessEnv = process.env,
): ArenaRateLimitDefaults {
  return {
    windowMs: parsePositiveInt(env.HD_RATE_LIMIT_WINDOW_MS, 60_000),
    commandsPerWindow: parsePositiveInt(env.HD_RATE_LIMIT_COMMANDS_PER_WINDOW, 60),
    chatPerWindow: parsePositiveInt(env.HD_RATE_LIMIT_CHAT_PER_WINDOW, 30),
    aiPerWindow: parsePositiveInt(env.HD_RATE_LIMIT_AI_PER_WINDOW, 20),
  };
}

export function rateLimitKeyForCommands(accountId: string): string {
  return `commands:${accountId}`;
}

export function rateLimitKeyForPartyChat(accountId: string): string {
  return `party-chat:${accountId}`;
}

export function rateLimitKeyForAiGateway(accountId: string): string {
  return `ai:${accountId}`;
}

/**
 * Records one attempt against the sliding window for `key`.
 * When the window is full, returns `allowed: false` and how long until the
 * oldest counted attempt falls out of the window.
 */
export function checkRateLimit(options: RateLimitCheck): RateLimitResult {
  const nowMs = options.nowMs ?? Date.now();
  const cutoff = nowMs - options.windowMs;
  const prior = buckets.get(options.key) ?? [];
  const recent = prior.filter((timestamp) => timestamp > cutoff);

  if (recent.length >= options.limit) {
    const oldest = recent[0]!;
    const retryAfterMs = Math.max(1, oldest + options.windowMs - nowMs);
    buckets.set(options.key, recent);
    return { allowed: false, retryAfterMs };
  }

  recent.push(nowMs);
  buckets.set(options.key, recent);
  return { allowed: true };
}

/** Test helper: clears all in-memory buckets. */
export function resetRateLimitBuckets(): void {
  buckets.clear();
}
