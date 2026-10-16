/**
 * Character portrait generation with a clean curated fallback.
 *
 * Imagen is attempted only when a Gemini API key is clearly present in the
 * environment. Any failure (no key, timeout, HTTP error, oversize image,
 * empty response) resolves to the curated archetype portrait, never an error.
 */

import {
  archetypePortraitUrl,
  type GeneratePortraitResponse,
} from '../../shared/portrait-contract.js';

export const PORTRAIT_IMAGE_MODEL_DEFAULT = 'imagen-4.0-fast-generate-001';
const PORTRAIT_TIMEOUT_MS = 25_000;
/** Firestore documents cap at 1 MiB; keep the inline image safely below it. */
export const PORTRAIT_MAX_DATA_URL_LENGTH = 800_000;

export interface PortraitEnvironment {
  readonly [key: string]: string | undefined;
}

export function portraitApiKey(env: PortraitEnvironment): string | null {
  if (env.HD_PORTRAIT_GENERATION === 'off') {
    return null;
  }
  const key = (env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? '').trim();
  return key.length >= 20 ? key : null;
}

export function buildPortraitPrompt(options: {
  readonly appearancePrompt: string;
  readonly ancestryId?: string | null;
  readonly classId?: string | null;
}): string {
  const subject = [options.ancestryId, options.classId]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .map((part) => part.replace(/[-_]+/g, ' '))
    .join(' ');
  return [
    'Oil-painted medieval fantasy character portrait, head and shoulders, dramatic candle-lit tavern lighting, painterly, no text, no watermark.',
    subject.length > 0 ? `A ${subject} adventurer.` : 'A fantasy adventurer.',
    options.appearancePrompt.length > 0 ? `Physical appearance: ${options.appearancePrompt}` : '',
  ]
    .filter((line) => line.length > 0)
    .join(' ');
}

async function tryImagen(options: {
  readonly apiKey: string;
  readonly model: string;
  readonly prompt: string;
  readonly fetchImpl: typeof fetch;
}): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PORTRAIT_TIMEOUT_MS);
  try {
    const response = await options.fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}:predict`,
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
    const payload = (await response.json()) as {
      predictions?: readonly { bytesBase64Encoded?: unknown; mimeType?: unknown }[];
    };
    const first = payload.predictions?.[0];
    if (first === undefined || typeof first.bytesBase64Encoded !== 'string') {
      return null;
    }
    const mime =
      first.mimeType === 'image/jpeg' || first.mimeType === 'image/webp' ? first.mimeType : 'image/png';
    const dataUrl = `data:${mime};base64,${first.bytesBase64Encoded}`;
    return dataUrl.length <= PORTRAIT_MAX_DATA_URL_LENGTH ? dataUrl : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolvePortrait(options: {
  readonly appearancePrompt: string;
  readonly ancestryId?: string | null;
  readonly classId?: string | null;
  readonly characterName?: string | null;
  readonly env?: PortraitEnvironment;
  readonly fetchImpl?: typeof fetch;
}): Promise<Pick<GeneratePortraitResponse, 'avatarUrl' | 'source'>> {
  const env = options.env ?? process.env;
  const apiKey = portraitApiKey(env);
  if (apiKey !== null) {
    const generated = await tryImagen({
      apiKey,
      model: (env.HD_PORTRAIT_IMAGE_MODEL ?? '').trim() || PORTRAIT_IMAGE_MODEL_DEFAULT,
      prompt: buildPortraitPrompt(options),
      fetchImpl: options.fetchImpl ?? fetch,
    });
    if (generated !== null) {
      return { avatarUrl: generated, source: 'generated' };
    }
  }
  return {
    avatarUrl: archetypePortraitUrl({
      ancestryId: options.ancestryId ?? null,
      classId: options.classId ?? null,
      name: options.characterName ?? null,
    }),
    source: 'archetype',
  };
}
