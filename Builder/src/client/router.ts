/**
 * A minimal client-side router.
 *
 * Vanilla, dependency-free, and deliberately small: it maps a location to a
 * page render, intercepts same-origin `<a data-link>` clicks so navigation
 * between the application's own pages does not reload the document, and
 * falls back to an ordinary browser navigation for everything else
 * (including the target="_blank" legal links, which are never intercepted).
 *
 * Soft navigation preserves pathname, query string, and hash so links such as
 * `/characters/new?returnCampaign=…` keep their query after a data-link click.
 */

export type RouteChangeHandler = (path: string) => void;

let activeHandler: RouteChangeHandler | null = null;
let listenersBound = false;

/** Pathname only — strips query and hash for route matching. */
export function pathnameOf(pathOrUrl: string): string {
  const noHash = pathOrUrl.split('#')[0] ?? pathOrUrl;
  const noQuery = noHash.split('?')[0] ?? noHash;
  return noQuery.length === 0 ? '/' : noQuery;
}

function locationKey(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

function currentLocationKey(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function shouldIntercept(event: MouseEvent, anchor: HTMLAnchorElement): boolean {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return false;
  }
  if (anchor.target !== '' && anchor.target !== '_self') {
    return false;
  }
  const url = new URL(anchor.href, window.location.href);
  return url.origin === window.location.origin;
}

function bindListenersOnce(): void {
  if (listenersBound) {
    return;
  }
  listenersBound = true;

  window.addEventListener('popstate', () => {
    activeHandler?.(currentLocationKey());
  });

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const anchor = target.closest('a[data-link]');
    if (!(anchor instanceof HTMLAnchorElement)) {
      return;
    }
    if (!shouldIntercept(event, anchor)) {
      return;
    }
    event.preventDefault();
    navigate(locationKey(new URL(anchor.href, window.location.href)));
  });

  // Keyboard activation (Enter) of same-origin data-link anchors must
  // soft-navigate too. preventDefault here also suppresses the follow-on
  // synthesized click so navigation runs once.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLAnchorElement) || !target.hasAttribute('data-link')) {
      return;
    }
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    if (target.target !== '' && target.target !== '_self') {
      return;
    }
    const url = new URL(target.href, window.location.href);
    if (url.origin !== window.location.origin) {
      return;
    }
    event.preventDefault();
    navigate(locationKey(url));
  });
}

/** Registers the handler invoked on every route change and renders the current path once. */
export function startRouter(handler: RouteChangeHandler): void {
  activeHandler = handler;
  bindListenersOnce();
  handler(currentLocationKey());
}

/** Navigates to `path` (pathname + optional search/hash) and invokes the active route handler. */
export function navigate(path: string, options: { readonly replace?: boolean } = {}): void {
  if (options.replace === true) {
    window.history.replaceState({}, '', path);
  } else {
    window.history.pushState({}, '', path);
  }
  activeHandler?.(path);
}
