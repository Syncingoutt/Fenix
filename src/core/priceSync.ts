import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { initializeApp, FirebaseApp } from 'firebase/app';
import { initializeAuth, signInAnonymously, Auth } from 'firebase/auth';
import { getFirestore, Firestore, collection, getDocs, doc, getDoc, setDoc, Timestamp, serverTimestamp, query, where, orderBy, startAfter, limit, QueryConstraint } from 'firebase/firestore';
import { PriceCache, PriceCacheEntry } from './database';

export interface PriceUpdateEntry {
  price: number;
  timestamp: number;
  listingCount?: number;
}

export interface PriceSyncStatus {
  pendingCount: number;
  isProcessing: boolean;
  lastError?: string;
}

type SyncConsent = 'pending' | 'granted' | 'denied';

interface CloudSyncConfig {
  enabled?: boolean;
  syncConsent?: SyncConsent;
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    appId: string;
    messagingSenderId?: string;
    storageBucket?: string;
  };
  username?: string;
  tag?: string;
  lastSyncCursorMs?: number;
  lastUsernameChangeMs?: number;
}


interface QueueItem {
  baseId: string;
  entry: PriceUpdateEntry;
  attempts: number;
  enqueuedAt: number;
  nextAttemptAt?: number;
}

const CONFIG_FILENAME = 'cloud_sync.json';
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAvz0DRZIJLNHQsHmPg7LaUq9s3N2eEQtg',
  authDomain: 'fenix-2c341.firebaseapp.com',
  projectId: 'fenix-2c341',
  appId: '1:387287127608:web:c4e5aa07b3b91389c5b8cd',
  messagingSenderId: '387287127608',
  storageBucket: 'fenix-2c341.firebasestorage.app'
};
const DEFAULT_CONFIG: CloudSyncConfig = {
  enabled: false,
  syncConsent: 'pending',
  firebase: {
    ...DEFAULT_FIREBASE_CONFIG
  },
  username: '',
  tag: ''
};

const QUEUE_INTERVAL_MS = 500; // 2 updates/sec -> 120/min
const MAX_RETRIES = 3;
const SYNC_CACHE_TTL_MS = 5000;
const USERNAME_COOLDOWN_MS = 24 * 60 * 60 * 1000;

type PersistenceValue = Record<string, unknown> | string;
type StorageListener = (value: PersistenceValue | null) => void;

interface FilePersistenceInternal {
  type: 'LOCAL' | 'SESSION' | 'NONE';
  _isAvailable(): Promise<boolean>;
  _set(key: string, value: PersistenceValue): Promise<void>;
  _get<T extends PersistenceValue>(key: string): Promise<T | null>;
  _remove(key: string): Promise<void>;
  _addListener(key: string, listener: StorageListener): void;
  _removeListener(key: string, listener: StorageListener): void;
}

const AUTH_PERSISTENCE_FILE = 'firebase_auth.json';
const persistenceListeners = new Map<string, Set<StorageListener>>();
let persistenceCache: Record<string, PersistenceValue> | null = null;

function getAuthPersistencePath(): string {
  return path.join(app.getPath('userData'), AUTH_PERSISTENCE_FILE);
}

function loadPersistenceStore(): Record<string, PersistenceValue> {
  if (persistenceCache) return persistenceCache;

  const filePath = getAuthPersistencePath();
  if (fs.existsSync(filePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const store = raw && typeof raw === 'object' ? raw : {};
      persistenceCache = store;
      return store;
    } catch {
      // fall through to empty store
    }
  }

  persistenceCache = {};
  return persistenceCache;
}

function savePersistenceStore(store: Record<string, PersistenceValue>): void {
  persistenceCache = store;
  fs.writeFileSync(getAuthPersistencePath(), JSON.stringify(store, null, 2), 'utf-8');
}

function notifyListeners(key: string, value: PersistenceValue | null): void {
  const listeners = persistenceListeners.get(key);
  if (!listeners) return;
  for (const listener of listeners) {
    listener(value);
  }
}

