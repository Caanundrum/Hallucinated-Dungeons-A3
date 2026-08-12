/**
 * Deterministic Local Arena baseline seed.
 *
 * Blueprint ownership: Sections 1.11.9 (Frozen Local Certification Mode
 * requires deterministic seed data) and 22.5 ("Baseline data is clean or
 * matches the requested seed identity").
 *
 * Phase 0 owns no product data, so the baseline is exactly one record that
 * names the seed identity. It exists so a certification run can prove which
 * baseline it started from rather than assuming an empty database.
 */

/** Identity of the Phase 0 baseline. Bump when the baseline content changes. */
export const SEED_VERSION = 'phase0-baseline-v1';

const OWNER_HEADERS = { Authorization: 'Bearer owner' };

/**
 * @param {string} firestoreHost host:port of the Firestore emulator
 * @param {string} projectId
 */
function documentsBase(firestoreHost, projectId) {
  return `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents`;
}

/**
 * Clears every Phase 0 collection so a run starts from a known baseline.
 *
 * @param {object} options
 * @param {string} options.firestoreHost
 * @param {string} options.projectId
 */
export async function clearArenaData({ firestoreHost, projectId }) {
  const response = await fetch(
    `http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE', headers: OWNER_HEADERS },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to clear the Firestore emulator baseline: HTTP ${response.status} ${await response.text()}`,
    );
  }
}

/**
 * Writes the deterministic baseline record and returns the seed identity.
 *
 * @param {object} options
 * @param {string} options.firestoreHost
 * @param {string} options.projectId
 * @param {string} options.candidateId
 */
export async function seedArenaBaseline({ firestoreHost, projectId, candidateId }) {
  const base = documentsBase(firestoreHost, projectId);
  const response = await fetch(`${base}/arenaBaseline?documentId=${SEED_VERSION}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...OWNER_HEADERS },
    body: JSON.stringify({
      fields: {
        seedVersion: { stringValue: SEED_VERSION },
        candidateId: { stringValue: candidateId },
        environmentClass: { stringValue: 'local' },
        phase: { stringValue: 'phase-0' },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to write the Local Arena baseline seed: HTTP ${response.status} ${await response.text()}`,
    );
  }
  return SEED_VERSION;
}

/**
 * Reads back the baseline record so readiness can prove which seed is loaded.
 *
 * @param {object} options
 * @param {string} options.firestoreHost
 * @param {string} options.projectId
 * @returns {Promise<string | null>}
 */
export async function readSeedIdentity({ firestoreHost, projectId }) {
  const base = documentsBase(firestoreHost, projectId);
  const response = await fetch(`${base}/arenaBaseline/${SEED_VERSION}`, {
    headers: OWNER_HEADERS,
  });
  if (!response.ok) {
    return null;
  }
  const body = await response.json();
  return body?.fields?.seedVersion?.stringValue ?? null;
}
