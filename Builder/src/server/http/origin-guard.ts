/**
 * Browser origin checks for the application server.
 *
 * Same-origin Cloud Run requests send `Origin: https://<service>.run.app`.
 * If HD_CLIENT_ORIGIN is still a placeholder from the first publish, those
 * requests must still be accepted or the CSS/JS never load.
 */

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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

export function allowedBrowserOrigins(options: {
  readonly clientOrigin: string;
  readonly hostHeader: string | undefined;
  readonly hosted: boolean;
}): ReadonlySet<string> {
  const allowed = new Set([options.clientOrigin]);
  if (options.hosted) {
    const serving = servingOriginFromHost(options.hostHeader);
    if (serving !== null) {
      allowed.add(serving);
    }
  }
  return allowed;
}

export function isAllowedBrowserOrigin(options: {
  readonly origin: string | undefined;
  readonly method: string;
  readonly clientOrigin: string;
  readonly hostHeader: string | undefined;
  readonly hosted: boolean;
}): boolean {
  const allowed = allowedBrowserOrigins({
    clientOrigin: options.clientOrigin,
    hostHeader: options.hostHeader,
    hosted: options.hosted,
  });
  const method = options.method.toUpperCase();
  if (MUTATING_METHODS.has(method)) {
    return options.origin !== undefined && allowed.has(options.origin);
  }
  return options.origin === undefined || allowed.has(options.origin);
}

export function corsAllowOrigin(options: {
  readonly origin: string | undefined;
  readonly clientOrigin: string;
  readonly hostHeader: string | undefined;
  readonly hosted: boolean;
}): string {
  if (
    options.origin !== undefined &&
    isAllowedBrowserOrigin({
      origin: options.origin,
      method: 'GET',
      clientOrigin: options.clientOrigin,
      hostHeader: options.hostHeader,
      hosted: options.hosted,
    })
  ) {
    return options.origin;
  }
  return options.clientOrigin;
}
