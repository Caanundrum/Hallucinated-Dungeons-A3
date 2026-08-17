/**
 * Phase 4 identity projection and provider-mode contract.
 *
 * Local Arena keeps development identities. Google Sign-In mode is exercised
 * via Auth emulator / contract minting locally; hosted Milestone uses real
 * Google. Machine-only QA fixtures exist only in the Local Arena.
 */

import type { IdentityProviderMode } from './presence-contract.js';

export type { IdentityProviderMode };

/**
 * Unified account projection for Phase 4+. Development identities omit email.
 * Google / QA fixture sessions may carry a server-verified email used only for
 * Admin authorization and audit — never accepted from the client body.
 */
export interface AccountIdentityProjection {
  readonly accountId: string;
  readonly displayLabel: string;
  readonly identityMode: IdentityProviderMode;
  readonly expiresAt: string;
  readonly email: string | null;
  readonly isBootstrapAdmin: boolean;
}

export const GOOGLE_SIGN_IN_NOTICE =
  'Hosted player identity uses Google Sign-In only. Local Arena may still mint development identities and machine-only QA fixtures. Gold Master artifacts strip those paths.';
