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
  type CandidateIdentity,
  type CreateFoundationCheckResponse,
  type DevelopmentIdentityProjection,
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
    throw new ApiFailure(code, body.message ?? NETWORK_FAILURE_MESSAGE);
  }

  return payload as T;
}

export async function fetchCandidate(): Promise<CandidateIdentity> {
  return (await request<CandidateIdentity>('/api/candidate')) as CandidateIdentity;
}

export async function fetchSession(): Promise<DevelopmentIdentityProjection> {
  return (await request<DevelopmentIdentityProjection>(
    '/api/session',
  )) as DevelopmentIdentityProjection;
}

export async function enterLocalArena(
  candidateId: string,
): Promise<DevelopmentIdentityProjection> {
  return (await request<DevelopmentIdentityProjection>('/api/identity/development-session', {
    method: 'POST',
    candidateId,
  })) as DevelopmentIdentityProjection;
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
