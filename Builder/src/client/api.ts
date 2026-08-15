/**
 * Browser-side transport for the Phase 0 foundation path.
 *
 * The client sends requests and renders whatever the server returns. It does
 * not decide authorization, ownership, ordering, or persistence, and it never
 * synthesizes a record the server has not confirmed.
 */

import {
  CANDIDATE_HEADER,
  ERROR_CODES,
  type ApiErrorBody,
  type AccountProjection,
  type CandidateIdentity,
  type CreateFoundationCheckResponse,
  type ErrorCode,
  type FoundationProjection,
} from '../shared/contract.js';
import type {
  CharacterChoices,
  CharacterProjection,
  CharacterVaultProjection,
  DraftOptions,
  DraftProjection,
} from '../shared/character-contract.js';
import type {
  CampaignDetailProjection,
  CampaignListProjection,
  CampaignProjection,
  DirectorCatalog,
  InvitationCreatedProjection,
  InvitationPreview,
  SeatProjection,
} from '../shared/campaign-contract.js';
import type {
  ChronicleFeedProjection,
  PartyChatFeedProjection,
  PartyChatMessageProjection,
} from '../shared/communication-contract.js';
import type {
  TableCommandAcceptResponse,
  TableStateProjection,
} from '../shared/command-contract.js';
import type { MapBundleProjection } from '../shared/map-contract.js';
import type { MovementPreviewProjection } from '../shared/movement-contract.js';
import type {
  TimingAuthorityClaimResponse,
  TimingAuthorityProjection,
} from '../shared/timing-authority-contract.js';
import type {
  CampaignSettingsProjection,
  PlayerPresentationSettingsProjection,
} from '../shared/settings-contract.js';
import type {
  AreaTarget,
  CharacterProgressionProjection,
  EncounterProjection,
  RuleExplanationProjection,
} from '../shared/rules-combat-contract.js';

/** A draft always travels with the options legal for its current state. */
export interface DraftResponse {
  readonly draft: DraftProjection;
  readonly options: DraftOptions;
}

/** A failure the page can explain to the person using it. */
export class ApiFailure extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'ApiFailure';
    this.code = code;
  }
}

const NETWORK_FAILURE_MESSAGE =
  'The Local Arena server did not respond. Confirm it is running, then retry.';

let authFailureHandler: (() => void) | null = null;

/** Registers the shared session clear used when the server reports auth death. */
export function onAuthFailure(handler: () => void): void {
  authFailureHandler = handler;
}

