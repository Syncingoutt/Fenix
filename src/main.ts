import { app, BrowserWindow, ipcMain, dialog, crashReporter, globalShortcut, Menu, screen, Tray } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { autoUpdater } from 'electron-updater';
import { loadItemDatabase, loadPriceCache, savePriceCache } from './core/database';
import { readLogFile, parseLogLine, parsePriceCheck, getLogSize, readLogFromPosition, getLogPath, setLogPath, isLogPathConfigured, initLogParser, getSettings, saveSettings } from './core/logParser';
import { InventoryManager } from './core/inventory';
import { processPriceCheckData } from './core/priceTracker';
import { ensureLogSizeLimit } from './core/logParser';

// Single instance lock - prevent multiple instances (CRITICAL for packaged apps)
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running, quit this one
  app.quit();
  process.exit(0);
} else {
  // Handle when a second instance tries to start
  app.on('second-instance', () => {
    // Someone tried to run a second instance, focus our window instead
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let inventoryManager: InventoryManager;
let itemDatabase: ReturnType<typeof loadItemDatabase>;
let lastLogPosition = 0;
let lastSendBaseId: string | null = null; // Track the most recent SEND message's baseId across log reads
const WATCH_INTERVAL = 500;
let currentKeybind: string = 'CommandOrControl+`'; // Default keybind
let fullscreenMode: boolean = false; // Default to windowed mode

// Timer state managed in main process (never throttled)
interface TimerState {
  realtimeSeconds: number;
  realtimeStartTime: number;
  hourlySeconds: number;
  hourlyStartTime: number;
  hourlyActive: boolean;
  hourlyPaused: boolean;
}

const timerState: TimerState = {
  realtimeSeconds: 0,
  realtimeStartTime: Date.now(),
  hourlySeconds: 0,
  hourlyStartTime: 0,
  hourlyActive: false,
  hourlyPaused: false
};

function getIconPath(): string {
  if (app.isPackaged) {
    // In packaged app, assets are in extraResources (alongside app.asar)
    // Try multiple possible locations
    const possiblePaths = [
      path.join(process.resourcesPath, 'assets', 'AppIcon.ico'), // extraResources/assets/
      path.join(process.resourcesPath, 'app.asar', 'assets', 'AppIcon.ico'), // app.asar/assets/
      path.join(process.resourcesPath, 'app', 'assets', 'AppIcon.ico'), // app/assets/ (unpacked)
      path.join(__dirname, 'assets', 'AppIcon.ico'), // dist/assets/
      path.join(__dirname, '../assets', 'AppIcon.ico') // dist/../assets/
    ];
    
    for (const iconPath of possiblePaths) {
      if (fs.existsSync(iconPath)) {
        console.log(`✅ Found icon at: ${iconPath}`);
        return iconPath;
      }
    }
    // Log all tried paths for debugging
    console.error(`❌ Icon not found in any of these locations:`);
    possiblePaths.forEach(p => console.error(`   - ${p}`));
    // Fallback - return first path anyway
    return possiblePaths[0];
  } else {
    // In development
    return path.join(__dirname, '../assets/AppIcon.ico');
  }
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { x, y, width, height } = primaryDisplay.bounds;
  
  // Always create frameless window - we'll use custom title bar for windowed mode
  // This avoids needing to recreate the window when switching modes
  mainWindow = new BrowserWindow({
    width: fullscreenMode ? width : 1440,
    height: fullscreenMode ? height : 900,
    x: fullscreenMode ? x : undefined,
    y: fullscreenMode ? y : undefined,
    minWidth: 800,
    minHeight: 600,
    icon: getIconPath(),
    frame: false, // Always frameless - we'll add custom title bar
    alwaysOnTop: fullscreenMode,
    skipTaskbar: fullscreenMode,
    resizable: !fullscreenMode,
    movable: !fullscreenMode,
    focusable: true,
    fullscreenable: !fullscreenMode,
    transparent: false,
    hasShadow: !fullscreenMode,
    show: false, // Don't show until ready to prevent flash
    backgroundColor: '#161616', // Match app background
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false // Disable throttling
    }
  });

  // mainWindow.setMenu(null);
  
  if (fullscreenMode) {
    mainWindow.setBounds({ x: x, y: y, width: width, height: height });
    mainWindow.setSkipTaskbar(true);
  } else {
    // In windowed mode, start maximized and add it to taskbar
    mainWindow.setSkipTaskbar(false);
    mainWindow.maximize();
  }
  
  mainWindow.webContents.session.clearCache();
  mainWindow.loadFile(path.join(__dirname, 'ui/index.html'));
  
  // Show window only after content is ready (prevents flash)
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !fullscreenMode) {
      mainWindow.show();
    }
  });
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  
  mainWindow.on('show', () => {
    if (mainWindow) {
      if (fullscreenMode) {
        mainWindow.setSkipTaskbar(true);
      } else {
        mainWindow.setSkipTaskbar(false);
      }
    }
  });
  
  // Notify renderer of maximize state changes for icon toggle
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('maximize-state-changed', true);
  });
  
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('maximize-state-changed', false);
  });
}

