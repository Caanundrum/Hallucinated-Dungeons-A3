/**
 * Campaign World Forge asset generation and Firestore-backed serving.
 *
 * Uses Gemini Enterprise Agent Platform (`gemini-3.1-flash-image` /
 * `gemini-3.1-flash-image-preview` / `gemini-2.5-flash-image` via `generateContent`)
 * or Imagen REST when `GEMINI_API_KEY` is present, and falls back to curated local
 * assets when offline or in local emulator mode. Supports chunked Firestore storage
 * so high-resolution generated battlemaps and portraits never exceed Firestore's
 * 1 MiB per-document limit.
 */

import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';

import { COLLECTIONS } from '../persistence/firestore.js';
import {
  PORTRAIT_IMAGE_MODEL_DEFAULT,
  PORTRAIT_MAX_DATA_URL_LENGTH,
  portraitApiKey,
  tryGeminiImageGeneration,
  type PortraitEnvironment,
} from '../characters/portrait.js';
import { resolveSceneArtUrl } from '../../shared/map-contract.js';

const ASSET_TIMEOUT_MS = 25_000;
const ASSET_FIRESTORE_CHUNK_SIZE = 700_000;
const NPC_FALLBACK_PORTRAIT_URL = '/assets/portraits/npc_tavernkeep.jpg';

export type CampaignAssetKind = 'battlemap' | 'npc_portrait' | 'monster_token';

export interface StoredCampaignAsset {
  readonly assetId: string;
  readonly campaignId: string;
  readonly kind: CampaignAssetKind;
  readonly mimeType: string;
  readonly base64Data: string;
  readonly chunkCount?: number;
  readonly prompt: string;
  readonly createdAt: string;
}

export function buildCampaignAssetPrompt(options: {
  readonly kind: CampaignAssetKind;
  readonly rawPrompt: string;
}): string {
  const clean = options.rawPrompt.trim();
  if (options.kind === 'battlemap') {
    return `Top-down 2D tactical tabletop RPG battlemap, orthographic 90-degree overhead bird's-eye view, rich atmospheric lighting, clear walkable floor space, AAA fantasy CRPG environment art, no grid lines, no text, no watermarks, no UI: ${clean}`;
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
  readonly aspectRatio?: '1:1' | '16:9' | '4:3';
}): Promise<{ readonly mimeType: string; readonly base64Data: string } | null> {
  return tryGeminiImageGeneration({
    env: options.env,
    model: options.model,
    prompt: options.prompt,
    aspectRatio: options.aspectRatio ?? '1:1',
  });
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

export async function storeCampaignAssetRecord(options: {
  readonly firestore: Firestore;
  readonly campaignId: string;
  readonly kind: CampaignAssetKind;
  readonly mimeType: string;
  readonly base64Data: string;
  readonly prompt: string;
  readonly customAssetId?: string;
}): Promise<string> {
  const assetId = options.customAssetId ?? `asset-${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const chunks: string[] = [];
  for (let offset = 0; offset < options.base64Data.length; offset += ASSET_FIRESTORE_CHUNK_SIZE) {
    chunks.push(options.base64Data.slice(offset, offset + ASSET_FIRESTORE_CHUNK_SIZE));
  }
  const firstChunk = chunks[0] ?? '';
  const record: StoredCampaignAsset = {
    assetId,
    campaignId: options.campaignId,
    kind: options.kind,
    mimeType: options.mimeType,
    base64Data: firstChunk,
    ...(chunks.length > 1 ? { chunkCount: chunks.length } : {}),
    prompt: options.prompt,
    createdAt,
  };
  await options.firestore.collection(COLLECTIONS.campaignAssets).doc(assetId).set(record);
  if (chunks.length > 1) {
    await Promise.all(
      chunks.slice(1).map((chunkData, idx) =>
        options.firestore
          .collection(COLLECTIONS.campaignAssets)
          .doc(`${assetId}_chunk_${idx + 1}`)
          .set({
            assetId,
            chunkIndex: idx + 1,
            base64Data: chunkData,
            createdAt,
          }),
      ),
    );
  }
  return `/api/assets/${assetId}`;
}

export function normalizeReusableMonsterKey(rawKey: string): string {
  return rawKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export async function generateAndStoreCampaignAsset(options: {
  readonly firestore: Firestore;
  readonly campaignId: string;
  readonly kind: CampaignAssetKind;
  readonly prompt: string;
  readonly fallbackTemplateId?: string;
  /** Optional shared cache key (e.g. SRD monster id like 'kobold' or 'goblin') to reuse across campaigns. */
  readonly reusableKey?: string;
  readonly env?: PortraitEnvironment;
  readonly fetchImpl?: typeof fetch;
}): Promise<{ readonly assetUrl: string; readonly source: 'generated' | 'curated' }> {
  const sharedAssetId =
    options.kind === 'monster_token' &&
    typeof options.reusableKey === 'string' &&
    normalizeReusableMonsterKey(options.reusableKey).length > 0
      ? `shared_monster_${normalizeReusableMonsterKey(options.reusableKey)}`
      : undefined;

  if (sharedAssetId !== undefined) {
    try {
      const existing = await loadCampaignAsset(options.firestore, sharedAssetId);
      if (existing !== null) {
        return {
          assetUrl: `/api/assets/${sharedAssetId}`,
          source: 'generated',
        };
      }
    } catch {
      // Proceed to generate if cache read fails.
    }
  }

  const env = options.env ?? process.env;
  const model = (env.HD_PORTRAIT_IMAGE_MODEL ?? '').trim() || PORTRAIT_IMAGE_MODEL_DEFAULT;
  const fullPrompt = buildCampaignAssetPrompt({
    kind: options.kind,
    rawPrompt: options.prompt,
  });
  const aspectRatio = options.kind === 'battlemap' ? '16:9' : '1:1';

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
      aspectRatio,
    });
  }

  if (generated !== null) {
    try {
      const assetUrl = await storeCampaignAssetRecord({
        firestore: options.firestore,
        campaignId: options.campaignId,
        kind: options.kind,
        mimeType: generated.mimeType,
        base64Data: generated.base64Data,
        prompt: fullPrompt,
        ...(sharedAssetId !== undefined ? { customAssetId: sharedAssetId } : {}),
      });
      return {
        assetUrl,
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
  let fullBase64 = data.base64Data;
  const chunkCount =
    typeof data.chunkCount === 'number' && Number.isFinite(data.chunkCount) ? data.chunkCount : 1;
  if (chunkCount > 1 && chunkCount <= 10) {
    const chunkSnaps = await Promise.all(
      Array.from({ length: chunkCount - 1 }, (_, idx) =>
        firestore
          .collection(COLLECTIONS.campaignAssets)
          .doc(`${assetId}_chunk_${idx + 1}`)
          .get(),
      ),
    );
    for (const chunkSnap of chunkSnaps) {
      const chunkData = chunkSnap.exists
        ? (chunkSnap.data() as { base64Data?: unknown } | undefined)?.base64Data
        : undefined;
      if (typeof chunkData !== 'string') {
        return null;
      }
      fullBase64 += chunkData;
    }
  }
  return {
    assetId: data.assetId ?? assetId,
    campaignId: typeof data.campaignId === 'string' ? data.campaignId : '',
    kind:
      data.kind === 'battlemap' || data.kind === 'npc_portrait' || data.kind === 'monster_token'
        ? data.kind
        : 'battlemap',
    mimeType: data.mimeType,
    base64Data: fullBase64,
    prompt: typeof data.prompt === 'string' ? data.prompt : '',
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
  };
}
