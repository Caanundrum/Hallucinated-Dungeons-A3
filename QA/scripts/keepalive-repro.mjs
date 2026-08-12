/**
 * Isolates why a request that follows an oversized-body rejection stalls.
 *
 * Hypothesis under test: the server answers a body larger than its 8 KB limit
 * without draining the remainder of the request, which leaves the keep-alive
 * connection unusable for the next request that reuses it.
 */

import http from 'node:http';

const HOST = '127.0.0.1';
const PORT = 5274;
const ORIGIN = 'http://127.0.0.1:5274';
const CANDIDATE = 'cand-0f810c6c26d8';

function send(agent, { method = 'GET', path, headers = {}, body }, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const request = http.request(
      { host: HOST, port: PORT, method, path, headers: { origin: ORIGIN, ...headers }, agent },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            outcome: 'answered',
            status: response.statusCode,
            elapsedMs: Date.now() - started,
            setCookie: response.headers['set-cookie'] ?? null,
            body: Buffer.concat(chunks).toString('utf8').slice(0, 200),
          }),
        );
      },
    );
    request.setTimeout(timeoutMs, () => {
      request.destroy();
      resolve({ outcome: 'STALLED (no response)', elapsedMs: Date.now() - started });
    });
    request.on('error', (error) =>
      resolve({ outcome: `socket error: ${error.message}`, elapsedMs: Date.now() - started }),
    );
    if (body !== undefined) request.write(body);
    request.end();
  });
}

async function scenario(label, oversizedBytes) {
  // maxSockets 1 forces the follow-up request onto the same pooled connection a
  // real browser would reuse.
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });

  const mint = await send(agent, {
    method: 'POST',
    path: '/api/identity/development-session',
    headers: { 'x-hd-candidate': CANDIDATE },
  });
  const cookie = /hd_dev_session=[^;]+/.exec((mint.setCookie ?? []).join(';'))?.[0];
  if (cookie === undefined) {
    throw new Error(`could not mint a session: ${JSON.stringify(mint)}`);
  }

  const payload = JSON.stringify({
    requestId: '22222222-2222-4222-8222-222222222222',
    note: 'x'.repeat(oversizedBytes),
  });

  const oversized = await send(agent, {
    method: 'POST',
    path: '/api/foundation-checks',
    headers: {
      cookie,
      'x-hd-candidate': CANDIDATE,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
    },
    body: payload,
  });

  const followUp = await send(agent, { path: '/api/candidate' });
  const secondFollowUp = await send(agent, { path: '/api/candidate' });

  agent.destroy();
  console.log(`\n--- ${label} (note length ${oversizedBytes}) ---`);
  console.log(`oversized POST : ${JSON.stringify(oversized)}`);
  console.log(`next GET (same connection) : ${JSON.stringify(followUp)}`);
  console.log(`following GET  : ${JSON.stringify(secondFollowUp)}`);
  return { label, oversized, followUp, secondFollowUp };
}

async function control() {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const first = await send(agent, { path: '/api/candidate' });
  const second = await send(agent, { path: '/api/candidate' });
  agent.destroy();
  console.log(`\n--- control: two ordinary GETs on one keep-alive connection ---`);
  console.log(`first  : ${JSON.stringify(first)}`);
  console.log(`second : ${JSON.stringify(second)}`);
  return { first, second };
}

await control();
await scenario('body just over the 8 KB limit', 9000);
await scenario('200 KB body', 200000);
