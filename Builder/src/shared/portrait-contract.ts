/**
 * Character portrait contract shared by server and client.
 *
 * Portraits are fantasy-only. Appearance text is screened against a small
 * word list on both sides; the server never trusts the client check.
 */

export const APPEARANCE_PROMPT_MAX_LENGTH = 240;

export const PORTRAIT_ASSET_BASE = '/assets/portraits';
export const PORTRAIT_DWARF_FIGHTER = `${PORTRAIT_ASSET_BASE}/dwarf_fighter.jpg`;
export const PORTRAIT_ELF_ROGUE = `${PORTRAIT_ASSET_BASE}/elf_rogue.jpg`;

export const GENERATE_PORTRAIT_PATH = '/api/characters/generate-portrait';

export interface GeneratePortraitRequest {
  readonly appearancePrompt: string;
  readonly ancestryId?: string | null;
  readonly classId?: string | null;
  readonly characterId?: string | null;
  readonly draftId?: string | null;
}

export interface GeneratePortraitResponse {
  readonly avatarUrl: string;
  readonly appearancePrompt: string;
  readonly source: 'generated' | 'archetype';
  readonly milestonePortraitCredits?: number;
}

const BLOCKED_TERMS: readonly string[] = [
  'nude',
  'naked',
  'nsfw',
  'porn',
  'sexy',
  'erotic',
  'lingerie',
  'topless',
  'gore',
  'laser',
  'cyberpunk',
  'cyborg',
  'robot',
  'android',
  'spaceship',
  'sci-fi',
  'scifi',
  'futuristic',
  'smartphone',
  'iphone',
  'hoodie',
  'jeans',
  'sneakers',
  'tshirt',
  't-shirt',
  'business suit',
  'modern',
  'gun',
  'pistol',
  'rifle',
  'machine gun',
  'tattoo sleeve',
];

export type AppearanceValidation =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly message: string };

/** Trims, bounds length, and rejects modern / sci-fi / adult terms. */
export function validateAppearancePrompt(raw: string): AppearanceValidation {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length > APPEARANCE_PROMPT_MAX_LENGTH) {
    return {
      ok: false,
      message: `Physical appearance must be ${APPEARANCE_PROMPT_MAX_LENGTH} characters or fewer.`,
    };
  }
  const lowered = text.toLowerCase();
  for (const term of BLOCKED_TERMS) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(lowered)) {
      return {
        ok: false,
        message: 'Keep the portrait description to a medieval fantasy setting (no modern, sci-fi, or adult terms).',
      };
    }
  }
  return { ok: true, text };
}

/** Curated archetype portrait. Elf or rogue picks the elf rogue; everything else is the dwarf fighter. */
export function archetypePortraitUrl(options: {
  readonly ancestryId?: string | null;
  readonly classId?: string | null;
  readonly name?: string | null;
}): string {
  const ancestry = (options.ancestryId ?? '').toLowerCase();
  const klass = (options.classId ?? '').toLowerCase();
  if (ancestry === 'dwarf' && klass === 'fighter') {
    return PORTRAIT_DWARF_FIGHTER;
  }
  if (ancestry === 'elf' && klass === 'rogue') {
    return PORTRAIT_ELF_ROGUE;
  }
  if (ancestry === 'elf' || klass === 'rogue') {
    return PORTRAIT_ELF_ROGUE;
  }
  if (ancestry === 'dwarf' || klass === 'fighter') {
    return PORTRAIT_DWARF_FIGHTER;
  }
  const name = (options.name ?? '').toLowerCase();
  if (/\b(elf|elven|rogue|thief|shadow)\b/.test(name)) {
    return PORTRAIT_ELF_ROGUE;
  }
  return PORTRAIT_DWARF_FIGHTER;
}

/** Only curated assets or server-generated inline images may be rendered as avatars. */
export function isTrustedAvatarUrl(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  if (value.startsWith(`${PORTRAIT_ASSET_BASE}/`) && !value.includes('..')) {
    return /^[A-Za-z0-9_./-]{1,200}$/.test(value);
  }
  if (/^\/api\/assets\/[a-zA-Z0-9_-]{1,120}$/.test(value)) {
    return true;
  }
  return value.length <= 800_100 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
}

export const MILESTONE_STORY_SCAR_MAX_LENGTH = 120;

/** Appends a story-scar note to an existing appearance prompt, within the max length. */
export function appendStoryScar(appearancePrompt: string, scarNote: string): string {
  const note = scarNote.replace(/\s+/g, ' ').trim().slice(0, MILESTONE_STORY_SCAR_MAX_LENGTH);
  if (note.length === 0) {
    return appearancePrompt.slice(0, APPEARANCE_PROMPT_MAX_LENGTH);
  }
  const base = appearancePrompt.trim();
  const suffix = `Scar: ${note}`;
  const joined = base.length > 0 ? `${base}. ${suffix}` : suffix;
  if (joined.length <= APPEARANCE_PROMPT_MAX_LENGTH) {
    return joined;
  }
  const room = APPEARANCE_PROMPT_MAX_LENGTH - suffix.length - 2;
  return room > 0 ? `${base.slice(0, room)}. ${suffix}` : suffix.slice(0, APPEARANCE_PROMPT_MAX_LENGTH);
}
