/**
 * One-shot migration: delete campaigns seeded from the retired Emberferry Crossing
 * starter pack and their related documents.
 *
 * Usage: node tools/migrate/purge-emberferry-campaigns.mjs
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PACK_ID = 'emberferry-crossing-v1';

function initFirestore() {
  if (getApps().length === 0) {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-hallucinated-dungeons' });
  }
  return getFirestore();
}

async function deleteQueryBatch(firestore, query) {
  const snapshot = await query.get();
  if (snapshot.empty) {
    return 0;
  }
  const batch = firestore.batch();
  for (const doc of snapshot.docs) {
    batch.delete(doc.ref);
  }
  await batch.commit();
  return snapshot.size;
}

async function purgeCampaign(firestore, campaignId) {
  const collections = [
    'campaigns',
    'campaignMemberships',
    'campaignInvitations',
    'campaignSeats',
    'campaignSettings',
    'campaignMemory',
    'campaignSessions',
    'campaignChronicle',
    'campaignTableProjections',
    'campaignEncounters',
    'campaignPartyChat',
    'campaignPresence',
    'campaignMaps',
  ];
  for (const name of collections) {
    if (name === 'campaigns') {
      await firestore.collection(name).doc(campaignId).delete().catch(() => {});
      continue;
    }
    let total = 0;
    let removed = 0;
    do {
      removed = await deleteQueryBatch(
        firestore,
        firestore.collection(name).where('campaignId', '==', campaignId).limit(200),
      );
      total += removed;
    } while (removed > 0);
  }
}

async function main() {
  const firestore = initFirestore();
  const snapshot = await firestore
    .collection('campaigns')
    .where('adventureTemplateId', '==', PACK_ID)
    .get();
  const ids = snapshot.docs.map((doc) => doc.data().campaignId ?? doc.id);
  console.log(`Found ${ids.length} Emberferry campaign(s) to purge.`);
  for (const campaignId of ids) {
    await purgeCampaign(firestore, campaignId);
    console.log(`Purged ${campaignId}`);
  }
  console.log('Done.');
}

void main();
