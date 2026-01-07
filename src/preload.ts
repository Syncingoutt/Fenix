import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getInventory: () => ipcRenderer.invoke('get-inventory'),
  onInventoryUpdate: (callback: () => void) => {
    ipcRenderer.on('inventory-updated', callback);
  },
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
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
  }
});