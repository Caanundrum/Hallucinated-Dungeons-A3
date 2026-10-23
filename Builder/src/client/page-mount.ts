/**
 * Marks a page mount on a container so remounts invalidate prior listeners.
 * Prefer this over MutationObserver: replacing innerHTML during render is not
 * an unmount, and observers that treat it as one will kill in-flight pages.
 */

const MOUNT_KEY = '__hdPageMount';
const CLEANUP_KEY = '__hdPageCleanups';

type MountedContainer = HTMLElement & {
  [MOUNT_KEY]?: symbol;
  [CLEANUP_KEY]?: Array<() => void>;
};

export function runPageCleanups(container: HTMLElement): void {
  const host = container as MountedContainer;
  const cleanups = host[CLEANUP_KEY];
  if (cleanups && cleanups.length > 0) {
    host[CLEANUP_KEY] = [];
    for (const fn of cleanups) {
      try {
        fn();
      } catch {
        // Best-effort page teardown.
      }
    }
  }
}

export function beginPageMount(container: HTMLElement): symbol {
  runPageCleanups(container);
  const token = Symbol('page-mount');
  const host = container as MountedContainer;
  host[MOUNT_KEY] = token;
  host[CLEANUP_KEY] = [];
  return token;
}

export function registerPageCleanup(
  container: HTMLElement,
  token: symbol,
  cleanup: () => void,
): void {
  const host = container as MountedContainer;
  if (host[MOUNT_KEY] !== token) {
    try {
      cleanup();
    } catch {
      // Best-effort teardown when already unmounted.
    }
    return;
  }
  if (!host[CLEANUP_KEY]) {
    host[CLEANUP_KEY] = [];
  }
  host[CLEANUP_KEY]!.push(cleanup);
}

export function isPageMountCurrent(container: HTMLElement, token: symbol): boolean {
  return (container as MountedContainer)[MOUNT_KEY] === token;
}
