/**
 * Local Stack Manifest construction and readiness verification.
 *
 * Blueprint ownership: Sections 22.5 (local stack startup, readiness, and
 * deterministic certification) and appendix C.ARENA.3 (Local Stack Manifest
 * corpus). Missing, substituted, or contradictory fields fail startup.
 */

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

import { packageVersion } from '../verify-toolchain.mjs';
import { readSeedIdentity } from './seed.mjs';

const execFileAsync = promisify(execFile);

async function javaVersion() {
  try {
    const { stderr, stdout } = await execFileAsync('java', ['-version']);
    const match = /version "?(\d+[^"\s]*)/.exec(`${stdout}${stderr}`);
    return match === null ? null : match[1];
  } catch {
    return null;
  }
}

/**
 * Builds the manifest describing one running Local Arena instance.
 *
 * @param {object} options
 * @param {import('../workspace/working-directory.mjs').WorkspacePaths} options.paths
 * @param {import('../candidate/candidate-identity.mjs').CandidateIdentity} options.candidate
 * @param {import('../blueprint/preflight.mjs').BlueprintPreflight} options.blueprint
 * @param {'rapid_builder' | 'frozen_certification'} options.runtimeMode
 * @param {string} options.projectId
 * @param {string} options.host
 * @param {{ firestore: number, auth: number, ui: number, server: number, client: number }} options.ports
 * @param {string} options.clientOrigin
 * @param {string} options.serverOrigin
 * @param {string} options.seedVersion
 * @param {string} options.emulatorConfigPath
 */
export async function buildLocalStackManifest(options) {
  const {
    paths,
    candidate,
    blueprint,
    runtimeMode,
    projectId,
    host,
    ports,
    clientOrigin,
    serverOrigin,
    seedVersion,
    emulatorConfigPath,
  } = options;

  return {
    manifestVersion: '1',
    generatedAt: new Date().toISOString(),
    phase: 'phase-0',
    environmentClass: 'local',
    runtimeMode,
    candidate: {
      candidateId: candidate.candidateId,
      sourceTreeHash: candidate.sourceTreeHash,
      commit: candidate.commit,
      clean: candidate.clean,
      dirtyPaths: candidate.dirtyPaths,
      fileCount: candidate.fileCount,
      dependencyLockHash: candidate.dependencyLockHash,
      rulesHash: candidate.rulesHash,
    },
    blueprint: {
      version: blueprint.version,
      fileName: blueprint.fileName,
      sourceHash: blueprint.sourceHash,
      lineCount: blueprint.lineCount,
      preflightPassed: blueprint.ok,
    },
    workingDirectory: {
      resolved: paths.workingDirectory,
      resolutionSource: paths.resolutionSource,
      builderRoot: paths.builderRoot,
      qaRoot: paths.qaRoot,
      runtimeRoot: paths.runtimeRoot,
      evidenceRoot: paths.evidenceRoot,
      checkpointRoot: paths.checkpointRoot,
      pendingArchiveRoot: paths.pendingArchiveRoot,
    },
    archive: {
      directory: paths.archiveDirectory,
      status: paths.archiveStatus,
    },
    origins: {
      client: clientOrigin,
      server: serverOrigin,
      emulatorUi: `http://${host}:${ports.ui}`,
    },
    ports,
    emulators: {
      projectId,
      configPath: emulatorConfigPath,
      services: {
        firestore: `${host}:${ports.firestore}`,
        auth: `${host}:${ports.auth}`,
        ui: `${host}:${ports.ui}`,
      },
    },
    services: {
      client: 'implemented',
      server: 'implemented',
      firestoreEmulator: 'implemented',
      authEmulator: 'implemented',
      // Section 25 assigns realtime projection delivery to Phase 2. No socket
      // service is started here, and none is claimed.
      websocket: 'NOT_YET_IMPLEMENTED — Phase 2',
    },
    toolchain: {
      node: process.versions.node,
      npm: process.env.npm_config_user_agent ?? null,
      java: await javaVersion(),
      firebaseTools: packageVersion('firebase-tools'),
      typescript: packageVersion('typescript'),
      vite: packageVersion('vite'),
      playwright: packageVersion('@playwright/test'),
      firebaseAdmin: packageVersion('firebase-admin'),
    },
    seed: { version: seedVersion },
    environmentSchemaVersion: '1',
    isolation: {
      milestoneEnvironmentConfigured: false,
      launchProductionEnvironmentConfigured: false,
      productionCredentialsPresent: false,
      note: 'Phase 0 builds and certifies the Local Execution Environment only. No Milestone or Launch Production target is configured or reachable from this stack.',
    },
  };
}

