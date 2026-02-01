/**
 * Utility functions for merging hourly buckets
 * These are shared between main and renderer processes
 */

import { HourlyBucket } from '../renderer/types.js';

/**
 * Merge buckets with the same hour number
 * Only merges buckets from the SAME session (same sessionId)
 */
export function mergeBucketsByHour(buckets: HourlyBucket[]): HourlyBucket[] {
  const hourMap = new Map<number, Map<string, HourlyBucket[]>>();

  // Group buckets by hour number AND session ID
  for (const bucket of buckets) {
    const sessionId = bucket.sessionId || 'default';
    if (!hourMap.has(bucket.hourNumber)) {
      hourMap.set(bucket.hourNumber, new Map());
    }
    const sessionMap = hourMap.get(bucket.hourNumber)!;
    if (!sessionMap.has(sessionId)) {
      sessionMap.set(sessionId, []);
    }
    sessionMap.get(sessionId)!.push(bucket);
  }

  // Merge each group
  const mergedBuckets: HourlyBucket[] = [];
  for (const [hourNumber, sessionMap] of hourMap) {
    for (const [sessionId, hourBuckets] of sessionMap) {
      // Sort by timestamp to ensure correct order
      hourBuckets.sort((a, b) => a.timestamp - b.timestamp);

      if (hourBuckets.length === 1) {
        mergedBuckets.push(hourBuckets[0]);
        continue;
      }

      // Merge multiple buckets for the same hour (from same session)
      const first = hourBuckets[0];
      const last = hourBuckets[hourBuckets.length - 1];

      // Sum earnings and durations
      const totalEarnings = hourBuckets.reduce((sum, b) => sum + b.earnings, 0);
      const totalDuration = hourBuckets.reduce((sum, b) => sum + b.duration, 0);

      // Combine and sort history points
      const combinedHistory: { time: number; value: number }[] = [];
      for (const bucket of hourBuckets) {
        combinedHistory.push(...bucket.history);
      }
      combinedHistory.sort((a, b) => a.time - b.time);

      // Merge usage snapshots
      const mergedUsageSnapshot: { [baseId: string]: { used: number; purchased: number } } = {};
      for (const bucket of hourBuckets) {
        for (const [baseId, usage] of Object.entries(bucket.usageSnapshot)) {
          if (!mergedUsageSnapshot[baseId]) {
            mergedUsageSnapshot[baseId] = { used: 0, purchased: 0 };
          }
          mergedUsageSnapshot[baseId].used += usage.used;
          mergedUsageSnapshot[baseId].purchased += usage.purchased;
        }
      }

      // Use the earliest start value and the latest end value
      const mergedBucket: HourlyBucket = {
        hourNumber,
        startValue: first.startValue,
        endValue: last.endValue,
        earnings: totalEarnings,
        history: combinedHistory,
        timestamp: first.timestamp, // Use the earliest timestamp
        duration: totalDuration,
        inventorySnapshot: last.inventorySnapshot, // Use the latest inventory snapshot
        pricesSnapshot: last.pricesSnapshot, // Use the latest prices
        includedItems: last.includedItems,
        usageSnapshot: mergedUsageSnapshot,
        customName: hourBuckets.find(b => b.customName)?.customName, // Preserve custom name if any bucket has one
        bucketStartTime: first.bucketStartTime || first.timestamp,
        bucketEndTime: last.bucketEndTime || (first.timestamp + totalDuration * 1000),
        sessionId // Keep the session ID
      };

      mergedBuckets.push(mergedBucket);
    }
  }

  // Sort merged buckets by bucket start time
  mergedBuckets.sort((a, b) => (a.bucketStartTime || a.timestamp) - (b.bucketStartTime || b.timestamp));

  return mergedBuckets;
}

/**
 * Merge consecutive hour buckets into a single bucket
 * This combines buckets from consecutive hours (e.g., hour 13 and 14) into one merged entry
 * ONLY merges buckets from the SAME session (same sessionId)
 */
