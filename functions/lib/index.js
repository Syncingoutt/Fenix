"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.onPriceWritten = exports.aggregatePriceSnapshots = void 0;
const admin = __importStar(require("firebase-admin"));
const firebase_functions_1 = require("firebase-functions");
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const crypto_1 = require("crypto");
admin.initializeApp();
const DEFAULT_LEAGUE_ID = 's11-vorax';
const HISTORY_RETENTION_DAYS = 90;
const HISTORY_COLLECTION_PATH = 'prices/history';
const SNAPSHOT_COLLECTION_PATH = 'pricesSnapshots';
const PRICE_CHECKS_ROOT = 'priceChecks';
const PRICES_7D_ROOT = 'prices7d';
function parseHistory7d(rawHistory) {
    return Array.isArray(rawHistory)
        ? rawHistory
            .map(point => {
            if (!point || typeof point !== 'object')
                return null;
            const record = point;
            const t = typeof record.t === 'number'
                ? record.t
                : (typeof record.timestamp === 'number' ? record.timestamp : null);
            const p = typeof record.p === 'number'
                ? record.p
                : (typeof record.price === 'number' ? record.price : null);
            if (t === null || p === null)
                return null;
            const l = typeof record.l === 'number'
                ? record.l
                : (typeof record.listingCount === 'number' ? record.listingCount : undefined);
            return { t, p, ...(l !== undefined ? { l } : {}) };
        })
            .filter((point) => point !== null)
        : [];
}
function computeChecksum(prices) {
    const entries = Object.entries(prices)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([baseId, entry]) => {
        var _a;
        return ({
            baseId,
            price: entry.price,
            timestamp: entry.timestamp,
            listingCount: (_a = entry.listingCount) !== null && _a !== void 0 ? _a : null
        });
    });
    const payload = JSON.stringify(entries);
    return (0, crypto_1.createHash)('sha256').update(payload).digest('hex');
}
async function deleteOldHistory(db, leagueId) {
    const cutoffMs = Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const cutoff = admin.firestore.Timestamp.fromMillis(cutoffMs);
    const historyRef = db.collection(`${HISTORY_COLLECTION_PATH}/${leagueId}`);
    const staleQuery = await historyRef.where('lastUpdated', '<', cutoff).get();
    if (staleQuery.empty)
        return 0;
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
exports.aggregatePriceSnapshots = (0, scheduler_1.onSchedule)('every 20 minutes', async () => {
    var _a, _b, _c, _d;
    try {
        firebase_functions_1.logger.info('Starting price snapshot aggregation');
        const db = admin.firestore();
        const snapshot = await db.collection('prices').get();
        const leagueBuckets = {};
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
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
            firebase_functions_1.logger.warn('No price documents found to aggregate.');
            return;
        }
        const now = admin.firestore.FieldValue.serverTimestamp();
        let historyWrites = 0;
        let batch = db.batch();
        let batchCount = 0;
        const queueSet = async (ref, data, options) => {
            if (options) {
                batch.set(ref, data, options);
            }
            else {
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
            const existingChecksum = existingSnap.exists ? (_a = existingSnap.data()) === null || _a === void 0 ? void 0 : _a.checksum : undefined;
            const hasSnapshotChange = !(existingChecksum && existingChecksum === checksum);
            const existing7dProbe = await db.collection(`${PRICES_7D_ROOT}/${leagueId}/items`).limit(1).get();
            const needsReadModelBackfill = existing7dProbe.empty;
            if (!hasSnapshotChange && !needsReadModelBackfill) {
                firebase_functions_1.logger.info('Snapshot unchanged, skipping aggregation for league', { leagueId });
                continue;
            }
            if (hasSnapshotChange) {
                const payload = { data: prices, lastUpdated: now, checksum };
                await queueSet(snapshotRef, payload, { merge: true });
                const historyRef = db.collection(`${HISTORY_COLLECTION_PATH}/${leagueId}`).doc(String(Date.now()));
                await queueSet(historyRef, payload);
                historyWrites += 1;
                const deleted = await deleteOldHistory(db, leagueId);
                if (deleted > 0) {
                    firebase_functions_1.logger.info('Deleted stale history entries', { leagueId, deleted });
                }
            }
            else {
                firebase_functions_1.logger.info('Backfilling read models for unchanged snapshot', { leagueId });
            }
            // Build read-optimized 7d item docs and per-item check events.
            const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
            for (const [baseId, entry] of Object.entries(prices)) {
                const eventRef = db.doc(`${PRICE_CHECKS_ROOT}/${leagueId}/items/${baseId}/events/${entry.timestamp}`);
                await queueSet(eventRef, {
                    timestamp: entry.timestamp,
                    price: entry.price,
                    listingCount: (_b = entry.listingCount) !== null && _b !== void 0 ? _b : null,
                    updatedAt: now
                }, { merge: true });
                const item7dRef = db.doc(`${PRICES_7D_ROOT}/${leagueId}/items/${baseId}`);
                const existing7d = await item7dRef.get();
                const rawHistory = existing7d.exists ? (_c = existing7d.data()) === null || _c === void 0 ? void 0 : _c.history7d : undefined;
                const parsedHistory = Array.isArray(rawHistory)
                    ? rawHistory
                        .map(point => {
                        if (!point || typeof point !== 'object')
                            return null;
                        const record = point;
                        const t = typeof record.t === 'number'
                            ? record.t
                            : (typeof record.timestamp === 'number' ? record.timestamp : null);
                        const p = typeof record.p === 'number'
                            ? record.p
                            : (typeof record.price === 'number' ? record.price : null);
                        if (t === null || p === null)
                            return null;
                        const l = typeof record.l === 'number'
                            ? record.l
                            : (typeof record.listingCount === 'number' ? record.listingCount : undefined);
                        return { t, p, ...(l !== undefined ? { l } : {}) };
                    })
                        .filter((point) => point !== null)
                    : [];
                parsedHistory.push({
                    t: entry.timestamp,
                    p: entry.price,
                    ...(entry.listingCount !== undefined ? { l: entry.listingCount } : {})
                });
                const deduped = new Map();
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
                    listingCount: (_d = entry.listingCount) !== null && _d !== void 0 ? _d : null,
                    history7d,
                    updatedAt: now
                }, { merge: true });
            }
        }
        if (batchCount > 0) {
            await batch.commit();
        }
        firebase_functions_1.logger.info('Price snapshot aggregation complete', {
            leagueCount: Object.keys(leagueBuckets).length,
            documentCount: snapshot.size,
            historyWrites
        });
    }
    catch (error) {
        firebase_functions_1.logger.error('Failed to aggregate price snapshot', error);
    }
});
exports.onPriceWritten = (0, firestore_1.onDocumentWritten)('prices/{baseId}', async (event) => {
    var _a, _b;
    try {
        const after = (_a = event.data) === null || _a === void 0 ? void 0 : _a.after;
        if (!(after === null || after === void 0 ? void 0 : after.exists))
            return;
        const baseId = event.params.baseId;
        if (!/^\d+$/.test(baseId))
            return;
        const data = after.data();
        const price = typeof data.price === 'number' ? data.price : null;
        const timestamp = typeof data.timestamp === 'number' ? data.timestamp : null;
        if (price === null || timestamp === null)
            return;
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
            listingCount: listingCount !== null && listingCount !== void 0 ? listingCount : null,
            updatedAt: now
        }, { merge: true });
        const item7dRef = db.doc(`${PRICES_7D_ROOT}/${leagueId}/items/${baseId}`);
        const existing7d = await item7dRef.get();
        const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const parsedHistory = parseHistory7d(existing7d.exists ? (_b = existing7d.data()) === null || _b === void 0 ? void 0 : _b.history7d : undefined);
        parsedHistory.push({
            t: timestamp,
            p: price,
            ...(listingCount !== undefined ? { l: listingCount } : {})
        });
        const deduped = new Map();
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
            listingCount: listingCount !== null && listingCount !== void 0 ? listingCount : null,
            history7d,
            updatedAt: now
        }, { merge: true });
    }
    catch (error) {
        firebase_functions_1.logger.error('Failed to process onPriceWritten trigger', error);
    }
});
