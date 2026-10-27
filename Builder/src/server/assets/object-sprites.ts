/**
 * Top-down 2D RPG object sprite service (`Packet 4`).
 *
 * Uses `imagen-3.0-fast-generate-001` (`$0.02/image`) to generate reusable
 * top-down object icons on a solid `#000000` key background, applies black-key
 * alpha cutout, caches globally by `spriteKey` (`kind:archetype:state`) in
 * memory and Firestore `assetBank`, and falls back to crisp top-down illustrated
 * SVG data URLs when offline or in local emulator mode.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS } from '../persistence/firestore.js';
import { portraitApiKey, type PortraitEnvironment } from '../characters/portrait.js';
import {
  buildIllustratedObjectSpriteDataUrl,
  buildImagenObjectSpritePrompt,
  resolveObjectSpriteDescriptor,
  type ObjectSpriteKey,
} from '../../shared/object-sprite-catalog.js';

export const IMAGEN_OBJECT_SPRITE_MODEL = 'imagen-3.0-fast-generate-001';
const IMAGEN_SPRITE_TIMEOUT_MS = 18_000;

/** Process-wide in-memory cache of resolved sprite data URLs keyed by `ObjectSpriteKey`. */
const spriteMemoryCache = new Map<ObjectSpriteKey, string>();

export function getCachedObjectSpriteUrl(spriteKey: ObjectSpriteKey): string | undefined {
  return spriteMemoryCache.get(spriteKey);
}

export function setCachedObjectSpriteUrl(spriteKey: ObjectSpriteKey, spriteUrl: string): void {
  spriteMemoryCache.set(spriteKey, spriteUrl);
}

/**
 * Wraps an Imagen-generated base64 raster (isolated on `#000000` pure black) in a
 * 64x64 top-down sprite SVG with luminance-keyed black-background alpha cutout
 * and feathered vignette so it composites cleanly over the battlemap floor.
 */
export function wrapImagenRasterWithBlackCutoutSvg(
  base64Data: string,
  mimeType = 'image/png',
): string {
  const safeId = base64Data.slice(0, 12).replace(/[^a-zA-Z0-9]/g, 'x') || 'spr';
  const rawImageHref = `data:${mimeType};base64,${base64Data}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><defs><filter id="cut-${safeId}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  2.2 2.2 2.2 0 -0.22"/></filter><clipPath id="clip-${safeId}"><circle cx="32" cy="32" r="29"/></clipPath></defs><ellipse cx="32" cy="35" rx="22" ry="18" fill="rgba(0,0,0,0.42)"/><g clip-path="url(#clip-${safeId})" filter="url(#cut-${safeId})"><image href="${rawImageHref}" x="2" y="2" width="60" height="60" preserveAspectRatio="xMidYMid slice"/></g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

async function tryImagenFastObjectSprite(options: {
  readonly apiKey: string;
  readonly prompt: string;
  readonly fetchImpl: typeof fetch;
}): Promise<{ readonly mimeType: string; readonly base64Data: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGEN_SPRITE_TIMEOUT_MS);
  try {
    const response = await options.fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(IMAGEN_OBJECT_SPRITE_MODEL)}:predict`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
        body: JSON.stringify({
          instances: [{ prompt: options.prompt }],
          parameters: { sampleCount: 1, aspectRatio: '1:1' },
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      return null;
    }
    const json = (await response.json()) as {
      predictions?: ReadonlyArray<{ bytesBase64Encoded?: string; mimeType?: string }>;
    };
    const first = json.predictions?.[0];
    if (
      first === undefined ||
      typeof first.bytesBase64Encoded !== 'string' ||
      first.bytesBase64Encoded.length < 64
    ) {
      return null;
    }
    const mimeType =
      typeof first.mimeType === 'string' && first.mimeType.startsWith('image/')
        ? first.mimeType
        : 'image/png';
    return { mimeType, base64Data: first.bytesBase64Encoded };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Synchronously resolves `{ spriteKey, spriteUrl }` for map projection (`map-projection.ts`),
 * returning the cached Imagen cutout sprite if present or the top-down illustrated sprite.
 */
export function resolveProjectedObjectSprite(feature: {
  readonly objectKind?: string | null;
  readonly referenceKind?: string | null;
  readonly label: string;
  readonly state?: string | null;
  readonly objectState?: string | null;
  readonly lockState?: 'unlocked' | 'locked' | null;
}): { readonly spriteKey: ObjectSpriteKey; readonly spriteUrl: string } {
  const descriptor = resolveObjectSpriteDescriptor(feature);
  const cached = spriteMemoryCache.get(descriptor.spriteKey);
  if (cached !== undefined) {
    return { spriteKey: descriptor.spriteKey, spriteUrl: cached };
  }
  return descriptor;
}

/**
 * Generates or loads a global object sprite from Firestore `assetBank` (`sprite:${spriteKey}`)
 * or `imagen-3.0-fast-generate-001`, falling back to `buildIllustratedObjectSpriteDataUrl`.
 */
export async function generateOrLoadObjectSprite(options: {
  readonly firestore: Firestore;
  readonly spriteKey: ObjectSpriteKey;
  readonly label?: string;
  readonly env?: PortraitEnvironment;
  readonly fetchImpl?: typeof fetch;
}): Promise<string> {
  const cachedMem = spriteMemoryCache.get(options.spriteKey);
  if (cachedMem !== undefined) {
    return cachedMem;
  }

  const bankDocId = `sprite_${options.spriteKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  try {
    const snap = await options.firestore.collection(COLLECTIONS.assetBank).doc(bankDocId).get();
    if (snap.exists) {
      const data = snap.data() as { spriteUrl?: string } | undefined;
      if (typeof data?.spriteUrl === 'string' && data.spriteUrl.length > 0) {
        spriteMemoryCache.set(options.spriteKey, data.spriteUrl);
        return data.spriteUrl;
      }
    }
  } catch {
    // Firestore bank read is best-effort.
  }

  const apiKey = portraitApiKey(options.env ?? process.env);
  if (apiKey !== null) {
    const prompt = buildImagenObjectSpritePrompt(options.spriteKey);
    const generated = await tryImagenFastObjectSprite({
      apiKey,
      prompt,
      fetchImpl: options.fetchImpl ?? fetch,
    });
    if (generated !== null) {
      const cutoutUrl = wrapImagenRasterWithBlackCutoutSvg(
        generated.base64Data,
        generated.mimeType,
      );
      spriteMemoryCache.set(options.spriteKey, cutoutUrl);
      try {
        await options.firestore.collection(COLLECTIONS.assetBank).doc(bankDocId).set({
          bankKey: `sprite:${options.spriteKey}`,
          spriteKey: options.spriteKey,
          spriteUrl: cutoutUrl,
          model: IMAGEN_OBJECT_SPRITE_MODEL,
          createdAt: new Date().toISOString(),
        });
      } catch {
        // Non-fatal cache write.
      }
      return cutoutUrl;
    }
  }

  const illustrated = buildIllustratedObjectSpriteDataUrl(options.spriteKey);
  spriteMemoryCache.set(options.spriteKey, illustrated);
  return illustrated;
}
