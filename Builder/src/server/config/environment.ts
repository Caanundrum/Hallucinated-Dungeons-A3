/**
 * Environment schema and fail-closed local isolation guards.
 *
 * Blueprint ownership: Sections 1.11.6 (three-environment authority), 1.11.8
 * (Local Arena and fail-closed isolation), 1.14.3 (secret and environment
 * isolation), and 25 Phase 0 ("local-only environment guards").
 *
 * The rule this file enforces: an ordinary local run must be structurally
 * incapable of reaching a live project, a public origin, or a production
 * credential. Anything ambiguous fails startup instead of degrading quietly.
 */

import {
  ENVIRONMENT_CLASSES,
  ENVIRONMENT_SCHEMA_VERSION,
  RUNTIME_MODES,
  type EnvironmentClass,
  type RuntimeMode,
} from '../../shared/contract.js';

export interface HostPort {
  readonly host: string;
  readonly port: number;
}

export interface ServerEnvironment {
  readonly environmentSchemaVersion: string;
  readonly environmentClass: EnvironmentClass;
  readonly runtimeMode: RuntimeMode;
  readonly candidateId: string;
  readonly blueprintVersion: string;
  readonly firebaseProjectId: string;
  readonly firestoreEmulator: HostPort;
  readonly authEmulator: HostPort;
  readonly serverHost: string;
  readonly serverPort: number;
  readonly clientOrigin: string;
  readonly seedVersion: string;
  /** Absolute directory of the built client bundle, or null in Rapid Builder Mode. */
  readonly clientBundleDir: string | null;
}

export class EnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvironmentError';
  }
}

/**
 * Every `HD_*` variable this candidate understands. An unrecognized `HD_*`
 * variable is rejected rather than ignored, because a silently ignored
 * variable is how a stale or mixed environment reaches a running process.
 */
const KNOWN_HD_VARIABLES = new Set([
  'HD_ENV_SCHEMA_VERSION',
  'HD_ENVIRONMENT_CLASS',
  'HD_RUNTIME_MODE',
  'HD_CANDIDATE_ID',
  'HD_BLUEPRINT_VERSION',
  'HD_FIREBASE_PROJECT_ID',
  'HD_FIRESTORE_EMULATOR_HOST',
  'HD_AUTH_EMULATOR_HOST',
  'HD_SERVER_HOST',
  'HD_SERVER_PORT',
  'HD_CLIENT_ORIGIN',
  'HD_CLIENT_BUNDLE_DIR',
  'HD_SEED_VERSION',
  'HD_WORKING_DIRECTORY',
  'HD_ARCHIVE_DIRECTORY',
]);

/**
 * Credential-bearing variables that must never be present during a local run.
 * Their presence means the process could authenticate against a real Google
 * Cloud project, which Section 1.11.8 forbids for ordinary local execution.
 */
const PROHIBITED_LOCAL_CREDENTIAL_VARIABLES = [
  'GOOGLE_APPLICATION_CREDENTIALS',
  'FIREBASE_TOKEN',
  'FIREBASE_SERVICE_ACCOUNT',
  'GOOGLE_CLOUD_KEYFILE_JSON',
  'GCLOUD_SERVICE_KEY',
];

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Project identifier the Local Arena is permitted to bind to. */
export const LOCAL_PROJECT_ID = 'hallucinated-dungeons-local';

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    throw new EnvironmentError(
      `Missing required environment variable ${name}. Start the stack through "npm run arena:start" so the Local Stack Manifest and environment are produced together.`,
    );
  }
  return value.trim();
}

function parseHostPort(name: string, raw: string): HostPort {
  const match = /^(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(raw);
  if (!match) {
    throw new EnvironmentError(`${name} must use the form host:port. Received "${raw}".`);
  }
  const host = match[1]!;
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new EnvironmentError(`${name} has an out-of-range port. Received "${raw}".`);
  }
  return { host, port };
}

function assertLoopback(name: string, host: string): void {
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new EnvironmentError(
      `${name} must resolve to a loopback host in the Local Arena. Received "${host}". Local execution may not target a public or shared service.`,
    );
  }
}

function parseOrigin(name: string, raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EnvironmentError(`${name} must be an absolute origin URL. Received "${raw}".`);
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new EnvironmentError(
      `${name} must be a bare origin without path, query, or fragment. Received "${raw}".`,
    );
  }
  return url;
}

function assertNoProhibitedCredentials(env: NodeJS.ProcessEnv): void {
  const present = PROHIBITED_LOCAL_CREDENTIAL_VARIABLES.filter(
    (name) => (env[name] ?? '').trim() !== '',
  );
  if (present.length > 0) {
    throw new EnvironmentError(
      `Local execution refuses to start while production credential variables are set: ${present.join(', ')}. Unset them before running the Local Arena.`,
    );
  }
}

function assertNoUnknownHdVariables(env: NodeJS.ProcessEnv): void {
  const unknown = Object.keys(env)
    .filter((name) => name.startsWith('HD_'))
    .filter((name) => !KNOWN_HD_VARIABLES.has(name))
    .sort();
  if (unknown.length > 0) {
    throw new EnvironmentError(
      `Unrecognized HD_* environment variable(s): ${unknown.join(', ')}. Schema version ${ENVIRONMENT_SCHEMA_VERSION} does not define them, so the environment is refused rather than partially applied.`,
    );
  }
}

