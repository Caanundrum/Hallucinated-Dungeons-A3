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
  ActiveSeatedTableProjection,
  CampaignDetailProjection,
  CampaignListProjection,
  CampaignProjection,
  DirectorCatalog,
  InvitationCreatedProjection,
  InvitationPreview,
  JoinTableResponse,
  PublicTableListProjection,
  SeatProjection,
  TablesHubProjection,
} from '../shared/campaign-contract.js';
import type {
  CampaignMemoryProjection,
  CampaignSessionResumeResponse,
  CampaignSessionSuspendResponse,
  PersonalRecapProjection,
} from '../shared/campaign-memory-contract.js';
import type { PresentationCuePlanProjection } from '../shared/presentation-cue-contract.js';
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
  readonly conflict?: import('../shared/table-contention-contract.js').TableConflictDetail;

  constructor(
    code: ErrorCode,
    message: string,
    conflict?: import('../shared/table-contention-contract.js').TableConflictDetail,
  ) {
    super(message);
    this.name = 'ApiFailure';
    this.code = code;
    if (conflict !== undefined) {
      this.conflict = conflict;
    }
  }
}

const NETWORK_FAILURE_MESSAGE =
  'The game server did not respond. Check your connection, then try again.';

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
      'The game server returned a response this page could not read.',
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
    throw new ApiFailure(
      code,
      body.message ?? NETWORK_FAILURE_MESSAGE,
      body.conflict,
    );
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

export async function deleteCharacter(options: {
  readonly candidateId: string;
  readonly characterId: string;
}): Promise<void> {
  await request<null>(`/api/characters/${options.characterId}`, {
    method: 'DELETE',
    candidateId: options.candidateId,
  });
}

export async function updateCharacterIdentity(options: {
  readonly candidateId: string;
  readonly characterId: string;
  readonly identity: CharacterChoices['identity'];
}): Promise<CharacterProjection> {
  return (await request<CharacterProjection>(`/api/characters/${options.characterId}`, {
    method: 'PATCH',
    candidateId: options.candidateId,
    body: JSON.stringify({ identity: options.identity }),
  })) as CharacterProjection;
}

export async function updateCharacterLoadout(options: {
  readonly candidateId: string;
  readonly characterId: string;
  readonly spellIds?: readonly string[];
  readonly classEquipmentOptionId?: string | null;
  readonly backgroundEquipmentOptionId?: string | null;
  readonly weaponMasteryWeaponNames?: readonly string[];
  readonly chosenOriginFeatId?: string | null;
}): Promise<CharacterProjection> {
  const { candidateId, characterId, ...loadout } = options;
  return (await request<CharacterProjection>(`/api/characters/${characterId}`, {
    method: 'PATCH',
    candidateId,
    body: JSON.stringify({ loadout }),
  })) as CharacterProjection;
}

export async function updateCharacterTrackers(options: {
  readonly candidateId: string;
  readonly characterId: string;
  readonly hitPointsCurrent?: number;
  readonly temporaryHitPoints?: number;
  readonly resourceRemaining?: Readonly<Record<string, number>>;
  readonly level1SlotsRemaining?: number;
  readonly equipmentOverrides?: readonly {
    readonly name: string;
    readonly quantity: number;
    readonly equipped?: boolean;
  }[];
  readonly auditReason?: string;
}): Promise<CharacterProjection> {
  const { candidateId, characterId, ...trackers } = options;
  return (await request<CharacterProjection>(`/api/characters/${characterId}`, {
    method: 'PATCH',
    candidateId,
    body: JSON.stringify({ trackers }),
  })) as CharacterProjection;
}

export async function fetchDirectorCatalog(): Promise<DirectorCatalog> {
  return (await request<DirectorCatalog>('/api/directors/catalog')) as DirectorCatalog;
}

export async function fetchCampaigns(): Promise<CampaignListProjection> {
  return (await request<CampaignListProjection>('/api/campaigns')) as CampaignListProjection;
}

