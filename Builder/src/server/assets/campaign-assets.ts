/**
 * Campaign World Forge asset generation and Firestore-backed serving.
 *
 * Uses Gemini API (`imagen-4.0-fast-generate-001`) when `GEMINI_API_KEY` is present,
 * falls back to Vertex AI Enterprise ADC via `@google/genai` when running in
 * milestone mode with a GCP project, and falls back to curated local assets
 * when offline or in local emulator mode.
 */

import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { GoogleGenAI } from '@google/genai';

import { COLLECTIONS } from '../persistence/firestore.js';
import {
  PORTRAIT_IMAGE_MODEL_DEFAULT,
  PORTRAIT_MAX_DATA_URL_LENGTH,
  portraitApiKey,
  type PortraitEnvironment,
} from '../characters/portrait.js';
import { resolveSceneArtUrl } from '../../shared/map-contract.js';

const ASSET_TIMEOUT_MS = 25_000;
const NPC_FALLBACK_PORTRAIT_URL = '/assets/portraits/npc_tavernkeep.jpg';

export type CampaignAssetKind = 'battlemap' | 'npc_portrait' | 'monster_token';

export interface StoredCampaignAsset {
  readonly assetId: string;
  readonly campaignId: string;
  readonly kind: CampaignAssetKind;
  readonly mimeType: string;
  readonly base64Data: string;
  readonly prompt: string;
  readonly createdAt: string;
}

export function buildCampaignAssetPrompt(options: {
  readonly kind: CampaignAssetKind;
  readonly rawPrompt: string;
}): string {
  const clean = options.rawPrompt.trim();
  if (options.kind === 'battlemap') {
    return `Top-down 2D tactical tabletop RPG battlemap, orthographic overhead view, painted stone and warm torchlight, clear walkable floor space, no grid lines, no text, no watermarks, no UI: ${clean}`;
  }
  if (options.kind === 'npc_portrait') {
    return `Oil-painted medieval fantasy character portrait, head and shoulders, dramatic candle-lit tavern lighting, painterly, no text, no watermark: ${clean}`;
  }
  return `Top-down circular fantasy RPG monster token portrait, dramatic dark fantasy rim lighting, painterly, no text, no watermark: ${clean}`;
}

async function tryImagenRest(options: {
  readonly apiKey: string;
  readonly model: string;
  readonly prompt: string;
  readonly fetchImpl: typeof fetch;
}): Promise<{ readonly mimeType: string; readonly base64Data: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSET_TIMEOUT_MS);
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
    const mimeType =
      first.mimeType === 'image/jpeg' || first.mimeType === 'image/webp'
        ? first.mimeType
        : 'image/png';
    if (first.bytesBase64Encoded.length > PORTRAIT_MAX_DATA_URL_LENGTH) {
      return null;
    }
    return { mimeType, base64Data: first.bytesBase64Encoded };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function tryVertexImagenAdc(options: {
  readonly env: PortraitEnvironment;
  readonly model: string;
  readonly prompt: string;
}): Promise<{ readonly mimeType: string; readonly base64Data: string } | null> {
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
    if (typeof bytes !== 'string' || bytes.length === 0 || bytes.length > PORTRAIT_MAX_DATA_URL_LENGTH) {
      return null;
    }
    const mimeType =
      first?.mimeType === 'image/png' || first?.mimeType === 'image/webp'
        ? first.mimeType
        : 'image/jpeg';
    return { mimeType, base64Data: bytes };
  } catch {
    return null;
  }
}

function fallbackUrlForAsset(options: {
  readonly kind: CampaignAssetKind;
  readonly fallbackTemplateId?: string;
}): string {
  if (options.kind === 'battlemap') {
    return (
      resolveSceneArtUrl(options.fallbackTemplateId ?? 'interior_stone_crypt') ??
      '/assets/maps/dungeon_cellar_split.jpg'
    );
  }
  return NPC_FALLBACK_PORTRAIT_URL;
}

export async function generateAndStoreCampaignAsset(options: {
  readonly firestore: Firestore;
  readonly campaignId: string;
  readonly kind: CampaignAssetKind;
  readonly prompt: string;
  readonly fallbackTemplateId?: string;
  readonly env?: PortraitEnvironment;
  readonly fetchImpl?: typeof fetch;
}): Promise<{ readonly assetUrl: string; readonly source: 'generated' | 'curated' }> {
  const env = options.env ?? process.env;
  const model = (env.HD_PORTRAIT_IMAGE_MODEL ?? '').trim() || PORTRAIT_IMAGE_MODEL_DEFAULT;
  const fullPrompt = buildCampaignAssetPrompt({
    kind: options.kind,
    rawPrompt: options.prompt,
  });

  let generated: { readonly mimeType: string; readonly base64Data: string } | null = null;
  const apiKey = portraitApiKey(env);
  if (apiKey !== null) {
    generated = await tryImagenRest({
      apiKey,
      model,
      prompt: fullPrompt,
      fetchImpl: options.fetchImpl ?? fetch,
    });
  }
  if (generated === null) {
    generated = await tryVertexImagenAdc({
      env,
      model,
      prompt: fullPrompt,
    });
  }

  if (generated !== null) {
    const assetId = `asset-${randomUUID()}`;
    const record: StoredCampaignAsset = {
      assetId,
      campaignId: options.campaignId,
      kind: options.kind,
      mimeType: generated.mimeType,
      base64Data: generated.base64Data,
      prompt: fullPrompt,
      createdAt: new Date().toISOString(),
    };
    try {
      await options.firestore.collection(COLLECTIONS.campaignAssets).doc(assetId).set(record);
      return {
        assetUrl: `/api/assets/${assetId}`,
        source: 'generated',
      };
    } catch {
      // Fall through to curated fallback if Firestore write fails.
    }
  }

  return {
    assetUrl: fallbackUrlForAsset({
      kind: options.kind,
      ...(options.fallbackTemplateId !== undefined
        ? { fallbackTemplateId: options.fallbackTemplateId }
        : {}),
    }),
    source: 'curated',
  };
}

export async function loadCampaignAsset(
  firestore: Firestore,
  assetId: string,
): Promise<StoredCampaignAsset | null> {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(assetId)) {
    return null;
  }
  const snap = await firestore.collection(COLLECTIONS.campaignAssets).doc(assetId).get();
  if (!snap.exists) {
    return null;
  }
  const data = snap.data() as Partial<StoredCampaignAsset> | undefined;
  if (
    data === undefined ||
    typeof data.base64Data !== 'string' ||
    typeof data.mimeType !== 'string'
  ) {
    return null;
  }
  return {
    assetId: data.assetId ?? assetId,
    campaignId: typeof data.campaignId === 'string' ? data.campaignId : '',
    kind:
      data.kind === 'battlemap' || data.kind === 'npc_portrait' || data.kind === 'monster_token'
        ? data.kind
        : 'battlemap',
    mimeType: data.mimeType,
    base64Data: data.base64Data,
    prompt: typeof data.prompt === 'string' ? data.prompt : '',
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
  };
}