export function mergeConsecutiveHours(buckets: HourlyBucket[]): HourlyBucket[] {
  if (buckets.length === 0) {
    return [];
  }

  // Sort buckets by start time
  const sortedBuckets = [...buckets].sort((a, b) => (a.bucketStartTime || a.timestamp) - (b.bucketStartTime || b.timestamp));

  const merged: HourlyBucket[] = [];
  let currentGroup: HourlyBucket[] = [sortedBuckets[0]];

  for (let i = 1; i < sortedBuckets.length; i++) {
    const prev = sortedBuckets[i - 1];
    const curr = sortedBuckets[i];

    // Only merge if:
    // 1. Same session (same sessionId)
    // 2. Consecutive hours (hour difference of 1, or 23->0 for midnight crossing)
    const sameSession = prev.sessionId === curr.sessionId;
    const consecutiveHours = isConsecutiveHours(prev, curr);

    if (sameSession && consecutiveHours) {
      // Same session and consecutive - add to current group
      currentGroup.push(curr);
    } else {
      // Different session or non-consecutive - merge current group and start new one
      merged.push(mergeBucketsGroup(currentGroup));
      currentGroup = [curr];
    }
  }

  // Don't forget to merge the last group
  if (currentGroup.length > 0) {
    merged.push(mergeBucketsGroup(currentGroup));
  }

  return merged;
}

/**
 * Check if two buckets have consecutive hours
 * Handles midnight crossing (23 -> 0)
 */
function isConsecutiveHours(prev: HourlyBucket, curr: HourlyBucket): boolean {
  const prevHour = new Date(prev.bucketStartTime || prev.timestamp).getHours();
  const currHour = new Date(curr.bucketStartTime || curr.timestamp).getHours();

  // Regular consecutive: 13 -> 14
  if (currHour === prevHour + 1) {
    return true;
  }

  // Midnight crossing: 23 -> 0
  if (prevHour === 23 && currHour === 0) {
    return true;
  }

  return false;
}

/**
 * Merge a group of buckets into a single bucket
 */
function mergeBucketsGroup(buckets: HourlyBucket[]): HourlyBucket {
  if (buckets.length === 1) {
    return buckets[0];
  }

  const first = buckets[0];
  const last = buckets[buckets.length - 1];

  // Sum earnings and durations
  const totalEarnings = buckets.reduce((sum, b) => sum + b.earnings, 0);
  const totalDuration = buckets.reduce((sum, b) => sum + b.duration, 0);

  // Combine and sort history points
  const combinedHistory: { time: number; value: number }[] = [];
  for (const bucket of buckets) {
    combinedHistory.push(...bucket.history);
  }
  combinedHistory.sort((a, b) => a.time - b.time);

  // Merge usage snapshots
  const mergedUsageSnapshot: { [baseId: string]: { used: number; purchased: number } } = {};
  for (const bucket of buckets) {
    for (const [baseId, usage] of Object.entries(bucket.usageSnapshot)) {
      if (!mergedUsageSnapshot[baseId]) {
        mergedUsageSnapshot[baseId] = { used: 0, purchased: 0 };
      }
      mergedUsageSnapshot[baseId].used += usage.used;
      mergedUsageSnapshot[baseId].purchased += usage.purchased;
    }
  }

  // Create merged bucket with the earliest hour number
  const mergedBucket: HourlyBucket = {
    hourNumber: first.hourNumber, // Use the first hour as the representative
    startValue: first.startValue,
    endValue: last.endValue,
    earnings: totalEarnings,
    history: combinedHistory,
    timestamp: first.timestamp,
    duration: totalDuration,
    inventorySnapshot: last.inventorySnapshot,
    pricesSnapshot: last.pricesSnapshot,
    includedItems: last.includedItems,
    usageSnapshot: mergedUsageSnapshot,
    customName: buckets.find(b => b.customName)?.customName,
    bucketStartTime: first.bucketStartTime || first.timestamp,
    bucketEndTime: last.bucketEndTime || (last.timestamp + last.duration * 1000)
  };

  return mergedBucket;
}
