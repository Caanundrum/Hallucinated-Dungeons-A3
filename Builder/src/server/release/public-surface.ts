/**
 * Public-surface gates for Local Arena vs Gold Master artifacts.
 *
 * Blueprint ownership: Section 25 Phase 7. Development identity mint, QA
 * fixture mint, and the QA harness exist only on `local_arena`. Gold Master
 * rehearsal (`publicSurface=gold_master`) still runs against local emulators
 * and must fail those routes closed.
 */

import type { ServerEnvironment } from '../config/environment.js';
import {
  allowsLocalArenaOnlyCapability,
  type PublicSurface,
} from '../../shared/public-surface-contract.js';

export function publicSurfaceOf(env: ServerEnvironment): PublicSurface {
  return env.publicSurface;
}

export function isLocalArenaPublicSurface(env: ServerEnvironment): boolean {
  return env.environmentClass === 'local' && allowsLocalArenaOnlyCapability(env.publicSurface);
}
