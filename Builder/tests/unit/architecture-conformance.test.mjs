import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  evaluateRules,
  RULES,
  runArchitectureConformance,
} from '../../tools/certification/architecture-conformance.mjs';

/**
 * The architecture conformance scan is only worth having if it actually fires.
 * These tests prove each rule catches the drift it names, prove each rule is
 * scoped to the right part of the tree, and prove the current source passes.
 */

function findingsFor(relativePath, contents) {
  return evaluateRules({ relativePath, contents }).map((finding) => finding.rule);
}

test('the current source tree conforms', async () => {
  const result = await runArchitectureConformance();
  assert.equal(
    result.ok,
    true,
    result.findings.map((f) => `${f.rule} ${f.file}:${f.line} ${f.text}`).join('\n'),
  );
  assert.ok(result.filesScanned > 0);
  assert.equal(result.ruleCount, RULES.length);
});

test('a client importing server code or the admin SDK is caught', () => {
  assert.ok(
    findingsFor('src/client/main.ts', "import { thing } from '../server/http/server.js';").includes(
      'client_must_not_import_server_or_admin_sdk',
    ),
  );
  assert.ok(
    findingsFor('src/client/api.ts', "import { getFirestore } from 'firebase-admin/firestore';").includes(
      'client_must_not_import_server_or_admin_sdk',
    ),
  );
  // The server is allowed to import the admin SDK; that is its job.
  assert.deepEqual(
    findingsFor('src/server/persistence/firestore.ts', "import x from 'firebase-admin/app';"),
    [],
  );
});

test('a client holding identity or canonical state in browser storage is caught', () => {
  for (const snippet of [
    'const token = document.cookie;',
    'localStorage.setItem("character", JSON.stringify(character));',
    'sessionStorage.setItem("seat", seatId);',
    'const db = indexedDB.open("campaigns");',
  ]) {
    assert.ok(
      findingsFor('src/client/main.ts', snippet).includes(
        'client_must_not_hold_identity_or_canonical_state',
      ),
      `expected a finding for: ${snippet}`,
    );
  }
});

test('session primitives outside the identity module are caught', () => {
  assert.ok(
    findingsFor('src/server/campaigns/campaigns.ts', 'const token = randomBytes(32);').includes(
      'session_primitives_confined_to_identity_module',
    ),
  );
  assert.ok(
    findingsFor('src/server/http/server.ts', 'await auth.createUser({ uid });').includes(
      'session_primitives_confined_to_identity_module',
    ),
  );
  assert.deepEqual(
    findingsFor('src/server/identity/development-identity.ts', 'const token = randomBytes(32);'),
    [],
  );
});

test('a second session store is caught', () => {
  assert.ok(
    findingsFor(
      'src/server/campaigns/campaigns.ts',
      'await firestore.collection(COLLECTIONS.developmentSessions).doc(id).set({});',
    ).includes('session_store_confined_to_identity_module'),
  );
});

test('an alternative ownership key is caught anywhere in src', () => {
  for (const snippet of [
    'const userId = session.accountId;',
    'interface Character { ownerId: string }',
    'const playerId = seat.accountId;',
    'record.owner_id = accountId;',
  ]) {
    assert.ok(
      findingsFor('src/server/characters/characters.ts', snippet).includes('single_ownership_key'),
      `expected a finding for: ${snippet}`,
    );
    assert.ok(
      findingsFor('src/client/main.ts', snippet).includes('single_ownership_key'),
      `expected a client-side finding for: ${snippet}`,
    );
  }

  // The approved vocabulary passes.
  assert.deepEqual(
    findingsFor(
      'src/server/characters/characters.ts',
      'const { accountId } = session; record.ownerAccountId = accountId;',
    ),
    [],
  );
});

test('an inline Firestore collection name is caught', () => {
  assert.ok(
    findingsFor('src/server/characters/characters.ts', "firestore.collection('characters')").includes(
      'collections_come_from_the_registry',
    ),
  );
  assert.deepEqual(
    findingsFor(
      'src/server/characters/characters.ts',
      'firestore.collection(COLLECTIONS.foundationChecks)',
    ),
    [],
  );
});

test('rules are scoped rather than global', () => {
  // A server file may read a cookie header; only the client is restricted.
  assert.deepEqual(
    findingsFor('src/server/http/server.ts', 'const raw = request.headers.cookie;'),
    [],
  );
});
