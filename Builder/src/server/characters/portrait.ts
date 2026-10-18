/**
 * Character portrait generation with a clean curated fallback.
 *
 * Imagen is attempted only when a Gemini API key is clearly present in the
 * environment. Any failure (no key, timeout, HTTP error, oversize image,
 * empty response) resolves to the curated archetype portrait, never an error.
 */

import { GoogleGenAI } from '@google/genai';
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

async function tryVertexPortraitAdc(options: {
  readonly env: PortraitEnvironment;
  readonly model: string;
  readonly prompt: string;
}): Promise<string | null> {
  if (options.env.HD_PORTRAIT_GENERATION === 'off') {
    return null;
  }
  const project = (
    options.env.HD_FIREBASE_PROJECT_ID ??
    options.env.GOOGLE_CLOUD_PROJECT ??
    options.env.GCLOUD_PROJECT ??
    ''
  ).trim();
  if (options.env.HD_ENVIRONMENT_CLASS !== 'milestone' || project.length === 0) {
    return null;
  }
  const location = (options.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1').trim() || 'us-central1';
  try {
    const ai = new GoogleGenAI({ vertexai: true, project, location });
    const response = await ai.models.generateImages({
      model: options.model,
      prompt: options.prompt,
      config: {
        numberOfImages: 1,
        outputMimeType: 'image/jpeg',
        aspectRatio: '1:1',
      },
    });
    const first = response.generatedImages?.[0]?.image;
    const bytes = first?.imageBytes;
    if (typeof bytes !== 'string' || bytes.length === 0) {
      return null;
    }
    const mime =
      first?.mimeType === 'image/png' || first?.mimeType === 'image/webp'
        ? first.mimeType
        : 'image/jpeg';
    const dataUrl = `data:${mime};base64,${bytes}`;
    return dataUrl.length <= PORTRAIT_MAX_DATA_URL_LENGTH ? dataUrl : null;
  } catch {
    return null;
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
  const model = (env.HD_PORTRAIT_IMAGE_MODEL ?? '').trim() || PORTRAIT_IMAGE_MODEL_DEFAULT;
  const prompt = buildPortraitPrompt(options);
  const apiKey = portraitApiKey(env);
  if (apiKey !== null) {
    const generated = await tryImagen({
      apiKey,
      model,
      prompt,
      fetchImpl: options.fetchImpl ?? fetch,
    });
    if (generated !== null) {
      return { avatarUrl: generated, source: 'generated' };
    }
  } else {
    const vertexGenerated = await tryVertexPortraitAdc({
      env,
      model,
      prompt,
    });
    if (vertexGenerated !== null) {
      return { avatarUrl: vertexGenerated, source: 'generated' };
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
