/**
 * Browser origin checks for the application server.
 *
 * Same-origin Cloud Run requests send `Origin: https://<service>.run.app`.
 * Firebase App Hosting sits in front of that process: the browser Origin is
 * `https://<backend>--<project>.<region>.hosted.app`, while Node often sees a
 * different `Host` (the internal Cloud Run URL). Vite also marks scripts and
 * styles `crossorigin`, so those GETs carry Origin and must be allowed or the
 * page stays on the skip link with an empty `#app`.
 *
 * If HD_CLIENT_ORIGIN is still a placeholder from the first publish, those
 * public origins must still be accepted.
 */

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const DEFAULT_APP_HOSTING_REGION = 'us-central1';

export interface OriginGuardOptions {
  readonly origin: string | undefined;
  readonly method: string;
  readonly clientOrigin: string;
  readonly hostHeader: string | undefined;
  readonly hosted: boolean;
  readonly forwardedHostHeader?: string | undefined;
  readonly cloudRunService?: string | undefined;
  readonly firebaseProjectId?: string | undefined;
  readonly appHostingRegion?: string | undefined;
  /**
   * HTML, CSS, JS, and other non-`/api/` paths. Hosted safe methods always
   * pass so a public `*.hosted.app` Origin cannot blank the shell.
   */
  readonly staticResource?: boolean;
}

export function servingOriginFromHost(hostHeader: string | undefined): string | null {
  if (hostHeader === undefined) {
    return null;
  }
  const host = hostHeader.split(',')[0]?.trim().toLowerCase() ?? '';
  if (host === '' || /[\s/]/.test(host)) {
    return null;
  }
  return `https://${host}`;
}

/**
 * Firebase App Hosting default URL:
 * `https://<K_SERVICE>--<projectId>.<region>.hosted.app`
 */
export function appHostingPublicOrigin(options: {
  readonly cloudRunService: string | undefined;
  readonly firebaseProjectId: string | undefined;
  readonly region?: string | undefined;
}): string | null {
  const service = options.cloudRunService?.trim().toLowerCase() ?? '';
  const project = options.firebaseProjectId?.trim().toLowerCase() ?? '';
  const region = (options.region ?? DEFAULT_APP_HOSTING_REGION).trim().toLowerCase();
  if (service === '' || project === '' || region === '' || /[\s/]/.test(service + project + region)) {
    return null;
  }
  return `https://${service}--${project}.${region}.hosted.app`;
}

export function allowedBrowserOrigins(options: {
  readonly clientOrigin: string;
  readonly hostHeader: string | undefined;
  readonly hosted: boolean;
  readonly forwardedHostHeader?: string | undefined;
  readonly cloudRunService?: string | undefined;
  readonly firebaseProjectId?: string | undefined;
  readonly appHostingRegion?: string | undefined;
}): ReadonlySet<string> {
  const allowed = new Set([options.clientOrigin]);
  if (!options.hosted) {
    return allowed;
  }
  const serving = servingOriginFromHost(options.hostHeader);
  if (serving !== null) {
    allowed.add(serving);
  }
  const forwarded = servingOriginFromHost(options.forwardedHostHeader);
  if (forwarded !== null) {
    allowed.add(forwarded);
  }
  const appHosting = appHostingPublicOrigin({
    cloudRunService: options.cloudRunService,
    firebaseProjectId: options.firebaseProjectId,
    region: options.appHostingRegion,
  });
  if (appHosting !== null) {
    allowed.add(appHosting);
  }
  return allowed;
}

function allowlistFrom(options: OriginGuardOptions): ReadonlySet<string> {
  return allowedBrowserOrigins({
    clientOrigin: options.clientOrigin,
    hostHeader: options.hostHeader,
    hosted: options.hosted,
    forwardedHostHeader: options.forwardedHostHeader,
    cloudRunService: options.cloudRunService,
    firebaseProjectId: options.firebaseProjectId,
    appHostingRegion: options.appHostingRegion,
  });
}

export function isAllowedBrowserOrigin(options: OriginGuardOptions): boolean {
  const allowed = allowlistFrom(options);
  const method = options.method.toUpperCase();
  if (MUTATING_METHODS.has(method)) {
    return options.origin !== undefined && allowed.has(options.origin);
  }
  if (options.hosted && options.staticResource === true && SAFE_METHODS.has(method)) {
    return true;
  }
  return options.origin === undefined || allowed.has(options.origin);
}

export function corsAllowOrigin(
  options: Omit<OriginGuardOptions, 'method'> & { readonly method?: string },
): string {
  const method = (options.method ?? 'GET').toUpperCase();
  if (
    options.origin !== undefined &&
    options.hosted &&
    options.staticResource === true &&
    SAFE_METHODS.has(method)
  ) {
    return options.origin;
  }
  if (
    options.origin !== undefined &&
    isAllowedBrowserOrigin({
      ...options,
      method: 'GET',
      staticResource: false,
    })
  ) {
    return options.origin;
  }
  return options.clientOrigin;
}