export async function fetchTablesHub(): Promise<TablesHubProjection> {
  return (await request<TablesHubProjection>('/api/tables/hub')) as TablesHubProjection;
}

export async function fetchPublicTables(): Promise<PublicTableListProjection> {
  return (await request<PublicTableListProjection>(
    '/api/tables/public',
  )) as PublicTableListProjection;
}

export async function fetchActiveSeatedTable(): Promise<ActiveSeatedTableProjection | null> {
  return await request<ActiveSeatedTableProjection | null>('/api/tables/active-seat');
}

export async function createCampaign(options: {
  readonly candidateId: string;
  readonly name: string;
  readonly summary: string;
  readonly directorIdentity: string;
  readonly directorPersonality: string;
  readonly visibility?: string;
  readonly joinPassword?: string;
}): Promise<CampaignProjection> {
  return (await request<CampaignProjection>('/api/campaigns', {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify({
      name: options.name,
      summary: options.summary,
      directorIdentity: options.directorIdentity,
      directorPersonality: options.directorPersonality,
      adventureTemplate: 'blank',
      ...(options.visibility !== undefined ? { visibility: options.visibility } : {}),
      ...(options.joinPassword !== undefined && options.joinPassword.length > 0
        ? { joinPassword: options.joinPassword }
        : {}),
    }),
  })) as CampaignProjection;
}

export async function fetchCampaignDetail(campaignId: string): Promise<CampaignDetailProjection> {
  return (await request<CampaignDetailProjection>(
    `/api/campaigns/${campaignId}`,
  )) as CampaignDetailProjection;
}

export async function updateCampaign(options: {
  readonly candidateId: string;
  readonly campaignId: string;
  readonly name?: string;
  readonly summary?: string;
  readonly directorIdentity?: string;
  readonly directorPersonality?: string;
}): Promise<CampaignProjection> {
  return (await request<CampaignProjection>(`/api/campaigns/${options.campaignId}`, {
    method: 'PATCH',
    candidateId: options.candidateId,
    body: JSON.stringify({
      ...(options.name !== undefined ? { name: options.name } : {}),
      ...(options.summary !== undefined ? { summary: options.summary } : {}),
      ...(options.directorIdentity !== undefined ? { directorIdentity: options.directorIdentity } : {}),
      ...(options.directorPersonality !== undefined
        ? { directorPersonality: options.directorPersonality }
        : {}),
    }),
  })) as CampaignProjection;
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
}): Promise<{ readonly campaign: CampaignProjection; readonly alreadyMember: boolean }> {
  return (await request<{ readonly campaign: CampaignProjection; readonly alreadyMember: boolean }>(
    `/api/invitations/${options.inviteCode}/accept`,
    {
      method: 'POST',
      candidateId: options.candidateId,
    },
  )) as { readonly campaign: CampaignProjection; readonly alreadyMember: boolean };
}

export async function createCampaignSeat(options: {
  readonly candidateId: string;
  readonly campaignId: string;
  readonly characterId: string;
  readonly confirmSwitch?: boolean;
}): Promise<SeatProjection> {
  return (await request<SeatProjection>(`/api/campaigns/${options.campaignId}/seats`, {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify({
      characterId: options.characterId,
      ...(options.confirmSwitch === true ? { confirmSwitch: true } : {}),
    }),
  })) as SeatProjection;
}

export async function joinCampaignTable(options: {
  readonly candidateId: string;
  readonly campaignId: string;
  readonly characterId: string;
  readonly password?: string;
  readonly confirmSwitch?: boolean;
}): Promise<JoinTableResponse> {
  return (await request<JoinTableResponse>(`/api/campaigns/${options.campaignId}/join`, {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify({
      characterId: options.characterId,
      ...(options.password !== undefined && options.password.length > 0
        ? { password: options.password }
        : {}),
      ...(options.confirmSwitch === true ? { confirmSwitch: true } : {}),
    }),
  })) as JoinTableResponse;
}

