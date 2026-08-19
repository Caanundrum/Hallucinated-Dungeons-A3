/**
 * The Local Arena application server.
 *
 * Blueprint ownership: Section 25 Phase 0 build scope. This server is the only
 * writer of canonical Phase 0 state. It authenticates the request, authorizes
 * the account, validates input, commits through the emulator, and returns a
 * server-produced projection. The browser is never trusted for any of that.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';

import {
  CANDIDATE_HEADER,
  ERROR_CODES,
  SESSION_COOKIE_NAME,
  isValidRequestId,
  validateNote,
  type ApiErrorBody,
  type CandidateIdentity,
  type CreateFoundationCheckResponse,
  type ErrorCode,
  type HealthResponse,
} from '../../shared/contract.js';
import { isLegalRoute, isSpaRoute } from '../../shared/routes.js';
import type { ServerEnvironment } from '../config/environment.js';
import { isHostedEnvironmentClass } from '../config/environment.js';
import {
  commitFoundationCheck,
  readFoundationProjection,
} from '../foundation/foundation-checks.js';
import { getLegalDocument } from '../legal/legal-registry.js';
import { renderLegalPage } from '../legal/render-legal-page.js';
import { acceptCurrentLegalDocument, readLegalAcceptance } from '../legal/legal-acceptance.js';
import { buildGoldMasterPackage } from '../release/gold-master.js';
import { isLocalArenaPublicSurface } from '../release/public-surface.js';
import { qaHarnessStatus, runQaHarnessOperation } from '../release/qa-harness.js';
import {
  IdentityUnavailableError,
  endSession,
  mintDevelopmentIdentity,
  mintGoogleEmulatorIdentity,
  mintQaFixtureSession,
  resolveSession,
  issueHostedGoogleSession,
} from '../identity/development-identity.js';
import {
  GoogleHostedIdentityError,
  exchangeGoogleIdToken,
} from '../identity/google-hosted.js';
import {
  assertAdminEmail,
  buildAdminPanelSnapshot,
  setAiKillSwitch,
} from '../admin/admin-service.js';
import {
  accountInDisconnectGrace,
  heartbeatPresence,
  loadCampaignPresence,
} from '../presence/presence-runtime.js';
import {
  AiDirectorUnavailableError,
  PROVIDER_COMPLIANCE_REGISTRY,
  answerDirectorAddress,
  interpretNaturalLanguageIntent,
  narrateVisibleBeat,
} from '../ai/director-gateway.js';
import {
  DIRECTOR_ADDRESS_MESSAGE_MAX_LENGTH,
  DIRECTOR_ADDRESS_NOTICE,
} from '../../shared/communication-contract.js';
import { PRESENCE_HEARTBEAT_INTERVAL_MS } from '../../shared/presence-contract.js';
import {
  AbilityRollsExhaustedError,
  CharacterIncompleteError,
  CharacterNotFoundError,
  applyQuickStart,
  commitDraft,
  discardDraft,
  openOrResumeDraft,
  readCharacter,
  readDraft,
  readVault,
  rollDraftAbilities,
  updateDraft,
} from '../characters/characters.js';
import {
  AlreadyMemberError,
  AlreadySeatedError,
  CampaignNotFoundError,
  CampaignValidationError,
  DirectorConfigLockedError,
  InvitationRateLimitedError,
  InvitationUnavailableError,
  acceptInvitation,
  createCampaign,
  createInvitation,
  createSeat,
  listCampaigns,
  previewInvitation,
  readCampaignDetail,
  revokeInvitation,
  updateCampaign,
} from '../campaigns/campaigns.js';
import { buildDirectorCatalog } from '../campaigns/director-catalog.js';
import { listChronicleEntries } from '../communication/chronicle.js';
import { listPartyChat, postPartyChatMessage } from '../communication/party-chat.js';
import {
  getAccountDeletionStatus,
  requestAccountDeletion,
} from '../privacy/account-deletion.js';
import {
  checkRateLimit,
  rateLimitKeyForAiGateway,
  rateLimitKeyForCommands,
  rateLimitKeyForPartyChat,
  readArenaRateLimitDefaults,
} from '../security/rate-limit.js';
import {
  acceptTableCommand,
  fetchTableState,
  previewTableMove,
  TableCommandError,
} from '../table/commands.js';
import { fetchCampaignMap, MapProjectionError } from '../table/map-projection.js';
import {
  CampaignMemoryError,
  closeCurrentChapter,
  loadCampaignMemory,
  readPersonalRecap,
  recordSessionSuspend,
  resumeSession,
} from '../campaigns/campaign-memory.js';
import { fetchPresentationCuePlan } from '../presentation/presentation-cues.js';
import {
  claimActiveTurnAuthority,
  endActiveTurnAuthority,
  fetchActiveTimingAuthority,
  lockActiveTurnOnDisconnect,
  TimingAuthorityError,
} from '../table/timing-authority.js';
import {
  readCampaignSettings,
  updateCampaignSettings,
} from '../settings/campaign-settings.js';
import { readPlayerSettings, updatePlayerSettings } from '../settings/player-settings.js';
import { buildDraftOptions } from '../rules/character-rules.js';
import { parseChoices } from '../characters/parse-choices.js';
import {
  fetchRulesState,
  RulesCommandError,
} from '../rules/engine/rules-commands.js';
import { explainRule, RULE_EXPLANATION_IDS } from '../rules/engine/rules-explanations.js';
import { COLLECTIONS } from '../persistence/firestore.js';

/** Largest request body the server will buffer, in bytes. */
const MAX_REQUEST_BODY_BYTES = 8 * 1024;

/** Sentinel meaning the body was already answered with an error response. */
const BODY_REJECTED = Symbol('body-rejected');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/**
 * Defence-in-depth response headers. The page assembles HTML from stored,
 * player-supplied text, so a restrictive policy is a second layer behind
 * escaping rather than a substitute for it. The built client loads only
 * same-origin scripts and styles and uses a `data:` favicon.
 */
