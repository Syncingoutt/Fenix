import { app, BrowserWindow, ipcMain, dialog, crashReporter, globalShortcut, Menu, screen, Tray } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { autoUpdater } from 'electron-updater';
import { loadItemDatabase, loadPriceCache, savePriceCache } from './core/database';
import { readLogFile, parseLogLine, parsePriceCheck, getLogSize, readLogFromPosition } from './core/logParser';
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

app.whenReady().then(() => {
  ensureLogSizeLimit(500);
  setInterval(() => ensureLogSizeLimit(500), 60 * 60 * 1000);
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let inventoryManager: InventoryManager;
let lastLogPosition = 0;
const WATCH_INTERVAL = 500;

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
  
  mainWindow = new BrowserWindow({
    x: x,
    y: y,
    width: width,
    height: height,
    icon: getIconPath(),
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: true,
    fullscreenable: false,
    transparent: false,
    hasShadow: false,
    type: 'toolbar',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false // Disable throttling
    }
  });

  mainWindow.setMenu(null);
  mainWindow.hide();
  mainWindow.setBounds({ x: x, y: y, width: width, height: height });
  mainWindow.setSkipTaskbar(true);
  mainWindow.webContents.session.clearCache();
  mainWindow.loadFile(path.join(__dirname, 'ui/index.html'));
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  
  mainWindow.on('show', () => {
    if (mainWindow) {
      mainWindow.setSkipTaskbar(true);
    }
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
    // For automatic checks, show dialog (existing behavior)
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Available',
      message: `A new version (${info.version}) is available!`,
      detail: `Current version: ${app.getVersion()}\n\nWould you like to download and install it now?`,
      buttons: ['Download Now', 'Later'],
      defaultId: 0,
      cancelId: 1
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate();
      }
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
    // Prompt for restart
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Downloaded',
      message: 'Update downloaded successfully!',
      detail: 'The update will be installed when you restart the application.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall(false, true);
      }
    });
    isManualCheck = false;
  } else if (mainWindow && !isManualCheck) {
    // For automatic checks, show dialog (existing behavior)
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Downloaded',
      message: 'Update downloaded successfully!',
      detail: 'The update will be installed when you restart the application.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall(false, true);
      }
    });
  }
});

if (app.isPackaged) {
  autoUpdater.checkForUpdatesAndNotify();
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  console.log('🔥 Torchlight Tracker - Starting...');
  
  const itemDatabase = loadItemDatabase();
  console.log(`📦 Loaded ${Object.keys(itemDatabase).length} items`);
  
  const priceCache = loadPriceCache();
  const priceCount = Object.keys(priceCache).length;
  if (priceCount > 0) {
    console.log(`💰 Loaded ${priceCount} cached prices`);
  }
  
  inventoryManager = new InventoryManager(itemDatabase, priceCache);
  
  const logEntries = readLogFile();
  inventoryManager.buildInventory(logEntries);
  console.log(`✅ Initial inventory loaded`);
  
  lastLogPosition = getLogSize();
  
  createWindow();
  createTray();

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

  const ret = globalShortcut.register('CommandOrControl+`', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
  
  setInterval(() => {
    watchLogFile();
  }, WATCH_INTERVAL);

  if (app.isPackaged) {
    setInterval(() => {
      autoUpdater.checkForUpdatesAndNotify();
    }, 30 * 60 * 1000);
  }

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

// IPC Handlers
ipcMain.handle('get-inventory', () => {
  return inventoryManager.getInventory();
});

ipcMain.on('minimize-window', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.on('close-window', () => {
  if (mainWindow) {
    mainWindow.hide();
  }
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

// Log file watcher
function watchLogFile() {
  const currentSize = getLogSize();

  if (currentSize > lastLogPosition) {
    const newContent = readLogFromPosition(lastLogPosition, currentSize);
    const newLines = newContent.split('\n');
    
    let priceCheckBuffer: string[] = [];
    let inPriceCheck = false;
    let inventoryChanged = false;
    let priceUpdated = false;

    let currentPriceCheckBaseId: string | null = null;

    for (const line of newLines) {
      if ((line.includes('+itemBaseId') || line.includes('+refer')) && line.includes('[')) {
        const match = line.match(/\[(\d+)\]/);
        if (match) {
          currentPriceCheckBaseId = match[1];
          console.log(`🔍 Price check initiated for baseId: ${currentPriceCheckBaseId}`);
        }
      }

      if (line.includes('----Socket RecvMessage STT----XchgSearchPrice----')) {
        inPriceCheck = true;
        priceCheckBuffer = [];
        console.log('📊 Receiving price data...');
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

          const priceResult = processPriceCheckData(currentPriceCheckBaseId!, prices);
          
          if (priceResult) {
            inventoryManager.updatePrice(priceResult.baseId, priceResult.avgPrice);
            savePriceCache(inventoryManager.getPriceCacheAsObject());
            const itemName = inventoryManager.getInventoryMap().get(priceResult.baseId)?.itemName || priceResult.baseId;
            console.log(`💰 Price updated: ${itemName} = ${priceResult.avgPrice.toFixed(2)} (from ${prices.length} listings)`);
            
            priceUpdated = true;
          } else {
            console.log(`⚠️  Parse issue - BaseID: ${currentPriceCheckBaseId}, Prices: ${prices.length} (need at least 50)`);
          }

          inPriceCheck = false;
          priceCheckBuffer = [];
          currentPriceCheckBaseId = null;
        }
      }

      if (line.includes('ItemChange@') && line.includes('Id=')) {
        const parsed = parseLogLine(line);
        if (parsed) {
          inventoryChanged = true;
        }
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