class FilePersistenceImpl implements FilePersistenceInternal {
  type: 'LOCAL' | 'SESSION' | 'NONE' = 'LOCAL';

  async _isAvailable() {
    try {
      loadPersistenceStore();
      return true;
    } catch {
      return false;
    }
  }

  async _set(key: string, value: PersistenceValue) {
    const store = loadPersistenceStore();
    store[key] = value;
    savePersistenceStore(store);
    notifyListeners(key, value);
  }

  async _get<T extends PersistenceValue>(key: string): Promise<T | null> {
    const store = loadPersistenceStore();
    return (store[key] ?? null) as T | null;
  }

  async _remove(key: string) {
    const store = loadPersistenceStore();
    delete store[key];
    savePersistenceStore(store);
    notifyListeners(key, null);
  }

  _addListener(key: string, listener: StorageListener) {
    if (!persistenceListeners.has(key)) {
      persistenceListeners.set(key, new Set());
    }
    persistenceListeners.get(key)!.add(listener);
  }

  _removeListener(key: string, listener: StorageListener) {
    const listeners = persistenceListeners.get(key);
    if (!listeners) return;
    listeners.delete(listener);
    if (listeners.size === 0) {
      persistenceListeners.delete(key);
    }
  }
}

function getConfigPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILENAME);
}

function loadCloudSyncConfig(): CloudSyncConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const mergedConfig: CloudSyncConfig = {
      ...DEFAULT_CONFIG,
      ...raw,
      firebase: {
        ...DEFAULT_CONFIG.firebase,
        ...(raw.firebase || {})
      }
    };

    const updatedConfig = normalizeSyncConsent(applyDefaultFirebaseConfig(mergedConfig));
    if (updatedConfig !== mergedConfig) {
      saveCloudSyncConfig(updatedConfig);
    }

    return updatedConfig;
  } catch (error) {
    console.error('Failed to read cloud sync config, using defaults:', error);
    return { ...DEFAULT_CONFIG };
  }
}

function applyDefaultFirebaseConfig(config: CloudSyncConfig): CloudSyncConfig {
  const firebase = { ...config.firebase };
  let updated = false;

  (Object.keys(DEFAULT_FIREBASE_CONFIG) as Array<keyof typeof DEFAULT_FIREBASE_CONFIG>).forEach(key => {
    const value = firebase[key];
    if (!value || String(value).trim() === '') {
      firebase[key] = DEFAULT_FIREBASE_CONFIG[key];
      updated = true;
    }
  });

  const updatedConfig: CloudSyncConfig = {
    ...config,
    firebase
  };

  return updated ? updatedConfig : config;
}

function normalizeSyncConsent(config: CloudSyncConfig): CloudSyncConfig {
  let syncConsent = config.syncConsent;
  let enabled = config.enabled;

  if (!syncConsent) {
    syncConsent = 'pending';
  }

  if (syncConsent === 'pending') {
    enabled = false;
  } else if (syncConsent === 'granted') {
    enabled = true;
  } else if (syncConsent === 'denied') {
    enabled = false;
  }

  if (config.syncConsent === syncConsent && config.enabled === enabled) {
    return config;
  }

  return {
    ...config,
    syncConsent,
    enabled
  };
}