function contentSecurityPolicy(env: ServerEnvironment): string {
  if (isHostedEnvironmentClass(env.environmentClass)) {
    return [
      "default-src 'self'",
      "script-src 'self' https://accounts.google.com/gsi/client",
      "style-src 'self' https://accounts.google.com/gsi/style",
      "img-src 'self' data: https://www.gstatic.com",
      "font-src 'self'",
      "connect-src 'self' https://accounts.google.com/gsi/",
      "frame-src https://accounts.google.com/gsi/",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join('; ');
  }
  return "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";
}

const ERROR_STATUS: Record<ErrorCode, number> = {
  [ERROR_CODES.ABILITY_ROLLS_EXHAUSTED]: 409,
  [ERROR_CODES.ALREADY_MEMBER]: 409,
  [ERROR_CODES.ALREADY_SEATED]: 409,
  [ERROR_CODES.BAD_REQUEST]: 400,
  [ERROR_CODES.CANDIDATE_MISMATCH]: 409,
  [ERROR_CODES.CHARACTER_INCOMPLETE]: 409,
  [ERROR_CODES.DIRECTOR_CONFIG_LOCKED]: 409,
  [ERROR_CODES.FORBIDDEN_ORIGIN]: 403,
  [ERROR_CODES.IDENTITY_ROUTE_UNAVAILABLE]: 403,
  [ERROR_CODES.INVITATION_UNAVAILABLE]: 404,
  [ERROR_CODES.INVITATION_RATE_LIMITED]: 429,
  [ERROR_CODES.RATE_LIMITED]: 429,
  [ERROR_CODES.NOT_AUTHENTICATED]: 401,
  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.NOTE_EMPTY]: 400,
  [ERROR_CODES.NOTE_TOO_LONG]: 400,
  [ERROR_CODES.METHOD_NOT_ALLOWED]: 405,
  [ERROR_CODES.PAYLOAD_TOO_LARGE]: 413,
  [ERROR_CODES.REQUEST_ID_INVALID]: 400,
  [ERROR_CODES.SESSION_EXPIRED]: 401,
  [ERROR_CODES.STALE_STATE_VERSION]: 409,
  [ERROR_CODES.NOT_SEATED]: 409,
  [ERROR_CODES.ILLEGAL_PATH]: 409,
  [ERROR_CODES.TIMING_AUTHORITY_REQUIRED]: 403,
  [ERROR_CODES.TIMING_AUTHORITY_INVALID]: 409,
  [ERROR_CODES.UPSTREAM_UNAVAILABLE]: 503,
  [ERROR_CODES.SESSION_ALREADY_SUSPENDED]: 409,
  [ERROR_CODES.SESSION_NOT_SUSPENDED]: 409,
};

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ERROR_CODES.ABILITY_ROLLS_EXHAUSTED]:
    'You have already used all three Ability Score rolls. Earlier rolls cannot be restored.',
  [ERROR_CODES.ALREADY_MEMBER]: 'This development account is already a member of that campaign.',
  [ERROR_CODES.ALREADY_SEATED]: 'This development account already has a seat in that campaign.',
  [ERROR_CODES.BAD_REQUEST]: 'The request body was not valid JSON in the expected shape.',
  [ERROR_CODES.CANDIDATE_MISMATCH]:
    'This page was loaded from a different candidate than the one now running. Reload the page to continue.',
  [ERROR_CODES.CHARACTER_INCOMPLETE]:
    'This character still has required choices to resolve, so it was not created.',
  [ERROR_CODES.DIRECTOR_CONFIG_LOCKED]:
    'Game Director identity and personality are locked after campaign creation and cannot be changed by ordinary users.',
  [ERROR_CODES.FORBIDDEN_ORIGIN]:
    'This request did not come from the declared Local Arena client origin.',
  [ERROR_CODES.IDENTITY_ROUTE_UNAVAILABLE]:
    'That identity or QA capability is available only on the Local Arena public surface. Gold Master artifacts strip development identities, QA fixtures, and the QA harness.',
  [ERROR_CODES.INVITATION_UNAVAILABLE]:
    'That invitation is not available. Ask the campaign owner for a current invite link.',
  [ERROR_CODES.INVITATION_RATE_LIMITED]:
    'Too many invitation links were created recently. Wait a bit, then try again.',
  [ERROR_CODES.RATE_LIMITED]:
    'Too many requests were sent in a short time. Wait a moment, then try again.',
  [ERROR_CODES.NOT_AUTHENTICATED]:
    'Sign in with a Local Arena development account before continuing.',
  [ERROR_CODES.NOT_FOUND]: 'No such route.',
  [ERROR_CODES.NOTE_EMPTY]: 'Enter a short note before recording a foundation check.',
  [ERROR_CODES.NOTE_TOO_LONG]: 'That note is longer than the 120 characters this record accepts.',
  [ERROR_CODES.METHOD_NOT_ALLOWED]: 'That method is not allowed on this route.',
  [ERROR_CODES.PAYLOAD_TOO_LARGE]:
    'That request body is larger than this route accepts, so it was refused before being read.',
  [ERROR_CODES.REQUEST_ID_INVALID]:
    'The submission was missing a valid request identifier, so it could not be made retry-safe.',
  [ERROR_CODES.SESSION_EXPIRED]:
    'This development session expired. Sign in again with a Local Arena development account.',
  [ERROR_CODES.STALE_STATE_VERSION]:
    'This table moved on since you last loaded it. Reload the table state, then retry.',
  [ERROR_CODES.NOT_SEATED]:
    'Seat a character you own in this campaign before submitting table commands.',
  [ERROR_CODES.ILLEGAL_PATH]:
    'That movement path is not legal on this map. Choose another route.',
  [ERROR_CODES.TIMING_AUTHORITY_REQUIRED]:
    'Claim Active Turn before committing table actions.',
  [ERROR_CODES.TIMING_AUTHORITY_INVALID]:
    'Your Timing Authority expired or belongs to another seat.',
  [ERROR_CODES.UPSTREAM_UNAVAILABLE]:
    'The local emulator suite did not respond. Confirm the Local Arena is running, then retry.',
  [ERROR_CODES.SESSION_ALREADY_SUSPENDED]:
    'This campaign session is already suspended. Resume it before suspending again.',
  [ERROR_CODES.SESSION_NOT_SUSPENDED]:
    'This campaign session is not suspended, so there is nothing to resume.',
};

export interface ArenaServerDependencies {
  readonly env: ServerEnvironment;
  readonly firestore: Firestore;
  readonly auth: Auth;
}

export interface ArenaServer {
  readonly server: Server;
  readonly listen: () => Promise<string>;
  readonly close: () => Promise<void>;
}

function candidateIdentity(env: ServerEnvironment): CandidateIdentity {
  return {
    candidateId: env.candidateId,
    blueprintVersion: env.blueprintVersion,
    environmentClass: env.environmentClass,
    runtimeMode: env.runtimeMode,
    publicSurface: env.publicSurface,
    firebaseProjectId: env.firebaseProjectId,
    environmentSchemaVersion: env.environmentSchemaVersion,
    hostedGoogleClientId: env.googleOAuthClientId,
  };
}

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (header === undefined) {
    return cookies;
  }
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    cookies.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  return cookies;
}