export async function leaveCampaignSeat(options: {
  readonly candidateId: string;
  readonly campaignId: string;
}): Promise<void> {
  await request(`/api/campaigns/${options.campaignId}/seats`, {
    method: 'DELETE',
    candidateId: options.candidateId,
  });
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
  const send = () =>
    request(`/api/campaigns/${options.campaignId}/party-chat`, {
      method: 'POST',
      candidateId: options.candidateId,
      body: JSON.stringify({ mode: options.mode, body: options.body }),
    }) as Promise<PartyChatMessageProjection>;
  try {
    return await send();
  } catch (failure) {
    // One retry absorbs transient emulator blips during certification load.
    if (failure instanceof ApiFailure && failure.code === ERROR_CODES.UPSTREAM_UNAVAILABLE) {
      return await send();
    }
    throw failure;
  }
}

export async function yieldNpcSpotlight(options: {
  readonly candidateId: string;
  readonly campaignId: string;
}): Promise<{ cleared: import('../shared/table-contention-contract.js').NpcSpotlightProjection | null }> {
  return (await request(`/api/campaigns/${options.campaignId}/npc-spotlight/yield`, {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify({}),
  })) as never;
}

export async function fetchTableState(campaignId: string): Promise<TableStateProjection> {
  return (await request(`/api/campaigns/${campaignId}/table-state`)) as TableStateProjection;
}

export async function fetchCampaignMap(campaignId: string): Promise<MapBundleProjection> {
  return (await request(`/api/campaigns/${campaignId}/map`)) as MapBundleProjection;
}

export async function fetchCampaignMemory(campaignId: string): Promise<CampaignMemoryProjection> {
  return (await request(`/api/campaigns/${campaignId}/memory`)) as CampaignMemoryProjection;
}

/** Director-owned NPC establish — not a player Confirm scene control. */
export async function applyDirectorNpc(options: {
  readonly candidateId: string;
  readonly campaignId: string;
  readonly directive: {
    readonly schemaVersion: 'play-authority-npc-v1';
    readonly npcId: string;
    readonly name: string;
    readonly publicDescription: string;
    readonly disposition: 'friendly' | 'wary' | 'neutral' | 'hostile' | 'allied' | 'unknown';
    readonly location: { readonly column: number; readonly row: number } | null;
    readonly placeToken: boolean;
    readonly firstDialogue: string | null;
    readonly audience: 'public' | 'private';
    readonly causeActionId: string | null;
  };
}): Promise<{
  readonly memory: CampaignMemoryProjection;
  readonly created: boolean;
  readonly chronicleBody: string | null;
}> {
  return (await request(`/api/campaigns/${options.campaignId}/director/npc`, {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify(options.directive),
  })) as {
    readonly memory: CampaignMemoryProjection;
    readonly created: boolean;
    readonly chronicleBody: string | null;
  };
}

/** Director-owned scene establish — validates + chronicles; map geometry apply is follow-on. */
export async function applyDirectorScene(options: {
  readonly candidateId: string;
  readonly campaignId: string;
  readonly directive: {
    readonly schemaVersion: 'play-authority-scene-v1';
    readonly sceneId: string;
    readonly revision: number;
    readonly title: string;
    readonly displayMode: 'ambient' | 'exploration' | 'combat';
    readonly bounds: { readonly columns: number; readonly rows: number };
    readonly causeActionId: string | null;
    readonly continuity: {
      readonly previousSceneId: string | null;
      readonly boundaryCrossed: boolean;
    };
    readonly structure: { readonly edges: readonly unknown[] };
    readonly markers: readonly unknown[];
    readonly entities: readonly unknown[];
    readonly visibility: 'public' | 'discovered' | 'hidden' | 'dm_only';
    readonly rejectedMechanics: readonly string[];
  };
}): Promise<{
  readonly ok: true;
  readonly sceneId: string;
  readonly revision: number;
  readonly title: string;
  readonly mapApplied: false;
  readonly rejectedMechanics: readonly string[];
  readonly chronicleBody: string;
}> {
  return (await request(`/api/campaigns/${options.campaignId}/director/scene`, {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify(options.directive),
  })) as {
    readonly ok: true;
    readonly sceneId: string;
    readonly revision: number;
    readonly title: string;
    readonly mapApplied: false;
    readonly rejectedMechanics: readonly string[];
    readonly chronicleBody: string;
  };
}