function createTray() {
  // Set app user model ID for Windows to show tray icon properly
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.fenix.tracker');
  }
  
  const iconPath = getIconPath();
  
  // Verify icon exists, log error if not (but don't crash)
  if (!fs.existsSync(iconPath)) {
    console.error(`❌ Tray icon not found at: ${iconPath}`);
    console.error(`   Trying to continue without tray icon...`);
    // Try to create tray anyway with empty string - might use default
    try {
      tray = new Tray(iconPath);
    } catch (error) {
      console.error(`❌ Failed to create tray: ${error}`);
      return; // Exit early if we can't create tray
    }
  } else {
    console.log(`✅ Tray icon found at: ${iconPath}`);
    tray = new Tray(iconPath);
  }
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Overlay (Ctrl+`)',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Hide Overlay',
      click: () => {
        if (mainWindow) {
          mainWindow.hide();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Check for Updates',
      click: () => {
        if (app.isPackaged) {
          autoUpdater.checkForUpdatesAndNotify();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip('Torchlight Tracker');
  tray.setContextMenu(contextMenu);
  
  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// Configure auto-updater
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

let isManualCheck = false; // Track if update check was triggered manually

autoUpdater.on('checking-for-update', () => {
  console.log('🔍 Checking for updates...');
  if (mainWindow && isManualCheck) {
    mainWindow.webContents.send('update-status', {
      status: 'checking',
      message: 'Checking for updates...'
    });
  }
});

autoUpdater.on('update-available', (info) => {
  console.log('✨ Update available:', info.version);
  if (mainWindow && isManualCheck) {
    // For manual checks, notify renderer and start download automatically
    mainWindow.webContents.send('update-status', {
      status: 'available',
      message: `Update available: ${info.version}`,
      version: info.version
    });
    autoUpdater.downloadUpdate();
  } else if (mainWindow && !isManualCheck) {
    // For automatic checks, show custom modal
    mainWindow.webContents.send('show-update-dialog', {
      type: 'available',
      version: info.version,
      currentVersion: app.getVersion()
    });
  }
});

autoUpdater.on('update-not-available', (info) => {
  console.log('✅ No updates available');
  if (mainWindow && isManualCheck) {
    mainWindow.webContents.send('update-status', {
      status: 'not-available',
      message: 'You are up to date!'
    });
    isManualCheck = false;
  }
});

autoUpdater.on('error', (err) => {
  console.error('❌ Error checking for updates:', err);
  if (mainWindow && isManualCheck) {
    mainWindow.webContents.send('update-status', {
      status: 'error',
      message: `Error: ${err.message || 'Failed to check for updates'}`
    });
    isManualCheck = false;
  }
});

autoUpdater.on('download-progress', (progressObj) => {
  const percent = Math.round(progressObj.percent);
  console.log(`📥 Downloading update: ${percent}%`);
  if (mainWindow) {
    mainWindow.webContents.send('update-download-progress', percent);
    if (isManualCheck) {
      mainWindow.webContents.send('update-status', {
        status: 'downloading',
        message: `Downloading update: ${percent}%`
      });
    }
  }
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('✅ Update downloaded:', info.version);
  if (mainWindow && isManualCheck) {
    // For manual checks, notify renderer and prompt for restart
    mainWindow.webContents.send('update-status', {
      status: 'downloaded',
      message: 'Update downloaded! Restart to install.',
      version: info.version
    });
    // Show custom modal for restart prompt
    mainWindow.webContents.send('show-update-dialog', {
      type: 'downloaded',
      version: info.version
    });
    isManualCheck = false;
  } else if (mainWindow && !isManualCheck) {
    // For automatic checks, transition to install prompt in same modal
    mainWindow.webContents.send('update-downloaded-transition', {
      version: info.version
    });
  }
});

if (app.isPackaged) {
  autoUpdater.checkForUpdatesAndNotify();
}

app.whenReady().then(() => {
  // Menu.setApplicationMenu(null);

  console.log('🔥 Torchlight Tracker - Starting...');
  
  // Initialize log parser with userData path
  initLogParser(app.getPath('userData'));
  
  // Now that log parser is initialized, we can safely check log size limits
  ensureLogSizeLimit(500);
  setInterval(() => ensureLogSizeLimit(500), 60 * 60 * 1000);
  
  itemDatabase = loadItemDatabase();
  console.log(`📦 Loaded ${Object.keys(itemDatabase).length} items`);
  
  const priceCache = loadPriceCache();
  const priceCount = Object.keys(priceCache).length;
  if (priceCount > 0) {
    console.log(`💰 Loaded ${priceCount} cached prices`);
  }
  
  inventoryManager = new InventoryManager(itemDatabase, priceCache);
  
  createWindow();
  createTray();
  
  // Check if log path is configured, if not, show setup dialog
  if (!isLogPathConfigured()) {
    if (mainWindow) {
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow?.webContents.send('show-log-path-setup');
      });
    }
  } else {
    // Load inventory if path is configured
    const logEntries = readLogFile();
    inventoryManager.buildInventory(logEntries);
    console.log(`✅ Initial inventory loaded`);
    lastLogPosition = getLogSize();
  }

  // Start main process timers (never throttled)
  console.log('⏱️  Starting main process timers...');
  
  // Realtime timer - always running
  setInterval(() => {
    timerState.realtimeSeconds++;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('timer-tick', {
        type: 'realtime',
        seconds: timerState.realtimeSeconds
      });
    }
  }, 1000);

  // Hourly timer - only when active
  setInterval(() => {
    if (timerState.hourlyActive && !timerState.hourlyPaused) {
      timerState.hourlySeconds++;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('timer-tick', {
          type: 'hourly',
          seconds: timerState.hourlySeconds
        });
      }
    }
  }, 1000);

  console.log('✅ Main process timers started');

  // Load settings and register keybind
  const settings = getSettings();
  if (settings.keybind) {
    currentKeybind = settings.keybind;
  }
  if (typeof settings.fullscreenMode === 'boolean') {
    fullscreenMode = settings.fullscreenMode;
  }
  registerKeybind(currentKeybind);
  
  setInterval(() => {
    watchLogFile();
  }, WATCH_INTERVAL);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  savePriceCache(inventoryManager.getPriceCacheAsObject());
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Keybind management
function registerKeybind(keybind: string): boolean {
  // Unregister old keybind first
  globalShortcut.unregisterAll();
  
  const ret = globalShortcut.register(keybind, () => {
    if (mainWindow && fullscreenMode) {
      // Keybind only works in fullscreen mode
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
  
  if (ret) {
    currentKeybind = keybind;
    console.log(`✅ Keybind registered: ${keybind}`);
  } else {
    console.error(`❌ Failed to register keybind: ${keybind}`);
  }
  
  return ret;
}

// IPC Handlers
ipcMain.handle('get-inventory', () => {
  return inventoryManager.getInventory();
});

ipcMain.handle('get-item-database', () => {
  return itemDatabase;
});

ipcMain.on('minimize-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.on('maximize-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('close-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (fullscreenMode) {
      mainWindow.hide();
    } else {
      mainWindow.close();
    }
  }
});

ipcMain.handle('get-maximize-state', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow.isMaximized();
  }
  return false;
});

ipcMain.on('toggle-window', () => {
  if (mainWindow) {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  }
});

// Timer control IPC handlers
ipcMain.on('start-hourly-timer', () => {
  timerState.hourlyActive = true;
  timerState.hourlyPaused = false;
  timerState.hourlySeconds = 0;
  timerState.hourlyStartTime = Date.now();
});

ipcMain.on('pause-hourly-timer', () => {
  timerState.hourlyPaused = true;
});

ipcMain.on('resume-hourly-timer', () => {
  timerState.hourlyPaused = false;
});

ipcMain.on('stop-hourly-timer', () => {
  timerState.hourlyActive = false;
  timerState.hourlyPaused = false;
  timerState.hourlySeconds = 0;
});

ipcMain.on('reset-realtime-timer', () => {
  timerState.realtimeSeconds = 0;
  timerState.realtimeStartTime = Date.now();
});

ipcMain.handle('get-timer-state', () => {
  return {
    realtimeSeconds: timerState.realtimeSeconds,
    hourlySeconds: timerState.hourlySeconds
  };
});

// Update IPC handlers
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) {
    return { success: false, message: 'Updates are only available in packaged app' };
  }
  
  try {
    isManualCheck = true;
    await autoUpdater.checkForUpdates();
    return { success: true, message: 'Checking for updates...' };
  } catch (error: any) {
    isManualCheck = false;
    return { success: false, message: error.message || 'Failed to check for updates' };
  }
});

// Handle update dialog responses from renderer
ipcMain.on('update-dialog-response', (event, response: 'download' | 'restart' | 'later') => {
  if (response === 'download') {
    autoUpdater.downloadUpdate();
  } else if (response === 'restart') {
    autoUpdater.quitAndInstall(false, true);
  }
  // 'later' response just closes the modal, no action needed
});

// Log path configuration IPC handlers
ipcMain.handle('get-log-path', () => {
  return getLogPath();
});

ipcMain.handle('is-log-path-configured', () => {
  return isLogPathConfigured();
});

ipcMain.handle('select-log-file', async () => {
  if (!mainWindow) return null;
  
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select UE_Game.log file',
    filters: [
      { name: 'Log Files', extensions: ['log'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    const selectedPath = result.filePaths[0];
    setLogPath(selectedPath);
    
    // Reload inventory with new path
    const logEntries = readLogFile();
    inventoryManager.buildInventory(logEntries);
    lastLogPosition = getLogSize();
    
    if (mainWindow) {
      mainWindow.webContents.send('inventory-updated');
    }
    
    return selectedPath;
  }
  
  return null;
});

// Settings IPC handlers
ipcMain.handle('get-settings', () => {
  return getSettings();
});

ipcMain.handle('save-settings', async (event, settings: { keybind?: string; fullscreenMode?: boolean; includeTax?: boolean }) => {
  try {
    saveSettings(settings);
    
    // Update keybind if it changed
    if (settings.keybind && settings.keybind !== currentKeybind) {
      const success = registerKeybind(settings.keybind);
      if (!success) {
        // Revert to old keybind if new one failed
        registerKeybind(currentKeybind);
        return { success: false, error: 'Failed to register keybind. It may already be in use.' };
      }
    }
    
    // Check if window mode changed
    const windowModeChanged = settings.fullscreenMode !== undefined && settings.fullscreenMode !== fullscreenMode;
    
    // Return success first before recreating window
    const result = { success: true };
    
    // Update window mode if it changed - update properties dynamically
    if (windowModeChanged && typeof settings.fullscreenMode === 'boolean' && mainWindow && !mainWindow.isDestroyed()) {
      fullscreenMode = settings.fullscreenMode;
      
      // Update window properties that can be changed dynamically
      try {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { x, y, width, height } = primaryDisplay.bounds;
        
        if (fullscreenMode) {
          // Switch to fullscreen overlay mode
          mainWindow.setAlwaysOnTop(true);
          mainWindow.setSkipTaskbar(true);
          mainWindow.setResizable(false);
          mainWindow.setMovable(false);
          mainWindow.setBounds({ x, y, width, height });
        } else {
          // Switch to normal window mode
          mainWindow.setAlwaysOnTop(false);
          mainWindow.setSkipTaskbar(false);
          mainWindow.setResizable(true);
          mainWindow.setMovable(true);
          // Resize to normal window size (centered)
          const normalWidth = 1600;
          const normalHeight = 900;
          const centerX = x + (width - normalWidth) / 2;
          const centerY = y + (height - normalHeight) / 2;
          mainWindow.setBounds({ 
            x: centerX, 
            y: centerY, 
            width: normalWidth, 
            height: normalHeight 
          });
        }
        
        // Notify renderer to show/hide custom title bar
        mainWindow.webContents.send('window-mode-changed', { fullscreenMode });
        
        // Close settings modal
        mainWindow.webContents.send('close-settings-modal');
      } catch (error: any) {
        console.error('Error updating window properties:', error);
      }
    }
    
    return result;
  } catch (error: any) {
    console.error('Failed to save settings:', error);
    return { success: false, error: error.message || 'Failed to save settings' };
  }
});

ipcMain.handle('test-keybind', (event, keybind: string) => {
  // Temporarily register the keybind to test if it's available
  const oldKeybind = currentKeybind;
  const success = registerKeybind(keybind);
  
  if (success) {
    // Restore old keybind after test
    registerKeybind(oldKeybind);
    return { success: true };
  }
  
  return { success: false, error: 'Keybind is already in use or invalid' };
});

// Log file watcher
function watchLogFile() {
  // Check log size limit frequently (every 500ms) to prevent file from growing too large
  // The function will return early if size is OK, so this is efficient
  ensureLogSizeLimit(500);

  // Get current size after potential truncation
  const currentSize = getLogSize();

  // Detect log file truncation (when ensureLogSizeLimit runs)
  if (currentSize < lastLogPosition) {
    console.log(`⚠️ Log file truncated detected (was ${lastLogPosition}, now ${currentSize}). Resetting tracking position.`);
    // Reset to start of truncated file - we'll rebuild inventory from the remaining content
    lastLogPosition = 0;
    // Rebuild inventory from the truncated file to ensure we have current state
    const logEntries = readLogFile();
    inventoryManager.buildInventory(logEntries);
    if (mainWindow) {
      mainWindow.webContents.send('inventory-updated');
    }
  }

  if (currentSize > lastLogPosition) {
    const newContent = readLogFromPosition(lastLogPosition, currentSize);
    const newLines = newContent.split('\n');
    
    let priceCheckBuffer: string[] = [];
    let inPriceCheck = false;
    let inSendMessage = false;
    let sendMessageBuffer: string[] = [];
    let inventoryChanged = false;
    let priceUpdated = false;

    let currentPriceCheckBaseId: string | null = null;

    for (const line of newLines) {
      // Track SEND messages to extract baseId
      if (line.includes('----Socket SendMessage STT----XchgSearchPrice----')) {
        inSendMessage = true;
        sendMessageBuffer = [];
        lastSendBaseId = null; // Reset when starting a new SEND message
      } else if (inSendMessage) {
        sendMessageBuffer.push(line);
        
        // Extract baseId from SEND message
        if ((line.includes('+itemBaseId') || line.includes('+refer')) && line.includes('[')) {
          const match = line.match(/\+refer\s*\[(\d+)\]/);
          if (match) {
            lastSendBaseId = match[1];
            console.log(`🔍 Price check initiated for baseId: ${lastSendBaseId}`);
          }
        }
        
        if (line.includes('----Socket SendMessage End----')) {
          inSendMessage = false;
          sendMessageBuffer = [];
        }
      }

      if (line.includes('----Socket RecvMessage STT----XchgSearchPrice----')) {
        inPriceCheck = true;
        priceCheckBuffer = [];
        console.log('📊 Receiving price data...');
        // Use the most recent SEND message's baseId
        currentPriceCheckBaseId = lastSendBaseId;
        // If not found in lastSendBaseId, try to extract from the send message buffer
        if (!currentPriceCheckBaseId && sendMessageBuffer.length > 0) {
          for (const bufLine of sendMessageBuffer) {
            if ((bufLine.includes('+itemBaseId') || bufLine.includes('+refer')) && bufLine.includes('[')) {
              const match = bufLine.match(/\+refer\s*\[(\d+)\]/);
              if (match) {
                currentPriceCheckBaseId = match[1];
                console.log(`🔍 Price check baseId extracted from send message buffer: ${currentPriceCheckBaseId}`);
                break;
              }
            }
          }
        }
        // If still not found, look backwards in the new lines for the most recent SEND message
        if (!currentPriceCheckBaseId) {
          for (let i = newLines.indexOf(line) - 1; i >= 0 && i >= newLines.indexOf(line) - 100; i--) {
            const prevLine = newLines[i];
            if (prevLine.includes('----Socket SendMessage STT----XchgSearchPrice----')) {
              // Found a SEND message, look for +refer in subsequent lines
              for (let j = i + 1; j < newLines.length && j < i + 20; j++) {
                const sendLine = newLines[j];
                if (sendLine.includes('----Socket SendMessage End----')) break;
                if ((sendLine.includes('+itemBaseId') || sendLine.includes('+refer')) && sendLine.includes('[')) {
                  const match = sendLine.match(/\+refer\s*\[(\d+)\]/);
                  if (match) {
                    currentPriceCheckBaseId = match[1];
                    console.log(`🔍 Price check baseId found in preceding send message: ${currentPriceCheckBaseId}`);
                    break;
                  }
                }
              }
              if (currentPriceCheckBaseId) break;
            }
          }
        }
      } else if (inPriceCheck) {
        priceCheckBuffer.push(line);
        
        if (line.includes('----Socket RecvMessage End----')) {
          console.log(`✅ Price data received, buffer has ${priceCheckBuffer.length} lines`);
          
          const prices: number[] = [];
          for (const bufLine of priceCheckBuffer) {
            if ((bufLine.includes('+unitPrices+') || bufLine.includes('|          +')) && bufLine.includes('[')) {
              const match = bufLine.match(/\[([0-9.]+)\]/);
              if (match) {
                const price = parseFloat(match[1]);
                if (!isNaN(price)) {
                  prices.push(price);
                  if (prices.length >= 100) break;
                }
              }
            }
          }

          if (currentPriceCheckBaseId) {
            const priceResult = processPriceCheckData(currentPriceCheckBaseId, prices);
            
            if (priceResult) {
              inventoryManager.updatePrice(priceResult.baseId, priceResult.avgPrice);
              savePriceCache(inventoryManager.getPriceCacheAsObject());
              // Try to get item name from database if not in inventory
              const inventoryItem = inventoryManager.getInventoryMap().get(priceResult.baseId);
              let itemName: string;
              if (inventoryItem?.itemName) {
                itemName = inventoryItem.itemName;
              } else {
                // Fallback to database lookup
                const itemData = itemDatabase[priceResult.baseId];
                itemName = itemData?.name || priceResult.baseId;
              }
              console.log(`💰 Price updated: ${itemName} = ${priceResult.avgPrice.toFixed(2)} (from ${prices.length} listings)`);
              
              priceUpdated = true;
            } else {
              console.log(`⚠️  Parse issue - BaseID: ${currentPriceCheckBaseId}, Prices: ${prices.length} (no valid prices found)`);
            }
          } else {
            console.log(`⚠️  No baseId found for price check with ${prices.length} prices`);
          }

          inPriceCheck = false;
          priceCheckBuffer = [];
          currentPriceCheckBaseId = null;
        }
      }

      // Detect ItemChange entries
      if (line.includes('ItemChange@') && line.includes('Id=')) {
        const parsed = parseLogLine(line);
        if (parsed) {
          inventoryChanged = true;
        }
      }
      
      // Detect ResetItemsLayout events (sort operations)
      if (line.includes('ItemChange@ ProtoName=ResetItemsLayout')) {
        inventoryChanged = true;
      }
      
      // Detect InitBagData entries (they appear after ResetItemsLayout)
      if (line.includes('BagMgr@:InitBagData')) {
        inventoryChanged = true;
      }
    }

    if (inventoryChanged) {
      const logEntries = readLogFile();
      inventoryManager.buildInventory(logEntries);
    }

    if ((inventoryChanged || priceUpdated) && mainWindow) {
      mainWindow.webContents.send('inventory-updated');
    }

    lastLogPosition = currentSize;
  }
}