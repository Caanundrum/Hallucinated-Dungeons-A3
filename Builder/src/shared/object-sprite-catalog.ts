/**
 * Shared Top-Down Object Sprite Catalog & Deterministic Key/Icon Resolver (Packet 4).
 *
 * Maps any scene/map feature (`container`, `light`, `lever`/`mechanism`, `prop`/`cover`,
 * `hazard`/`trap`, `exit`) to a canonical `kind:archetype:state` key and a rich,
 * multi-layered top-down illustrated tabletop icon (`data:image/svg+xml;utf8,...`)
 * so no map object ever renders as a generic geometric circle, square, or diamond dot.
 */

export type ObjectSpriteKey = string;

export interface ObjectSpriteDescriptor {
  readonly spriteKey: ObjectSpriteKey;
  readonly spriteUrl: string;
  readonly imagenPrompt: string;
}

export function resolveObjectSpriteKey(feature: {
  readonly label: string;
  readonly objectKind?: string | null | undefined;
  readonly referenceKind?: string | null | undefined;
  readonly objectState?: string | null | undefined;
  readonly state?: string | null | undefined;
  readonly lockState?: 'unlocked' | 'locked' | null | undefined;
}): ObjectSpriteKey {
  const rawLabel = feature.label ?? '';
  const lower = rawLabel.toLowerCase();
  const objKind = (feature.objectKind ?? '').toLowerCase();
  const refKind = (feature.referenceKind ?? '').toLowerCase();
  const rawState = (feature.objectState ?? feature.state ?? '').toLowerCase();
  const isOpen =
    rawState === 'open' ||
    rawState === 'pulled' ||
    rawState === 'active' ||
    /\(\s*(?:open|pulled|active)\s*\)/i.test(rawLabel) ||
    /[—–-]\s*open\b/i.test(rawLabel);
  const isLocked =
    !isOpen &&
    (feature.lockState === 'locked' ||
      rawState === 'locked' ||
      /\(\s*locked\s*\)/i.test(rawLabel) ||
      /[—–-]\s*locked\b/i.test(rawLabel));

  // 1. Exit markers (`exit:archway:open` / `exit:archway:locked`)
  if (objKind === 'exit' || refKind === 'exit') {
    return `exit:archway:${isLocked ? 'locked' : 'open'}`;
  }

  // 2. Mechanisms (`mechanism:lever:closed` / `mechanism:lever:open`, `winch`, `switch`)
  if (
    objKind === 'lever' ||
    /\b(?:lever|switch|winch|crank|pulley|valve|dial|mechanism)\b/i.test(lower)
  ) {
    const archetype = /\b(?:winch|crank|pulley|wheel)\b/i.test(lower)
      ? 'winch'
      : /\b(?:switch|button|plate|dial)\b/i.test(lower)
        ? 'switch'
        : 'lever';
    return `mechanism:${archetype}:${isOpen ? 'open' : 'closed'}`;
  }

  // 3. Containers (`container:chest:closed`, `container:chest:open`, `container:trunk:closed`, `container:trunk:open`, etc.)
  if (
    objKind === 'container' ||
    /\b(?:trunk|chest|crate|strongbox|lockbox|coffer|casket|satchel|pack|bag|pouch|barrel|cask|urn)\b/i.test(
      lower,
    )
  ) {
    const archetype = /\b(?:trunk|coffer|casket)\b/i.test(lower)
      ? 'trunk'
      : /\b(?:strongbox|lockbox|safe)\b/i.test(lower)
        ? 'strongbox'
        : /\b(?:crate|box)\b/i.test(lower)
          ? 'crate'
          : /\b(?:satchel|pack|bag|pouch|sack)\b/i.test(lower)
            ? 'satchel'
            : /\b(?:barrel|cask|keg|urn)\b/i.test(lower)
              ? 'barrel'
              : 'chest';
    return `container:${archetype}:${isOpen ? 'open' : 'closed'}`;
  }

  // 4. Light sources (`light:lantern:lit`, `light:lantern:unlit`, `light:brazier:lit`)
  if (
    objKind === 'light' ||
    refKind === 'lighting' ||
    /\b(?:lantern|lamp|torch|sconce|brazier|candle|candelabra)\b/i.test(lower)
  ) {
    const archetype = /\b(?:brazier|hearth|firepit)\b/i.test(lower)
      ? 'brazier'
      : /\b(?:torch|sconce)\b/i.test(lower)
        ? 'torch'
        : 'lantern';
    const isUnlit = rawState === 'unlit' || /\(\s*unlit\s*\)|\bunlit\b/i.test(lower);
    return `light:${archetype}:${isUnlit ? 'unlit' : 'lit'}`;
  }

  // 5. Traps & Hazards (`hazard:trap:active`, `hazard:trap:disarmed`)
  if (
    objKind === 'trap' ||
    objKind === 'hazard' ||
    refKind === 'hazard' ||
    /\b(?:trap|snare|tripwire|pressure\s+plate|glyph|hazard|pit)\b/i.test(lower)
  ) {
    const isDisarmed = rawState === 'disarmed' || rawState === 'inactive' || /\bdisarmed\b/i.test(lower);
    return `hazard:trap:${isDisarmed ? 'disarmed' : 'active'}`;
  }

  // 6. Props / Support Surfaces / Cover (`prop:workbench:default`, `prop:table:default`, `prop:altar:default`, etc.)
  const propArchetype = /\b(?:workbench|bench|counter|bar|anvil|forge)\b/i.test(lower)
    ? 'workbench'
    : /\b(?:table|desk)\b/i.test(lower)
      ? 'table'
      : /\b(?:altar|pedestal|shrine|dais)\b/i.test(lower)
        ? 'altar'
        : /\b(?:shelf|shelves|bookshelf|rack|cabinet)\b/i.test(lower)
          ? 'bookshelf'
          : /\b(?:ledger|book|journal|register|scroll|map|note|letter|tome|manifest|papers)\b/i.test(
                lower,
              )
            ? 'ledger'
            : /\b(?:pillar|column|statue|rubble|boulder)\b/i.test(lower)
              ? 'pillar'
              : 'workbench';
  return `prop:${propArchetype}:default`;
}

