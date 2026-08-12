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
import type { ServerEnvironment } from '../config/environment.js';
import {
  commitFoundationCheck,
  readFoundationProjection,
} from '../foundation/foundation-checks.js';
import {
  endSession,
  mintDevelopmentIdentity,
  resolveSession,
} from '../identity/development-identity.js';

/** Largest request body the server will buffer, in bytes. */
const MAX_REQUEST_BODY_BYTES = 8 * 1024;

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
const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  [
    'content-security-policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
  ],
  ['x-frame-options', 'DENY'],
  ['referrer-policy', 'no-referrer'],
  ['x-content-type-options', 'nosniff'],
];

const ERROR_STATUS: Record<ErrorCode, number> = {
  [ERROR_CODES.BAD_REQUEST]: 400,
  [ERROR_CODES.CANDIDATE_MISMATCH]: 409,
  [ERROR_CODES.FORBIDDEN_ORIGIN]: 403,
  [ERROR_CODES.IDENTITY_ROUTE_UNAVAILABLE]: 403,
  [ERROR_CODES.NOT_AUTHENTICATED]: 401,
  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.NOTE_EMPTY]: 400,
  [ERROR_CODES.NOTE_TOO_LONG]: 400,
  [ERROR_CODES.METHOD_NOT_ALLOWED]: 405,
  [ERROR_CODES.PAYLOAD_TOO_LARGE]: 413,
  [ERROR_CODES.REQUEST_ID_INVALID]: 400,
  [ERROR_CODES.SESSION_EXPIRED]: 401,
  [ERROR_CODES.UPSTREAM_UNAVAILABLE]: 503,
};

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ERROR_CODES.BAD_REQUEST]: 'The request body was not valid JSON in the expected shape.',
  [ERROR_CODES.CANDIDATE_MISMATCH]:
    'This page was loaded from a different candidate than the one now running. Reload the page to continue.',
  [ERROR_CODES.FORBIDDEN_ORIGIN]:
    'This request did not come from the declared Local Arena client origin.',
  [ERROR_CODES.IDENTITY_ROUTE_UNAVAILABLE]:
    'Development identities are available only in the Local Execution Environment.',
  [ERROR_CODES.NOT_AUTHENTICATED]: 'Enter the Local Arena before recording a foundation check.',
  [ERROR_CODES.NOT_FOUND]: 'No such route.',
  [ERROR_CODES.NOTE_EMPTY]: 'Enter a short note before recording a foundation check.',
  [ERROR_CODES.NOTE_TOO_LONG]: 'That note is longer than the 120 characters this record accepts.',
  [ERROR_CODES.METHOD_NOT_ALLOWED]: 'That method is not allowed on this route.',
  [ERROR_CODES.PAYLOAD_TOO_LARGE]:
    'That request body is larger than this route accepts, so it was refused before being read.',
  [ERROR_CODES.REQUEST_ID_INVALID]:
    'The submission was missing a valid request identifier, so it could not be made retry-safe.',
  [ERROR_CODES.SESSION_EXPIRED]: 'This development session expired. Enter the Local Arena again.',
  [ERROR_CODES.UPSTREAM_UNAVAILABLE]:
    'The local emulator suite did not respond. Confirm the Local Arena is running, then retry.',
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
    firebaseProjectId: env.firebaseProjectId,
    environmentSchemaVersion: env.environmentSchemaVersion,
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

function applySecurityHeaders(response: ServerResponse): void {
  for (const [name, value] of SECURITY_HEADERS) {
    response.setHeader(name, value);
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  applySecurityHeaders(response);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

function sendError(response: ServerResponse, code: ErrorCode): void {
  const body: ApiErrorBody = { error: code, message: ERROR_MESSAGES[code] };
  sendJson(response, ERROR_STATUS[code], body);
}

/**
 * Refuses an over-large body and closes the connection.
 *
 * The server stops reading the request stream as soon as the limit is passed,
 * so the remaining upload would sit unread in the socket buffer and stall the
 * next request on a keep-alive connection. Closing is the honest outcome: the
 * client learns immediately and can open a new connection.
 */
function refuseOversizedBody(request: IncomingMessage, response: ServerResponse): void {
  response.setHeader('connection', 'close');
  sendError(response, ERROR_CODES.PAYLOAD_TOO_LARGE);
  request.destroy();
}

function sendNotFoundPage(response: ServerResponse, requestedPath: string): void {
  const safePath = requestedPath.replace(/[<>&"]/g, '');
  const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Route not found — Hallucinated Dungeons Local Arena</title>
  </head>
  <body>
    <main>
      <h1>No page exists at ${safePath}</h1>
      <p>The Local Arena serves the Phase 0 foundation page at the site root.</p>
      <p><a href="/">Return to the Local Arena</a></p>
    </main>
  </body>
</html>
`;
  applySecurityHeaders(response);
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

function setSessionCookie(response: ServerResponse, token: string, expiresAt: string): void {
  response.setHeader('set-cookie', [
    `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Expires=${new Date(expiresAt).toUTCString()}`,
  ]);
}

function clearSessionCookie(response: ServerResponse): void {
  response.setHeader('set-cookie', [
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
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
async function serveBundleAsset(
  response: ServerResponse,
  bundleDir: string,
  requestedPath: string,
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
    applySecurityHeaders(response);
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

    if (env.clientBundleDir === null) {
      sendNotFoundPage(response, path);
      return;
    }

    if (method !== 'GET') {
      sendError(response, ERROR_CODES.METHOD_NOT_ALLOWED);
      return;
    }

    const served =
      path === '/'
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
      const [firestoreEmulator, authEmulator] = await Promise.all([
        emulatorReachable(
          `${env.firestoreEmulator.host}:${env.firestoreEmulator.port}`,
          '/',
        ),
        emulatorReachable(`${env.authEmulator.host}:${env.authEmulator.port}`, '/'),
      ]);
      const body: HealthResponse = {
        status: firestoreEmulator && authEmulator ? 'ready' : 'degraded',
        candidate: candidateIdentity(env),
        checks: { firestoreEmulator, authEmulator },
      };
      sendJson(response, body.status === 'ready' ? 200 : 503, body);
      return;
    }

    if (path === '/api/identity/development-session' && method === 'POST') {
      if (env.environmentClass !== 'local') {
        sendError(response, ERROR_CODES.IDENTITY_ROUTE_UNAVAILABLE);
        return;
      }
      const minted = await mintDevelopmentIdentity({ env, firestore, auth });
      setSessionCookie(response, minted.sessionToken, minted.identity.expiresAt);
      sendJson(response, 201, minted.identity);
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

    sendError(response, ERROR_CODES.NOT_FOUND);
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
