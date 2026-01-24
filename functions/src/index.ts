import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { createHash } from 'crypto';

admin.initializeApp();

const DEFAULT_LEAGUE_ID = 's11-vorax';
const HISTORY_RETENTION_DAYS = 90;
const HISTORY_COLLECTION_PATH = 'prices/history';

interface PriceEntry {
  price: number;
  timestamp: number;
  listingCount?: number;
}

interface SnapshotPayload {
  data: Record<string, PriceEntry>;
  lastUpdated: admin.firestore.FieldValue | admin.firestore.Timestamp;
  checksum: string;
}

function computeChecksum(prices: Record<string, PriceEntry>): string {
  const entries = Object.entries(prices)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([baseId, entry]) => ({
      baseId,
      price: entry.price,
      timestamp: entry.timestamp,
      listingCount: entry.listingCount ?? null
    }));
  const payload = JSON.stringify(entries);
  return createHash('sha256').update(payload).digest('hex');
}

async function deleteOldHistory(db: admin.firestore.Firestore, leagueId: string): Promise<number> {
  const cutoffMs = Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = admin.firestore.Timestamp.fromMillis(cutoffMs);
  const historyRef = db.collection(`${HISTORY_COLLECTION_PATH}/${leagueId}`);
  const staleQuery = await historyRef.where('lastUpdated', '<', cutoff).get();
  if (staleQuery.empty) return 0;

  let deleted = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of staleQuery.docs) {
    batch.delete(doc.ref);
    batchCount += 1;
    deleted += 1;
    if (batchCount >= 450) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  return deleted;
}

export const aggregatePriceSnapshots = onSchedule('every 20 minutes', async () => {
  try {
    logger.info('Starting price snapshot aggregation');

    const db = admin.firestore();
    const snapshot = await db.collection('prices').get();
    const leagueBuckets: Record<string, Record<string, PriceEntry>> = {};

    snapshot.forEach((docSnap) => {
      const data = docSnap.data() as Record<string, unknown>;
      const leagueId = typeof data.leagueId === 'string' && data.leagueId.trim().length > 0
        ? data.leagueId
        : DEFAULT_LEAGUE_ID;

      if (!leagueBuckets[leagueId]) {
        leagueBuckets[leagueId] = {};
      }

      const price = typeof data.price === 'number' ? data.price : null;
      const timestamp = data.timestamp instanceof admin.firestore.Timestamp
        ? data.timestamp.toMillis()
        : typeof data.timestamp === 'number'
          ? data.timestamp
          : null;

      if (price === null || timestamp === null) {
        return;
      }

      const listingCount = typeof data.listingCount === 'number' ? data.listingCount : undefined;
      leagueBuckets[leagueId][docSnap.id] = {
        price,
        timestamp,
        ...(listingCount !== undefined ? { listingCount } : {})
      };
    });

    if (Object.keys(leagueBuckets).length === 0) {
      logger.warn('No price documents found to aggregate.');
      return;
    }

    const batch = db.batch();
    const now = admin.firestore.FieldValue.serverTimestamp();
    let historyWrites = 0;
    let hasWrites = false;

    for (const [leagueId, prices] of Object.entries(leagueBuckets)) {
      const snapshotRef = db.doc(`prices/snapshot/${leagueId}`);
      const checksum = computeChecksum(prices);
      const existingSnap = await snapshotRef.get();
      const existingChecksum = existingSnap.exists ? (existingSnap.data()?.checksum as string | undefined) : undefined;

      if (existingChecksum && existingChecksum === checksum) {
        logger.info('Snapshot unchanged, skipping write', { leagueId });
        continue;
      }

      const payload: SnapshotPayload = { data: prices, lastUpdated: now, checksum };
      batch.set(snapshotRef, payload, { merge: true });

      const historyRef = db.collection(`${HISTORY_COLLECTION_PATH}/${leagueId}`).doc(String(Date.now()));
      batch.set(historyRef, payload);
      historyWrites += 1;
      hasWrites = true;

      const deleted = await deleteOldHistory(db, leagueId);
      if (deleted > 0) {
        logger.info('Deleted stale history entries', { leagueId, deleted });
      }
    }

    if (hasWrites) {
      await batch.commit();
    }
    logger.info('Price snapshot aggregation complete', {
      leagueCount: Object.keys(leagueBuckets).length,
      documentCount: snapshot.size,
      historyWrites
    });
  } catch (error) {
    logger.error('Failed to aggregate price snapshot', error);
  }
});