/**
 * Reads, validates, and freezes the environment for one server process.
 * Throws {@link EnvironmentError} with an operator-readable reason on any
 * missing, unknown, mixed, or non-local configuration.
 */
export function loadServerEnvironment(env: NodeJS.ProcessEnv = process.env): ServerEnvironment {
  assertNoUnknownHdVariables(env);

  const schemaVersion = required(env, 'HD_ENV_SCHEMA_VERSION');
  if (schemaVersion !== ENVIRONMENT_SCHEMA_VERSION) {
    throw new EnvironmentError(
      `HD_ENV_SCHEMA_VERSION is "${schemaVersion}" but this candidate implements schema "${ENVIRONMENT_SCHEMA_VERSION}".`,
    );
  }

  const environmentClass = required(env, 'HD_ENVIRONMENT_CLASS') as EnvironmentClass;
  if (!ENVIRONMENT_CLASSES.includes(environmentClass)) {
    throw new EnvironmentError(
      `HD_ENVIRONMENT_CLASS must be one of ${ENVIRONMENT_CLASSES.join(', ')}. Received "${environmentClass}".`,
    );
  }
  if (environmentClass !== 'local') {
    throw new EnvironmentError(
      `This candidate implements the Local Execution Environment only. The "${environmentClass}" environment class is introduced by the phase that owns hosted publication, so it is refused here instead of being partially honored.`,
    );
  }

  assertNoProhibitedCredentials(env);

  const runtimeMode = required(env, 'HD_RUNTIME_MODE') as RuntimeMode;
  if (!RUNTIME_MODES.includes(runtimeMode)) {
    throw new EnvironmentError(
      `HD_RUNTIME_MODE must be one of ${RUNTIME_MODES.join(', ')}. Received "${runtimeMode}".`,
    );
  }

  const firebaseProjectId = required(env, 'HD_FIREBASE_PROJECT_ID');
  if (firebaseProjectId !== LOCAL_PROJECT_ID) {
    throw new EnvironmentError(
      `Local execution binds only to the emulator project "${LOCAL_PROJECT_ID}". Received "${firebaseProjectId}".`,
    );
  }

  const firestoreEmulator = parseHostPort(
    'HD_FIRESTORE_EMULATOR_HOST',
    required(env, 'HD_FIRESTORE_EMULATOR_HOST'),
  );
  assertLoopback('HD_FIRESTORE_EMULATOR_HOST', firestoreEmulator.host);

  const authEmulator = parseHostPort(
    'HD_AUTH_EMULATOR_HOST',
    required(env, 'HD_AUTH_EMULATOR_HOST'),
  );
  assertLoopback('HD_AUTH_EMULATOR_HOST', authEmulator.host);

  const serverHost = required(env, 'HD_SERVER_HOST');
  assertLoopback('HD_SERVER_HOST', serverHost);

  const serverPortRaw = required(env, 'HD_SERVER_PORT');
  const serverPort = Number(serverPortRaw);
  if (!Number.isInteger(serverPort) || serverPort <= 0 || serverPort > 65535) {
    throw new EnvironmentError(`HD_SERVER_PORT must be a valid port. Received "${serverPortRaw}".`);
  }

  const clientOriginUrl = parseOrigin('HD_CLIENT_ORIGIN', required(env, 'HD_CLIENT_ORIGIN'));
  assertLoopback('HD_CLIENT_ORIGIN', clientOriginUrl.hostname);
  if (clientOriginUrl.protocol !== 'http:') {
    throw new EnvironmentError(
      `HD_CLIENT_ORIGIN must use http on loopback in the Local Arena. Received "${clientOriginUrl.protocol}".`,
    );
  }

  const clientBundleDir = (env.HD_CLIENT_BUNDLE_DIR ?? '').trim();
  if (runtimeMode === 'frozen_certification' && clientBundleDir === '') {
    throw new EnvironmentError(
      'HD_CLIENT_BUNDLE_DIR is required in frozen_certification mode: the frozen runtime serves the built bundle rather than a hot-reloading dev server.',
    );
  }

  return {
    environmentSchemaVersion: schemaVersion,
    environmentClass,
    runtimeMode,
    candidateId: required(env, 'HD_CANDIDATE_ID'),
    blueprintVersion: required(env, 'HD_BLUEPRINT_VERSION'),
    firebaseProjectId,
    firestoreEmulator,
    authEmulator,
    serverHost,
    serverPort,
    clientOrigin: clientOriginUrl.origin,
    seedVersion: required(env, 'HD_SEED_VERSION'),
    clientBundleDir: clientBundleDir === '' ? null : clientBundleDir,
  };
}

/**
 * Redacts values that look like credentials so environment problems can be
 * logged without leaking secret material (Section 1.14.3).
 */
export function redactEnvironmentForLog(env: NodeJS.ProcessEnv): Record<string, string> {
  const secretish = /(KEY|TOKEN|SECRET|CREDENTIAL|PASSWORD)/i;
  const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('HD_') && !name.startsWith('FIRE') && !name.startsWith('GOOGLE')) {
      continue;
    }
    output[name] = secretish.test(name) ? '[redacted]' : (value ?? '');
  }
  return output;
}