function saveCloudSyncConfig(config: CloudSyncConfig): void {
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

function hasFirebaseConfig(config: CloudSyncConfig): boolean {
  const firebase = config.firebase;
  return !!firebase.apiKey && !!firebase.authDomain && !!firebase.projectId && !!firebase.appId;
}

function normalizeUsername(username: string): string {
  return username.trim().replace('#', '');
}

function generateTag(): string {
  return Math.floor(Math.random() * 10000).toString().padStart(4, '0');
}

export class PriceSyncService {
  private config: CloudSyncConfig | null = null;
  private app: FirebaseApp | null = null;
  private auth: Auth | null = null;
  private db: Firestore | null = null;
  private userId: string | null = null;
  private displayName: string | null = null;
  private queue: QueueItem[] = [];
  private inFlight = false;
  private queueTimer: NodeJS.Timeout | null = null;
  private lastError: string | null = null;
  private lastSyncAt = 0;
  private lastSyncCache: PriceCache = {};
  private initializing: Promise<boolean> | null = null;
  private onRemoteUpdate?: (baseId: string, entry: PriceCacheEntry) => void;
  private disabledLogged = false;
  private configErrorLogged = false;
  private lastSyncCursorMs: number | null = null;
  private currentConsent: SyncConsent = 'pending';

  getConfigPath(): string {
    return getConfigPath();
  }

  getSyncStatus(): { enabled: boolean; consent: SyncConsent } {
    if (!this.config) {
      this.config = loadCloudSyncConfig();
    }
    const normalized = normalizeSyncConsent(this.config);
    if (normalized !== this.config) {
      this.config = normalized;
      saveCloudSyncConfig(this.config);
    }
    const enabled = this.config.enabled === true;
    const consent = this.config.syncConsent ?? 'pending';
    this.currentConsent = consent;
    return { enabled, consent };
  }

  async setSyncEnabled(enabled: boolean): Promise<void> {
    if (!this.config) {
      this.config = loadCloudSyncConfig();
    }
    const consent: SyncConsent = enabled ? 'granted' : 'denied';
    this.config.enabled = enabled;
    this.config.syncConsent = consent;
    saveCloudSyncConfig(this.config);
    this.currentConsent = consent;

    if (enabled) {
      await this.initialize();
    } else {
      this.queue = [];
      if (this.queueTimer) {
        clearInterval(this.queueTimer);
        this.queueTimer = null;
      }
      this.inFlight = false;
    }
  }

  setRemoteUpdateHandler(handler: (baseId: string, entry: PriceCacheEntry) => void): void {
    this.onRemoteUpdate = handler;
  }

  async initialize(): Promise<boolean> {
    if (this.initializing) {
      return this.initializing;
    }

    this.initializing = this.initializeInternal();
    const result = await this.initializing;
    this.initializing = null;
    return result;
  }

  private async initializeInternal(): Promise<boolean> {
    this.config = loadCloudSyncConfig();
    if (this.config.syncConsent) {
      this.currentConsent = this.config.syncConsent;
    }
    if (typeof this.config.lastSyncCursorMs === 'number') {
      this.lastSyncCursorMs = this.config.lastSyncCursorMs;
    }

    if (!this.config.enabled) {
      if (!this.disabledLogged) {
        // Cloud sync disabled
        this.disabledLogged = true;
      }
      return false;
    }

    if (!hasFirebaseConfig(this.config)) {
      if (!this.configErrorLogged) {
        console.warn('[sync] Firebase config missing in cloud_sync.json. Sync disabled.');
        this.configErrorLogged = true;
      }
      return false;
    }

    if (!this.app) {
      this.app = initializeApp(this.config.firebase);
    }

    if (!this.auth) {
      this.auth = initializeAuth(this.app, { persistence: FilePersistenceImpl as any });
    }

    if (!this.db) {
      this.db = getFirestore(this.app);
    }

    if (!this.userId) {
      await this.auth.authStateReady();
      const existingUser = this.auth.currentUser;
      if (existingUser) {
        this.userId = existingUser.uid;
      } else {
        const authResult = await signInAnonymously(this.auth);
        this.userId = authResult.user.uid;
      }
    }

    await this.ensureUserProfile();
    this.startQueueProcessing();
    return true;
  }

  private async ensureUserProfile(): Promise<void> {
    if (!this.db || !this.config || !this.userId) return;

    const userRef = doc(this.db, 'users', this.userId);
    const snapshot = await getDoc(userRef);
    const now = Date.now();
    const updatePayload: Record<string, unknown> = {
      lastSeenAt: now
    };

    if (!snapshot.exists()) {
      updatePayload.createdAt = now;
    }

    const rawUsername = normalizeUsername(this.config.username || '');
    if (rawUsername.length >= 3 && rawUsername.length <= 20) {
      let tag = (this.config.tag || '').trim();
      if (!tag) {
        tag = generateTag();
        this.config.tag = tag;
        saveCloudSyncConfig(this.config);
      }
      if (!this.config.lastUsernameChangeMs) {
        this.config.lastUsernameChangeMs = now;
        saveCloudSyncConfig(this.config);
      }
      this.displayName = `${rawUsername}#${tag}`;
      updatePayload.username = rawUsername;
      updatePayload.tag = tag;
      updatePayload.displayName = this.displayName;
    }

    await setDoc(userRef, updatePayload, { merge: true });
  }

  getUsernameInfo(): { username?: string; tag?: string; displayName?: string; nextChangeAt?: number; canChange: boolean } {
    if (!this.config) {
      this.config = loadCloudSyncConfig();
    }
    const config = this.config;
    const username = normalizeUsername(config.username || '');
    const tag = (config.tag || '').trim() || undefined;
    const displayName = username && tag ? `${username}#${tag}` : undefined;
    const lastChange = config.lastUsernameChangeMs ?? 0;
    const nextChangeAt = lastChange ? lastChange + USERNAME_COOLDOWN_MS : undefined;
    const canChange = !lastChange || Date.now() - lastChange >= USERNAME_COOLDOWN_MS;

    return { username: username || undefined, tag, displayName, nextChangeAt, canChange };
  }

  async setUsername(username: string, tag?: string): Promise<void> {
    if (!this.config) {
      this.config = loadCloudSyncConfig();
    }

    const normalized = normalizeUsername(username);
    if (normalized.length > 0 && (normalized.length < 3 || normalized.length > 20)) {
      throw new Error('Username must be 3-20 characters.');
    }

    const now = Date.now();
    const lastChange = this.config.lastUsernameChangeMs ?? 0;
    if (lastChange && now - lastChange < USERNAME_COOLDOWN_MS) {
      const nextChangeAt = lastChange + USERNAME_COOLDOWN_MS;
      throw new Error(`Username can only be changed every 24 hours. Next change available at ${new Date(nextChangeAt).toLocaleString()}.`);
    }

    if (normalized === (this.config.username || '') && normalized !== '') {
      return;
    }

    const finalTag = (tag || this.config.tag || generateTag()).trim();
    this.config.username = normalized;
    this.config.tag = finalTag;
    this.config.lastUsernameChangeMs = now;
    saveCloudSyncConfig(this.config);

    await this.initialize();
    if (!this.db || !this.userId) return;

    const userRef = doc(this.db, 'users', this.userId);
    this.displayName = normalized ? `${normalized}#${finalTag}` : null;
    await setDoc(userRef, {
      username: normalized || null,
      tag: normalized ? finalTag : null,
      displayName: this.displayName,
      updatedAt: now
    }, { merge: true });
  }

  async syncPrices(options?: { forceFull?: boolean }): Promise<PriceCache> {
    const ready = await this.initialize();
    if (!ready || !this.db) {
      return {};
    }

    const now = Date.now();
    if (!options?.forceFull && now - this.lastSyncAt < SYNC_CACHE_TTL_MS) {
      return this.lastSyncCache;
    }

    try {
      const cache: PriceCache = {};
      const cursorMs = this.lastSyncCursorMs ?? 0;
      const useIncremental = !options?.forceFull && cursorMs > 0;
      let maxUpdatedAtMs = useIncremental ? cursorMs : 0;
      
      if (useIncremental) {
        let lastDoc: unknown | null = null;
        let batchSize = 0;
        do {
          const constraints: QueryConstraint[] = [
            where('updatedAt', '>', Timestamp.fromMillis(cursorMs)),
            orderBy('updatedAt'),
            limit(500)
          ];
          if (lastDoc) {
            constraints.push(startAfter(lastDoc as any));
          }

          const snapshot = await getDocs(query(collection(this.db, 'prices'), ...constraints));
          batchSize = snapshot.size;
          if (batchSize === 0) break;

          snapshot.forEach(docSnap => {
            const data = docSnap.data() as Record<string, unknown>;
            const price = typeof data.price === 'number' ? data.price : null;
            const timestamp = typeof data.timestamp === 'number' ? data.timestamp : null;
            if (price === null || timestamp === null) return;
            const listingCount = typeof data.listingCount === 'number' ? data.listingCount : undefined;

            cache[docSnap.id] = {
              price,
              timestamp,
              ...(listingCount !== undefined && { listingCount })
            };

            const updatedAt = data.updatedAt;
            if (updatedAt instanceof Timestamp) {
              const updatedAtMs = updatedAt.toMillis();
              if (updatedAtMs > maxUpdatedAtMs) {
                maxUpdatedAtMs = updatedAtMs;
              }
            }
          });

          lastDoc = snapshot.docs[snapshot.docs.length - 1] ?? null;
        } while (batchSize === 500);
      } else {
        const snapshot = await getDocs(collection(this.db, 'prices'));
        snapshot.forEach(docSnap => {
          const data = docSnap.data() as Record<string, unknown>;
          const price = typeof data.price === 'number' ? data.price : null;
          const timestamp = typeof data.timestamp === 'number' ? data.timestamp : null;
          if (price === null || timestamp === null) return;
          const listingCount = typeof data.listingCount === 'number' ? data.listingCount : undefined;

          cache[docSnap.id] = {
            price,
            timestamp,
            ...(listingCount !== undefined && { listingCount })
          };

          const updatedAt = data.updatedAt;
          if (updatedAt instanceof Timestamp) {
            const updatedAtMs = updatedAt.toMillis();
            if (updatedAtMs > maxUpdatedAtMs) {
              maxUpdatedAtMs = updatedAtMs;
            }
          }
        });
      }

      if (maxUpdatedAtMs && maxUpdatedAtMs !== this.lastSyncCursorMs) {
        this.lastSyncCursorMs = maxUpdatedAtMs;
        if (this.config) {
          this.config.lastSyncCursorMs = maxUpdatedAtMs;
          saveCloudSyncConfig(this.config);
        }
      } else if (!this.lastSyncCursorMs || this.lastSyncCursorMs === 0) {
        // Fallback to avoid repeated full syncs if updatedAt is missing
        const fallbackCursor = Date.now() - 5 * 60 * 1000;
        this.lastSyncCursorMs = fallbackCursor;
        if (this.config) {
          this.config.lastSyncCursorMs = fallbackCursor;
          saveCloudSyncConfig(this.config);
        }
      }

      this.lastSyncAt = now;
      this.lastSyncCache = cache;
      return cache;
    } catch (error) {
      console.error('Failed to sync prices from cloud:', error);
      return {};
    }
  }

  queuePriceUpdate(baseId: string, entry: PriceUpdateEntry): void {
    if (!/^\d+$/.test(baseId)) {
      return;
    }

    if (!Number.isFinite(entry.price) || !Number.isFinite(entry.timestamp)) {
      return;
    }

    if (!this.config) {
      this.config = loadCloudSyncConfig();
    }
    if (!this.config.enabled || !hasFirebaseConfig(this.config)) {
      return;
    }

    this.initialize().catch(error => {
      console.error('Failed to initialize cloud sync:', error);
    });

    this.queue = this.queue.filter(item => !(item.baseId === baseId && item.entry.timestamp <= entry.timestamp));

    this.queue.push({
      baseId,
      entry,
      attempts: 0,
      enqueuedAt: Date.now()
    });

    this.queue.sort((a, b) => b.entry.timestamp - a.entry.timestamp);
    this.startQueueProcessing();
  }

  getQueueStatus(): PriceSyncStatus {
    return {
      pendingCount: this.queue.length,
      isProcessing: this.inFlight || !!this.queueTimer,
      ...(this.lastError && { lastError: this.lastError })
    };
  }

  private startQueueProcessing(): void {
    if (this.queueTimer) return;
    this.queueTimer = setInterval(() => {
      this.processNext().catch(error => {
        console.error('Queue processing error:', error);
      });
    }, QUEUE_INTERVAL_MS);
  }

  private async processNext(): Promise<void> {
    if (this.inFlight || this.queue.length === 0) {
      return;
    }

    const now = Date.now();
    const nextIndex = this.queue.findIndex(item => !item.nextAttemptAt || item.nextAttemptAt <= now);
    if (nextIndex === -1) {
      return;
    }

    const [item] = this.queue.splice(nextIndex, 1);
    this.inFlight = true;

    try {
      await this.pushUpdate(item);
      this.lastError = null;
    } catch (error: any) {
      const code = error?.code || '';
      const isPermissionDenied = code === 'permission-denied';
      const isRateLimited = code === 'resource-exhausted' || code === 'unavailable';

      item.attempts += 1;
      if (item.attempts <= MAX_RETRIES) {
        const backoff = isRateLimited ? 5000 : Math.min(30000, 1000 * Math.pow(2, item.attempts));
        item.nextAttemptAt = Date.now() + backoff;
        this.queue.push(item);
        this.queue.sort((a, b) => b.entry.timestamp - a.entry.timestamp);
        this.lastError = isPermissionDenied ? 'Permission denied. Check Firestore rules.' : 
                        isRateLimited ? 'Rate limited. Retrying...' : 'Sync failed. Retrying...';
      } else {
        this.lastError = 'Sync failed after retries.';
      }
    } finally {
      this.inFlight = false;
    }
  }

  private async pushUpdate(item: QueueItem): Promise<void> {
    const ready = await this.initialize();
    if (!ready || !this.db || !this.userId) {
      throw new Error('Cloud sync not ready');
    }

    const priceRef = doc(this.db, 'prices', item.baseId);
    
    // Read current server state
    const snapshot = await getDoc(priceRef);
    
    // Check if server has newer data
    if (snapshot.exists()) {
      const serverData = snapshot.data();
      const serverTimestamp = serverData.timestamp as number;
      
      if (serverTimestamp > item.entry.timestamp) {
        // Server is newer, use server's data
        if (this.onRemoteUpdate) {
          const serverEntry: PriceCacheEntry = {
            price: serverData.price as number,
            timestamp: serverTimestamp,
            ...(serverData.listingCount !== undefined && { listingCount: serverData.listingCount as number })
          };
          this.onRemoteUpdate(item.baseId, serverEntry);
        }
        return; // Skip update, server has newer data
      }
      
      if (serverTimestamp === item.entry.timestamp) {
        const serverListings = (serverData.listingCount as number) ?? 0;
        const localListings = item.entry.listingCount ?? 0;
        if (serverListings > localListings) {
          // Server has more listings, use server's data
          if (this.onRemoteUpdate) {
            const serverEntry: PriceCacheEntry = {
              price: serverData.price as number,
              timestamp: serverTimestamp,
              ...(serverData.listingCount !== undefined && { listingCount: serverData.listingCount as number })
            };
            this.onRemoteUpdate(item.baseId, serverEntry);
          }
          return; // Skip update, server has better data
        }
      }
    }
    
    // Write our update (Firestore rules will validate)
    try {
      await setDoc(priceRef, {
        price: item.entry.price,
        timestamp: item.entry.timestamp,
        listingCount: item.entry.listingCount ?? null,
        userId: this.userId,
        updatedAt: serverTimestamp()
      }, { merge: false });
    } catch (writeError: any) {
      // If write was rejected (permission-denied), re-read server data
      // This handles race conditions where server was updated between our read and write
      if (writeError?.code === 'permission-denied') {
        console.warn(`[sync] Price sync blocked for ${item.baseId}. Check Firestore rules.`);
        const updatedSnapshot = await getDoc(priceRef);
        if (updatedSnapshot.exists()) {
          const serverData = updatedSnapshot.data();
          const serverTimestamp = serverData.timestamp as number;
          if (serverTimestamp >= item.entry.timestamp && this.onRemoteUpdate) {
            const serverEntry: PriceCacheEntry = {
              price: serverData.price as number,
              timestamp: serverTimestamp,
              ...(serverData.listingCount !== undefined && { listingCount: serverData.listingCount as number })
            };
            this.onRemoteUpdate(item.baseId, serverEntry);
          }
        }
        // Don't throw - we've handled it by updating from server
        return;
      }
      throw writeError; // Re-throw other errors
    }
  }
}
