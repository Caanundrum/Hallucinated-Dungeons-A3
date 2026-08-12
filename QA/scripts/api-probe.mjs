/**
 * Independent QA raw-HTTP probe for Phase 0 candidate cand-0f810c6c26d8.
 *
 * This file is QA-authored. It deliberately does not reuse Builder test code.
 * It exercises the transport boundary directly (headers a browser refuses to
 * forge, concurrency, replay, traversal) so that browser-level results can be
 * separated from server-level guarantees.
 *
 * All output is written under /workspace/QA. Nothing here mutates Builder Root.
 */

import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const BASE = 'http://127.0.0.1:5274';
// Parameterised so the identical check set can be re-run against a
// replacement candidate as a true regression pass.
const EXPECTED_CANDIDATE = process.env.QA_EXPECTED_CANDIDATE ?? 'cand-0f810c6c26d8';
const CANDIDATE_HEADER = 'x-hd-candidate';
const COOKIE_NAME = 'hd_dev_session';
const OUT_DIR = process.env.QA_OUT_DIR ?? '/workspace/QA/evidence/api';

const results = [];

function record(id, title, passed, detail) {
  results.push({ id, title, passed, detail });
  const mark = passed ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${id} ${title}`);
  if (detail !== undefined) {
    console.log(`        ${JSON.stringify(detail)}`);
  }
}

function cookieFrom(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const entry of raw) {
    const [pair] = entry.split(';');
    const [name, value] = pair.split('=');
    if (name.trim() === COOKIE_NAME) {
      return value.trim();
    }
  }
  return null;
}

async function readBody(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function call(path, options = {}) {
  const { method = 'GET', origin, candidate, cookie, body, headers = {}, raw = false } = options;
  const finalHeaders = { ...headers };
  if (origin !== undefined) finalHeaders.origin = origin;
  if (candidate !== undefined) finalHeaders[CANDIDATE_HEADER] = candidate;
  if (cookie !== undefined && cookie !== null) finalHeaders.cookie = `${COOKIE_NAME}=${cookie}`;
  if (body !== undefined) finalHeaders['content-type'] = 'application/json';

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: finalHeaders,
    body: raw ? body : body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
  });
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    cookie: cookieFrom(response),
    body: await readBody(response),
  };
}

/**
 * Sends one request on a dedicated, non-pooled connection. Used for probes
 * that can damage a keep-alive connection, so one probe cannot corrupt the
 * result of the next one.
 */
function sendIsolated({ method = 'GET', path, headers = {}, body }, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const request = http.request(
      {
        host: '127.0.0.1',
        port: 5274,
        method,
        path,
        headers: { origin: BASE, ...headers },
        agent: false,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = text;
          }
          resolve({
            answered: true,
            status: response.statusCode,
            elapsedMs: Date.now() - started,
            body: parsed,
          });
        });
      },
    );
    request.setTimeout(timeoutMs, () => {
      request.destroy();
      resolve({ answered: false, outcome: 'no response before timeout', elapsedMs: Date.now() - started });
    });
    request.on('error', (error) =>
      resolve({ answered: false, outcome: `socket error: ${error.message}`, elapsedMs: Date.now() - started }),
    );
    if (body !== undefined) request.write(body);
    request.end();
  });
}

/** Mints a fresh development identity the way the real page does. */
async function mintIdentity() {
  const response = await call('/api/identity/development-session', {
    method: 'POST',
    origin: BASE,
    candidate: EXPECTED_CANDIDATE,
  });
  if (response.status !== 201 || response.cookie === null) {
    throw new Error(`identity mint failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return { cookie: response.cookie, accountId: response.body.accountId };
}

async function submit(cookie, note, requestId = randomUUID(), candidate = EXPECTED_CANDIDATE) {
  return call('/api/foundation-checks', {
    method: 'POST',
    origin: BASE,
    candidate,
    cookie,
    body: { requestId, note },
  });
}

