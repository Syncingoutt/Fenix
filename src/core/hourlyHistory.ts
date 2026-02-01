import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { HourlyBucket } from '../renderer/types.js';
import { mergeBucketsByHour } from '../utils/bucketUtils.js';

export interface SavedHourlySession {
  sessionId: string;
  startTime: number;
  endTime: number;
  buckets: HourlyBucket[];
}

const HOURLY_HISTORY_FILE = getUserDataPath('hourly_history.json');

function getUserDataPath(filename: string): string {
  return path.join(app.getPath('userData'), filename);
}

/**
 * Save a complete hourly session to disk
 */
export async function saveHourlySession(buckets: HourlyBucket[]): Promise<void> {
  try {
    const sessions = await loadHourlySessions();
    
    // Merge buckets with same hour number before saving
    const mergedBuckets = mergeBucketsByHour(buckets);
    
    // Create new session
    const newSession: SavedHourlySession = {
      sessionId: generateSessionId(),
      startTime: mergedBuckets.length > 0 ? mergedBuckets[0].timestamp : Date.now(),
      endTime: Date.now(),
      buckets: mergedBuckets
    };
    
    sessions.push(newSession);
    
    // Keep only last 30 sessions
    const recentSessions = sessions.slice(-30);
    
    // Ensure directory exists
    const dir = path.dirname(HOURLY_HISTORY_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    await fs.promises.writeFile(HOURLY_HISTORY_FILE, JSON.stringify(recentSessions, null, 2));
  } catch (error) {
    console.error('Failed to save hourly session:', error);
  }
}

/**
 * Load all saved hourly sessions from disk
 */
export async function loadHourlySessions(): Promise<SavedHourlySession[]> {
  try {
    if (!fs.existsSync(HOURLY_HISTORY_FILE)) {
      return [];
    }
    
    const data = await fs.promises.readFile(HOURLY_HISTORY_FILE, 'utf-8');
    const sessions: SavedHourlySession[] = JSON.parse(data);
    
    return sessions;
  } catch (error) {
    console.error('Failed to load hourly sessions:', error);
    return [];
  }
}

/**
 * Delete a specific session by ID
 */
export async function deleteHourlySession(sessionId: string): Promise<void> {
  try {
    const sessions = await loadHourlySessions();
    const filteredSessions = sessions.filter(s => s.sessionId !== sessionId);

    await fs.promises.writeFile(HOURLY_HISTORY_FILE, JSON.stringify(filteredSessions, null, 2));
  } catch (error) {
    console.error('Failed to delete hourly session:', error);
  }
}

/**
 * Clear all history
 */
export async function clearAllHistory(): Promise<void> {
  try {
    await fs.promises.writeFile(HOURLY_HISTORY_FILE, JSON.stringify([], null, 2));
  } catch (error) {
    console.error('Failed to clear all history:', error);
    throw error;
  }
}

/**
 * Delete specific buckets from history by date and bucket start time
 */
export async function deleteBucketsByDateAndHour(dateStr: string, bucketStartTime: number): Promise<void> {
  try {
    const sessions = await loadHourlySessions();
    let hasChanges = false;

    for (const session of sessions) {
      const originalLength = session.buckets.length;
      // Filter out buckets matching the date and bucket start time
      session.buckets = session.buckets.filter(bucket => {
        const bucketDate = new Date(bucket.timestamp);
        const bucketDateStr = formatDate(bucketDate);
        return bucketDateStr !== dateStr || bucket.bucketStartTime !== bucketStartTime;
      });

      if (session.buckets.length !== originalLength) {
        hasChanges = true;
      }
    }

    // Remove sessions that have no buckets left
    const filteredSessions = sessions.filter(s => s.buckets.length > 0);

    if (hasChanges) {
      await fs.promises.writeFile(HOURLY_HISTORY_FILE, JSON.stringify(filteredSessions, null, 2));
    }
  } catch (error) {
    console.error('Failed to delete buckets:', error);
    throw error;
  }
}

/**
 * Update custom name for a specific bucket
 */
export async function updateBucketCustomName(dateStr: string, bucketStartTime: number, customName?: string): Promise<void> {
  try {
    const sessions = await loadHourlySessions();
    let hasChanges = false;

    for (const session of sessions) {
      for (const bucket of session.buckets) {
        const bucketDate = new Date(bucket.timestamp);
        const bucketDateStr = formatDate(bucketDate);

        if (bucketDateStr === dateStr && bucket.bucketStartTime === bucketStartTime) {
          if (bucket.customName !== customName) {
            bucket.customName = customName;
            hasChanges = true;
          }
        }
      }
    }

    if (hasChanges) {
      await fs.promises.writeFile(HOURLY_HISTORY_FILE, JSON.stringify(sessions, null, 2));
    }
  } catch (error) {
    console.error('Failed to update bucket custom name:', error);
    throw error;
  }
}

/**
 * Format date to YYYY-MM-DD string
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
