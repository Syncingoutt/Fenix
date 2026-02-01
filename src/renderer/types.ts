// Type definitions for renderer process

export interface InventoryItem {
  itemName: string;
  totalQuantity: number;
  baseId: string;
  price: number | null;
  priceTimestamp: number | null; // Unix timestamp in milliseconds when price was last updated
  instances: number;
  lastUpdated: string;
  pageId: number | null;
  slotId: number | null;
}

export interface PriceCacheEntry {
  price: number;
  timestamp: number;
  listingCount?: number;
  history?: { date: string; price: number }[];
}

export interface PriceCache {
  [baseId: string]: PriceCacheEntry;
}

export interface ElectronAPI {
  getInventory: () => Promise<InventoryItem[]>;
  getItemDatabase: () => Promise<Record<string, { name: string; tradable?: boolean; group?: string }>>;
  getPriceCache: () => Promise<PriceCache>;
  getMapEvents: () => Promise<MapEvent[]>;
  resetMapEvents: () => void;
  onInventoryUpdate: (callback: () => void) => void;
  startHourlyTimer: () => void;
  pauseHourlyTimer: () => void;
  resumeHourlyTimer: () => void;
  stopHourlyTimer: () => void;
  resetRealtimeTimer: () => void;
  getTimerState: () => Promise<{ realtimeSeconds: number; hourlySeconds: number }>;
  onTimerTick: (callback: (data: { type: string; seconds: number }) => void) => void;
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<{ success: boolean; message?: string }>;
  onUpdateStatus: (callback: (data: { status: string; message?: string; version?: string }) => void) => void;
  onUpdateProgress: (callback: (percent: number) => void) => void;
  onShowUpdateDialog: (callback: (data: { type: 'available' | 'downloaded'; version: string; currentVersion?: string }) => void) => void;
  onUpdateDownloadedTransition: (callback: (data: { version: string }) => void) => void;
  onShowUpdatePanel: (callback: (data: { version: string }) => void) => void;
  sendUpdateDialogResponse: (response: 'download' | 'restart' | 'later') => void;
  isLogPathConfigured: () => Promise<boolean>;
  getLogPath: () => Promise<string>;
  selectLogFile: () => Promise<string | null>;
  onShowLogPathSetup: (callback: () => void) => void;
  getSettings: () => Promise<{ keybind?: string; fullscreenMode?: boolean; includeTax?: boolean; leagueId?: string }>;
  saveSettings: (settings: { keybind?: string; fullscreenMode?: boolean; includeTax?: boolean; leagueId?: string }) => Promise<{ success: boolean; error?: string }>;
  getUsernameInfo: () => Promise<{ username?: string; tag?: string; displayName?: string; nextChangeAt?: number; canChange: boolean }>;
  setUsername: (username: string) => Promise<{ success: boolean; error?: string; nextChangeAt?: number }>;
  getCloudSyncStatus: () => Promise<{ enabled: boolean; consent: 'pending' | 'granted' | 'denied' }>;
  setCloudSyncEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  onShowSyncConsent: (callback: () => void) => void;
  testKeybind: (keybind: string) => Promise<{ success: boolean; error?: string }>;
  onCloseSettingsModal: (callback: () => void) => void;
  onWindowModeChanged: (callback: (data: { fullscreenMode: boolean }) => void) => void;
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
  onMaximizeStateChanged: (callback: (isMaximized: boolean) => void) => void;
  getMaximizeState: () => Promise<boolean>;
  openExternal: (url: string) => void;
  toggleOverlayWidget: () => void;
  updateOverlayWidget: (data: { duration: number; hourly: number; total: number; isHourlyMode: boolean; isPaused: boolean }) => void;
  onWidgetPauseHourly: (callback: () => void) => void;
  onWidgetResumeHourly: (callback: () => void) => void;
  onWidgetResetRealtime: (callback: () => void) => void;
  saveHourlySession: (buckets: HourlyBucket[]) => Promise<void>;
  loadHourlySessions: () => Promise<SavedHourlySession[]>;
  deleteHourlySession: (sessionId: string) => Promise<void>;
  clearAllHistory: () => Promise<void>;
  deleteBucketsByDateAndHour: (dateStr: string, hourNumber: number) => Promise<void>;
  updateBucketCustomName: (dateStr: string, hourNumber: number, customName?: string) => Promise<void>;
}

export interface SavedHourlySession {
  sessionId: string;
  startTime: number;
  endTime: number;
  buckets: HourlyBucket[];
}

export interface HourlyBucket {
  hourNumber: number;
  startValue: number;
  endValue: number;
  earnings: number;
  history: { time: number; value: number }[];
  // NEW FIELDS:
  timestamp: number; // Unix timestamp when hour completed
  duration: number; // Total duration in seconds
  inventorySnapshot: string; // HTML string of rendered inventory div
  pricesSnapshot: PriceCache; // Complete price cache at hour end
  includedItems: string[]; // Array of baseIds for tracked compasses/beacons
  usageSnapshot: { [baseId: string]: { used: number; purchased: number } }; // Compass/beacon usage (use object for JSON serialization)
  customName?: string; // Optional custom name for the hour bucket
  bucketStartTime?: number; // Unix timestamp when this bucket actually started
  bucketEndTime?: number; // Unix timestamp when this bucket actually ended
  sessionId?: string; // ID of the session this bucket belongs to (for session-aware merging)
}

export interface ItemDatabase {
  [baseId: string]: {
    name: string;
    tradable?: boolean;
    group?: string;
  };
}

export type WealthMode = 'realtime' | 'hourly';
export type SortBy = 'priceUnit' | 'priceTotal';
export type SortOrder = 'asc' | 'desc';
export type UpdateType = 'available' | 'downloaded';

export interface MapEvent {
  timestamp: string;
  eventType: 'map_start' | 'map_end' | 'beacon_used';
  zonePath?: string;
  levelId?: number;
  beaconBaseId?: string;
  beaconName?: string;
  zoneEnglishName?: string;
  isHideout?: boolean; // Tag hideout events
}