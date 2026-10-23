/**
 * Character portrait generation with a clean curated fallback.
 *
 * Uses Gemini Enterprise Agent Platform (`gemini-3.1-flash-image` /
 * `gemini-3.1-flash-image-preview` / `gemini-2.5-flash-image` via `generateContent`)
 * or Imagen REST when a Gemini API key is present. Any failure resolves cleanly
 * to the curated archetype portrait, never an error.
 */

import { GoogleGenAI } from '@google/genai';
import {
  archetypePortraitUrl,
  type GeneratePortraitResponse,
} from '../../shared/portrait-contract.js';

export const PORTRAIT_IMAGE_MODEL_DEFAULT = 'gemini-3.1-flash-image';
export const GEMINI_IMAGE_MODELS = [
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-image-preview',
  'gemini-2.5-flash-image',
] as const;
const PORTRAIT_TIMEOUT_MS = 25_000;
/** Firestore documents cap at 1 MiB; chunked assets support up to 4 MB base64. */
export const PORTRAIT_MAX_DATA_URL_LENGTH = 800_000;
const PORTRAIT_MAX_GENERATED_BASE64_LENGTH = 4_000_000;

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

function extractInlineImageFromResponse(response: unknown): {
  readonly mimeType: string;
  readonly base64Data: string;
} | null {
  const candidates = (
    response as {
      candidates?: readonly {
        content?: {
          parts?: readonly {
            inlineData?: { data?: unknown; mimeType?: unknown };
          }[];
        };
      }[];
    }
  )?.candidates;
  const parts = candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const data = part?.inlineData?.data;
    if (typeof data === 'string' && data.length > 0 && data.length <= PORTRAIT_MAX_GENERATED_BASE64_LENGTH) {
      const rawMime = part?.inlineData?.mimeType;
      const mimeType =
        rawMime === 'image/png' || rawMime === 'image/webp' || rawMime === 'image/jpeg'
          ? rawMime
          : 'image/jpeg';
      return { mimeType, base64Data: data };
    }
  }
  return null;
}

export async function tryGeminiImageGeneration(options: {
  readonly env: PortraitEnvironment;
  readonly model?: string;
  readonly prompt: string;
  readonly aspectRatio?: '1:1' | '16:9' | '4:3';
}): Promise<{ readonly mimeType: string; readonly base64Data: string } | null> {
  if (options.env.HD_PORTRAIT_GENERATION === 'off') {
    return null;
  }
  const apiKey = portraitApiKey(options.env);
  const project = (
    options.env.HD_FIREBASE_PROJECT_ID ??
    options.env.GOOGLE_CLOUD_PROJECT ??
    options.env.GCLOUD_PROJECT ??
    ''
  ).trim();
  const isHostedMilestone =
    options.env.HD_ENVIRONMENT_CLASS === 'milestone' && project.length > 0;
  if (apiKey === null && !isHostedMilestone) {
    return null;
  }

  const aspectRatio = options.aspectRatio ?? '1:1';
  const configuredModel = (options.model ?? '').trim();
  const candidateModels: string[] = [];
  if (
    configuredModel.length > 0 &&
    !configuredModel.startsWith('imagen-') &&
    !candidateModels.includes(configuredModel)
  ) {
    candidateModels.push(configuredModel);
  }
  for (const fallbackModel of GEMINI_IMAGE_MODELS) {
    if (!candidateModels.includes(fallbackModel)) {
      candidateModels.push(fallbackModel);
    }
  }

  for (const candidateModel of candidateModels) {
    try {
      const location = candidateModel.startsWith('gemini-3')
        ? 'global'
        : (options.env.GOOGLE_CLOUD_LOCATION ?? 'global').trim() || 'global';
      const ai =
        apiKey !== null
          ? new GoogleGenAI({ apiKey })
          : new GoogleGenAI({ vertexai: true, project, location });
      const response = await ai.models.generateContent({
        model: candidateModel,
        contents: options.prompt,
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: {
            aspectRatio,
            outputMimeType: 'image/jpeg',
            outputCompressionQuality: 78,
          },
        },
      });
      const extracted = extractInlineImageFromResponse(response);
      if (extracted !== null) {
        return extracted;
      }
    } catch {
      // Try next candidate model.
    }
  }

  if (isHostedMilestone) {
    try {
      const ai = new GoogleGenAI({ vertexai: true, project, location: 'us-central1' });
      const imagenModel = configuredModel.startsWith('imagen-')
        ? configuredModel
        : 'imagen-3.0-generate-002';
      const response = await ai.models.generateImages({
        model: imagenModel,
        prompt: options.prompt,
        config: {
          numberOfImages: 1,
          outputMimeType: 'image/jpeg',
          aspectRatio,
        },
      });
      const first = response.generatedImages?.[0]?.image;
      const bytes = first?.imageBytes;
      if (
        typeof bytes === 'string' &&
        bytes.length > 0 &&
        bytes.length <= PORTRAIT_MAX_GENERATED_BASE64_LENGTH
      ) {
        const mimeType =
          first?.mimeType === 'image/png' || first?.mimeType === 'image/webp'
            ? first.mimeType
            : 'image/jpeg';
        return { mimeType, base64Data: bytes };
      }
    } catch {
      return null;
    }
  }
  return null;
}

async function tryVertexPortraitAdc(options: {
  readonly env: PortraitEnvironment;
  readonly model: string;
  readonly prompt: string;
}): Promise<string | null> {
  const generated = await tryGeminiImageGeneration({
    env: options.env,
    model: options.model,
    prompt: options.prompt,
    aspectRatio: '1:1',
  });
  if (generated === null) {
    return null;
  }
  return `data:${generated.mimeType};base64,${generated.base64Data}`;
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
    if (options.fetchImpl === undefined) {
      const sdkGenerated = await tryVertexPortraitAdc({
        env,
        model,
        prompt,
      });
      if (sdkGenerated !== null) {
        return { avatarUrl: sdkGenerated, source: 'generated' };
      }
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