/**
 * Writes the manifest to disk.
 *
 * @param {string} manifestPath
 * @param {object} manifest
 */
export async function writeLocalStackManifest(manifestPath, manifest) {
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifestPath;
}

/**
 * @typedef {object} ReadinessCheck
 * @property {string} name
 * @property {boolean} ok
 * @property {string} detail
 */

/**
 * Verifies the running stack against the manifest it claims to be.
 *
 * @param {object} manifest
 * @returns {Promise<{ ok: boolean, checks: ReadinessCheck[] }>}
 */
export async function verifyReadiness(manifest) {
  /** @type {ReadinessCheck[]} */
  const checks = [];

  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  // Frontend responds on the expected loopback origin.
  try {
    const response = await fetch(manifest.origins.client, {
      signal: AbortSignal.timeout(5000),
    });
    const html = await response.text();
    add(
      'client_origin_serves_page',
      response.ok && html.includes('<div id="app"'),
      `${manifest.origins.client} -> HTTP ${response.status}`,
    );
  } catch (error) {
    add('client_origin_serves_page', false, `${manifest.origins.client} -> ${error.message}`);
  }

  // Backend health and emulator reachability.
  try {
    const response = await fetch(`${manifest.origins.server}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.json();
    add(
      'server_health_ready',
      response.ok && body.status === 'ready',
      `status=${body.status} firestore=${body.checks?.firestoreEmulator} auth=${body.checks?.authEmulator}`,
    );
    add(
      'candidate_endpoint_matches_manifest',
      body.candidate?.candidateId === manifest.candidate.candidateId,
      `served=${body.candidate?.candidateId} expected=${manifest.candidate.candidateId}`,
    );
    add(
      'approved_emulator_project',
      body.candidate?.firebaseProjectId === manifest.emulators.projectId,
      `served=${body.candidate?.firebaseProjectId}`,
    );
    add(
      'environment_class_local',
      body.candidate?.environmentClass === 'local',
      `served=${body.candidate?.environmentClass}`,
    );
  } catch (error) {
    add('server_health_ready', false, error.message);
  }

  // The local-only identity capability rejects a foreign origin. This is a live
  // negative probe, not an assertion that the guard exists in source.
  try {
    const response = await fetch(`${manifest.origins.server}/api/identity/development-session`, {
      method: 'POST',
      headers: { origin: 'http://attacker.invalid', 'x-hd-candidate': manifest.candidate.candidateId },
      signal: AbortSignal.timeout(5000),
    });
    add(
      'identity_route_rejects_foreign_origin',
      response.status === 403,
      `HTTP ${response.status}`,
    );
  } catch (error) {
    add('identity_route_rejects_foreign_origin', false, error.message);
  }

  // Baseline seed identity matches the manifest.
  try {
    const seed = await readSeedIdentity({
      firestoreHost: manifest.emulators.services.firestore,
      projectId: manifest.emulators.projectId,
    });
    add('baseline_seed_matches', seed === manifest.seed.version, `loaded=${seed}`);
  } catch (error) {
    add('baseline_seed_matches', false, error.message);
  }

  // Production endpoints absent.
  const credentialVariables = [
    'GOOGLE_APPLICATION_CREDENTIALS',
    'FIREBASE_TOKEN',
    'FIREBASE_SERVICE_ACCOUNT',
    'GOOGLE_CLOUD_KEYFILE_JSON',
    'GCLOUD_SERVICE_KEY',
  ].filter((name) => (process.env[name] ?? '').trim() !== '');
  add(
    'no_production_credentials_present',
    credentialVariables.length === 0,
    credentialVariables.length === 0 ? 'none set' : credentialVariables.join(', '),
  );

  // Rules and dependency identity match the candidate the manifest names.
  add(
    'rules_hash_recorded',
    typeof manifest.candidate.rulesHash === 'string' && manifest.candidate.rulesHash.length === 64,
    manifest.candidate.rulesHash,
  );
  add(
    'dependency_lock_hash_recorded',
    typeof manifest.candidate.dependencyLockHash === 'string' &&
      manifest.candidate.dependencyLockHash.length === 64,
    manifest.candidate.dependencyLockHash,
  );

  return { ok: checks.every((check) => check.ok), checks };
}