export async function fetchPersonalRecap(campaignId: string): Promise<PersonalRecapProjection> {
  return (await request(`/api/campaigns/${campaignId}/recap`)) as PersonalRecapProjection;
}

export async function suspendCampaignSession(options: {
  readonly candidateId: string;
  readonly campaignId: string;
  readonly note?: string;
}): Promise<CampaignSessionSuspendResponse> {
  return (await request(`/api/campaigns/${options.campaignId}/session/suspend`, {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify({ ...(options.note !== undefined ? { note: options.note } : {}) }),
  })) as CampaignSessionSuspendResponse;
}

export async function resumeCampaignSession(options: {
  readonly candidateId: string;
  readonly campaignId: string;
}): Promise<CampaignSessionResumeResponse> {
  return (await request(`/api/campaigns/${options.campaignId}/session/resume`, {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify({}),
  })) as CampaignSessionResumeResponse;
}

export async function closeCampaignChapter(options: {
  readonly candidateId: string;
  readonly campaignId: string;
  readonly recordedSummary?: string;
}): Promise<CampaignMemoryProjection> {
  return (await request(`/api/campaigns/${options.campaignId}/chapters/close`, {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify({
      ...(options.recordedSummary !== undefined ? { recordedSummary: options.recordedSummary } : {}),
    }),
  })) as CampaignMemoryProjection;
}

export async function fetchPresentationCuePlan(
  campaignId: string,
): Promise<PresentationCuePlanProjection> {
  return (await request(
    `/api/campaigns/${campaignId}/presentation-cues`,
  )) as PresentationCuePlanProjection;
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
  readonly objectId?: string;
  readonly destinationHint?: string;
  readonly returnToPrevious?: boolean;
  readonly premise?: string;
  readonly targetCombatantId?: string;
  readonly attackId?: string;
  readonly spellId?: string;
  readonly area?: AreaTarget;
  readonly reactionKind?: 'opportunity_attack' | 'shield';
  readonly decisionWindowId?: string;
  readonly readyTrigger?: string;
  readonly xpAmount?: number;
  readonly itemId?: string;
  readonly summary?: string;
  readonly declaration?: string;
  readonly declaredFoes?: readonly { readonly name: string }[];
  readonly arcaneRecovery?: boolean;
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
      ...(options.objectId !== undefined ? { objectId: options.objectId } : {}),
      ...(options.destinationHint !== undefined
        ? { destinationHint: options.destinationHint }
        : {}),
      ...(options.returnToPrevious === true ? { returnToPrevious: true } : {}),
      ...(options.premise !== undefined ? { premise: options.premise } : {}),
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
      ...(options.summary !== undefined ? { summary: options.summary } : {}),
      ...(options.declaration !== undefined ? { declaration: options.declaration } : {}),
      ...(options.declaredFoes !== undefined ? { declaredFoes: options.declaredFoes } : {}),
      ...(options.arcaneRecovery === true ? { arcaneRecovery: true } : {}),
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

export async function fetchRulesCatalog(): Promise<
  import('../shared/rules-catalog-contract.js').RulesCatalogProjection
> {
  return (await request('/api/rules/catalog')) as never;
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
  readonly speech?: {
    readonly textToSpeechEnabled?: boolean;
    readonly chronicleAutoplay?: boolean;
    readonly privateDirectorAutoplay?: boolean;
    readonly speechToTextEnabled?: boolean;
  };
  /** Player-controlled narration length (Section 25 Phase 5). */
  readonly narrationDensity?: string;
}): Promise<PlayerPresentationSettingsProjection> {
  return (await request('/api/account/settings', {
    method: 'PUT',
    candidateId: options.candidateId,
    body: JSON.stringify({
      reducedMotion: options.reducedMotion,
      ...(options.lowEffects !== undefined ? { lowEffects: options.lowEffects } : {}),
      ...(options.speech !== undefined ? { speech: options.speech } : {}),
      ...(options.narrationDensity !== undefined
        ? { narrationDensity: options.narrationDensity }
        : {}),
    }),
  })) as PlayerPresentationSettingsProjection;
}

