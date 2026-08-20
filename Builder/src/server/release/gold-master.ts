/**
 * Gold Master package projection — identity, stripped capabilities, legal,
 * provider, eligibility, ops, and honest publication state.
 *
 * Blueprint ownership: Section 25 Phase 7 and C.ARENA.13. This record is the
 * machine-readable Gold Master package the frozen candidate serves. It does
 * not deploy anywhere.
 */

import {
  BROWSER_SUPPORT_MATRIX,
  ELIGIBILITY_POLICY,
  GOLD_MASTER_STRIPPED_CAPABILITIES,
  type PublicSurface,
} from '../../shared/public-surface-contract.js';
import { listLegalDocuments } from '../legal/legal-registry.js';
import { PROVIDER_COMPLIANCE_REGISTRY } from '../ai/director-gateway.js';
import { readArenaRateLimitDefaults } from '../security/rate-limit.js';
import type { ServerEnvironment } from '../config/environment.js';

export interface GoldMasterPackageProjection {
  readonly recordType: 'gold_master_package';
  readonly candidateId: string;
  readonly publicSurface: PublicSurface;
  readonly environmentClass: ServerEnvironment['environmentClass'];
  readonly launchProduction: 'NOT_DEPLOYED';
  readonly productOwnerAuthorization: 'NOT_GRANTED';
  readonly hostedSmoke: 'NOT_RUN';
  readonly strippedFromHostedArtifacts: readonly string[];
  readonly localArenaStillExposesStrippedCapabilities: boolean;
  readonly legalDocuments: readonly {
    readonly route: string;
    readonly title: string;
    readonly version: string;
    readonly contentDigest: string;
    readonly reConsentRequired: boolean;
  }[];
  readonly eligibilityPolicy: typeof ELIGIBILITY_POLICY;
  readonly browserSupport: typeof BROWSER_SUPPORT_MATRIX;
  readonly providers: typeof PROVIDER_COMPLIANCE_REGISTRY;
  readonly quotas: ReturnType<typeof readArenaRateLimitDefaults>;
  readonly ops: {
    readonly healthPath: '/api/health';
    readonly healthMutatesGameplay: false;
    readonly incidentRunbook: 'Checkpoints/phase-7/INCIDENT_RUNBOOK.md';
    readonly rollbackProcedure: 'Checkpoints/phase-7/ROLLBACK_PROCEDURE.md';
    readonly supportPath: 'invitation channel named in legal documents';
  };
  readonly honestBounds: readonly string[];
}

export function buildGoldMasterPackage(env: ServerEnvironment): GoldMasterPackageProjection {
  const localArena = env.publicSurface === 'local_arena';
  return {
    recordType: 'gold_master_package',
    candidateId: env.candidateId,
    publicSurface: env.publicSurface,
    environmentClass: env.environmentClass,
    launchProduction: 'NOT_DEPLOYED',
    productOwnerAuthorization: 'NOT_GRANTED',
    hostedSmoke: 'NOT_RUN',
    strippedFromHostedArtifacts: GOLD_MASTER_STRIPPED_CAPABILITIES,
    localArenaStillExposesStrippedCapabilities: localArena,
    legalDocuments: listLegalDocuments().map((document) => ({
      route: document.route,
      title: document.title,
      version: document.version,
      contentDigest: document.contentDigest,
      reConsentRequired: document.reConsentRequired,
    })),
    eligibilityPolicy: ELIGIBILITY_POLICY,
    browserSupport: BROWSER_SUPPORT_MATRIX,
    providers: PROVIDER_COMPLIANCE_REGISTRY,
    quotas: readArenaRateLimitDefaults(),
    ops: {
      healthPath: '/api/health',
      healthMutatesGameplay: false,
      incidentRunbook: 'Checkpoints/phase-7/INCIDENT_RUNBOOK.md',
      rollbackProcedure: 'Checkpoints/phase-7/ROLLBACK_PROCEDURE.md',
      supportPath: 'invitation channel named in legal documents',
    },
    honestBounds: [
      env.environmentClass === 'milestone'
        ? 'This process is Invite-Only Alpha on Milestone Firebase. Launch Production is not configured and has not been deployed.'
        : 'This process is the Local Execution Environment. Launch Production is not configured and has not been deployed.',
      'Safari, certified tablet hardware, and real screen-reader AT remain BLOCKED_FOR_FINAL_DEVICE_CERTIFICATION on this host.',
      env.environmentClass === 'milestone'
        ? 'Google Sign-In uses live Google OAuth. Development identities, QA fixtures, and the QA harness are stripped.'
        : 'Google Sign-In on this host uses the Auth emulator. It is not a live OAuth popup against a public Google Cloud project.',
      env.environmentClass === 'milestone'
        ? 'Hosted Invite-Only Alpha uses Gemini 3.7 Flash on Agent Platform for Director Address and narration when the AI kill switch is off. Local Arena remains a deterministic simulator.'
        : 'The Local Arena Director remains a deterministic simulator. Hosted Gemini is not called from this process.',
      'Age/region eligibility collection is inactive because no selected provider currently requires it.',
    ],
  };
}
