import type { CandidateIdentity } from '../shared/contract.js';

/** Hosted Invite-Only Alpha player surface (App Hosting / Milestone). */
export function isHostedPlayerSurface(candidate: CandidateIdentity | null): boolean {
  return candidate?.environmentClass === 'milestone' && candidate?.publicSurface === 'gold_master';
}
