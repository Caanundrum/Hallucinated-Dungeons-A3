/**
 * Local Arena QA progression harness — availability and fail-closed hosted cutover.
 *
 * Blueprint ownership: Section 6.2 / 19.11.3 and Phase 7 artifact stripping.
 * The harness may exist only on `local_arena`. It never stamps derived character
 * statistics. Hosted Gold Master artifacts must fail closed.
 *
 * This candidate exposes a non-mutating status operation so certification can
 * prove the route exists locally and is absent when `publicSurface=gold_master`.
 * Mutating fixture setup still travels through canonical identity/character
 * services (QA fixture sessions), not a second writer.
 */

import { IdentityUnavailableError } from '../identity/development-identity.js';
import type { ServerEnvironment } from '../config/environment.js';
import { isLocalArenaPublicSurface } from './public-surface.js';

function assertHarnessAllowed(env: ServerEnvironment): void {
  if (!isLocalArenaPublicSurface(env)) {
    throw new IdentityUnavailableError(
      'qa_progression_harness is available only on the Local Arena public surface and is stripped from Gold Master artifacts.',
    );
  }
}

export const QA_HARNESS_OPERATIONS = ['status'] as const;
export type QaHarnessOperation = (typeof QA_HARNESS_OPERATIONS)[number];

export interface QaHarnessProjection {
  readonly available: boolean;
  readonly publicSurface: ServerEnvironment['publicSurface'];
  readonly operations: readonly QaHarnessOperation[];
  readonly notice: string;
}

export const QA_HARNESS_LOCAL_NOTICE =
  'This QA harness is a Local Arena certification control. It cannot mint ordinary player accounts, impersonate Google identities, or appear on Gold Master / Launch Production artifacts.';

export function qaHarnessStatus(env: ServerEnvironment): QaHarnessProjection {
  assertHarnessAllowed(env);
  return {
    available: true,
    publicSurface: env.publicSurface,
    operations: QA_HARNESS_OPERATIONS,
    notice: QA_HARNESS_LOCAL_NOTICE,
  };
}

export function runQaHarnessOperation(
  env: ServerEnvironment,
  operation: string,
): QaHarnessProjection {
  assertHarnessAllowed(env);
  if (operation !== 'status') {
    throw new IdentityUnavailableError(
      'That QA harness operation is not allowlisted. Mutating fixture setup uses canonical QA fixture sessions, not a second writer.',
    );
  }
  return qaHarnessStatus(env);
}
