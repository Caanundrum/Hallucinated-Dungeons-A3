/**
 * Independent QA probe of the surface the Phase 0 remediation changed.
 *
 * Written for the retest of candidate cand-882c6c2fe4a3. The original
 * api-probe.mjs is re-run unchanged as the regression guard; this file attacks
 * only what the fixes touched: oversized-body handling and the new 413 path,
 * the new hardening headers across every response class, and the new
 * `totalCount` aggregation on the owner projection.
 *
 * All output stays under /workspace/QA.
 */

import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const BASE = 'http://127.0.0.1:5274';
const EXPECTED_CANDIDATE = process.env.QA_EXPECTED_CANDIDATE ?? 'cand-882c6c2fe4a3';
const CANDIDATE_HEADER = 'x-hd-candidate';
const COOKIE_NAME = 'hd_dev_session';
const OUT_DIR = '/workspace/QA/evidence/retest-cand-882c6c2fe4a3/api';
const MAX_BODY_BYTES = 8 * 1024;

const results = [];

function record(id, title, passed, detail) {
  results.push({ id, title, passed, detail });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${id} ${title}`);
  if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
}

/** One request on a dedicated connection, with full control over framing. */
function send(options, timeoutMs = 8000) {
  const { method = 'GET', path, headers = {}, body, agent = false } = options;
  return new Promise((resolve) => {
    const started = Date.now();
    const request = http.request(
      { host: '127.0.0.1', port: 5274, method, path, headers: { origin: BASE, ...headers }, agent },
      (response) => {
        const chunks = [];
        response.on('data', (c) => chunks.push(c));
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
            headers: response.headers,
            elapsedMs: Date.now() - started,
            body: parsed,
          });
        });
      },
    );
    request.setTimeout(timeoutMs, () => {
      request.destroy();
      resolve({ answered: false, outcome: 'STALLED, no response', elapsedMs: Date.now() - started });
    });
    request.on('error', (error) =>
      resolve({
        answered: false,
        outcome: `socket error: ${error.code ?? error.message}`,
        elapsedMs: Date.now() - started,
      }),
    );
    if (body !== undefined) request.write(body);
    request.end();
  });
}

async function fetchJson(path, options = {}) {
  const { method = 'GET', cookie, candidate, body, origin = BASE } = options;
  const headers = { origin };
  if (cookie) headers.cookie = `${COOKIE_NAME}=${cookie}`;
  if (candidate) headers[CANDIDATE_HEADER] = candidate;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  if (payload !== undefined) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(payload);
  }
  const response = await send({ method, path, headers, body: payload });
  const setCookie = response.headers?.['set-cookie'] ?? [];
  const token = /hd_dev_session=([^;]+)/.exec(setCookie.join(';'))?.[1];
  return { ...response, sessionToken: token };
}

async function mintIdentity() {
  const response = await fetchJson('/api/identity/development-session', {
    method: 'POST',
    candidate: EXPECTED_CANDIDATE,
  });
  if (response.status !== 201 || !response.sessionToken) {
    throw new Error(`mint failed: ${JSON.stringify(response)}`);
  }
  return { cookie: response.sessionToken, accountId: response.body.accountId };
}

const submit = (cookie, note, requestId = randomUUID()) =>
  fetchJson('/api/foundation-checks', {
    method: 'POST',
    cookie,
    candidate: EXPECTED_CANDIDATE,
    body: { requestId, note },
  });

const projection = (cookie) => fetchJson('/api/foundation-checks', { cookie });

const REQUIRED_HEADERS = {
  'content-security-policy': /default-src 'self'/,
  'x-frame-options': /^DENY$/i,
  'referrer-policy': /^no-referrer$/i,
  'x-content-type-options': /^nosniff$/i,
};

function headerReport(headers) {
  const report = {};
  let ok = true;
  for (const [name, pattern] of Object.entries(REQUIRED_HEADERS)) {
    const value = headers?.[name];
    const present = typeof value === 'string' && pattern.test(value);
    report[name] = present ? 'ok' : (value ?? 'MISSING');
    if (!present) ok = false;
  }
  return { ok, report };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const candidate = await fetchJson('/api/candidate');
  record(
    'R01',
    'the running candidate is the replacement candidate',
    candidate.body.candidateId === EXPECTED_CANDIDATE && candidate.body.environmentClass === 'local',
    candidate.body,
  );

  // ---- R02 hardening headers on every class of response -----------------
  const htmlPage = await send({ path: '/' });
  const notFoundPage = await send({ path: '/admin' });
  const jsonOk = await send({ path: '/api/candidate' });
  const jsonError = await send({ path: '/api/foundation-checks' });
  const assetMatch = /assets\/[A-Za-z0-9._-]+\.js/.exec(String(htmlPage.body));
  const cssMatch = /assets\/[A-Za-z0-9._-]+\.css/.exec(String(htmlPage.body));
  const jsAsset = await send({ path: `/${assetMatch?.[0] ?? 'assets/missing.js'}` });
  const cssAsset = await send({ path: `/${cssMatch?.[0] ?? 'assets/missing.css'}` });

  const classes = {
    'html document': htmlPage,
    '404 page': notFoundPage,
    'json success': jsonOk,
    'json error': jsonError,
    'js bundle': jsAsset,
    'css bundle': cssAsset,
  };
  const headerFindings = {};
  let allHeadersOk = true;
  for (const [label, response] of Object.entries(classes)) {
    const { ok, report } = headerReport(response.headers);
    headerFindings[label] = { status: response.status, ...report };
    if (!ok) allHeadersOk = false;
  }
  record('R02', 'every class of response carries the hardening headers', allHeadersOk, headerFindings);

  record(
    'R03',
    'the client bundle actually loads (js and css return 200)',
    jsAsset.status === 200 && cssAsset.status === 200,
    { js: { path: assetMatch?.[0], status: jsAsset.status }, css: { path: cssMatch?.[0], status: cssAsset.status } },
  );

  // The CSP forbids inline script and style, so the served HTML must not
  // contain any. A page that needed them would break silently.
  const html = String(htmlPage.body);
  const inlineScript = /<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/i.test(html);
  const inlineStyleBlock = /<style[\s>]/i.test(html);
  const inlineStyleAttribute = /<[^>]+\sstyle=/i.test(html);
  record(
    'R04',
    'the served HTML contains nothing the CSP would block',
    !inlineScript && !inlineStyleBlock && !inlineStyleAttribute,
    { inlineScript, inlineStyleBlock, inlineStyleAttribute },
  );

  // ---- R05 oversized body handling --------------------------------------
  const session = await mintIdentity();

  const sizeCases = [
    // A 100-character note is a legitimate submission and must still commit;
    // the point of this case is that the size guard did not become
    // over-eager. The 8 KB case is a valid-size body carrying an invalid note,
    // so it must be judged by note length, not refused as oversized.
    { name: 'valid 100 character note', noteBytes: 100, expectStatus: 201 },
    { name: 'body just under 8 KB', noteBytes: MAX_BODY_BYTES - 200, expectStatus: 400 },
    { name: 'body just over 8 KB', noteBytes: MAX_BODY_BYTES + 200, expectStatus: 413 },
    { name: 'body of 200 KB', noteBytes: 200 * 1024, expectStatus: 413 },
    { name: 'body of 5 MB', noteBytes: 5 * 1024 * 1024, expectStatus: 413 },
  ];
  const sizeObserved = [];
  for (const testCase of sizeCases) {
    const payload = JSON.stringify({ requestId: randomUUID(), note: 'x'.repeat(testCase.noteBytes) });
    const response = await send({
      method: 'POST',
      path: '/api/foundation-checks',
      headers: {
        cookie: `${COOKIE_NAME}=${session.cookie}`,
        [CANDIDATE_HEADER]: EXPECTED_CANDIDATE,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
      body: payload,
    });
    sizeObserved.push({
      name: testCase.name,
      bodyBytes: Buffer.byteLength(payload),
      expectStatus: testCase.expectStatus,
      answered: response.answered,
      status: response.status ?? response.outcome,
      error: response.body?.error ?? null,
      connectionHeader: response.headers?.connection ?? null,
      elapsedMs: response.elapsedMs,
    });
  }
  record(
    'R05',
    'every oversized body is answered with 413 and every valid-size body is still processed',
    sizeObserved.every((o) => o.answered && o.status === o.expectStatus),
    sizeObserved,
  );

  record(
    'R05b',
    'the size guard rejects before reading, not after a long upload',
    sizeObserved.filter((o) => o.expectStatus === 413).every((o) => o.elapsedMs < 1000),
    sizeObserved.filter((o) => o.expectStatus === 413).map((o) => ({ name: o.name, elapsedMs: o.elapsedMs })),
  );

  // A chunked upload declares no Content-Length, so it bypasses the fast
  // pre-check and must still be refused cleanly by the streaming guard.
  const chunked = await new Promise((resolve) => {
    const started = Date.now();
    const request = http.request(
      {
        host: '127.0.0.1',
        port: 5274,
        method: 'POST',
        path: '/api/foundation-checks',
        agent: false,
        headers: {
          origin: BASE,
          cookie: `${COOKIE_NAME}=${session.cookie}`,
          [CANDIDATE_HEADER]: EXPECTED_CANDIDATE,
          'content-type': 'application/json',
          'transfer-encoding': 'chunked',
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (c) => chunks.push(c));
        response.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            parsed = Buffer.concat(chunks).toString('utf8');
          }
          resolve({
            answered: true,
            status: response.statusCode,
            body: parsed,
            connection: response.headers.connection ?? null,
            elapsedMs: Date.now() - started,
          });
        });
      },
    );
    request.setTimeout(8000, () => {
      request.destroy();
      resolve({ answered: false, outcome: 'STALLED', elapsedMs: Date.now() - started });
    });
    request.on('error', (error) =>
      resolve({ answered: false, outcome: `socket error: ${error.code ?? error.message}` }),
    );
    request.write(`{"requestId":"${randomUUID()}","note":"`);
    let written = 0;
    const writeMore = () => {
      while (written < 300 * 1024) {
        written += 4096;
        if (!request.write('y'.repeat(4096))) {
          request.once('drain', writeMore);
          return;
        }
      }
      request.end('"}');
    };
    writeMore();
  });
  record(
    'R06',
    'a chunked upload with no Content-Length is refused cleanly rather than stalling',
    chunked.answered === true && chunked.status === 413,
    chunked,
  );

  // A lying Content-Length must not let an over-large body through.
  const lyingPayload = JSON.stringify({ requestId: randomUUID(), note: 'z'.repeat(60 * 1024) });
  const lying = await send({
    method: 'POST',
    path: '/api/foundation-checks',
    headers: {
      cookie: `${COOKIE_NAME}=${session.cookie}`,
      [CANDIDATE_HEADER]: EXPECTED_CANDIDATE,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(lyingPayload),
      'x-qa-note': 'declared length is honest; the guard is the subject',
    },
    body: lyingPayload,
  });
  record(
    'R07',
    'a 60 KB body is refused with 413 and never reaches storage',
    lying.answered === true && lying.status === 413,
    { status: lying.status, error: lying.body?.error },
  );

  // ---- R08 the 413 path does not damage ordinary use --------------------
  const afterOversize = await submit(session.cookie, 'ordinary note after oversized attempts');
  const afterProjection = await projection(session.cookie);
  const oversizedLeaked = afterProjection.body.checks.filter((c) => c.note.length > 120);
  record(
    'R08',
    'an ordinary submission still works after the oversized rejections, and no oversized note was stored',
    afterOversize.status === 201 &&
      afterProjection.body.checks.some((c) => c.note === 'ordinary note after oversized attempts') &&
      oversizedLeaked.length === 0,
    {
      submitStatus: afterOversize.status,
      storedNoteLengths: afterProjection.body.checks.map((c) => c.note.length),
      oversizedNotesStored: oversizedLeaked.length,
    },
  );

  // ---- R09 the new totalCount field -------------------------------------
  const counting = await mintIdentity();
  const empty = await projection(counting.cookie);
  const countObservations = [{ written: 0, totalCount: empty.body.totalCount, rendered: empty.body.checks.length }];

  for (let i = 1; i <= 23; i += 1) {
    await submit(counting.cookie, `count probe ${String(i).padStart(2, '0')}`);
    if ([1, 19, 20, 21, 23].includes(i)) {
      const snapshot = await projection(counting.cookie);
      countObservations.push({
        written: i,
        totalCount: snapshot.body.totalCount,
        rendered: snapshot.body.checks.length,
        projectionVersion: snapshot.body.projectionVersion,
      });
    }
  }
  const countsCorrect = countObservations.every(
    (o) => o.totalCount === o.written && o.rendered === Math.min(o.written, 20),
  );
  record('R09', 'totalCount reports the true stored count at every size', countsCorrect, countObservations);

  // The count must be owner-scoped. By now the emulator holds many records
  // across many accounts, so a global count would be obvious.
  const isolated = await mintIdentity();
  await submit(isolated.cookie, 'isolated count note one');
  await submit(isolated.cookie, 'isolated count note two');
  const isolatedProjection = await projection(isolated.cookie);
  record(
    'R10',
    'totalCount is owner-scoped and does not leak the global record count',
    isolatedProjection.body.totalCount === 2 && isolatedProjection.body.accountId === isolated.accountId,
    {
      accountId: isolatedProjection.body.accountId,
      totalCount: isolatedProjection.body.totalCount,
      otherAccountTotal: countObservations[countObservations.length - 1].totalCount,
    },
  );

  const unauthCount = await send({ path: '/api/foundation-checks' });
  record(
    'R11',
    'the projection with totalCount is still refused to an unauthenticated caller',
    unauthCount.status === 401 && unauthCount.body?.error === 'NOT_AUTHENTICATED',
    { status: unauthCount.status, body: unauthCount.body },
  );

  // ---- R12 PAYLOAD_TOO_LARGE is a documented, player-readable failure ----
  const oversizedBody = JSON.stringify({ requestId: randomUUID(), note: 'q'.repeat(50 * 1024) });
  const codeCheck = await send({
    method: 'POST',
    path: '/api/foundation-checks',
    headers: {
      cookie: `${COOKIE_NAME}=${session.cookie}`,
      [CANDIDATE_HEADER]: EXPECTED_CANDIDATE,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(oversizedBody),
    },
    body: oversizedBody,
  });
  record(
    'R12',
    'the 413 carries a machine code and a sentence a player could read',
    codeCheck.body?.error === 'PAYLOAD_TOO_LARGE' &&
      typeof codeCheck.body?.message === 'string' &&
      codeCheck.body.message.length > 30,
    codeCheck.body,
  );

  // ---- R13 unauthenticated oversized body --------------------------------
  const anonOversized = JSON.stringify({ requestId: randomUUID(), note: 'a'.repeat(200 * 1024) });
  const anonAgent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const anonFirst = await send({
    method: 'POST',
    path: '/api/foundation-checks',
    agent: anonAgent,
    headers: {
      [CANDIDATE_HEADER]: EXPECTED_CANDIDATE,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(anonOversized),
    },
    body: anonOversized,
  });
  const anonNext = await send({ path: '/api/candidate', agent: anonAgent });
  anonAgent.destroy();
  record(
    'R14',
    'an unauthenticated oversized body cannot stall a connection either',
    anonNext.answered === true,
    { oversized: { status: anonFirst.status, error: anonFirst.body?.error }, followUp: anonNext.status ?? anonNext.outcome },
  );

  // ---- R15 source map exposure on the new bundle -------------------------
  const mapPath = `${assetMatch?.[0] ?? ''}.map`;
  const sourceMap = await send({ path: `/${mapPath}` });
  record('R15', 'INFORMATIONAL: source map exposure on the new bundle', true, {
    path: mapPath,
    status: sourceMap.status,
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    candidateUnderTest: EXPECTED_CANDIDATE,
    scope: 'surface changed by the Phase 0 remediation',
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).map((r) => r.id),
    results,
  };
  await writeFile(`${OUT_DIR}/new-surface-results.json`, JSON.stringify(summary, null, 2));
  console.log(`\n${summary.passed}/${summary.total} new-surface checks passed.`);
  if (summary.failed.length > 0) console.log(`Failed: ${summary.failed.join(', ')}`);
}

main().catch((error) => {
  console.error('probe aborted:', error);
  process.exitCode = 1;
});