export async function saveDisplayLabel(options: {
  readonly candidateId: string;
  readonly displayLabel: string;
}): Promise<AccountProjection> {
  return (await request<AccountProjection>('/api/account/display-label', {
    method: 'PUT',
    candidateId: options.candidateId,
    body: JSON.stringify({ displayLabel: options.displayLabel }),
  })) as AccountProjection;
}

export interface AccountDeletionStatusProjection {
  readonly requested: boolean;
  readonly requestedAt: string | null;
  readonly notice: string;
}

export async function fetchAccountDeletionStatus(): Promise<AccountDeletionStatusProjection> {
  return (await request('/api/account/deletion-status')) as AccountDeletionStatusProjection;
}

export async function requestAccountDeletion(
  candidateId: string,
): Promise<AccountDeletionStatusProjection> {
  return (await request('/api/account/deletion-request', {
    method: 'POST',
    candidateId,
    body: JSON.stringify({}),
  })) as AccountDeletionStatusProjection;
}

export interface GoldMasterPackageProjection {
  readonly recordType: 'gold_master_package';
  readonly candidateId: string;
  readonly publicSurface: string;
  readonly launchProduction: 'NOT_DEPLOYED';
  readonly productOwnerAuthorization: 'NOT_GRANTED';
  readonly strippedFromHostedArtifacts: readonly string[];
  readonly localArenaStillExposesStrippedCapabilities: boolean;
  readonly eligibilityPolicy: { readonly status: string; readonly notice: string };
  readonly honestBounds: readonly string[];
}

export async function fetchGoldMasterPackage(): Promise<GoldMasterPackageProjection> {
  return (await request('/api/release/gold-master')) as GoldMasterPackageProjection;
}

export interface QaHarnessProjection {
  readonly available: boolean;
  readonly publicSurface: string;
  readonly operations: readonly string[];
  readonly notice: string;
}

export async function fetchQaHarnessStatus(): Promise<QaHarnessProjection> {
  return (await request('/api/qa/harness')) as QaHarnessProjection;
}

export interface LegalAcceptanceItemProjection {
  readonly route: string;
  readonly title: string;
  readonly version: string;
  readonly accepted: boolean;
  readonly acceptedAt: string | null;
}

export interface LegalAcceptanceProjection {
  readonly accountId: string;
  readonly documents: readonly LegalAcceptanceItemProjection[];
  readonly allCurrentAccepted: boolean;
}

export async function fetchLegalAcceptance(): Promise<LegalAcceptanceProjection> {
  return (await request('/api/legal/acceptance')) as LegalAcceptanceProjection;
}

export async function acceptLegalDocument(
  candidateId: string,
  route: string,
): Promise<LegalAcceptanceProjection> {
  return (await request('/api/legal/acceptance', {
    method: 'POST',
    candidateId,
    body: JSON.stringify({ route }),
  })) as LegalAcceptanceProjection;
}

export async function enterHostedGoogleSession(options: {
  readonly candidateId: string;
  readonly googleIdToken: string;
}): Promise<AccountProjection> {
  return (await request<AccountProjection>('/api/identity/google-session', {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify({ googleIdToken: options.googleIdToken }),
  })) as AccountProjection;
}

