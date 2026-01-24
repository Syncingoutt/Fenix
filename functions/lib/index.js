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
exports.aggregatePriceSnapshots = void 0;
const admin = __importStar(require("firebase-admin"));
const firebase_functions_1 = require("firebase-functions");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const crypto_1 = require("crypto");
admin.initializeApp();
const DEFAULT_LEAGUE_ID = 's11-vorax';
const HISTORY_RETENTION_DAYS = 90;
const HISTORY_COLLECTION_PATH = 'prices/history';
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
    var _a;
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
        const batch = db.batch();
        const now = admin.firestore.FieldValue.serverTimestamp();
        let historyWrites = 0;
        let hasWrites = false;
        for (const [leagueId, prices] of Object.entries(leagueBuckets)) {
            const snapshotRef = db.doc(`prices/snapshot/${leagueId}`);
            const checksum = computeChecksum(prices);
            const existingSnap = await snapshotRef.get();
            const existingChecksum = existingSnap.exists ? (_a = existingSnap.data()) === null || _a === void 0 ? void 0 : _a.checksum : undefined;
            if (existingChecksum && existingChecksum === checksum) {
                firebase_functions_1.logger.info('Snapshot unchanged, skipping write', { leagueId });
                continue;
            }
            const payload = { data: prices, lastUpdated: now, checksum };
            batch.set(snapshotRef, payload, { merge: true });
            const historyRef = db.collection(`${HISTORY_COLLECTION_PATH}/${leagueId}`).doc(String(Date.now()));
            batch.set(historyRef, payload);
            historyWrites += 1;
            hasWrites = true;
            const deleted = await deleteOldHistory(db, leagueId);
            if (deleted > 0) {
                firebase_functions_1.logger.info('Deleted stale history entries', { leagueId, deleted });
            }
        }
        if (hasWrites) {
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
