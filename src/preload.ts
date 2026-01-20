import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getInventory: () => ipcRenderer.invoke('get-inventory'),
  getItemDatabase: () => ipcRenderer.invoke('get-item-database'),
  onInventoryUpdate: (callback: () => void) => {
    ipcRenderer.on('inventory-updated', callback);
  },
  toggleWindow: () => ipcRenderer.send('toggle-window'),
  
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
  sendUpdateDialogResponse: (response: 'download' | 'restart' | 'later') => {
    ipcRenderer.send('update-dialog-response', response);
  },
  // Log path configuration methods
  getLogPath: () => ipcRenderer.invoke('get-log-path'),
  isLogPathConfigured: () => ipcRenderer.invoke('is-log-path-configured'),
  selectLogFile: () => ipcRenderer.invoke('select-log-file'),
  onShowLogPathSetup: (callback: () => void) => {
    ipcRenderer.on('show-log-path-setup', callback);
  },
  // Settings methods
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: { keybind?: string; fullscreenMode?: boolean; includeTax?: boolean }) => ipcRenderer.invoke('save-settings', settings),
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
  getMaximizeState: () => ipcRenderer.invoke('get-maximize-state')
});