export function buildImagenObjectSpritePrompt(spriteKey: string): string {
  const [kind = 'prop', archetype = 'workbench', state = 'default'] = spriteKey.split(':');
  const subjectMap: Record<string, string> = {
    'container:chest:closed':
      'a closed medieval oak treasure chest bound with wrought-iron straps and a brass lockplate',
    'container:chest:open':
      'an open medieval oak treasure chest with lid thrown back revealing parchment scrolls, coins, and Adventurer gear inside',
    'container:trunk:closed':
      'a closed iron-hasped leather-and-timber travel trunk with brass corner brackets and heavy latches',
    'container:trunk:open':
      'an open iron-hasped travel trunk with its hinged lid open revealing neatly packed supplies, vials, and folded parchment inside',
    'container:strongbox:closed':
      'a closed heavy riveted iron strongbox with an ornate brass keyhole plate',
    'container:strongbox:open':
      'an open riveted iron strongbox with lid open showing velvet lining, documents, and silver tokens',
    'container:crate:closed':
      'a closed slatted wooden cargo crate reinforced with iron corner nails',
    'container:crate:open':
      'an open wooden cargo crate with pried-off top planks revealing straw packing and supplies inside',
    'container:satchel:closed':
      'a buckled weathered leather courier satchel with brass clasps resting flat',
    'container:satchel:open':
      'an unbuckled open leather courier satchel with rolled scrolls and a brass tool peeking out',
    'container:barrel:closed':
      'a bound oak storage barrel with iron hoops viewed from directly overhead',
    'container:barrel:open':
      'an open-topped oak storage barrel with iron hoops showing provisions inside',
    'light:lantern:lit':
      'a wrought-iron hooded tabletop lantern glowing with warm golden-amber flame light',
    'light:lantern:unlit':
      'an unlit cold wrought-iron hooded tabletop lantern with dark glass panes',
    'light:brazier:lit':
      'a bronze dungeon brazier burning with bright orange-gold coals and embers',
    'light:brazier:unlit':
      'an unlit bronze dungeon brazier filled with cold grey ash and charred coals',
    'light:torch:lit':
      'a wall-mounted iron torch sconce burning with warm flickering amber fire',
    'light:torch:unlit':
      'an unlit iron torch sconce with charred wood tip',
    'mechanism:lever:closed':
      'a heavy stone-and-iron dungeon wall lever mechanism in its upright reset position',
    'mechanism:lever:open':
      'a heavy stone-and-iron dungeon wall lever mechanism pulled forward into its activated open position with glowing brass gears',
    'mechanism:winch:closed':
      'a heavy iron gate winch and chain drum locked in its wound closed state',
    'mechanism:winch:open':
      'a heavy iron gate winch and chain drum released in its unwound open state',
    'mechanism:switch:closed':
      'a carved stone mechanism switch plate in its unpressed reset state',
    'mechanism:switch:open':
      'a carved stone mechanism switch plate depressed and glowing with amber runes',
    'prop:workbench:default':
      'a weathered wooden artisan workbench scattered with a ledger book, brass calipers, inkwell, and tools',
    'prop:table:default':
      'a heavy timber table with a parchment chart, candle stub, and iron key',
    'prop:altar:default':
      'a carved stone ritual pedestal and altar inlaid with weathered bronze reliefs',
    'prop:bookshelf:default':
      'a dark oak archive bookshelf packed with leather-bound tomes and rolled scrolls',
    'prop:ledger:default':
      'an open leather-bound register ledger book with handwritten ink entries and a brass quill',
    'prop:pillar:default':
      'a weathered carved stone dungeon column and rubble cover block',
    'hazard:trap:active':
      'a concealed mechanical floor pressure-plate trap with bronze tripwire teeth',
    'hazard:trap:disarmed':
      'a disarmed mechanical floor trap with wedged gears and cut tripwire',
    'exit:archway:open':
      'an open stone dungeon archway threshold with a glowing directional compass chevron leading onward',
    'exit:archway:locked':
      'a sealed iron-bound stone archway threshold barred by a heavy lock and iron portcullis',
  };
  const description =
    subjectMap[spriteKey] ??
    `a fantasy tabletop RPG ${archetype} (${kind}, ${state} state)`;
  return `Isolated orthographic 90-degree top-down 2D tabletop RPG map object icon of ${description}, centered on a uniform solid pure black (#000000) background, hand-painted dark-fantasy game asset, crisp edges, no floor tiles, no text, no border frame.`;
}

function encodeSvgDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.replace(/\s+/g, ' ').trim())}`;
}

/**
 * Generates a rich, multi-layered top-down illustrated SVG sprite data-URI for every
 * canonical `kind:archetype:state` key so map objects always render as recognizable
 * tabletop artwork (never a geometric dot).
 */
export function buildIllustratedObjectSpriteDataUrl(spriteKey: string): string {
  const [kind = 'prop', archetype = 'workbench', state = 'default'] = spriteKey.split(':');

  if (kind === 'container') {
    const isOpen = state === 'open';
    const isTrunk = archetype === 'trunk';
    const isStrongbox = archetype === 'strongbox';
    const isCrate = archetype === 'crate';
    const isSatchel = archetype === 'satchel';
    const isBarrel = archetype === 'barrel';

    if (isBarrel) {
      return encodeSvgDataUrl(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
          <circle cx="32" cy="34" r="23" fill="#0d0906" opacity="0.55"/>
          <circle cx="32" cy="32" r="21" fill="#6e4726" stroke="#1e130a" stroke-width="2.5"/>
          <circle cx="32" cy="32" r="18" fill="none" stroke="#3c2817" stroke-width="2"/>
          <line x1="15" y1="24" x2="49" y2="24" stroke="#2a1a0e" stroke-width="1.6"/>
          <line x1="13" y1="32" x2="51" y2="32" stroke="#2a1a0e" stroke-width="1.6"/>
          <line x1="15" y1="40" x2="49" y2="40" stroke="#2a1a0e" stroke-width="1.6"/>
          ${
            isOpen
              ? `<circle cx="32" cy="32" r="13" fill="#23170d" stroke="#d4af37" stroke-width="1.5"/>
                 <circle cx="28" cy="29" r="4" fill="#e5c158"/>
                 <rect x="31" y="28" width="8" height="6" rx="1" fill="#d9ccb4" transform="rotate(18 35 31)"/>`
              : `<circle cx="25" cy="26" r="3" fill="#2a1a0e" stroke="#9c7a44" stroke-width="1.2"/>`
          }
        </svg>
      `);
    }

    if (isSatchel) {
      return encodeSvgDataUrl(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
          <ellipse cx="32" cy="36" rx="22" ry="17" fill="#0d0906" opacity="0.55"/>
          <path d="M14 24 Q32 16 50 24 L52 44 Q32 50 12 44 Z" fill="#7c4d25" stroke="#1e130a" stroke-width="2.5"/>
          <path d="M16 24 Q32 32 48 24" fill="none" stroke="#c89d54" stroke-width="2"/>
          <rect x="23" y="22" width="4" height="16" rx="1.5" fill="#4a2c14" stroke="#d4af37" stroke-width="1"/>
          <rect x="37" y="22" width="4" height="16" rx="1.5" fill="#4a2c14" stroke="#d4af37" stroke-width="1"/>
          ${
            isOpen
              ? `<rect x="24" y="14" width="16" height="11" rx="2" fill="#efe2c4" stroke="#5c4328" stroke-width="1.5"/>
                 <circle cx="32" cy="29" r="3.5" fill="#f3c65f"/>`
              : `<rect x="29" y="28" width="6" height="6" rx="1" fill="#d4af37" stroke="#1e130a" stroke-width="1"/>`
          }
        </svg>
      `);
    }

    const bodyFill = isStrongbox ? '#4a525a' : isCrate ? '#8b6239' : isTrunk ? '#5c3a21' : '#734827';
    const bandFill = isStrongbox ? '#9ea7b0' : isTrunk ? '#3b4248' : '#3a2e24';
    const trimStroke = isOpen ? '#f0c868' : '#c89d54';
    return encodeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
        <rect x="8" y="16" width="48" height="36" rx="5" fill="#0d0906" opacity="0.58"/>
        ${
          isOpen
            ? `<rect x="10" y="9" width="44" height="13" rx="3" fill="${bodyFill}" stroke="#1a1109" stroke-width="2"/>
               <rect x="10" y="22" width="44" height="26" rx="4" fill="#1e140c" stroke="${trimStroke}" stroke-width="2.2"/>
               <rect x="14" y="25" width="36" height="20" rx="2" fill="#2c1d12"/>
               <rect x="18" y="28" width="14" height="11" rx="1.5" fill="#eadbb8" stroke="#6e5233" stroke-width="1.2" transform="rotate(-8 25 33)"/>
               <circle cx="39" cy="31" r="4.2" fill="#f4c552" stroke="#5c3e14" stroke-width="1"/>
               <circle cx="43" cy="37" r="3.5" fill="#7cd4f0" stroke="#1b4d63" stroke-width="1"/>
               <rect x="17" y="9" width="5" height="13" fill="${bandFill}"/>
               <rect x="42" y="9" width="5" height="13" fill="${bandFill}"/>`
            : `<rect x="10" y="15" width="44" height="32" rx="4.5" fill="${bodyFill}" stroke="#1a1109" stroke-width="2.4"/>
               <line x1="12" y1="25" x2="52" y2="25" stroke="#2a1a0e" stroke-width="1.6"/>
               <line x1="12" y1="36" x2="52" y2="36" stroke="#2a1a0e" stroke-width="1.6"/>
               <rect x="17" y="15" width="5.5" height="32" fill="${bandFill}" stroke="#1a1109" stroke-width="1"/>
               <rect x="41.5" y="15" width="5.5" height="32" fill="${bandFill}" stroke="#1a1109" stroke-width="1"/>
               <rect x="27" y="26" width="10" height="10" rx="2" fill="${trimStroke}" stroke="#1a1109" stroke-width="1.5"/>
               <circle cx="32" cy="31" r="2" fill="#1a1109"/>`
        }
      </svg>
    `);
  }

  if (kind === 'light') {
    const isLit = state !== 'unlit';
    return encodeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
        ${
          isLit
            ? `<circle cx="32" cy="32" r="28" fill="#ffb84d" opacity="0.24"/>
               <circle cx="32" cy="32" r="20" fill="#ffd27d" opacity="0.38"/>`
            : ''
        }
        <circle cx="32" cy="32" r="14" fill="#2b2622" stroke="#c89d54" stroke-width="2.2"/>
        <polygon points="32,14 36,22 28,22" fill="#4a4036"/>
        <polygon points="32,50 36,42 28,42" fill="#4a4036"/>
        <polygon points="14,32 22,28 22,36" fill="#4a4036"/>
        <polygon points="50,32 42,28 42,36" fill="#4a4036"/>
        <circle cx="32" cy="32" r="8" fill="${isLit ? '#ffae33' : '#4a433c'}" stroke="#1a120b" stroke-width="1.5"/>
        ${isLit ? `<circle cx="32" cy="32" r="4" fill="#fff3c4"/>` : ''}
      </svg>
    `);
  }

  if (kind === 'mechanism') {
    const isPulled = state === 'open';
    return encodeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
        <rect x="14" y="16" width="36" height="32" rx="6" fill="#0d0906" opacity="0.55"/>
        <rect x="16" y="18" width="32" height="28" rx="5" fill="#43484d" stroke="#18130e" stroke-width="2.4"/>
        <circle cx="22" cy="24" r="2" fill="#9ea7b0"/>
        <circle cx="42" cy="24" r="2" fill="#9ea7b0"/>
        <circle cx="22" cy="40" r="2" fill="#9ea7b0"/>
        <circle cx="42" cy="40" r="2" fill="#9ea7b0"/>
        <rect x="28" y="22" width="8" height="20" rx="3" fill="#1d2024" stroke="#c89d54" stroke-width="1.4"/>
        ${
          isPulled
            ? `<line x1="32" y1="32" x2="46" y2="46" stroke="#d9b45b" stroke-width="5" stroke-linecap="round"/>
               <circle cx="47" cy="47" r="6" fill="#5cc98b" stroke="#14291d" stroke-width="2"/>`
            : `<line x1="32" y1="32" x2="18" y2="16" stroke="#c89d54" stroke-width="5" stroke-linecap="round"/>
               <circle cx="17" cy="15" r="6" fill="#e06d53" stroke="#2b120c" stroke-width="2"/>`
        }
      </svg>
    `);
  }

  if (kind === 'hazard') {
    const isDisarmed = state === 'disarmed';
    return encodeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
        <polygon points="32,8 56,52 8,52" fill="#1c130e" stroke="${isDisarmed ? '#6fb98f' : '#e05a47'}" stroke-width="3"/>
        <circle cx="32" cy="36" r="9" fill="none" stroke="${isDisarmed ? '#6fb98f' : '#f29f4b'}" stroke-width="2.2" stroke-dasharray="4 2"/>
        <circle cx="32" cy="36" r="3.5" fill="${isDisarmed ? '#6fb98f' : '#e05a47'}"/>
      </svg>
    `);
  }

  if (kind === 'exit') {
    const isLocked = state === 'locked';
    return encodeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
        <circle cx="32" cy="32" r="24" fill="#121820" stroke="${isLocked ? '#e07a5f' : '#7cc6fe'}" stroke-width="3"/>
        <path d="M18 44 L18 24 Q32 12 46 24 L46 44" fill="none" stroke="#d4af37" stroke-width="3"/>
        ${
          isLocked
            ? `<rect x="24" y="27" width="16" height="14" rx="2.5" fill="#e07a5f" stroke="#1a110a" stroke-width="2"/>
               <path d="M27 27 V22 Q32 17 37 22 V27" fill="none" stroke="#e07a5f" stroke-width="2.5"/>`
            : `<polygon points="32,16 44,34 36,34 36,46 28,46 28,34 20,34" fill="#7cc6fe" stroke="#0d1b2a" stroke-width="1.8"/>`
        }
      </svg>
    `);
  }

  // Default: prop / support surface / workbench / table / altar / ledger / bookshelf
  if (archetype === 'ledger') {
    return encodeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
        <rect x="10" y="14" width="44" height="36" rx="3" fill="#4a2e1b" stroke="#1a1109" stroke-width="2.2"/>
        <rect x="14" y="17" width="17" height="30" fill="#efe3c6" stroke="#8c7355" stroke-width="1"/>
        <rect x="33" y="17" width="17" height="30" fill="#efe3c6" stroke="#8c7355" stroke-width="1"/>
        <line x1="17" y1="23" x2="28" y2="23" stroke="#5c4632" stroke-width="1.5"/>
        <line x1="17" y1="29" x2="28" y2="29" stroke="#5c4632" stroke-width="1.5"/>
        <line x1="36" y1="23" x2="47" y2="23" stroke="#5c4632" stroke-width="1.5"/>
        <line x1="36" y1="29" x2="47" y2="29" stroke="#5c4632" stroke-width="1.5"/>
      </svg>
    `);
  }

  if (archetype === 'altar' || archetype === 'pillar') {
    return encodeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
        <rect x="12" y="12" width="40" height="40" rx="6" fill="#5a6065" stroke="#1c1f22" stroke-width="2.5"/>
        <rect x="18" y="18" width="28" height="28" rx="4" fill="#737a80" stroke="#d4af37" stroke-width="1.8"/>
        <circle cx="32" cy="32" r="7" fill="#c89d54" stroke="#2b2113" stroke-width="1.5"/>
      </svg>
    `);
  }

  return encodeSvgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
      <rect x="6" y="14" width="52" height="36" rx="4" fill="#0d0906" opacity="0.55"/>
      <rect x="8" y="12" width="48" height="36" rx="4" fill="#6b4423" stroke="#1e130a" stroke-width="2.4"/>
      <line x1="10" y1="24" x2="54" y2="24" stroke="#3d2512" stroke-width="1.5"/>
      <line x1="10" y1="36" x2="54" y2="36" stroke="#3d2512" stroke-width="1.5"/>
      <rect x="15" y="17" width="16" height="13" rx="1.5" fill="#eadbc0" stroke="#5c4328" stroke-width="1.2" transform="rotate(-6 23 23)"/>
      <line x1="18" y1="21" x2="28" y2="21" stroke="#5c4328" stroke-width="1.2"/>
      <line x1="18" y1="25" x2="27" y2="25" stroke="#5c4328" stroke-width="1.2"/>
      <circle cx="43" cy="24" r="5" fill="#d4af37" stroke="#241709" stroke-width="1.4"/>
      <rect x="36" y="34" width="12" height="6" rx="1.5" fill="#8b959e" stroke="#1e130a" stroke-width="1.2"/>
    </svg>
  `);
}

export function resolveObjectSpriteDescriptor(feature: {
  readonly label: string;
  readonly objectKind?: string | null | undefined;
  readonly referenceKind?: string | null | undefined;
  readonly objectState?: string | null | undefined;
  readonly state?: string | null | undefined;
  readonly lockState?: 'unlocked' | 'locked' | null | undefined;
  readonly spriteUrl?: string | null | undefined;
}): ObjectSpriteDescriptor {
  const spriteKey = resolveObjectSpriteKey(feature);
  const spriteUrl =
    typeof feature.spriteUrl === 'string' && feature.spriteUrl.trim().length > 0
      ? feature.spriteUrl
      : buildIllustratedObjectSpriteDataUrl(spriteKey);
  return {
    spriteKey,
    spriteUrl,
    imagenPrompt: buildImagenObjectSpritePrompt(spriteKey),
  };
}