function applySecurityHeadersFor(response: ServerResponse, env: ServerEnvironment): void {
  response.setHeader('content-security-policy', contentSecurityPolicy(env));
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-content-type-options', 'nosniff');
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  env: ServerEnvironment,
): void {
  const payload = JSON.stringify(body);
  applySecurityHeadersFor(response, env);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

function writeError(response: ServerResponse, code: ErrorCode, env: ServerEnvironment): void {
  const body: ApiErrorBody = { error: code, message: ERROR_MESSAGES[code] };
  writeJson(response, ERROR_STATUS[code], body, env);
}

/** Applies an in-memory sliding-window check; returns false when the response was already sent. */
function allowUnderRateLimitFor(
  response: ServerResponse,
  env: ServerEnvironment,
  options: { readonly key: string; readonly limit: number; readonly windowMs: number },
): boolean {
  const result = checkRateLimit(options);
  if (!result.allowed) {
    if (result.retryAfterMs !== undefined) {
      response.setHeader('retry-after', String(Math.ceil(result.retryAfterMs / 1000)));
    }
    writeError(response, ERROR_CODES.RATE_LIMITED, env);
    return false;
  }
  return true;
}

/**
 * Refuses an over-large body and closes the connection.
 *
 * The server stops reading the request stream as soon as the limit is passed,
 * so the remaining upload would sit unread in the socket buffer and stall the
 * next request on a keep-alive connection. Closing is the honest outcome: the
 * client learns immediately and can open a new connection.
 */
function refuseOversizedBodyFor(
  request: IncomingMessage,
  response: ServerResponse,
  env: ServerEnvironment,
): void {
  response.setHeader('connection', 'close');
  writeError(response, ERROR_CODES.PAYLOAD_TOO_LARGE, env);
  request.destroy();
}

function writeNotFoundPage(
  response: ServerResponse,
  requestedPath: string,
  env: ServerEnvironment,
): void {
  const safePath = requestedPath.replace(/[<>&"]/g, '');
  const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Route not found — Hallucinated Dungeons</title>
  </head>
  <body>
    <main>
      <h1>No page exists at ${safePath}</h1>
      <p>Hallucinated Dungeons is at the site root. Legal documents and the Local Arena diagnostics page are linked from there.</p>
      <p><a href="/">Return to Hallucinated Dungeons</a></p>
    </main>
  </body>
</html>
`;
  applySecurityHeadersFor(response, env);
  response.writeHead(404, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(page),
    'cache-control': 'no-store',
  });
  response.end(page);
}

class PayloadTooLargeError extends Error {
  constructor() {
    super('request body exceeds the accepted size');
    this.name = 'PayloadTooLargeError';
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(request.headers['content-length'] ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    throw new PayloadTooLargeError();
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > MAX_REQUEST_BODY_BYTES) {
      throw new PayloadTooLargeError();
    }
    chunks.push(buffer);
  }
  if (total === 0) {
    return undefined;
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

/**
 * Rejects any request that did not come from the single declared client
 * origin. Mutating requests must carry a matching `Origin` header, which
 * combined with the `SameSite=Strict` session cookie closes the ordinary
 * cross-site submission path.
 */
function originIsAllowed(request: IncomingMessage, env: ServerEnvironment): boolean {
  const origin = request.headers.origin;
  const method = (request.method ?? 'GET').toUpperCase();

  if (MUTATING_METHODS.has(method)) {
    return origin === env.clientOrigin;
  }
  return origin === undefined || origin === env.clientOrigin;
}

function applyCorsHeaders(response: ServerResponse, env: ServerEnvironment): void {
  response.setHeader('vary', 'Origin');
  response.setHeader('access-control-allow-origin', env.clientOrigin);
  response.setHeader('access-control-allow-credentials', 'true');
  response.setHeader('access-control-allow-headers', `content-type, ${CANDIDATE_HEADER}`);
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
}

function sessionTokenFrom(request: IncomingMessage): string | null {
  return parseCookies(request.headers.cookie).get(SESSION_COOKIE_NAME) ?? null;
}

function sessionCookieFlags(env: ServerEnvironment): string {
  const secure = env.clientOrigin.startsWith('https:') ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Strict${secure}`;
}

function writeSessionCookie(
  response: ServerResponse,
  token: string,
  expiresAt: string,
  env: ServerEnvironment,
): void {
  response.setHeader('set-cookie', [
    `${SESSION_COOKIE_NAME}=${token}; ${sessionCookieFlags(env)}; Expires=${new Date(expiresAt).toUTCString()}`,
  ]);
}

function expireSessionCookie(response: ServerResponse, env: ServerEnvironment): void {
  response.setHeader('set-cookie', [
    `${SESSION_COOKIE_NAME}=; ${sessionCookieFlags(env)}; Max-Age=0`,
  ]);
}

async function emulatorReachable(hostPort: string, path: string): Promise<boolean> {
  try {
    const response = await fetch(`http://${hostPort}${path}`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

/**
 * Serves one file from the built client bundle. Path traversal outside the
 * bundle directory is rejected before any filesystem access.
 */
async function serveBundleAssetFor(
  response: ServerResponse,
  bundleDir: string,
  requestedPath: string,
  env: ServerEnvironment,
): Promise<boolean> {
  const relative = normalize(requestedPath).replace(/^(\.\.[/\\])+/, '');
  const absolute = resolve(join(bundleDir, relative));
  if (absolute !== resolve(bundleDir) && !absolute.startsWith(resolve(bundleDir) + sep)) {
    return false;
  }

  try {
    const stats = await stat(absolute);
    if (!stats.isFile()) {
      return false;
    }
    const contentType = CONTENT_TYPES[extname(absolute).toLowerCase()] ?? 'application/octet-stream';
    applySecurityHeadersFor(response, env);
    response.writeHead(200, {
      'content-type': contentType,
      'content-length': stats.size,
      'cache-control': 'no-store',
    });
    createReadStream(absolute).pipe(response);
    return true;
  } catch {
    return false;
  }
}

export function createArenaServer(dependencies: ArenaServerDependencies): ArenaServer {
  const { env, firestore, auth } = dependencies;

  function sendJson(response: ServerResponse, status: number, body: unknown): void {
    writeJson(response, status, body, env);
  }
  function sendError(response: ServerResponse, code: ErrorCode): void {
    writeError(response, code, env);
  }
  function setSessionCookie(response: ServerResponse, token: string, expiresAt: string): void {
    writeSessionCookie(response, token, expiresAt, env);
  }
  function clearSessionCookie(response: ServerResponse): void {
    expireSessionCookie(response, env);
  }
  function sendNotFoundPage(response: ServerResponse, requestedPath: string): void {
    writeNotFoundPage(response, requestedPath, env);
  }
  function refuseOversizedBody(request: IncomingMessage, response: ServerResponse): void {
    refuseOversizedBodyFor(request, response, env);
  }
  function allowUnderRateLimit(
    response: ServerResponse,
    options: { readonly key: string; readonly limit: number; readonly windowMs: number },
  ): boolean {
    return allowUnderRateLimitFor(response, env, options);
  }
  async function serveBundleAsset(
    response: ServerResponse,
    bundleDir: string,
    requestedPath: string,
  ): Promise<boolean> {
    return serveBundleAssetFor(response, bundleDir, requestedPath, env);
  }

  const server = createServer((request, response) => {
    handleRequest(request, response).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[arena-server] unhandled request failure: ${detail}\n`);
      if (!response.headersSent) {
        sendError(response, ERROR_CODES.UPSTREAM_UNAVAILABLE);
      } else {
        response.end();
      }
    });
  });

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = (request.method ?? 'GET').toUpperCase();
    const url = new URL(request.url ?? '/', `http://${env.serverHost}:${env.serverPort}`);
    const path = url.pathname;

    applyCorsHeaders(response, env);

    if (method === 'OPTIONS') {
      if (request.headers.origin !== env.clientOrigin) {
        sendError(response, ERROR_CODES.FORBIDDEN_ORIGIN);
        return;
      }
      response.writeHead(204);
      response.end();
      return;
    }

    if (!originIsAllowed(request, env)) {
      sendError(response, ERROR_CODES.FORBIDDEN_ORIGIN);
      return;
    }

    if (path.startsWith('/api/')) {
      await handleApiRequest(request, response, method, path);
      return;
    }

    // Legal routes are plain server-rendered documents, not part of the
    // single-page application, so they remain readable without script
    // execution and are served the same way in both runtime modes.
    if (isLegalRoute(path)) {
      if (method !== 'GET') {
        sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
        return;
      }
      const document = getLegalDocument(path);
      if (document === null) {
        sendNotFoundPage(response, path);
        return;
      }
      const page = renderLegalPage(document);
      applySecurityHeadersFor(response, env);
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(page),
        'cache-control': 'no-store',
      });
      response.end(page);
      return;
    }

    if (env.clientBundleDir === null) {
      sendNotFoundPage(response, path);
      return;
    }

    if (method !== 'GET') {
      sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
      return;
    }

    // Only the declared single-page-application routes fall back to the
    // built index.html on a hard navigation or reload. Every other path is
    // resolved as a literal asset (scripts, styles, source maps) or answered
    // with the honest 404 page — an unlinked path never silently renders the
    // application shell.
    const served = isSpaRoute(path)
      ? await serveBundleAsset(response, env.clientBundleDir, 'index.html')
      : await serveBundleAsset(response, env.clientBundleDir, path);

    if (!served) {
      sendNotFoundPage(response, path);
    }
  }

  async function handleApiRequest(
    request: IncomingMessage,
    response: ServerResponse,
    method: string,
    path: string,
  ): Promise<void> {
    // Every mutation must name the candidate the page was loaded from, so a
    // page left open across a candidate change cannot commit into the new one.
    if (MUTATING_METHODS.has(method)) {
      const declared = request.headers[CANDIDATE_HEADER];
      const declaredValue = Array.isArray(declared) ? declared[0] : declared;
      if (declaredValue !== env.candidateId) {
        sendError(response, ERROR_CODES.CANDIDATE_MISMATCH);
        return;
      }
    }

    if (path === '/api/candidate' && method === 'GET') {
      sendJson(response, 200, candidateIdentity(env));
      return;
    }

    if (path === '/api/health' && method === 'GET') {
      let firestoreEmulator = false;
      let authEmulator = false;
      let hostedPersistence = false;
      if (env.environmentClass === 'local' && env.firestoreEmulator && env.authEmulator) {
        [firestoreEmulator, authEmulator] = await Promise.all([
          emulatorReachable(
            `${env.firestoreEmulator.host}:${env.firestoreEmulator.port}`,
            '/',
          ),
          emulatorReachable(`${env.authEmulator.host}:${env.authEmulator.port}`, '/'),
        ]);
      } else {
        try {
          await firestore.collection(COLLECTIONS.arenaBaseline).limit(1).get();
          hostedPersistence = true;
        } catch {
          hostedPersistence = false;
        }
      }
      const ready =
        env.environmentClass === 'local'
          ? firestoreEmulator && authEmulator
          : hostedPersistence;
      const body: HealthResponse = {
        status: ready ? 'ready' : 'degraded',
        candidate: candidateIdentity(env),
        checks: { firestoreEmulator, authEmulator, hostedPersistence },
      };
      sendJson(response, body.status === 'ready' ? 200 : 503, body);
      return;
    }

    if (path === '/api/identity/development-session' && method === 'POST') {
      if (!isLocalArenaPublicSurface(env)) {
        sendError(response, ERROR_CODES.IDENTITY_ROUTE_UNAVAILABLE);
        return;
      }
      try {
        const minted = await mintDevelopmentIdentity({ env, firestore, auth });
        setSessionCookie(response, minted.sessionToken, minted.identity.expiresAt);
        sendJson(response, 201, minted.identity);
      } catch (error) {
        if (error instanceof IdentityUnavailableError) {
          sendError(response, ERROR_CODES.IDENTITY_ROUTE_UNAVAILABLE);
          return;
        }
        throw error;
      }
      return;
    }

    if (path === '/api/identity/google-emulator-session' && method === 'POST') {
      if (env.environmentClass !== 'local') {
        sendError(response, ERROR_CODES.IDENTITY_ROUTE_UNAVAILABLE);
        return;
      }
      let body: unknown;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        if (error instanceof PayloadTooLargeError) {
          refuseOversizedBody(request, response);
        } else {
          sendError(response, ERROR_CODES.BAD_REQUEST);
        }
        return;
      }
      const email =
        typeof (body as { email?: unknown }).email === 'string'
          ? (body as { email: string }).email
          : '';
      try {
        const minted = await mintGoogleEmulatorIdentity({ env, firestore, auth, email });
        setSessionCookie(response, minted.sessionToken, minted.identity.expiresAt);
        sendJson(response, 201, minted.identity);
      } catch (error) {
        sendJson(response, 400, {
          error: ERROR_CODES.BAD_REQUEST,
          message: error instanceof Error ? error.message : 'Google emulator identity failed.',
        } satisfies ApiErrorBody);
      }
      return;
    }

    if (path === '/api/identity/google-session' && method === 'POST') {
      if (!isHostedEnvironmentClass(env.environmentClass) || env.firebaseWebApiKey === null) {
        sendError(response, ERROR_CODES.IDENTITY_ROUTE_UNAVAILABLE);
        return;
      }
      let body: unknown;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        if (error instanceof PayloadTooLargeError) {
          refuseOversizedBody(request, response);
        } else {
          sendError(response, ERROR_CODES.BAD_REQUEST);
        }
        return;
      }
      const googleIdToken =
        typeof (body as { googleIdToken?: unknown }).googleIdToken === 'string'
          ? (body as { googleIdToken: string }).googleIdToken
          : '';
      try {
        const profile = await exchangeGoogleIdToken({
          webApiKey: env.firebaseWebApiKey,
          googleIdToken,
          requestUri: env.clientOrigin,
        });
        const minted = await issueHostedGoogleSession({ env, firestore, profile });
        setSessionCookie(response, minted.sessionToken, minted.identity.expiresAt);
        sendJson(response, 201, minted.identity);
      } catch (error) {
        if (error instanceof GoogleHostedIdentityError || error instanceof IdentityUnavailableError) {
          sendJson(response, 400, {
            error: ERROR_CODES.BAD_REQUEST,
            message: error.message,
          } satisfies ApiErrorBody);
          return;
        }
        throw error;
      }
      return;
    }

    if (path === '/api/identity/qa-fixture-session' && method === 'POST') {
      if (!isLocalArenaPublicSurface(env)) {
        sendError(response, ERROR_CODES.IDENTITY_ROUTE_UNAVAILABLE);
        return;
      }
      let body: unknown;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        if (error instanceof PayloadTooLargeError) {
          refuseOversizedBody(request, response);
        } else {
          sendError(response, ERROR_CODES.BAD_REQUEST);
        }
        return;
      }
      const fixtureLabel =
        typeof (body as { fixtureLabel?: unknown }).fixtureLabel === 'string'
          ? (body as { fixtureLabel: string }).fixtureLabel
          : 'player';
      try {
        const minted = await mintQaFixtureSession({ env, firestore, auth, fixtureLabel });
        setSessionCookie(response, minted.sessionToken, minted.identity.expiresAt);
        sendJson(response, 201, minted.identity);
      } catch (error) {
        sendJson(response, 400, {
          error: ERROR_CODES.BAD_REQUEST,
          message: error instanceof Error ? error.message : 'QA fixture session failed.',
        } satisfies ApiErrorBody);
      }
      return;
    }

    if (path === '/api/providers/registry' && method === 'GET') {
      sendJson(response, 200, { providers: PROVIDER_COMPLIANCE_REGISTRY });
      return;
    }

    if (path === '/api/release/gold-master' && method === 'GET') {
      sendJson(response, 200, buildGoldMasterPackage(env));
      return;
    }

    if (path === '/api/qa/harness') {
      if (method === 'GET') {
        try {
          sendJson(response, 200, qaHarnessStatus(env));
        } catch (error) {
          if (error instanceof IdentityUnavailableError) {
            sendError(response, ERROR_CODES.IDENTITY_ROUTE_UNAVAILABLE);
            return;
          }
          throw error;
        }
        return;
      }
      if (method === 'POST') {
        let body: unknown;
        try {
          body = await readJsonBody(request);
        } catch (error) {
          if (error instanceof PayloadTooLargeError) {
            refuseOversizedBody(request, response);
          } else {
            sendError(response, ERROR_CODES.BAD_REQUEST);
          }
          return;
        }
        const operation =
          typeof (body as { operation?: unknown }).operation === 'string'
            ? (body as { operation: string }).operation
            : 'status';
        try {
          sendJson(response, 200, runQaHarnessOperation(env, operation));
        } catch (error) {
          if (error instanceof IdentityUnavailableError) {
            sendError(response, ERROR_CODES.IDENTITY_ROUTE_UNAVAILABLE);
            return;
          }
          sendJson(response, 400, {
            error: ERROR_CODES.BAD_REQUEST,
            message: error instanceof Error ? error.message : 'QA harness refused the operation.',
          } satisfies ApiErrorBody);
        }
        return;
      }
      sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
      return;
    }

    if (path === '/api/legal/acceptance') {
      const session = await resolveSession({
        firestore,
        sessionToken: sessionTokenFrom(request),
      });
      if (session === null) {
        sendError(response, ERROR_CODES.NOT_AUTHENTICATED);
        return;
      }
      if (method === 'GET') {
        sendJson(response, 200, await readLegalAcceptance(firestore, session.accountId));
        return;
      }
      if (method === 'POST') {
        let body: unknown;
        try {
          body = await readJsonBody(request);
        } catch (error) {
          if (error instanceof PayloadTooLargeError) {
            refuseOversizedBody(request, response);
          } else {
            sendError(response, ERROR_CODES.BAD_REQUEST);
          }
          return;
        }
        const route =
          typeof (body as { route?: unknown }).route === 'string'
            ? (body as { route: string }).route
            : '';
        try {
          sendJson(
            response,
            201,
            await acceptCurrentLegalDocument(firestore, session.accountId, route),
          );
        } catch (error) {
          sendJson(response, 400, {
            error: ERROR_CODES.BAD_REQUEST,
            message: error instanceof Error ? error.message : 'Legal acceptance failed.',
          } satisfies ApiErrorBody);
        }
        return;
      }
      sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
      return;
    }

    if (path === '/api/admin' || path.startsWith('/api/admin/')) {
      const session = await resolveSession({
        firestore,
        sessionToken: sessionTokenFrom(request),
      });
      if (session === null) {
        sendError(response, ERROR_CODES.NOT_AUTHENTICATED);
        return;
      }
      if (path === '/api/admin' && method === 'GET') {
        sendJson(
          response,
          200,
          await buildAdminPanelSnapshot({
            firestore,
            accountId: session.accountId,
            email: session.identity.email,
            providerMode: session.identity.identityMode,
          }),
        );
        return;
      }
      if (path === '/api/admin/ai-kill-switch' && method === 'POST') {
        let body: unknown;
        try {
          body = await readJsonBody(request);
        } catch (error) {
          if (error instanceof PayloadTooLargeError) {
            refuseOversizedBody(request, response);
          } else {
            sendError(response, ERROR_CODES.BAD_REQUEST);
          }
          return;
        }
        try {
          assertAdminEmail(session.identity.email);
          const enabled = (body as { enabled?: unknown }).enabled === true;
          const next = await setAiKillSwitch({
            firestore,
            accountId: session.accountId,
            email: session.identity.email!,
            enabled,
          });
          sendJson(response, 200, { enabled: next });
        } catch (error) {
          sendJson(response, 403, {
            error: ERROR_CODES.BAD_REQUEST,
            message: error instanceof Error ? error.message : 'Admin operation refused.',
          } satisfies ApiErrorBody);
        }
        return;
      }
      sendError(response, ERROR_CODES.NOT_FOUND);
      return;
    }

    if (path === '/api/session' && method === 'GET') {
      const session = await resolveSession({
        firestore,
        sessionToken: sessionTokenFrom(request),
      });
      if (session === null) {
        sendError(response, ERROR_CODES.NOT_AUTHENTICATED);
        return;
      }
      sendJson(response, 200, session.identity);
      return;
    }

    if (path === '/api/session' && method === 'DELETE') {
      await endSession({ firestore, sessionToken: sessionTokenFrom(request) });
      clearSessionCookie(response);
      response.writeHead(204);
      response.end();
      return;
    }

    if (path === '/api/account/settings') {
      const session = await resolveSession({
        firestore,
        sessionToken: sessionTokenFrom(request),
      });
      if (session === null) {
        sendError(response, ERROR_CODES.NOT_AUTHENTICATED);
        return;
      }
      if (method === 'GET') {
        sendJson(
          response,
          200,
          await readPlayerSettings({ firestore, accountId: session.accountId }),
        );
        return;
      }
      if (method === 'PUT') {
        let body: unknown;
        try {
          body = await readJsonBody(request);
        } catch (error) {
          if (error instanceof PayloadTooLargeError) {
            refuseOversizedBody(request, response);
          } else {
            sendError(response, ERROR_CODES.BAD_REQUEST);
          }
          return;
        }
        try {
          const payload = body as {
            reducedMotion?: unknown;
            lowEffects?: unknown;
            speech?: {
              textToSpeechEnabled?: unknown;
              chronicleAutoplay?: unknown;
              privateDirectorAutoplay?: unknown;
              speechToTextEnabled?: unknown;
            };
            narrationDensity?: unknown;
          };
          const settings = await updatePlayerSettings({
            firestore,
            accountId: session.accountId,
            reducedMotion: payload.reducedMotion,
            ...(payload.lowEffects !== undefined ? { lowEffects: payload.lowEffects } : {}),
            ...(payload.speech !== undefined ? { speech: payload.speech } : {}),
            ...(payload.narrationDensity !== undefined
              ? { narrationDensity: payload.narrationDensity }
              : {}),
          });
          sendJson(response, 200, settings);
        } catch {
          sendError(response, ERROR_CODES.BAD_REQUEST);
        }
        return;
      }
      sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
      return;
    }

    if (path === '/api/account/deletion-request' || path === '/api/account/deletion-status') {
      const session = await resolveSession({
        firestore,
        sessionToken: sessionTokenFrom(request),
      });
      if (session === null) {
        sendError(response, ERROR_CODES.NOT_AUTHENTICATED);
        return;
      }
      if (path === '/api/account/deletion-status' && method === 'GET') {
        sendJson(
          response,
          200,
          await getAccountDeletionStatus(firestore, session.accountId),
        );
        return;
      }
      if (path === '/api/account/deletion-request' && method === 'POST') {
        sendJson(
          response,
          201,
          await requestAccountDeletion(firestore, session.accountId),
        );
        return;
      }
      sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
      return;
    }

    if (path === '/api/foundation-checks') {
      const session = await resolveSession({
        firestore,
        sessionToken: sessionTokenFrom(request),
      });
      if (session === null) {
        sendError(response, ERROR_CODES.NOT_AUTHENTICATED);
        return;
      }

      if (method === 'GET') {
        const projection = await readFoundationProjection({
          firestore,
          accountId: session.accountId,
        });
        sendJson(response, 200, projection);
        return;
      }

      if (method === 'POST') {
        let body: unknown;
        try {
          body = await readJsonBody(request);
        } catch (error) {
          if (error instanceof PayloadTooLargeError) {
            refuseOversizedBody(request, response);
          } else {
            sendError(response, ERROR_CODES.BAD_REQUEST);
          }
          return;
        }
        if (typeof body !== 'object' || body === null) {
          sendError(response, ERROR_CODES.BAD_REQUEST);
          return;
        }

        const { requestId, note } = body as { requestId?: unknown; note?: unknown };
        if (!isValidRequestId(requestId)) {
          sendError(response, ERROR_CODES.REQUEST_ID_INVALID);
          return;
        }
        const validatedNote = validateNote(note);
        if (!validatedNote.ok) {
          sendError(response, validatedNote.code);
          return;
        }

        const result = await commitFoundationCheck({
          firestore,
          accountId: session.accountId,
          requestId,
          note: validatedNote.note,
        });
        const payload: CreateFoundationCheckResponse = result;
        sendJson(response, result.duplicate ? 200 : 201, payload);
        return;
      }

      sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
      return;
    }

    if (path === '/api/rules/explain' && method === 'GET') {
      const session = await resolveSession({
        firestore,
        sessionToken: sessionTokenFrom(request),
      });
      if (session === null) {
        sendError(response, ERROR_CODES.NOT_AUTHENTICATED);
        return;
      }
      const requestUrl = new URL(request.url ?? path, `http://${env.serverHost}:${env.serverPort}`);
      const ruleId = requestUrl.searchParams.get('ruleId') ?? 'combat.attack';
      const explanation = explainRule(ruleId);
      if (explanation === null) {
        sendJson(response, 404, {
          error: ERROR_CODES.NOT_FOUND,
          message: `No structured explanation exists for ${ruleId}. Available rules: ${RULE_EXPLANATION_IDS.join(', ')}.`,
        } satisfies ApiErrorBody);
        return;
      }
      sendJson(response, 200, explanation);
      return;
    }

    if (path === '/api/characters' || path.startsWith('/api/characters/')) {
      await handleCharacterRequest(request, response, method, path);
      return;
    }

    if (
      path === '/api/campaigns' ||
      path.startsWith('/api/campaigns/') ||
      path === '/api/directors/catalog' ||
      path.startsWith('/api/invitations/')
    ) {
      await handleCampaignRequest(request, response, method, path);
      return;
    }

    sendError(response, ERROR_CODES.NOT_FOUND);
  }

  /**
   * Character creation, drafts, and the Character Vault.
   *
   * Every route resolves the session first and passes only the authenticated
   * account id downward. No route accepts an owner from the caller.
   */
  async function handleCharacterRequest(
    request: IncomingMessage,
    response: ServerResponse,
    method: string,
    path: string,
  ): Promise<void> {
    const session = await resolveSession({ firestore, sessionToken: sessionTokenFrom(request) });
    if (session === null) {
      sendError(response, ERROR_CODES.NOT_AUTHENTICATED);
      return;
    }
    const accountId = session.accountId;

    const readBody = async (): Promise<unknown | typeof BODY_REJECTED> => {
      try {
        return await readJsonBody(request);
      } catch (error) {
        if (error instanceof PayloadTooLargeError) {
          refuseOversizedBody(request, response);
        } else {
          sendError(response, ERROR_CODES.BAD_REQUEST);
        }
        return BODY_REJECTED;
      }
    };

    try {
      if (path === '/api/characters/vault' && method === 'GET') {
        sendJson(response, 200, await readVault({ firestore, accountId }));
        return;
      }

      if (path === '/api/characters/drafts' && method === 'POST') {
        const draft = await openOrResumeDraft({ firestore, accountId });
        sendJson(response, 200, { draft, options: buildDraftOptions(draft.choices) });
        return;
      }

      const draftMatch = /^\/api\/characters\/drafts\/([A-Za-z0-9-]{1,64})$/.exec(path);
      if (draftMatch !== null) {
        const draftId = draftMatch[1]!;

        if (method === 'GET') {
          const draft = await readDraft({ firestore, accountId, draftId });
          sendJson(response, 200, { draft, options: buildDraftOptions(draft.choices) });
          return;
        }

        if (method === 'PUT') {
          const body = await readBody();
          if (body === BODY_REJECTED) {
            return;
          }
          const parsed = parseChoices((body as { choices?: unknown } | undefined)?.choices);
          if (parsed === null) {
            sendError(response, ERROR_CODES.BAD_REQUEST);
            return;
          }
          const draft = await updateDraft({ firestore, accountId, draftId, choices: parsed });
          sendJson(response, 200, { draft, options: buildDraftOptions(draft.choices) });
          return;
        }

        if (method === 'DELETE') {
          await discardDraft({ firestore, accountId, draftId });
          response.writeHead(204);
          response.end();
          return;
        }

        sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
        return;
      }

      const quickStartMatch = /^\/api\/characters\/drafts\/([A-Za-z0-9-]{1,64})\/quick-start$/.exec(path);
      if (quickStartMatch !== null) {
        if (method !== 'POST') {
          sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        const body = await readBody();
        if (body === BODY_REJECTED) {
          return;
        }
        const templateId = (body as { templateId?: unknown } | undefined)?.templateId;
        if (typeof templateId !== 'string' || templateId.length > 64) {
          sendError(response, ERROR_CODES.BAD_REQUEST);
          return;
        }
        const draft = await applyQuickStart({
          firestore,
          accountId,
          draftId: quickStartMatch[1]!,
          templateId,
        });
        sendJson(response, 200, { draft, options: buildDraftOptions(draft.choices) });
        return;
      }

      const rollAbilitiesMatch = /^\/api\/characters\/drafts\/([A-Za-z0-9-]{1,64})\/roll-abilities$/.exec(
        path,
      );
      if (rollAbilitiesMatch !== null) {
        if (method !== 'POST') {
          sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        const draft = await rollDraftAbilities({
          firestore,
          accountId,
          draftId: rollAbilitiesMatch[1]!,
        });
        sendJson(response, 200, { draft, options: buildDraftOptions(draft.choices) });
        return;
      }

      const commitMatch = /^\/api\/characters\/drafts\/([A-Za-z0-9-]{1,64})\/commit$/.exec(path);
      if (commitMatch !== null) {
        if (method !== 'POST') {
          sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        const character = await commitDraft({ firestore, accountId, draftId: commitMatch[1]! });
        sendJson(response, 201, character);
        return;
      }

      const characterMatch = /^\/api\/characters\/([A-Za-z0-9-]{1,64})$/.exec(path);
      if (characterMatch !== null) {
        if (method !== 'GET') {
          sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        sendJson(response, 200, await readCharacter({ firestore, accountId, characterId: characterMatch[1]! }));
        return;
      }

      sendError(response, ERROR_CODES.NOT_FOUND);
    } catch (error) {
      if (error instanceof CharacterNotFoundError) {
        // A record owned by another account is reported exactly like one that
        // does not exist, so the response cannot be used to probe for the
        // existence of other accounts' characters.
        sendError(response, ERROR_CODES.NOT_FOUND);
        return;
      }
      if (error instanceof CharacterIncompleteError) {
        sendError(response, ERROR_CODES.CHARACTER_INCOMPLETE);
        return;
      }
      if (error instanceof AbilityRollsExhaustedError) {
        sendError(response, ERROR_CODES.ABILITY_ROLLS_EXHAUSTED);
        return;
      }
      throw error;
    }
  }

  /**
   * Campaigns, Director catalog, invitations, membership, and seats.
   *
   * Director identity/personality is locked at create. Ordinary PATCH that
   * tries to change it fails closed. Foreign campaigns resolve as not found.
   */
  async function handleCampaignRequest(
    request: IncomingMessage,
    response: ServerResponse,
    method: string,
    path: string,
  ): Promise<void> {
    const readBody = async (): Promise<unknown | typeof BODY_REJECTED> => {
      try {
        return await readJsonBody(request);
      } catch (error) {
        if (error instanceof PayloadTooLargeError) {
          refuseOversizedBody(request, response);
        } else {
          sendError(response, ERROR_CODES.BAD_REQUEST);
        }
        return BODY_REJECTED;
      }
    };

    try {
      if (path === '/api/directors/catalog' && method === 'GET') {
        sendJson(response, 200, buildDirectorCatalog());
        return;
      }

      const invitePreviewMatch = /^\/api\/invitations\/([A-Za-z0-9]{8,32})$/.exec(path);
      if (invitePreviewMatch !== null && method === 'GET') {
        sendJson(
          response,
          200,
          await previewInvitation({
            firestore,
            inviteCode: invitePreviewMatch[1]!,
          }),
        );
        return;
      }

      const inviteAcceptMatch = /^\/api\/invitations\/([A-Za-z0-9]{8,32})\/accept$/.exec(path);
      if (inviteAcceptMatch !== null) {
        if (method !== 'POST') {
          sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        const session = await resolveSession({ firestore, sessionToken: sessionTokenFrom(request) });
        if (session === null) {
          sendError(response, ERROR_CODES.NOT_AUTHENTICATED);
          return;
        }
        const campaign = await acceptInvitation({
          firestore,
          accountId: session.accountId,
          displayLabel: session.identity.displayLabel,
          inviteCode: inviteAcceptMatch[1]!,
        });
        sendJson(response, 200, campaign);
        return;
      }

      const session = await resolveSession({ firestore, sessionToken: sessionTokenFrom(request) });
      if (session === null) {
        sendError(response, ERROR_CODES.NOT_AUTHENTICATED);
        return;
      }
      const accountId = session.accountId;

      if (path === '/api/campaigns' && method === 'GET') {
        sendJson(response, 200, await listCampaigns({ firestore, accountId }));
        return;
      }

      if (path === '/api/campaigns' && method === 'POST') {
        const body = await readBody();
        if (body === BODY_REJECTED) {
          return;
        }
        const payload = body as {
          name?: unknown;
          summary?: unknown;
          directorIdentity?: unknown;
          directorPersonality?: unknown;
          adventureTemplate?: unknown;
        };
        const campaign = await createCampaign({
          firestore,
          accountId,
          displayLabel: session.identity.displayLabel,
          name: payload.name,
          summary: payload.summary,
          directorIdentity: payload.directorIdentity,
          directorPersonality: payload.directorPersonality,
          adventureTemplate: payload.adventureTemplate,
        });
        sendJson(response, 201, campaign);
        return;
      }

      const campaignMatch = /^\/api\/campaigns\/([A-Za-z0-9-]{1,64})$/.exec(path);
      if (campaignMatch !== null) {
        const campaignId = campaignMatch[1]!;
        if (method === 'GET') {
          sendJson(response, 200, await readCampaignDetail({ firestore, accountId, campaignId }));
          return;
        }
        if (method === 'PATCH') {
          const body = await readBody();
          if (body === BODY_REJECTED) {
            return;
          }
          const payload = body as {
            name?: unknown;
            summary?: unknown;
            directorIdentity?: unknown;
            directorPersonality?: unknown;
          };
          const campaign = await updateCampaign({
            firestore,
            accountId,
            campaignId,
            name: payload.name,
            summary: payload.summary,
            directorIdentity: payload.directorIdentity,
            directorPersonality: payload.directorPersonality,
          });
          sendJson(response, 200, campaign);
          return;
        }
        sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
        return;
      }

      const invitationCreateMatch = /^\/api\/campaigns\/([A-Za-z0-9-]{1,64})\/invitations$/.exec(
        path,
      );
      if (invitationCreateMatch !== null) {
        if (method !== 'POST') {
          sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        const invitation = await createInvitation({
          firestore,
          accountId,
          campaignId: invitationCreateMatch[1]!,
        });
        sendJson(response, 201, invitation);
        return;
      }

      const invitationRevokeMatch =
        /^\/api\/campaigns\/([A-Za-z0-9-]{1,64})\/invitations\/revoke$/.exec(path);
      if (invitationRevokeMatch !== null) {
        if (method !== 'POST') {
          sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        await revokeInvitation({
          firestore,
          accountId,
          campaignId: invitationRevokeMatch[1]!,
        });
        response.writeHead(204);
        response.end();
        return;
      }

      const seatCreateMatch = /^\/api\/campaigns\/([A-Za-z0-9-]{1,64})\/seats$/.exec(path);
      if (seatCreateMatch !== null) {
        if (method !== 'POST') {
          sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        const body = await readBody();
        if (body === BODY_REJECTED) {
          return;
        }
        const characterId = (body as { characterId?: unknown } | undefined)?.characterId;
        if (typeof characterId !== 'string' || characterId.length === 0 || characterId.length > 64) {
          sendError(response, ERROR_CODES.BAD_REQUEST);
          return;
        }
        const seat = await createSeat({
          firestore,
          accountId,
          campaignId: seatCreateMatch[1]!,
          characterId,
          deviceSessionId: session.deviceSessionId,
        });
        sendJson(response, 201, seat);
        return;
      }

      const settingsMatch = /^\/api\/campaigns\/([A-Za-z0-9-]{1,64})\/settings$/.exec(path);
      if (settingsMatch !== null) {
        const campaignId = settingsMatch[1]!;
        if (method === 'GET') {
          sendJson(response, 200, await readCampaignSettings({ firestore, accountId, campaignId }));
          return;
        }
        if (method === 'PUT') {
          const body = await readBody();
          if (body === BODY_REJECTED) {
            return;
          }
          const settings = await updateCampaignSettings({
            firestore,
            accountId,
            campaignId,
            payload: (body ?? {}) as Record<string, unknown>,
          });
          sendJson(response, 200, settings);
          return;
        }
        sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
        return;
      }

      const chronicleMatch = /^\/api\/campaigns\/([A-Za-z0-9-]{1,64})\/chronicle$/.exec(path);
      if (chronicleMatch !== null) {
        if (method !== 'GET') {
          sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        const campaignId = chronicleMatch[1]!;
        await readCampaignDetail({ firestore, accountId, campaignId });
        sendJson(response, 200, await listChronicleEntries({ firestore, campaignId }));
        return;
      }

      const campaignMemoryMatch = /^\/api\/campaigns\/([A-Za-z0-9-]{1,64})\/memory$/.exec(path);
      if (campaignMemoryMatch !== null) {
        if (method !== 'GET') {
          sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        const campaignId = campaignMemoryMatch[1]!;
        sendJson(response, 200, await loadCampaignMemory(firestore, campaignId, accountId));
        return;
      }

      const campaignRecapMatch = /^\/api\/campaigns\/([A-Za-z0-9-]{1,64})\/recap$/.exec(path);
      if (campaignRecapMatch !== null) {
        if (method !== 'GET') {
          sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        const campaignId = campaignRecapMatch[1]!;
        sendJson(response, 200, await readPersonalRecap(firestore, campaignId, accountId));
        return;
      }

      const sessionSuspendMatch = /^\/api\/campaigns\/([A-Za-z0-9-]{1,64})\/session\/suspend$/.exec(
        path,
      );
      if (sessionSuspendMatch !== null) {
        if (method !== 'POST') {
          sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        const campaignId = sessionSuspendMatch[1]!;
        const body = await readBody();
        if (body === BODY_REJECTED) {
          return;
        }
        const note = (body as { note?: unknown } | undefined)?.note;
        const suspended = await recordSessionSuspend(firestore, campaignId, accountId, {
          ...(typeof note === 'string' ? { note } : {}),
        });
        sendJson(response, 200, suspended);
        return;
      }

      const sessionResumeMatch = /^\/api\/campaigns\/([A-Za-z0-9-]{1,64})\/session\/resume$/.exec(
        path,
      );
      if (sessionResumeMatch !== null) {
        if (method !== 'POST') {
          sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        const campaignId = sessionResumeMatch[1]!;
        sendJson(response, 200, await resumeSession(firestore, campaignId, accountId));
        return;
      }

      const chapterCloseMatch = /^\/api\/campaigns\/([A-Za-z0-9-]{1,64})\/chapters\/close$/.exec(
        path,
      );
      if (chapterCloseMatch !== null) {
        if (method !== 'POST') {
          sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        const campaignId = chapterCloseMatch[1]!;
        const body = await readBody();
        if (body === BODY_REJECTED) {
          return;
        }
        const recordedSummary = (body as { recordedSummary?: unknown } | undefined)?.recordedSummary;
        sendJson(
          response,
          200,
          await closeCurrentChapter(firestore, campaignId, accountId, {
            ...(typeof recordedSummary === 'string' ? { recordedSummary } : {}),
          }),
        );
        return;
      }

      const partyChatMatch = /^\/api\/campaigns\/([A-Za-z0-9-]{1,64})\/party-chat$/.exec(path);
      if (partyChatMatch !== null) {
        const campaignId = partyChatMatch[1]!;
        if (method === 'GET') {
          sendJson(response, 200, await listPartyChat({ firestore, accountId, campaignId }));
          return;
        }
        if (method === 'POST') {
          const limits = readArenaRateLimitDefaults();
          if (
            !allowUnderRateLimit(response, {
              key: rateLimitKeyForPartyChat(accountId),
              limit: limits.chatPerWindow,
              windowMs: limits.windowMs,
            })
          ) {
            return;
          }
          const body = await readBody();
          if (body === BODY_REJECTED) {
            return;
          }
          const payload = body as { mode?: unknown; body?: unknown };
          const message = await postPartyChatMessage({
            firestore,
            accountId,
            campaignId,
            mode: payload.mode,
            body: payload.body,
          });
          sendJson(response, 201, message);
          return;
        }
        sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
        return;
      }

      const presenceMatch = /^\/api\/campaigns\/([A-Za-z0-9-]{1,64})\/presence$/.exec(path);
      if (presenceMatch !== null) {
        const campaignId = presenceMatch[1]!;
        await readCampaignDetail({ firestore, accountId, campaignId });
        if (method === 'GET') {
          sendJson(response, 200, await loadCampaignPresence(firestore, campaignId));
          return;
        }
        if (method === 'POST') {
          const body = await readBody();
          if (body === BODY_REJECTED) {
            return;
          }
          const payload = body as {
            tabId?: unknown;
            seatId?: unknown;
            spectator?: unknown;
            requestId?: unknown;
          };
          if (typeof payload.tabId !== 'string' || payload.tabId.length === 0) {
            sendError(response, ERROR_CODES.BAD_REQUEST);
            return;
          }
          const detail = await readCampaignDetail({ firestore, accountId, campaignId });
          const ownSeat = detail.ownSeat?.seatId ?? null;
          const presence = await heartbeatPresence({
            firestore,
            campaignId,
            accountId,
            displayLabel: session.identity.displayLabel,
            deviceSessionId: session.deviceSessionId,
            tabId: payload.tabId,
            seatId: typeof payload.seatId === 'string' ? payload.seatId : ownSeat,
            spectator: payload.spectator === true,
          });
          // Detect grace for other seated accounts and lock their Active Turns.
          for (const device of presence.devices) {
            if (
              device.accountId !== accountId &&
              accountInDisconnectGrace(presence, device.accountId)
            ) {
              await lockActiveTurnOnDisconnect({
                firestore,
                campaignId,
                accountId: device.accountId,
              });
            }
          }
          sendJson(response, 200, {
            presence,
            heartbeatIntervalMs: PRESENCE_HEARTBEAT_INTERVAL_MS,
          });
          return;
        }
        sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
        return;
      }

      const directorAddressMatch = /^\/api\/campaigns\/([A-Za-z0-9-]{1,64})\/director-address$/.exec(
        path,
      );
      if (directorAddressMatch !== null) {
        const campaignId = directorAddressMatch[1]!;
        if (method === 'GET') {
          sendJson(response, 200, { notice: DIRECTOR_ADDRESS_NOTICE });
          return;
        }
        if (method === 'POST') {
          const limits = readArenaRateLimitDefaults();
          if (
            !allowUnderRateLimit(response, {
              key: rateLimitKeyForAiGateway(accountId),
              limit: limits.aiPerWindow,
              windowMs: limits.windowMs,
            })
          ) {
            return;
          }
          const body = await readBody();
          if (body === BODY_REJECTED) {
            return;
          }
          const text =
            typeof (body as { body?: unknown }).body === 'string'
              ? (body as { body: string }).body.trim()
              : '';
          if (text.length === 0 || text.length > DIRECTOR_ADDRESS_MESSAGE_MAX_LENGTH) {
            sendError(response, ERROR_CODES.BAD_REQUEST);
            return;
          }
          await readCampaignDetail({ firestore, accountId, campaignId });
          try {
            const answered = await answerDirectorAddress({
              firestore,
              campaignId,
              accountId,
              text,
            });
            sendJson(response, 201, answered);
          } catch (error) {
            if (error instanceof AiDirectorUnavailableError) {
              sendJson(response, 503, {
                error: ERROR_CODES.UPSTREAM_UNAVAILABLE,
                message: error.message,
              } satisfies ApiErrorBody);
              return;
            }
            throw error;
          }
          return;
        }
        sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
        return;
      }

      const interpretNlMatch = /^\/api\/campaigns\/([A-Za-z0-9-]{1,64})\/interpret-intent$/.exec(
        path,
      );
      if (interpretNlMatch !== null) {
        if (method !== 'POST') {
          sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        const limits = readArenaRateLimitDefaults();
        if (
          !allowUnderRateLimit(response, {
            key: rateLimitKeyForAiGateway(accountId),
            limit: limits.aiPerWindow,
            windowMs: limits.windowMs,
          })
        ) {
          return;
        }
        const campaignId = interpretNlMatch[1]!;
        const body = await readBody();
        if (body === BODY_REJECTED) {
          return;
        }
        const payload = body as {
          text?: unknown;
          moveTarget?: { column?: unknown; row?: unknown } | null;
        };
        const text = typeof payload.text === 'string' ? payload.text.trim() : '';
        if (text.length === 0) {
          sendError(response, ERROR_CODES.BAD_REQUEST);
          return;
        }
        await readCampaignDetail({ firestore, accountId, campaignId });
        const moveTarget =
          payload.moveTarget &&
          typeof payload.moveTarget.column === 'number' &&
          typeof payload.moveTarget.row === 'number'
            ? { column: payload.moveTarget.column, row: payload.moveTarget.row }
            : null;
        try {
          const interpreted = await interpretNaturalLanguageIntent({
            firestore,
            campaignId,
            accountId,
            text,
            moveTarget,
          });
          sendJson(response, 201, interpreted);
        } catch (error) {
          if (error instanceof AiDirectorUnavailableError) {
            sendJson(response, 503, {
              error: ERROR_CODES.UPSTREAM_UNAVAILABLE,
              message: error.message,
            } satisfies ApiErrorBody);
            return;
          }
          throw error;
        }
        return;
      }

      const narrateMatch = /^\/api\/campaigns\/([A-Za-z0-9-]{1,64})\/narrate$/.exec(path);
      if (narrateMatch !== null) {
        if (method !== 'POST') {
          sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        const limits = readArenaRateLimitDefaults();
        if (
          !allowUnderRateLimit(response, {
            key: rateLimitKeyForAiGateway(accountId),
            limit: limits.aiPerWindow,
            windowMs: limits.windowMs,
          })
        ) {
          return;
        }
        const campaignId = narrateMatch[1]!;
        const body = await readBody();
        if (body === BODY_REJECTED) {
          return;
        }
        const mechanicsSummary =
          typeof (body as { mechanicsSummary?: unknown }).mechanicsSummary === 'string'
            ? (body as { mechanicsSummary: string }).mechanicsSummary.trim()
            : '';
        if (mechanicsSummary.length === 0) {
          sendError(response, ERROR_CODES.BAD_REQUEST);
          return;
        }
        await readCampaignDetail({ firestore, accountId, campaignId });
        try {
          const narration = await narrateVisibleBeat({
            firestore,
            campaignId,
            accountId,
            mechanicsSummary,
          });
          sendJson(response, 201, narration);
        } catch (error) {
          if (error instanceof AiDirectorUnavailableError) {
            sendJson(response, 503, {
              error: ERROR_CODES.UPSTREAM_UNAVAILABLE,
              message: error.message,
            } satisfies ApiErrorBody);
            return;
          }
          throw error;
        }
        return;
      }

      const tableStateMatch = /^\/api\/campaigns\/([A-Za-z0-9-]{1,64})\/table-state$/.exec(path);
      if (tableStateMatch !== null) {
        if (method !== 'GET') {
          sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        const campaignId = tableStateMatch[1]!;
        sendJson(response, 200, await fetchTableState({ firestore, accountId, campaignId }));
        return;
      }

      const rulesStateMatch = /^\/api\/campaigns\/([A-Za-z0-9-]{1,64})\/rules-state$/.exec(path);
      if (rulesStateMatch !== null) {
        if (method !== 'GET') {
          sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        sendJson(
          response,
          200,
          await fetchRulesState({
            firestore,
            accountId,
            campaignId: rulesStateMatch[1]!,
          }),
        );
        return;
      }

      const timingAuthorityMatch = /^\/api\/campaigns\/([A-Za-z0-9-]{1,64})\/timing-authority$/.exec(
        path,
      );
      if (timingAuthorityMatch !== null) {
        const campaignId = timingAuthorityMatch[1]!;
        if (method === 'GET') {
          sendJson(response, 200, {
            authority: await fetchActiveTimingAuthority({ firestore, accountId, campaignId }),
          });
          return;
        }
        if (method === 'POST') {
          const claimed = await claimActiveTurnAuthority({ firestore, accountId, campaignId });
          sendJson(response, 201, claimed);
          return;
        }
        sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
        return;
      }

      const endTimingAuthorityMatch =
        /^\/api\/campaigns\/([A-Za-z0-9-]{1,64})\/timing-authority\/end$/.exec(path);
      if (endTimingAuthorityMatch !== null) {
        if (method !== 'POST') {
          sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        const campaignId = endTimingAuthorityMatch[1]!;
        const body = await readBody();
        if (body === BODY_REJECTED) {
          return;
        }
        const payload = body as { timingAuthorityId?: unknown };
        if (typeof payload.timingAuthorityId !== 'string' || payload.timingAuthorityId.length === 0) {
          sendError(response, ERROR_CODES.BAD_REQUEST);
          return;
        }
        const ended = await endActiveTurnAuthority({
          firestore,
          accountId,
          campaignId,
          timingAuthorityId: payload.timingAuthorityId,
        });
        sendJson(response, 200, { authority: ended });
        return;
      }

      const campaignMapMatch = /^\/api\/campaigns\/([A-Za-z0-9-]{1,64})\/map$/.exec(path);
      if (campaignMapMatch !== null) {
        if (method !== 'GET') {
          sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        const campaignId = campaignMapMatch[1]!;
        sendJson(response, 200, await fetchCampaignMap({ firestore, accountId, campaignId }));
        return;
      }

      const presentationCuesMatch =
        /^\/api\/campaigns\/([A-Za-z0-9-]{1,64})\/presentation-cues$/.exec(path);
      if (presentationCuesMatch !== null) {
        if (method !== 'GET') {
          sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        const campaignId = presentationCuesMatch[1]!;
        sendJson(
          response,
          200,
          await fetchPresentationCuePlan({ firestore, accountId, campaignId }),
        );
        return;
      }

      const movePreviewMatch = /^\/api\/campaigns\/([A-Za-z0-9-]{1,64})\/move-preview$/.exec(path);
      if (movePreviewMatch !== null) {
        if (method !== 'POST') {
          sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        const campaignId = movePreviewMatch[1]!;
        const body = await readBody();
        if (body === BODY_REJECTED) {
          return;
        }
        const payload = body as { path?: unknown };
        const previewPath = Array.isArray(payload.path) ? payload.path : [];
        sendJson(
          response,
          200,
          await previewTableMove({
            firestore,
            accountId,
            campaignId,
            path: previewPath as { column: number; row: number }[],
          }),
        );
        return;
      }

      const tableCommandsMatch = /^\/api\/campaigns\/([A-Za-z0-9-]{1,64})\/commands$/.exec(path);
      if (tableCommandsMatch !== null) {
        if (method !== 'POST') {
          sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        const limits = readArenaRateLimitDefaults();
        if (
          !allowUnderRateLimit(response, {
            key: rateLimitKeyForCommands(accountId),
            limit: limits.commandsPerWindow,
            windowMs: limits.windowMs,
          })
        ) {
          return;
        }
        const campaignId = tableCommandsMatch[1]!;
        const body = await readBody();
        if (body === BODY_REJECTED) {
          return;
        }
        const payload = body as {
          requestId?: unknown;
          commandType?: unknown;
          expectedStateVersion?: unknown;
          timingAuthorityId?: unknown;
          path?: unknown;
          edgeId?: unknown;
          targetCombatantId?: unknown;
          attackId?: unknown;
          spellId?: unknown;
          area?: unknown;
          reactionKind?: unknown;
          decisionWindowId?: unknown;
          readyTrigger?: unknown;
          xpAmount?: unknown;
          itemId?: unknown;
        };
        if (!isValidRequestId(payload.requestId)) {
          sendError(response, ERROR_CODES.REQUEST_ID_INVALID);
          return;
        }
        const result = await acceptTableCommand({
          firestore,
          accountId,
          campaignId,
          requestId: payload.requestId,
          commandType: payload.commandType as never,
          expectedStateVersion: payload.expectedStateVersion as number,
          deviceSessionId: session.deviceSessionId,
          ...(typeof payload.timingAuthorityId === 'string'
            ? { timingAuthorityId: payload.timingAuthorityId }
            : {}),
          ...(Array.isArray(payload.path)
            ? { path: payload.path as { column: number; row: number }[] }
            : {}),
          ...(typeof payload.edgeId === 'string' ? { edgeId: payload.edgeId } : {}),
          ...(typeof payload.targetCombatantId === 'string'
            ? { targetCombatantId: payload.targetCombatantId }
            : {}),
          ...(typeof payload.attackId === 'string' ? { attackId: payload.attackId } : {}),
          ...(typeof payload.spellId === 'string' ? { spellId: payload.spellId } : {}),
          ...(typeof payload.area === 'object' && payload.area !== null
            ? { area: payload.area as never }
            : {}),
          ...(payload.reactionKind === 'opportunity_attack' || payload.reactionKind === 'shield'
            ? { reactionKind: payload.reactionKind }
            : {}),
          ...(typeof payload.decisionWindowId === 'string'
            ? { decisionWindowId: payload.decisionWindowId }
            : {}),
          ...(typeof payload.readyTrigger === 'string'
            ? { readyTrigger: payload.readyTrigger }
            : {}),
          ...(typeof payload.xpAmount === 'number' ? { xpAmount: payload.xpAmount } : {}),
          ...(typeof payload.itemId === 'string' ? { itemId: payload.itemId } : {}),
        });
        sendJson(response, result.duplicate ? 200 : 201, result);
        return;
      }

      sendError(response, ERROR_CODES.NOT_FOUND);
    } catch (error) {
      if (
        error instanceof TableCommandError ||
        error instanceof MapProjectionError ||
        error instanceof TimingAuthorityError ||
        error instanceof RulesCommandError
      ) {
        const code = error.code as ErrorCode;
        if (code in ERROR_STATUS) {
          sendJson(response, ERROR_STATUS[code], {
            error: code,
            message: error.message,
          } satisfies ApiErrorBody);
          return;
        }
        sendJson(response, 400, {
          error: ERROR_CODES.BAD_REQUEST,
          message: error.message,
        } satisfies ApiErrorBody);
        return;
      }
      if (error instanceof CampaignNotFoundError || error instanceof CharacterNotFoundError) {
        sendError(response, ERROR_CODES.NOT_FOUND);
        return;
      }
      if (error instanceof InvitationUnavailableError) {
        sendError(response, ERROR_CODES.INVITATION_UNAVAILABLE);
        return;
      }
      if (error instanceof InvitationRateLimitedError) {
        sendError(response, ERROR_CODES.INVITATION_RATE_LIMITED);
        return;
      }
      if (error instanceof DirectorConfigLockedError) {
        sendError(response, ERROR_CODES.DIRECTOR_CONFIG_LOCKED);
        return;
      }
      if (error instanceof AlreadyMemberError) {
        sendError(response, ERROR_CODES.ALREADY_MEMBER);
        return;
      }
      if (error instanceof AlreadySeatedError) {
        sendError(response, ERROR_CODES.ALREADY_SEATED);
        return;
      }
      if (error instanceof CampaignValidationError) {
        sendJson(response, 400, {
          error: ERROR_CODES.BAD_REQUEST,
          message: error.message,
        } satisfies ApiErrorBody);
        return;
      }
      if (error instanceof CampaignMemoryError) {
        const code = error.code as ErrorCode;
        if (code in ERROR_STATUS) {
          sendJson(response, ERROR_STATUS[code], {
            error: code,
            message: error.message,
          } satisfies ApiErrorBody);
          return;
        }
        sendJson(response, 400, {
          error: ERROR_CODES.BAD_REQUEST,
          message: error.message,
        } satisfies ApiErrorBody);
        return;
      }
      throw error;
    }
  }

  return {
    server,
    listen: () =>
      new Promise<string>((resolvePromise, rejectPromise) => {
        server.once('error', rejectPromise);
        server.listen(env.serverPort, env.serverHost, () => {
          server.removeListener('error', rejectPromise);
          resolvePromise(`http://${env.serverHost}:${env.serverPort}`);
        });
      }),
    close: () =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
      }),
  };
}