export async function enterGoogleEmulatorSession(options: {
  readonly candidateId: string;
  readonly email: string;
}): Promise<AccountProjection> {
  return (await request<AccountProjection>('/api/identity/google-emulator-session', {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify({ email: options.email }),
  })) as AccountProjection;
}

export async function fetchAdminPanel(): Promise<
  | {
      readonly isAdmin: false;
      readonly notice: string;
    }
  | {
      readonly isAdmin: true;
      readonly bootstrapEmail: string;
      readonly actorEmail: string | null;
      readonly actorAccountId: string;
      readonly auditEvents: readonly {
        readonly id: string;
        readonly actorEmail: string;
        readonly action: string;
        readonly detail: string;
        readonly atMs: number;
      }[];
      readonly providerMode: string;
      readonly aiKillSwitch: boolean;
      readonly notice: string;
    }
> {
  return (await request('/api/admin')) as never;
}

export async function setAdminAiKillSwitch(options: {
  readonly candidateId: string;
  readonly enabled: boolean;
}): Promise<{ readonly enabled: boolean }> {
  return (await request('/api/admin/ai-kill-switch', {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify({ enabled: options.enabled }),
  })) as { readonly enabled: boolean };
}

export async function fetchProviderRegistry(): Promise<{
  readonly providers: readonly {
    readonly providerId: string;
    readonly displayName: string;
    readonly category: string;
  }[];
}> {
  return (await request('/api/providers/registry')) as never;
}

export async function heartbeatCampaignPresence(options: {
  readonly candidateId: string;
  readonly campaignId: string;
  readonly tabId: string;
  readonly seatId?: string | null;
  readonly spectator?: boolean;
}): Promise<{
  readonly presence: import('../shared/presence-contract.js').CampaignPresenceProjection;
  readonly heartbeatIntervalMs: number;
}> {
  return (await request(`/api/campaigns/${options.campaignId}/presence`, {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify({
      requestId: crypto.randomUUID(),
      tabId: options.tabId,
      ...(options.seatId !== undefined ? { seatId: options.seatId } : {}),
      ...(options.spectator !== undefined ? { spectator: options.spectator } : {}),
    }),
  })) as never;
}

export async function fetchCampaignPresence(
  campaignId: string,
): Promise<import('../shared/presence-contract.js').CampaignPresenceProjection> {
  return (await request(`/api/campaigns/${campaignId}/presence`)) as never;
}

export async function postDirectorAddress(options: {
  readonly candidateId: string;
  readonly campaignId: string;
  readonly body: string;
}): Promise<import('../shared/ai-director-contract.js').DirectorAddressResponse> {
  return (await request(`/api/campaigns/${options.campaignId}/director-address`, {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify({ body: options.body }),
  })) as never;
}

export async function interpretNaturalLanguage(options: {
  readonly candidateId: string;
  readonly campaignId: string;
  readonly text: string;
  readonly moveTarget?: { column: number; row: number } | null;
}): Promise<import('../shared/ai-director-contract.js').IntentInterpretResponse> {
  return (await request(`/api/campaigns/${options.campaignId}/interpret-intent`, {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify({
      text: options.text,
      ...(options.moveTarget !== undefined ? { moveTarget: options.moveTarget } : {}),
    }),
  })) as never;
}

export async function requestDirectorNarration(options: {
  readonly candidateId: string;
  readonly campaignId: string;
  readonly mechanicsSummary: string;
  readonly rolls?: readonly number[];
}): Promise<import('../shared/ai-director-contract.js').DirectorNarrationProjection> {
  return (await request(`/api/campaigns/${options.campaignId}/narrate`, {
    method: 'POST',
    candidateId: options.candidateId,
    body: JSON.stringify({
      mechanicsSummary: options.mechanicsSummary,
      ...(options.rolls !== undefined ? { rolls: options.rolls } : {}),
    }),
  })) as never;
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
