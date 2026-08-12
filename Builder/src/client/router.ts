/**
 * A minimal client-side router.
 *
 * Vanilla, dependency-free, and deliberately small: it maps a pathname to a
 * page render, intercepts same-origin `<a data-link>` clicks so navigation
 * between the application's own pages does not reload the document, and
 * falls back to an ordinary browser navigation for everything else
 * (including the target="_blank" legal links, which are never intercepted).
 */

export type RouteChangeHandler = (path: string) => void;

let activeHandler: RouteChangeHandler | null = null;
let listenersBound = false;

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
    activeHandler?.(window.location.pathname);
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
    navigate(new URL(anchor.href, window.location.href).pathname);
  });
}

/** Registers the handler invoked on every route change and renders the current path once. */
export function startRouter(handler: RouteChangeHandler): void {
  activeHandler = handler;
  bindListenersOnce();
  handler(window.location.pathname);
}

/** Navigates to `path` using the History API and invokes the active route handler. */
export function navigate(path: string, options: { readonly replace?: boolean } = {}): void {
  if (options.replace === true) {
    window.history.replaceState({}, '', path);
  } else {
    window.history.pushState({}, '', path);
  }
  activeHandler?.(path);
}