async function request<T>(
  path: string,
  init: RequestInit & { candidateId?: string } = {},
): Promise<T | null> {
  const headers = new Headers(init.headers);
  if (init.candidateId !== undefined) {
    headers.set(CANDIDATE_HEADER, init.candidateId);
  }
  if (init.body !== undefined) {
    headers.set('content-type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiFailure(ERROR_CODES.UPSTREAM_UNAVAILABLE, NETWORK_FAILURE_MESSAGE);
  }

  if (response.status === 204) {
    return null;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiFailure(
      ERROR_CODES.UPSTREAM_UNAVAILABLE,
      'The Local Arena server returned a response this page could not read.',
    );
  }

  if (!response.ok) {
    const body = payload as Partial<ApiErrorBody>;
    const code = (body.error ?? ERROR_CODES.UPSTREAM_UNAVAILABLE) as ErrorCode;
    if (
      (code === ERROR_CODES.NOT_AUTHENTICATED || code === ERROR_CODES.SESSION_EXPIRED) &&
      authFailureHandler !== null
    ) {
      authFailureHandler();
    }
    throw new ApiFailure(code, body.message ?? NETWORK_FAILURE_MESSAGE);
  }

  return payload as T;
}

export async function fetchCandidate(): Promise<CandidateIdentity> {
  return (await request<CandidateIdentity>('/api/candidate')) as CandidateIdentity;
}

export async function fetchSession(): Promise<AccountProjection> {
  return (await request<AccountProjection>('/api/session')) as AccountProjection;
}

/** Alias for the product-facing account surface; same Development Test Identity. */
export async function fetchAccount(): Promise<AccountProjection> {
  return fetchSession();
}

export async function enterLocalArena(candidateId: string): Promise<AccountProjection> {
  return (await request<AccountProjection>('/api/identity/development-session', {
    method: 'POST',
    candidateId,
  })) as AccountProjection;
}

export async function leaveLocalArena(candidateId: string): Promise<void> {
  await request<null>('/api/session', { method: 'DELETE', candidateId });
}

export async function fetchProjection(): Promise<FoundationProjection> {
  return (await request<FoundationProjection>('/api/foundation-checks')) as FoundationProjection;
}

export async function fetchVault(): Promise<CharacterVaultProjection> {
  return (await request<CharacterVaultProjection>(
    '/api/characters/vault',
  )) as CharacterVaultProjection;
}

/** Opens the account's draft, resuming the existing one when there is one. */
export async function openDraft(candidateId: string): Promise<DraftResponse> {
  return (await request<DraftResponse>('/api/characters/drafts', {
    method: 'POST',
    candidateId,
  })) as DraftResponse;
}

export async function fetchDraft(draftId: string): Promise<DraftResponse> {
  return (await request<DraftResponse>(`/api/characters/drafts/${draftId}`)) as DraftResponse;
}

export async function saveDraft(options: {
  readonly candidateId: string;
  readonly draftId: string;
  readonly choices: CharacterChoices;
}): Promise<DraftResponse> {
  return (await request<DraftResponse>(`/api/characters/drafts/${options.draftId}`, {
    method: 'PUT',
    candidateId: options.candidateId,
    body: JSON.stringify({ choices: options.choices }),
  })) as DraftResponse;
}

export async function applyQuickStartTemplate(options: {
  readonly candidateId: string;
  readonly draftId: string;
  readonly templateId: string;
}): Promise<DraftResponse> {
  return (await request<DraftResponse>(`/api/characters/drafts/${options.draftId}/quick-start`, {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify({ templateId: options.templateId }),
  })) as DraftResponse;
}

/** Server-authoritative Ability Score roll (4d6 drop lowest × 6). Max 3 per draft. */
export async function rollDraftAbilities(options: {
  readonly candidateId: string;
  readonly draftId: string;
}): Promise<DraftResponse> {
  return (await request<DraftResponse>(`/api/characters/drafts/${options.draftId}/roll-abilities`, {
    method: 'POST',
    candidateId: options.candidateId,
  })) as DraftResponse;
}

export async function createCharacter(options: {
  readonly candidateId: string;
  readonly draftId: string;
}): Promise<CharacterProjection> {
  return (await request<CharacterProjection>(
    `/api/characters/drafts/${options.draftId}/commit`,
    { method: 'POST', candidateId: options.candidateId },
  )) as CharacterProjection;
}

export async function discardDraft(options: {
  readonly candidateId: string;
  readonly draftId: string;
}): Promise<void> {
  await request<null>(`/api/characters/drafts/${options.draftId}`, {
    method: 'DELETE',
    candidateId: options.candidateId,
  });
}

export async function fetchCharacter(characterId: string): Promise<CharacterProjection> {
  return (await request<CharacterProjection>(
    `/api/characters/${characterId}`,
  )) as CharacterProjection;
}

export async function fetchDirectorCatalog(): Promise<DirectorCatalog> {
  return (await request<DirectorCatalog>('/api/directors/catalog')) as DirectorCatalog;
}

export async function fetchCampaigns(): Promise<CampaignListProjection> {
  return (await request<CampaignListProjection>('/api/campaigns')) as CampaignListProjection;
}

export async function createCampaign(options: {
  readonly candidateId: string;
  readonly name: string;
  readonly summary: string;
  readonly directorIdentity: string;
  readonly directorPersonality: string;
}): Promise<CampaignProjection> {
  return (await request<CampaignProjection>('/api/campaigns', {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify({
      name: options.name,
      summary: options.summary,
      directorIdentity: options.directorIdentity,
      directorPersonality: options.directorPersonality,
    }),
  })) as CampaignProjection;
}

export async function fetchCampaignDetail(campaignId: string): Promise<CampaignDetailProjection> {
  return (await request<CampaignDetailProjection>(
    `/api/campaigns/${campaignId}`,
  )) as CampaignDetailProjection;
}

export async function createCampaignInvitation(options: {
  readonly candidateId: string;
  readonly campaignId: string;
}): Promise<InvitationCreatedProjection> {
  return (await request<InvitationCreatedProjection>(
    `/api/campaigns/${options.campaignId}/invitations`,
    { method: 'POST', candidateId: options.candidateId },
  )) as InvitationCreatedProjection;
}

export async function revokeCampaignInvitation(options: {
  readonly candidateId: string;
  readonly campaignId: string;
}): Promise<void> {
  await request<null>(`/api/campaigns/${options.campaignId}/invitations/revoke`, {
    method: 'POST',
    candidateId: options.candidateId,
  });
}

export async function fetchInvitationPreview(inviteCode: string): Promise<InvitationPreview> {
  return (await request<InvitationPreview>(
    `/api/invitations/${inviteCode}`,
  )) as InvitationPreview;
}

export async function acceptCampaignInvitation(options: {
  readonly candidateId: string;
  readonly inviteCode: string;
}): Promise<CampaignProjection> {
  return (await request<CampaignProjection>(`/api/invitations/${options.inviteCode}/accept`, {
    method: 'POST',
    candidateId: options.candidateId,
  })) as CampaignProjection;
}

export async function createCampaignSeat(options: {
  readonly candidateId: string;
  readonly campaignId: string;
  readonly characterId: string;
}): Promise<SeatProjection> {
  return (await request<SeatProjection>(`/api/campaigns/${options.campaignId}/seats`, {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify({ characterId: options.characterId }),
  })) as SeatProjection;
}

export async function fetchCampaignSettings(campaignId: string): Promise<CampaignSettingsProjection> {
  return (await request(`/api/campaigns/${campaignId}/settings`)) as CampaignSettingsProjection;
}

export async function saveCampaignSettings(options: {
  readonly candidateId: string;
  readonly campaignId: string;
  readonly payload: Record<string, unknown>;
}): Promise<CampaignSettingsProjection> {
  return (await request(`/api/campaigns/${options.campaignId}/settings`, {
    method: 'PUT',
    candidateId: options.candidateId,
    body: JSON.stringify(options.payload),
  })) as CampaignSettingsProjection;
}

export async function fetchChronicle(campaignId: string): Promise<ChronicleFeedProjection> {
  return (await request(`/api/campaigns/${campaignId}/chronicle`)) as ChronicleFeedProjection;
}

export async function fetchPartyChat(campaignId: string): Promise<PartyChatFeedProjection> {
  return (await request(`/api/campaigns/${campaignId}/party-chat`)) as PartyChatFeedProjection;
}

export async function postPartyChat(options: {
  readonly candidateId: string;
  readonly campaignId: string;
  readonly mode: string;
  readonly body: string;
}): Promise<PartyChatMessageProjection> {
  return (await request(`/api/campaigns/${options.campaignId}/party-chat`, {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify({ mode: options.mode, body: options.body }),
  })) as PartyChatMessageProjection;
}

export async function fetchTableState(campaignId: string): Promise<TableStateProjection> {
  return (await request(`/api/campaigns/${campaignId}/table-state`)) as TableStateProjection;
}

export async function fetchCampaignMap(campaignId: string): Promise<MapBundleProjection> {
  return (await request(`/api/campaigns/${campaignId}/map`)) as MapBundleProjection;
}

export async function submitTableCommand(options: {
  readonly candidateId: string;
  readonly campaignId: string;
  readonly requestId: string;
  readonly commandType: string;
  readonly expectedStateVersion: number;
  readonly timingAuthorityId?: string;
  readonly path?: readonly { readonly column: number; readonly row: number }[];
  readonly edgeId?: string;
  readonly targetCombatantId?: string;
  readonly attackId?: string;
  readonly spellId?: string;
  readonly area?: AreaTarget;
  readonly reactionKind?: 'opportunity_attack' | 'shield';
  readonly decisionWindowId?: string;
  readonly readyTrigger?: string;
  readonly xpAmount?: number;
  readonly itemId?: string;
}): Promise<TableCommandAcceptResponse> {
  return (await request(`/api/campaigns/${options.campaignId}/commands`, {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify({
      requestId: options.requestId,
      commandType: options.commandType,
      expectedStateVersion: options.expectedStateVersion,
      ...(options.timingAuthorityId !== undefined
        ? { timingAuthorityId: options.timingAuthorityId }
        : {}),
      ...(options.path !== undefined ? { path: options.path } : {}),
      ...(options.edgeId !== undefined ? { edgeId: options.edgeId } : {}),
      ...(options.targetCombatantId !== undefined
        ? { targetCombatantId: options.targetCombatantId }
        : {}),
      ...(options.attackId !== undefined ? { attackId: options.attackId } : {}),
      ...(options.spellId !== undefined ? { spellId: options.spellId } : {}),
      ...(options.area !== undefined ? { area: options.area } : {}),
      ...(options.reactionKind !== undefined
        ? { reactionKind: options.reactionKind }
        : {}),
      ...(options.decisionWindowId !== undefined
        ? { decisionWindowId: options.decisionWindowId }
        : {}),
      ...(options.readyTrigger !== undefined ? { readyTrigger: options.readyTrigger } : {}),
      ...(options.xpAmount !== undefined ? { xpAmount: options.xpAmount } : {}),
      ...(options.itemId !== undefined ? { itemId: options.itemId } : {}),
    }),
  })) as TableCommandAcceptResponse;
}

export async function fetchRulesState(campaignId: string): Promise<{
  readonly encounter: EncounterProjection | null;
  readonly progression: CharacterProgressionProjection;
}> {
  return (await request(`/api/campaigns/${campaignId}/rules-state`)) as {
    encounter: EncounterProjection | null;
    progression: CharacterProgressionProjection;
  };
}

export async function fetchRuleExplanation(ruleId: string): Promise<RuleExplanationProjection> {
  return (await request(
    `/api/rules/explain?ruleId=${encodeURIComponent(ruleId)}`,
  )) as RuleExplanationProjection;
}

export async function fetchTimingAuthority(
  campaignId: string,
): Promise<{ authority: TimingAuthorityProjection | null }> {
  return (await request(`/api/campaigns/${campaignId}/timing-authority`)) as {
    authority: TimingAuthorityProjection | null;
  };
}

export async function claimTimingAuthority(options: {
  readonly candidateId: string;
  readonly campaignId: string;
}): Promise<TimingAuthorityClaimResponse> {
  return (await request(`/api/campaigns/${options.campaignId}/timing-authority`, {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify({}),
  })) as TimingAuthorityClaimResponse;
}

export async function endTimingAuthority(options: {
  readonly candidateId: string;
  readonly campaignId: string;
  readonly timingAuthorityId: string;
}): Promise<{ authority: TimingAuthorityProjection }> {
  return (await request(`/api/campaigns/${options.campaignId}/timing-authority/end`, {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify({ timingAuthorityId: options.timingAuthorityId }),
  })) as { authority: TimingAuthorityProjection };
}

export async function previewTableMove(options: {
  readonly candidateId: string;
  readonly campaignId: string;
  readonly path: readonly { readonly column: number; readonly row: number }[];
}): Promise<MovementPreviewProjection> {
  return (await request(`/api/campaigns/${options.campaignId}/move-preview`, {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify({ path: options.path }),
  })) as MovementPreviewProjection;
}

export async function fetchPlayerSettings(): Promise<PlayerPresentationSettingsProjection> {
  return (await request('/api/account/settings')) as PlayerPresentationSettingsProjection;
}

export async function savePlayerSettings(options: {
  readonly candidateId: string;
  readonly reducedMotion: boolean;
  readonly lowEffects?: boolean;
}): Promise<PlayerPresentationSettingsProjection> {
  return (await request('/api/account/settings', {
    method: 'PUT',
    candidateId: options.candidateId,
    body: JSON.stringify({
      reducedMotion: options.reducedMotion,
      ...(options.lowEffects !== undefined ? { lowEffects: options.lowEffects } : {}),
    }),
  })) as PlayerPresentationSettingsProjection;
}

export async function recordFoundationCheck(options: {
  readonly candidateId: string;
  readonly requestId: string;
  readonly note: string;
}): Promise<CreateFoundationCheckResponse> {
  return (await request<CreateFoundationCheckResponse>('/api/foundation-checks', {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify({ requestId: options.requestId, note: options.note }),
  })) as CreateFoundationCheckResponse;
}
