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

export interface ElectronAPI {
  getInventory: () => Promise<InventoryItem[]>;
  getItemDatabase: () => Promise<Record<string, { name: string; tradable?: boolean; group?: string }>>;
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
  sendUpdateDialogResponse: (response: 'download' | 'restart' | 'later') => void;
  isLogPathConfigured: () => Promise<boolean>;
  selectLogFile: () => Promise<string | null>;
  onShowLogPathSetup: (callback: () => void) => void;
  getSettings: () => Promise<{ keybind?: string; fullscreenMode?: boolean; includeTax?: boolean }>;
  saveSettings: (settings: { keybind?: string; fullscreenMode?: boolean; includeTax?: boolean }) => Promise<{ success: boolean; error?: string }>;
  testKeybind: (keybind: string) => Promise<{ success: boolean; error?: string }>;
  onCloseSettingsModal: (callback: () => void) => void;
  onWindowModeChanged: (callback: (data: { fullscreenMode: boolean }) => void) => void;
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
  onMaximizeStateChanged: (callback: (isMaximized: boolean) => void) => void;
  getMaximizeState: () => Promise<boolean>;
  toggleOverlayWidget: () => void;
  updateOverlayWidget: (data: { duration: number; hourly: number; total: number; isHourlyMode: boolean; isPaused: boolean }) => void;
  onWidgetPauseHourly: (callback: () => void) => void;
  onWidgetResumeHourly: (callback: () => void) => void;
}

export interface HourlyBucket {
  hourNumber: number;
  startValue: number;
  endValue: number;
  earnings: number;
  history: { time: number; value: number }[];
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
