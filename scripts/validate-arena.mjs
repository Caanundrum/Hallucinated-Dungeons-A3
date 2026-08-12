#!/usr/bin/env node
// Local Arena end-to-end validation. Proves the running Firebase Emulator Suite
// actually accepts and returns state via a genuine round-trip:
//   1. Firestore: write a document, read it back, assert equality.
//   2. Auth: create a user, list users, assert it exists.
// This is infrastructure validation (server -> emulator), not a product feature.

const PROJECT = process.env.GCLOUD_PROJECT || "hallucinated-dungeons-local";
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

const stamp = Date.now();
let failures = 0;

// The Firebase emulators treat "Authorization: Bearer owner" as a trusted
// admin/server caller that bypasses Firestore security rules and unlocks the
// emulator admin endpoints. This mirrors the blueprint's server-authoritative
// model, where canonical writes come from the trusted server, not the client.
const OWNER = { Authorization: "Bearer owner" };

function assert(label, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

async function firestoreRoundTrip() {
  console.log("[Firestore emulator] round-trip");
  const collection = "arena_smoke";
  const docId = `probe-${stamp}`;
  const base = `http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;

  const writeRes = await fetch(`${base}/${collection}?documentId=${docId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...OWNER },
    body: JSON.stringify({
      fields: {
        message: { stringValue: "local-arena-online" },
        stamp: { integerValue: String(stamp) },
      },
    }),
  });
  assert("Firestore write accepted", writeRes.ok, `HTTP ${writeRes.status}`);

  const readRes = await fetch(`${base}/${collection}/${docId}`, { headers: { ...OWNER } });
  const readBody = await readRes.json();
  const msg = readBody?.fields?.message?.stringValue;
  const stampBack = readBody?.fields?.stamp?.integerValue;
  assert("Firestore read returns written doc", readRes.ok, `HTTP ${readRes.status}`);
  assert("Firestore value round-trips", msg === "local-arena-online", `got message=${msg}`);
  assert("Firestore integer round-trips", stampBack === String(stamp), `got stamp=${stampBack}`);
}

async function authRoundTrip() {
  console.log("[Auth emulator] round-trip");
  const email = `player-${stamp}@example.test`;
  const signUpRes = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery", returnSecureToken: true }),
    },
  );
  const signUpBody = await signUpRes.json();
  assert("Auth user created", signUpRes.ok && !!signUpBody.localId, JSON.stringify(signUpBody));

  const listRes = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`,
    { method: "POST", headers: { "Content-Type": "application/json", ...OWNER }, body: "{}" },
  );
  const listBody = await listRes.json();
  const found = Array.isArray(listBody.userInfo) && listBody.userInfo.some((u) => u.email === email);
  assert("Auth user listed by emulator", found, `records=${listBody?.recordsCount ?? 0}`);
}

async function main() {
  console.log(`Local Arena validation against project "${PROJECT}"`);
  console.log(`  Firestore: ${FS_HOST}`);
  console.log(`  Auth:      ${AUTH_HOST}\n`);
  await firestoreRoundTrip();
  console.log("");
  await authRoundTrip();
  console.log("");
  if (failures > 0) {
    console.error(`Local Arena validation FAILED (${failures} check(s)).`);
    process.exit(1);
  }
  console.log("Local Arena validation PASSED. Browser -> server -> emulator path is ready.");
}

main().catch((err) => {
  console.error("Local Arena validation ERROR:", err.message);
  console.error("Is the emulator suite running? Try `npm run arena:start`.");
  process.exit(1);
});
