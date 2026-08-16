/**
 * Admin authorization constants and helpers — Phase 4.
 *
 * Blueprint: bootstrap administrator is the exact server-verified Google
 * account nick.donner@gmail.com. Admin status never grants hidden table
 * information or mechanical privilege during ordinary play.
 */

import { BOOTSTRAP_ADMIN_EMAIL } from '../../shared/presence-contract.js';

export { BOOTSTRAP_ADMIN_EMAIL };

export function isBootstrapAdminEmail(email: string | null | undefined): boolean {
  if (typeof email !== 'string') return false;
  return email.trim().toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
}
