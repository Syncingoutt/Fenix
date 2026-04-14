import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { createHash } from 'crypto';

admin.initializeApp();

const DEFAULT_LEAGUE_ID = 's11-vorax';
const HISTORY_RETENTION_DAYS = 90;
const HISTORY_COLLECTION_PATH = 'prices/history';
const SNAPSHOT_COLLECTION_PATH = 'pricesSnapshots';
const PRICE_CHECKS_ROOT = 'priceChecks';
const PRICES_7D_ROOT = 'prices7d';

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

function parseHistory7d(rawHistory: unknown): Array<{ t: number; p: number; l?: number }> {
  return Array.isArray(rawHistory)
    ? rawHistory
        .map(point => {
          if (!point || typeof point !== 'object') return null;
          const record = point as Record<string, unknown>;
          const t = typeof record.t === 'number'
            ? record.t
            : (typeof record.timestamp === 'number' ? record.timestamp : null);
          const p = typeof record.p === 'number'
            ? record.p
            : (typeof record.price === 'number' ? record.price : null);
          if (t === null || p === null) return null;
          const l = typeof record.l === 'number'
            ? record.l
            : (typeof record.listingCount === 'number' ? record.listingCount : undefined);
          return { t, p, ...(l !== undefined ? { l } : {}) };
        })
        .filter((point): point is { t: number; p: number; l?: number } => point !== null)
    : [];
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

    const now = admin.firestore.FieldValue.serverTimestamp();
    let historyWrites = 0;
    let batch = db.batch();
    let batchCount = 0;

    const queueSet = async (
      ref: admin.firestore.DocumentReference,
      data: admin.firestore.DocumentData,
      options?: FirebaseFirestore.SetOptions
    ): Promise<void> => {
      if (options) {
        batch.set(ref, data, options);
      } else {
        batch.set(ref, data);
      }
      batchCount += 1;
      if (batchCount >= 450) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    };

    for (const [leagueId, prices] of Object.entries(leagueBuckets)) {
      const snapshotRef = db.doc(`${SNAPSHOT_COLLECTION_PATH}/${leagueId}`);
      const checksum = computeChecksum(prices);
      const existingSnap = await snapshotRef.get();
      const existingChecksum = existingSnap.exists ? (existingSnap.data()?.checksum as string | undefined) : undefined;
      const hasSnapshotChange = !(existingChecksum && existingChecksum === checksum);
      const existing7dProbe = await db.collection(`${PRICES_7D_ROOT}/${leagueId}/items`).limit(1).get();
      const needsReadModelBackfill = existing7dProbe.empty;

      if (!hasSnapshotChange && !needsReadModelBackfill) {
        logger.info('Snapshot unchanged, skipping aggregation for league', { leagueId });
        continue;
      }

      if (hasSnapshotChange) {
        const payload: SnapshotPayload = { data: prices, lastUpdated: now, checksum };
        await queueSet(snapshotRef, payload as admin.firestore.DocumentData, { merge: true });

        const historyRef = db.collection(`${HISTORY_COLLECTION_PATH}/${leagueId}`).doc(String(Date.now()));
        await queueSet(historyRef, payload as admin.firestore.DocumentData);
        historyWrites += 1;

        const deleted = await deleteOldHistory(db, leagueId);
        if (deleted > 0) {
          logger.info('Deleted stale history entries', { leagueId, deleted });
        }
      } else {
        logger.info('Backfilling read models for unchanged snapshot', { leagueId });
      }

      // Build read-optimized 7d item docs and per-item check events.
      const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
      for (const [baseId, entry] of Object.entries(prices)) {
        const eventRef = db.doc(`${PRICE_CHECKS_ROOT}/${leagueId}/items/${baseId}/events/${entry.timestamp}`);
        await queueSet(eventRef, {
          timestamp: entry.timestamp,
          price: entry.price,
          listingCount: entry.listingCount ?? null,
          updatedAt: now
        }, { merge: true });

        const item7dRef = db.doc(`${PRICES_7D_ROOT}/${leagueId}/items/${baseId}`);
        const existing7d = await item7dRef.get();
        const rawHistory = existing7d.exists ? (existing7d.data()?.history7d as unknown) : undefined;
        const parsedHistory = Array.isArray(rawHistory)
          ? rawHistory
              .map(point => {
                if (!point || typeof point !== 'object') return null;
                const record = point as Record<string, unknown>;
                const t = typeof record.t === 'number'
                  ? record.t
                  : (typeof record.timestamp === 'number' ? record.timestamp : null);
                const p = typeof record.p === 'number'
                  ? record.p
                  : (typeof record.price === 'number' ? record.price : null);
                if (t === null || p === null) return null;
                const l = typeof record.l === 'number'
                  ? record.l
                  : (typeof record.listingCount === 'number' ? record.listingCount : undefined);
                return { t, p, ...(l !== undefined ? { l } : {}) };
              })
              .filter((point): point is { t: number; p: number; l?: number } => point !== null)
          : [];

        parsedHistory.push({
          t: entry.timestamp,
          p: entry.price,
          ...(entry.listingCount !== undefined ? { l: entry.listingCount } : {})
        });

        const deduped = new Map<number, { t: number; p: number; l?: number }>();
        for (const point of parsedHistory) {
          deduped.set(point.t, point);
        }

        const history7d = Array.from(deduped.values())
          .filter(point => point.t >= cutoffMs)
          .sort((a, b) => a.t - b.t)
          .slice(-512);

        await queueSet(item7dRef, {
          price: entry.price,
          timestamp: entry.timestamp,
          listingCount: entry.listingCount ?? null,
          history7d,
          updatedAt: now
        }, { merge: true });
      }
    }

    if (batchCount > 0) {
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

export const onPriceWritten = onDocumentWritten('prices/{baseId}', async (event) => {
  try {
    const after = event.data?.after;
    if (!after?.exists) return;

    const baseId = event.params.baseId;
    if (!/^\d+$/.test(baseId)) return;

    const data = after.data() as Record<string, unknown>;
    const price = typeof data.price === 'number' ? data.price : null;
    const timestamp = typeof data.timestamp === 'number' ? data.timestamp : null;
    if (price === null || timestamp === null) return;

    const listingCount = typeof data.listingCount === 'number' ? data.listingCount : undefined;
    const leagueId = typeof data.leagueId === 'string' && data.leagueId.trim().length > 0
      ? data.leagueId.trim()
      : DEFAULT_LEAGUE_ID;

    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();

    const eventRef = db.doc(`${PRICE_CHECKS_ROOT}/${leagueId}/items/${baseId}/events/${timestamp}`);
    await eventRef.set({
      timestamp,
      price,
      listingCount: listingCount ?? null,
      updatedAt: now
    }, { merge: true });

    const item7dRef = db.doc(`${PRICES_7D_ROOT}/${leagueId}/items/${baseId}`);
    const existing7d = await item7dRef.get();
    const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const parsedHistory = parseHistory7d(existing7d.exists ? (existing7d.data()?.history7d as unknown) : undefined);
    parsedHistory.push({
      t: timestamp,
      p: price,
      ...(listingCount !== undefined ? { l: listingCount } : {})
    });

    const deduped = new Map<number, { t: number; p: number; l?: number }>();
    for (const point of parsedHistory) {
      deduped.set(point.t, point);
    }

    const history7d = Array.from(deduped.values())
      .filter(point => point.t >= cutoffMs)
      .sort((a, b) => a.t - b.t)
      .slice(-512);

    await item7dRef.set({
      price,
      timestamp,
      listingCount: listingCount ?? null,
      history7d,
      updatedAt: now
    }, { merge: true });
  } catch (error) {
    logger.error('Failed to process onPriceWritten trigger', error);
  }
});
