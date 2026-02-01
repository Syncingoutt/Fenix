import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getInventory: () => ipcRenderer.invoke('get-inventory'),
  getItemDatabase: () => ipcRenderer.invoke('get-item-database'),
  getPriceCache: () => ipcRenderer.invoke('get-price-cache'),
  getMapEvents: () => ipcRenderer.invoke('get-map-events'),
  resetMapEvents: () => ipcRenderer.send('reset-map-events'),
  onInventoryUpdate: (callback: () => void) => {
    ipcRenderer.on('inventory-updated', callback);
  },
  // Timer control methods
  startHourlyTimer: () => ipcRenderer.send('start-hourly-timer'),
  pauseHourlyTimer: () => ipcRenderer.send('pause-hourly-timer'),
  resumeHourlyTimer: () => ipcRenderer.send('resume-hourly-timer'),
  stopHourlyTimer: () => ipcRenderer.send('stop-hourly-timer'),
  resetRealtimeTimer: () => ipcRenderer.send('reset-realtime-timer'),
  getTimerState: () => ipcRenderer.invoke('get-timer-state'),
  onTimerTick: (callback: (data: { type: string; seconds: number }) => void) => {
    ipcRenderer.on('timer-tick', (_event, data) => callback(data));
  },
  
  // Update methods
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onUpdateStatus: (callback: (data: { status: string; message?: string; version?: string }) => void) => {
    ipcRenderer.on('update-status', (_event, data) => callback(data));
  },
  onUpdateProgress: (callback: (percent: number) => void) => {
    ipcRenderer.on('update-download-progress', (_event, percent) => callback(percent));
  },
    // Update dialog methods
    onShowUpdateDialog: (callback: (data: { type: 'available' | 'downloaded'; version: string; currentVersion?: string }) => void) => {
      ipcRenderer.on('show-update-dialog', (_event, data) => callback(data));
    },
    onUpdateDownloadedTransition: (callback: (data: { version: string }) => void) => {
      ipcRenderer.on('update-downloaded-transition', (_event, data) => callback(data));
    },
    onShowUpdatePanel: (callback: (data: { version: string }) => void) => {
      ipcRenderer.on('show-update-panel', (_event, data) => callback(data));
    },
    sendUpdateDialogResponse: (response: 'download' | 'restart' | 'later') => {
      ipcRenderer.send('update-dialog-response', response);
    },
    // Log path configuration methods
  isLogPathConfigured: () => ipcRenderer.invoke('is-log-path-configured'),
  getLogPath: () => ipcRenderer.invoke('get-log-path'),
  selectLogFile: () => ipcRenderer.invoke('select-log-file'),
  onShowLogPathSetup: (callback: () => void) => {
    ipcRenderer.on('show-log-path-setup', callback);
  },
  // Settings methods
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: { keybind?: string; fullscreenMode?: boolean; includeTax?: boolean; leagueId?: string }) => ipcRenderer.invoke('save-settings', settings),
  getUsernameInfo: () => ipcRenderer.invoke('get-username-info'),
  setUsername: (username: string) => ipcRenderer.invoke('set-username', username),
  getCloudSyncStatus: () => ipcRenderer.invoke('get-cloud-sync-status'),
  setCloudSyncEnabled: (enabled: boolean) => ipcRenderer.invoke('set-cloud-sync-enabled', enabled),
  onShowSyncConsent: (callback: () => void) => {
    ipcRenderer.on('show-sync-consent', callback);
  },
  testKeybind: (keybind: string) => ipcRenderer.invoke('test-keybind', keybind),
  onCloseSettingsModal: (callback: () => void) => {
    ipcRenderer.on('close-settings-modal', callback);
  },
  onWindowModeChanged: (callback: (data: { fullscreenMode: boolean }) => void) => {
    ipcRenderer.on('window-mode-changed', (_event, data) => callback(data));
  },
  minimizeWindow: () => {
    ipcRenderer.send('minimize-window');
  },
  maximizeWindow: () => {
    ipcRenderer.send('maximize-window');
  },
  closeWindow: () => {
    ipcRenderer.send('close-window');
  },
  onMaximizeStateChanged: (callback: (isMaximized: boolean) => void) => {
    ipcRenderer.on('maximize-state-changed', (_event, isMaximized) => callback(isMaximized));
  },
  getMaximizeState: () => ipcRenderer.invoke('get-maximize-state'),
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  // Overlay widget methods
  toggleOverlayWidget: () => ipcRenderer.send('toggle-overlay-widget'),
  updateOverlayWidget: (data: { duration: number; hourly: number; total: number; isHourlyMode: boolean; isPaused: boolean }) => 
    ipcRenderer.send('update-overlay-widget', data),
  onWidgetPauseHourly: (callback: () => void) => {
    ipcRenderer.on('widget-pause-hourly', callback);
  },
  onWidgetResumeHourly: (callback: () => void) => {
    ipcRenderer.on('widget-resume-hourly', callback);
  },
  onWidgetResetRealtime: (callback: () => void) => {
    ipcRenderer.on('widget-reset-realtime', callback);
  },
  // Hourly history methods
  saveHourlySession: (buckets: any[]) => ipcRenderer.invoke('save-hourly-session', buckets),
  loadHourlySessions: () => ipcRenderer.invoke('load-hourly-sessions'),
  deleteHourlySession: (sessionId: string) => ipcRenderer.invoke('delete-hourly-session', sessionId),
  clearAllHistory: () => ipcRenderer.invoke('clear-all-history'),
  deleteBucketsByDateAndHour: (dateStr: string, hourNumber: number) => ipcRenderer.invoke('delete-buckets-by-date-hour', dateStr, hourNumber),
  updateBucketCustomName: (dateStr: string, hourNumber: number, customName?: string) => ipcRenderer.invoke('update-bucket-custom-name', dateStr, hourNumber, customName)
});