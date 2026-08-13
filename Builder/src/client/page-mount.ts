/**
 * Marks a page mount on a container so remounts invalidate prior listeners.
 * Prefer this over MutationObserver: replacing innerHTML during render is not
 * an unmount, and observers that treat it as one will kill in-flight pages.
 */

const MOUNT_KEY = '__hdPageMount';

export function beginPageMount(container: HTMLElement): symbol {
  const token = Symbol('page-mount');
  (container as HTMLElement & { [MOUNT_KEY]?: symbol })[MOUNT_KEY] = token;
  return token;
}

export function isPageMountCurrent(container: HTMLElement, token: symbol): boolean {
  return (container as HTMLElement & { [MOUNT_KEY]?: symbol })[MOUNT_KEY] === token;
}