async function projection(cookie) {
  return call('/api/foundation-checks', { origin: BASE, cookie });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  // ---- A01 candidate identity ------------------------------------------
  const candidate = await call('/api/candidate');
  record(
    'A01',
    'running candidate id and environment class match the frozen manifest',
    candidate.status === 200 &&
      candidate.body.candidateId === EXPECTED_CANDIDATE &&
      candidate.body.environmentClass === 'local' &&
      candidate.body.runtimeMode === 'frozen_certification',
    candidate.body,
  );

  const health = await call('/api/health');
  record('A02', 'health route reports both emulators reachable', health.status === 200 && health.body.status === 'ready', health.body);

  // ---- A03 wrong origin -------------------------------------------------
  const evil = 'https://evil.example';
  const evilMint = await call('/api/identity/development-session', {
    method: 'POST',
    origin: evil,
    candidate: EXPECTED_CANDIDATE,
  });
  record(
    'A03a',
    'POST identity mint from a foreign Origin is refused',
    evilMint.status === 403 && evilMint.body.error === 'FORBIDDEN_ORIGIN' && evilMint.cookie === null,
    { status: evilMint.status, body: evilMint.body },
  );

  const session = await mintIdentity();
  const first = await submit(session.cookie, 'QA baseline note one');
  record('A04', 'authenticated submission is accepted and persisted', first.status === 201 && first.body.duplicate === false, {
    status: first.status,
    check: first.body.check,
  });

  const evilRead = await call('/api/foundation-checks', { origin: evil, cookie: session.cookie });
  record(
    'A03b',
    'GET records with a valid cookie but a foreign Origin is refused',
    evilRead.status === 403 && evilRead.body.error === 'FORBIDDEN_ORIGIN',
    { status: evilRead.status, body: evilRead.body },
  );

  const evilWrite2 = await call('/api/foundation-checks', {
    method: 'POST',
    origin: evil,
    candidate: EXPECTED_CANDIDATE,
    cookie: session.cookie,
    body: { requestId: randomUUID(), note: 'origin bypass attempt' },
  });
  record(
    'A03c',
    'POST records from a foreign Origin is refused',
    evilWrite2.status === 403 && evilWrite2.body.error === 'FORBIDDEN_ORIGIN',
    { status: evilWrite2.status, body: evilWrite2.body },
  );

  const evilPreflight = await call('/api/foundation-checks', { method: 'OPTIONS', origin: evil });
  record(
    'A03d',
    'CORS preflight from a foreign Origin is refused',
    evilPreflight.status === 403,
    { status: evilPreflight.status, acao: evilPreflight.headers['access-control-allow-origin'] },
  );

  const nullOrigin = await call('/api/foundation-checks', {
    method: 'POST',
    origin: 'null',
    candidate: EXPECTED_CANDIDATE,
    cookie: session.cookie,
    body: { requestId: randomUUID(), note: 'null origin attempt' },
  });
  record(
    'A03e',
    'POST with Origin: null (sandboxed iframe / data: document) is refused',
    nullOrigin.status === 403 && nullOrigin.body.error === 'FORBIDDEN_ORIGIN',
    { status: nullOrigin.status, body: nullOrigin.body },
  );

  const noOriginWrite = await call('/api/foundation-checks', {
    method: 'POST',
    candidate: EXPECTED_CANDIDATE,
    cookie: session.cookie,
    body: { requestId: randomUUID(), note: 'missing origin attempt' },
  });
  record(
    'A03f',
    'POST with no Origin header at all is refused (no header-stripping bypass)',
    noOriginWrite.status === 403 && noOriginWrite.body.error === 'FORBIDDEN_ORIGIN',
    { status: noOriginWrite.status, body: noOriginWrite.body },
  );

  const caseOrigin = await call('/api/foundation-checks', {
    method: 'POST',
    origin: 'http://127.0.0.1:5274.evil.example',
    candidate: EXPECTED_CANDIDATE,
    cookie: session.cookie,
    body: { requestId: randomUUID(), note: 'origin prefix attempt' },
  });
  record(
    'A03g',
    'POST from a look-alike Origin (allowed origin as a prefix) is refused',
    caseOrigin.status === 403 && caseOrigin.body.error === 'FORBIDDEN_ORIGIN',
    { status: caseOrigin.status, body: caseOrigin.body },
  );

  // ---- A05 unauthenticated access --------------------------------------
  const anonRead = await call('/api/foundation-checks', { origin: BASE });
  record(
    'A05a',
    'unauthenticated read of records is refused',
    anonRead.status === 401 && anonRead.body.error === 'NOT_AUTHENTICATED',
    { status: anonRead.status, body: anonRead.body },
  );

  const anonWrite = await call('/api/foundation-checks', {
    method: 'POST',
    origin: BASE,
    candidate: EXPECTED_CANDIDATE,
    body: { requestId: randomUUID(), note: 'anonymous write attempt' },
  });
  record(
    'A05b',
    'unauthenticated write is refused',
    anonWrite.status === 401 && anonWrite.body.error === 'NOT_AUTHENTICATED',
    { status: anonWrite.status, body: anonWrite.body },
  );

  const forgedCookie = await call('/api/foundation-checks', {
    origin: BASE,
    cookie: 'a'.repeat(43),
  });
  record(
    'A05c',
    'a forged/guessed session cookie is refused',
    forgedCookie.status === 401,
    { status: forgedCookie.status, body: forgedCookie.body },
  );

  const anonSession = await call('/api/session', { origin: BASE });
  record('A05d', 'unauthenticated /api/session is refused', anonSession.status === 401, {
    status: anonSession.status,
    body: anonSession.body,
  });

  // ---- A06 stale candidate ---------------------------------------------
  const stale = await submit(session.cookie, 'stale candidate attempt', randomUUID(), 'cand-000000000000');
  const staleMessage = typeof stale.body?.message === 'string' ? stale.body.message : '';
  record(
    'A06a',
    'submission declaring a different candidate is refused with recovery guidance',
    stale.status === 409 && stale.body.error === 'CANDIDATE_MISMATCH' && /reload/i.test(staleMessage),
    { status: stale.status, body: stale.body },
  );

  const noCandidate = await call('/api/foundation-checks', {
    method: 'POST',
    origin: BASE,
    cookie: session.cookie,
    body: { requestId: randomUUID(), note: 'no candidate header' },
  });
  record(
    'A06b',
    'submission with no candidate header is refused',
    noCandidate.status === 409 && noCandidate.body.error === 'CANDIDATE_MISMATCH',
    { status: noCandidate.status, body: noCandidate.body },
  );

  const beforeStale = await projection(session.cookie);
  record(
    'A06c',
    'the refused stale-candidate submissions wrote nothing',
    !beforeStale.body.checks.some((c) => /stale candidate attempt|no candidate header|origin bypass|null origin|missing origin|origin prefix|anonymous write/.test(c.note)),
    { notes: beforeStale.body.checks.map((c) => c.note) },
  );

  // ---- A07 replay / duplicate ------------------------------------------
  const replayId = randomUUID();
  const replay1 = await submit(session.cookie, 'replay probe', replayId);
  const replay2 = await submit(session.cookie, 'replay probe', replayId);
  const replay3 = await submit(session.cookie, 'a completely different note body', replayId);
  const afterReplay = await projection(session.cookie);
  const replayCount = afterReplay.body.checks.filter((c) => c.note === 'replay probe').length;
  record(
    'A07a',
    'replaying an identical requestId returns the original record and writes nothing new',
    replay1.status === 201 &&
      replay1.body.duplicate === false &&
      replay2.status === 200 &&
      replay2.body.duplicate === true &&
      replay2.body.check.checkId === replay1.body.check.checkId &&
      replayCount === 1,
    {
      first: { status: replay1.status, duplicate: replay1.body.duplicate, checkId: replay1.body.check.checkId },
      second: { status: replay2.status, duplicate: replay2.body.duplicate, checkId: replay2.body.check.checkId },
      storedCopies: replayCount,
    },
  );
  record(
    'A07b',
    'reusing a requestId with a different note body returns the original note (no overwrite)',
    replay3.body.duplicate === true && replay3.body.check.note === 'replay probe',
    { status: replay3.status, duplicate: replay3.body.duplicate, note: replay3.body.check.note },
  );

  // ---- A08 concurrent identical submissions ----------------------------
  const raceId = randomUUID();
  const raceResponses = await Promise.all(
    Array.from({ length: 10 }, () => submit(session.cookie, 'concurrent identical submission', raceId)),
  );
  const afterRace = await projection(session.cookie);
  const raceStored = afterRace.body.checks.filter((c) => c.note === 'concurrent identical submission');
  record(
    'A08',
    '10 concurrent submissions of the same requestId commit exactly one record',
    raceStored.length === 1,
    {
      statuses: raceResponses.map((r) => r.status),
      duplicateFlags: raceResponses.map((r) => r.body?.duplicate),
      storedCopies: raceStored.length,
      distinctCheckIds: [...new Set(raceResponses.map((r) => r.body?.check?.checkId))].length,
    },
  );

  // ---- A09 concurrent distinct submissions (lost update / sequence) ----
  const distinctSession = await mintIdentity();
  const distinctResponses = await Promise.all(
    Array.from({ length: 8 }, (_, index) => submit(distinctSession.cookie, `parallel distinct ${index}`)),
  );
  const afterDistinct = await projection(distinctSession.cookie);
  const sequences = afterDistinct.body.checks.map((c) => c.sequence).sort((a, b) => a - b);
  const uniqueSequences = new Set(sequences);
  record(
    'A09',
    '8 concurrent distinct submissions all persist with unique sequence numbers (no lost update)',
    afterDistinct.body.checks.length === 8 &&
      uniqueSequences.size === 8 &&
      afterDistinct.body.projectionVersion === 8,
    {
      statuses: distinctResponses.map((r) => r.status),
      storedCount: afterDistinct.body.checks.length,
      sequences,
      projectionVersion: afterDistinct.body.projectionVersion,
    },
  );

  // ---- A10 input abuse --------------------------------------------------
  const abuseSession = await mintIdentity();
  const abuseCases = [
    { name: 'empty string note', body: { requestId: randomUUID(), note: '' }, expect: 'NOTE_EMPTY' },
    { name: 'whitespace-only note', body: { requestId: randomUUID(), note: '   \t\n  ' }, expect: 'NOTE_EMPTY' },
    { name: 'note of 121 characters', body: { requestId: randomUUID(), note: 'x'.repeat(121) }, expect: 'NOTE_TOO_LONG' },
    { name: 'note of 5000 characters', body: { requestId: randomUUID(), note: 'x'.repeat(5000) }, expect: 'NOTE_TOO_LONG' },
    { name: 'note is a number', body: { requestId: randomUUID(), note: 12345 }, expect: 'BAD_REQUEST' },
    { name: 'note is an object', body: { requestId: randomUUID(), note: { toString: 'x' } }, expect: 'BAD_REQUEST' },
    { name: 'note is null', body: { requestId: randomUUID(), note: null }, expect: 'BAD_REQUEST' },
    { name: 'missing requestId', body: { note: 'no request id' }, expect: 'REQUEST_ID_INVALID' },
    { name: 'non-uuid requestId', body: { requestId: 'not-a-uuid', note: 'bad id' }, expect: 'REQUEST_ID_INVALID' },
    { name: 'uuid v1 requestId', body: { requestId: 'f47ac10b-58cc-11e4-8f2a-0800200c9a66', note: 'v1 id' }, expect: 'REQUEST_ID_INVALID' },
    {
      name: 'requestId with a firestore path separator',
      body: { requestId: '../../admin', note: 'path in id' },
      expect: 'REQUEST_ID_INVALID',
    },
    {
      name: 'prototype pollution attempt in body',
      body: { requestId: randomUUID(), note: 'pollution', __proto__: { polluted: true }, ownerAccountId: 'dev-someone-else', sequence: 9999 },
      expect: null,
    },
  ];

  const abuseObserved = [];
  for (const testCase of abuseCases) {
    const response = await submit(abuseSession.cookie, undefined, undefined).catch(() => null);
    void response;
    const actual = await call('/api/foundation-checks', {
      method: 'POST',
      origin: BASE,
      candidate: EXPECTED_CANDIDATE,
      cookie: abuseSession.cookie,
      body: testCase.body,
    });
    abuseObserved.push({
      name: testCase.name,
      expect: testCase.expect,
      status: actual.status,
      error: actual.body?.error ?? null,
      message: actual.body?.message ?? null,
      duplicate: actual.body?.duplicate ?? null,
    });
  }
  const rejectedAsExpected = abuseObserved
    .filter((o) => o.expect !== null)
    .every((o) => o.error === o.expect && o.status >= 400 && o.status < 500);
  record('A10a', 'every malformed/abusive note payload is refused with a specific, explanatory code', rejectedAsExpected, abuseObserved);

  const pollutionResult = abuseObserved.find((o) => o.name === 'prototype pollution attempt in body');
  const afterAbuse = await projection(abuseSession.cookie);
  const pollutionStored = afterAbuse.body.checks.find((c) => c.note === 'pollution');
  record(
    'A10b',
    'client-supplied ownership/sequence fields are ignored; the server assigns them',
    afterAbuse.body.accountId === abuseSession.accountId &&
      pollutionStored !== undefined &&
      pollutionStored.sequence !== 9999 &&
      ({}).polluted === undefined,
    { accountId: afterAbuse.body.accountId, storedSequence: pollutionStored?.sequence, status: pollutionResult?.status },
  );

  const malformed = await call('/api/foundation-checks', {
    method: 'POST',
    origin: BASE,
    candidate: EXPECTED_CANDIDATE,
    cookie: abuseSession.cookie,
    body: '{"requestId": "broken",,,',
    raw: true,
  });
  record('A10c', 'malformed JSON is refused with BAD_REQUEST, not a crash', malformed.status === 400 && malformed.body.error === 'BAD_REQUEST', {
    status: malformed.status,
    body: malformed.body,
  });

  const oversizedPayload = JSON.stringify({ requestId: randomUUID(), note: 'x'.repeat(200000) });
  const oversizedOutcome = await sendIsolated({
    method: 'POST',
    path: '/api/foundation-checks',
    headers: {
      cookie: `${COOKIE_NAME}=${abuseSession.cookie}`,
      [CANDIDATE_HEADER]: EXPECTED_CANDIDATE,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(oversizedPayload),
    },
    body: oversizedPayload,
  });
  const stillAlive = await call('/api/candidate');
  record(
    'A10d',
    'a 200 KB body is answered with an explanatory error and the server survives',
    oversizedOutcome.answered === true &&
      stillAlive.status === 200 &&
      stillAlive.body.candidateId === EXPECTED_CANDIDATE,
    { oversized: oversizedOutcome, serverStillAnswering: stillAlive.status },
  );

  // A10e: after the oversized rejection the remainder of the request body is
  // never drained, so the next request that reuses that keep-alive connection
  // is the real subject of this check.
  const stallAgent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const stallSend = (options, timeoutMs = 8000) =>
    new Promise((resolve) => {
      const started = Date.now();
      const request = http.request(
        {
          host: '127.0.0.1',
          port: 5274,
          method: options.method ?? 'GET',
          path: options.path,
          headers: { origin: BASE, ...(options.headers ?? {}) },
          agent: stallAgent,
        },
        (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () =>
            resolve({
              answered: true,
              status: response.statusCode,
              elapsedMs: Date.now() - started,
              setCookie: response.headers['set-cookie'] ?? null,
            }),
          );
        },
      );
      request.setTimeout(timeoutMs, () => {
        request.destroy();
        resolve({ answered: false, outcome: 'STALLED, no response', elapsedMs: Date.now() - started });
      });
      request.on('error', (error) =>
        resolve({ answered: false, outcome: `socket error: ${error.message}`, elapsedMs: Date.now() - started }),
      );
      if (options.body !== undefined) request.write(options.body);
      request.end();
    });

  const stallMint = await stallSend({
    method: 'POST',
    path: '/api/identity/development-session',
    headers: { [CANDIDATE_HEADER]: EXPECTED_CANDIDATE },
  });
  const stallCookie = /hd_dev_session=[^;]+/.exec((stallMint.setCookie ?? []).join(';'))?.[0] ?? '';
  const stallPayload = JSON.stringify({ requestId: randomUUID(), note: 'x'.repeat(200000) });
  const stallOversized = await stallSend({
    method: 'POST',
    path: '/api/foundation-checks',
    headers: {
      cookie: stallCookie,
      [CANDIDATE_HEADER]: EXPECTED_CANDIDATE,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(stallPayload),
    },
    body: stallPayload,
  });
  const stallFollowUp = await stallSend({ path: '/api/candidate' });
  stallAgent.destroy();
  record(
    'A10e',
    'the connection stays usable after an oversized body is rejected',
    stallFollowUp.answered === true,
    { oversizedResponse: stallOversized, nextRequestOnSameConnection: stallFollowUp },
  );

  const controlAgent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const controlSend = (path) =>
    new Promise((resolve) => {
      const request = http.request(
        { host: '127.0.0.1', port: 5274, path, headers: { origin: BASE }, agent: controlAgent },
        (response) => {
          response.resume();
          response.on('end', () => resolve({ answered: true, status: response.statusCode }));
        },
      );
      request.setTimeout(8000, () => {
        request.destroy();
        resolve({ answered: false, outcome: 'STALLED' });
      });
      request.on('error', (error) => resolve({ answered: false, outcome: error.message }));
      request.end();
    });
  const control1 = await controlSend('/api/candidate');
  const control2 = await controlSend('/api/candidate');
  controlAgent.destroy();
  record(
    'A10f',
    'CONTROL: two ordinary requests reuse one keep-alive connection without stalling',
    control1.answered === true && control2.answered === true,
    { first: control1, second: control2 },
  );

  // ---- A11 method handling ---------------------------------------------
  const put = await call('/api/foundation-checks', {
    method: 'PUT',
    origin: BASE,
    candidate: EXPECTED_CANDIDATE,
    cookie: abuseSession.cookie,
    body: { requestId: randomUUID(), note: 'put attempt' },
  });
  const del = await call('/api/foundation-checks', {
    method: 'DELETE',
    origin: BASE,
    candidate: EXPECTED_CANDIDATE,
    cookie: abuseSession.cookie,
  });
  record(
    'A11',
    'unsupported methods on the records route are refused (no hidden update/delete verb)',
    put.status === 405 && del.status === 405,
    { put: put.status, delete: del.status },
  );

  // ---- A12 direct navigation and traversal ------------------------------
  const traversalPaths = [
    '/admin',
    '/dist',
    '/dist/',
    '/dist/server/index.js',
    '/.git/config',
    '/package.json',
    '/firestore.rules',
    '/firebase.json',
    '/../../etc/passwd',
    '/..%2f..%2f..%2fetc%2fpasswd',
    '/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '/assets/../../../../etc/passwd',
    '/assets/..%5c..%5cetc%5cpasswd',
    '/....//....//etc/passwd',
    '/api/admin',
    '/api/',
    '/api/candidate/../session',
    '/.env',
    '/node_modules/playwright/package.json',
  ];
  const traversalObserved = [];
  for (const path of traversalPaths) {
    const response = await fetch(`${BASE}${path}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    traversalObserved.push({
      path,
      status: response.status,
      contentType: response.headers.get('content-type'),
      leaksPasswd: /root:x:0:0/.test(text),
      leaksSource: /ownerAccountId|sessionTokenHash|firebase-admin/.test(text),
      bodyStart: text.slice(0, 90).replace(/\s+/g, ' '),
    });
  }
  const traversalSafe = traversalObserved.every(
    (o) => o.status >= 400 && !o.leaksPasswd && !o.leaksSource,
  );
  record('A12a', 'unlinked routes and path-traversal attempts expose nothing and return an error status', traversalSafe, traversalObserved);

  const notFoundReflection = await fetch(`${BASE}/%3Cimg%20src=x%20onerror=alert(1)%3E`);
  const notFoundHtml = await notFoundReflection.text();
  record(
    'A12b',
    'the 404 page does not reflect an attacker-controlled path as live markup',
    !/<img\s/i.test(notFoundHtml) && !/<script/i.test(notFoundHtml.replace(/<script[^>]*src="\.\/assets/g, '')),
    { status: notFoundReflection.status, snippet: notFoundHtml.match(/<h1>[\s\S]*?<\/h1>/)?.[0] ?? null },
  );

  const sourcemap = await fetch(`${BASE}/assets/index-Bo_IIb6o.js.map`);
  record(
    'A12c',
    'INFORMATIONAL: client source map exposure on the frozen bundle',
    true,
    { status: sourcemap.status, note: sourcemap.status === 200 ? 'source map is served' : 'source map not served' },
  );

  // ---- A13 ownership ----------------------------------------------------
  const ownerA = await mintIdentity();
  await submit(ownerA.cookie, 'owner A private note');
  const ownerB = await mintIdentity();
  await submit(ownerB.cookie, 'owner B private note');
  const bView = await projection(ownerB.cookie);
  const aView = await projection(ownerA.cookie);
  record(
    'A13a',
    'a second identity cannot see the first identity records',
    !bView.body.checks.some((c) => c.note === 'owner A private note') &&
      !aView.body.checks.some((c) => c.note === 'owner B private note') &&
      bView.body.accountId === ownerB.accountId,
    {
      ownerA: { accountId: ownerA.accountId, notes: aView.body.checks.map((c) => c.note) },
      ownerB: { accountId: ownerB.accountId, notes: bView.body.checks.map((c) => c.note) },
    },
  );

  const crossAccountForge = await call('/api/foundation-checks', {
    method: 'POST',
    origin: BASE,
    candidate: EXPECTED_CANDIDATE,
    cookie: ownerB.cookie,
    body: { requestId: randomUUID(), note: 'forged into owner A', accountId: ownerA.accountId, ownerAccountId: ownerA.accountId },
  });
  const aAfterForge = await projection(ownerA.cookie);
  record(
    'A13b',
    'a caller cannot write into another account by naming it in the body',
    crossAccountForge.status === 201 &&
      !aAfterForge.body.checks.some((c) => c.note === 'forged into owner A'),
    { forgeStatus: crossAccountForge.status, ownerANotes: aAfterForge.body.checks.map((c) => c.note) },
  );

  // ---- A14 session lifecycle -------------------------------------------
  const leaving = await mintIdentity();
  await submit(leaving.cookie, 'note recorded before leaving');
  const signOut = await call('/api/session', {
    method: 'DELETE',
    origin: BASE,
    candidate: EXPECTED_CANDIDATE,
    cookie: leaving.cookie,
  });
  const reuseRead = await call('/api/foundation-checks', { origin: BASE, cookie: leaving.cookie });
  const reuseWrite = await submit(leaving.cookie, 'write after sign out');
  const reuseSession = await call('/api/session', { origin: BASE, cookie: leaving.cookie });
  record(
    'A14a',
    'signing out ends the session server-side and the stale cookie cannot be replayed',
    signOut.status === 204 &&
      reuseRead.status === 401 &&
      reuseWrite.status === 401 &&
      reuseSession.status === 401,
    {
      signOut: signOut.status,
      replayRead: reuseRead.status,
      replayWrite: reuseWrite.status,
      replaySession: reuseSession.status,
    },
  );

  const signOutCookieHeader = signOut.headers['set-cookie'] ?? '';
  record(
    'A14b',
    'sign out clears the browser cookie as well',
    /hd_dev_session=;/.test(signOutCookieHeader) && /Max-Age=0/i.test(signOutCookieHeader),
    { setCookie: signOutCookieHeader },
  );

  const mintHeaders = await call('/api/identity/development-session', {
    method: 'POST',
    origin: BASE,
    candidate: EXPECTED_CANDIDATE,
  });
  const mintedCookieHeader = (mintHeaders.headers['set-cookie'] ?? '');
  record(
    'A14c',
    'the session cookie is HttpOnly and SameSite=Strict',
    /HttpOnly/i.test(mintedCookieHeader) && /SameSite=Strict/i.test(mintedCookieHeader),
    { setCookie: mintedCookieHeader.replace(/hd_dev_session=[^;]+/, 'hd_dev_session=<redacted>') },
  );

  // ---- A15 response hardening headers ----------------------------------
  const pageResponse = await fetch(`${BASE}/`);
  const pageHeaders = Object.fromEntries(pageResponse.headers.entries());
  await pageResponse.text();
  record(
    'A15',
    'INFORMATIONAL: security headers present on the HTML document',
    true,
    {
      'x-content-type-options': pageHeaders['x-content-type-options'] ?? null,
      'content-security-policy': pageHeaders['content-security-policy'] ?? null,
      'x-frame-options': pageHeaders['x-frame-options'] ?? null,
      'referrer-policy': pageHeaders['referrer-policy'] ?? null,
    },
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    expectedCandidate: EXPECTED_CANDIDATE,
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).map((r) => r.id),
    results,
  };
  await writeFile(`${OUT_DIR}/api-probe-results.json`, JSON.stringify(summary, null, 2));
  console.log(`\n${summary.passed}/${summary.total} raw-HTTP checks passed.`);
  if (summary.failed.length > 0) {
    console.log(`Failed: ${summary.failed.join(', ')}`);
  }
}

main().catch((error) => {
  console.error('probe aborted:', error);
  process.exitCode = 1;
});
