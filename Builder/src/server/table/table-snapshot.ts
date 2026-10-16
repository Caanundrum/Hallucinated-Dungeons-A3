/**
 * Single-poll tabletop snapshot — bundles the projections the play client
 * previously fetched as eight parallel GETs every few seconds.
 */

import type { Firestore } from 'firebase-admin/firestore';

import type { TableSnapshotProjection } from '../../shared/table-snapshot-contract.js';
import { loadCampaignMemory } from '../campaigns/campaign-memory.js';
import { listChronicleEntries } from '../communication/chronicle.js';
import { listPartyChat } from '../communication/party-chat.js';
import { buildPresentationCuePlanFromTable } from '../presentation/presentation-cues.js';
import { fetchRulesState } from '../rules/engine/rules-commands.js';
import { fetchTableState } from './commands.js';
import { fetchCampaignMap } from './map-projection.js';
import { fetchActiveTimingAuthority } from './timing-authority.js';

export async function fetchTableSnapshot(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
}): Promise<TableSnapshotProjection> {
  const { firestore, accountId, campaignId } = options;

  const [table, map, authority, partyChat, chronicle, memory, rules] = await Promise.all([
    fetchTableState({ firestore, accountId, campaignId }),
    fetchCampaignMap({ firestore, accountId, campaignId }),
    fetchActiveTimingAuthority({ firestore, accountId, campaignId }),
    listPartyChat({ firestore, accountId, campaignId }),
    listChronicleEntries({ firestore, campaignId }),
    loadCampaignMemory(firestore, campaignId, accountId).catch(() => null),
    fetchRulesState({ firestore, accountId, campaignId }).catch(() => null),
  ]);

  return {
    campaignId,
    table,
    map,
    timingAuthority: { authority },
    partyChat,
    chronicle,
    memory,
    rules,
    presentationCues: buildPresentationCuePlanFromTable(campaignId, table),
  };
}
