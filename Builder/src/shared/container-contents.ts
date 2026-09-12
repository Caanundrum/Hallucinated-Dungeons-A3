/**
 * Container contents authorship — separate from open/closed leaf state.
 *
 * Missing contents means unauthored (honest limitation). Empty array means
 * authored empty. Discovery tracks what the party has actually learned.
 */

export const CONTENTS_DISCOVERY_STATES = ['hidden', 'visible', 'searched', 'taken'] as const;
export type ContentsDiscoveryState = (typeof CONTENTS_DISCOVERY_STATES)[number];

export interface AuthoredContentItem {
  readonly itemId: string;
  readonly label: string;
  /** When true, item is already removed into a character inventory. */
  readonly taken?: boolean;
}

export interface ContainerContentsView {
  /** null = unauthored; [] = authored empty; otherwise remaining items. */
  readonly contents: readonly AuthoredContentItem[] | null;
  readonly discovery: ContentsDiscoveryState;
  readonly open: boolean;
}

export interface ContainerContentsAnswer {
  readonly ok: boolean;
  readonly body: string;
  readonly nextDiscovery: ContentsDiscoveryState;
}

export function answerContainerContentsQuery(options: {
  readonly containerLabel: string;
  readonly view: ContainerContentsView;
  readonly wantsTake?: boolean;
}): ContainerContentsAnswer {
  const label = options.containerLabel.trim() || 'the container';
  const { contents, discovery, open } = options.view;

  if (!open && discovery === 'hidden') {
    return {
      ok: false,
      body: `${label} is closed. Open it before you can see inside — looking from here does not invent contents.`,
      nextDiscovery: discovery,
    };
  }

  if (contents === null) {
    return {
      ok: true,
      body: open
        ? `${label} is open, but no contents are authored for it on this table. Nothing to list, take, or invent — try another prop or ask the Director what avenues remain.`
        : `${label} has no authored contents on this table. Opening it will not create loot that was never written.`,
      nextDiscovery: open ? 'searched' : discovery,
    };
  }

  const remaining = contents.filter((item) => item.taken !== true);
  if (options.wantsTake) {
    if (remaining.length === 0) {
      return {
        ok: true,
        body:
          contents.length === 0
            ? `${label} is empty — there is nothing to take.`
            : `Everything that was in ${label} has already been taken.`,
        nextDiscovery: 'taken',
      };
    }
    const first = remaining[0]!;
    return {
      ok: true,
      body: `You can take ${first.label} from ${label}. Confirm a take declaration naming that item when the table supports inventory commits.`,
      nextDiscovery: remaining.length <= 1 ? 'taken' : 'searched',
    };
  }

  if (remaining.length === 0) {
    return {
      ok: true,
      body:
        contents.length === 0
          ? `You look inside ${label}. It is empty.`
          : `You look inside ${label}. Nothing remains — its contents were already taken.`,
      nextDiscovery: contents.length === 0 ? 'searched' : 'taken',
    };
  }

  const list = remaining.map((item) => item.label).join(', ');
  return {
    ok: true,
    body:
      discovery === 'hidden' && !open
        ? `${label} still conceals its contents until opened.`
        : `Inside ${label} you can make out: ${list}.`,
    nextDiscovery: 'searched',
  };
}

/** Infer a container label hint from declaration text for matching. */
export function containerLabelHintFromText(text: string): string | null {
  const match = text.match(
    /\b(?:the\s+)?(courier\s+satchel|satchel|pack|bag|crate|crates|chest|box|barrel|urn|pouch)\b/i,
  );
  return match?.[1]?.toLowerCase() ?? null;
}
