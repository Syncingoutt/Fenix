import { app, BrowserWindow, ipcMain, dialog, crashReporter, globalShortcut, Menu, screen, Tray } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { autoUpdater } from 'electron-updater';
import { loadItemDatabase, loadPriceCache, savePriceCache } from './core/database';
import { readLogFile, parseLogLine, parsePriceCheck, getLogSize, readLogFromPosition } from './core/logParser';
import { InventoryManager } from './core/inventory';
import { processPriceCheckData } from './core/priceTracker';
import { ensureLogSizeLimit } from './core/logParser';

app.whenReady().then(() => {
  ensureLogSizeLimit(500);
  setInterval(() => ensureLogSizeLimit(500), 60 * 60 * 1000);
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null; // Add tray variable
let inventoryManager: InventoryManager;
let lastLogPosition = 0;
const WATCH_INTERVAL = 500;

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { x, y, width, height } = primaryDisplay.bounds;
  
  mainWindow = new BrowserWindow({
    x: x,
    y: y,
    width: width,
    height: height,
    icon: path.join(__dirname, '../assets/AppIcon.ico'),
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
      nodeIntegration: false
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
  // Create tray icon
  const iconPath = path.join(__dirname, '../assets/AppIcon.ico');
  tray = new Tray(iconPath);
  
  // Create context menu
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
  
  // Double-click tray icon to toggle overlay
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
autoUpdater.autoDownload = false; // We'll ask user first
autoUpdater.autoInstallOnAppQuit = true;

// Update event handlers
autoUpdater.on('checking-for-update', () => {
  console.log('🔍 Checking for updates...');
});

autoUpdater.on('update-available', (info) => {
  console.log('✨ Update available:', info.version);
  if (mainWindow) {
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

autoUpdater.on('update-not-available', () => {
  console.log('✅ No updates available');
});

autoUpdater.on('error', (err) => {
  console.error('❌ Error checking for updates:', err);
});

autoUpdater.on('download-progress', (progressObj) => {
  const percent = Math.round(progressObj.percent);
  console.log(`📥 Downloading update: ${percent}%`);
  // You can send this to renderer to show progress if needed
  if (mainWindow) {
    mainWindow.webContents.send('update-download-progress', percent);
  }
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('✅ Update downloaded:', info.version);
  if (mainWindow) {
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

// Check for updates on startup (only in production, not dev)
if (app.isPackaged) {
  autoUpdater.checkForUpdatesAndNotify();
}

app.whenReady().then(() => {
  // Remove menu globally
  Menu.setApplicationMenu(null);

  // Initialize
  console.log('🔥 Torchlight Tracker - Starting...');
  
  const itemDatabase = loadItemDatabase();
  console.log(`📦 Loaded ${Object.keys(itemDatabase).length} items`);
  
  const priceCache = loadPriceCache();
  const priceCount = Object.keys(priceCache).length;
  if (priceCount > 0) {
    console.log(`💰 Loaded ${priceCount} cached prices`);
  }
  
  inventoryManager = new InventoryManager(itemDatabase, priceCache);
  
  // Initial inventory load
  const logEntries = readLogFile();
  inventoryManager.buildInventory(logEntries);
  console.log(`✅ Initial inventory loaded`);
  
  lastLogPosition = getLogSize();
  
  createWindow();
  createTray();

  // Register global hotkey Ctrl+` to toggle overlay
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
  
  // Start watching log file
  setInterval(() => {
    watchLogFile();
  }, WATCH_INTERVAL);

  // Check for updates periodically (every 30 minutes, only in production)
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
  // Save price cache before closing
  savePriceCache(inventoryManager.getPriceCacheAsObject());
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Unregister hotkeys when app quits
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// IPC Handlers
ipcMain.handle('get-inventory', () => {
  return inventoryManager.getInventory();
});

// IPC handler to minimize/close window from renderer
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
      // Step 1: Capture the baseId from XchgSyncSearchPrice SendMessage
      // Match both old and new formats for baseId
      if ((line.includes('+itemBaseId') || line.includes('+refer')) && line.includes('[')) {
        const match = line.match(/\[(\d+)\]/);
        if (match) {
          currentPriceCheckBaseId = match[1];
          console.log(`🔍 Price check initiated for baseId: ${currentPriceCheckBaseId}`);
        }
      }

      // Step 2: Start buffering when we see XchgSearchPrice RecvMessage
      if (line.includes('----Socket RecvMessage STT----XchgSearchPrice----')) {
        inPriceCheck = true;
        priceCheckBuffer = [];
        console.log('📊 Receiving price data...');
      } else if (inPriceCheck) {
        priceCheckBuffer.push(line);
        
        // Step 3: End when we see RecvMessage End
        if (line.includes('----Socket RecvMessage End----')) {
          console.log(`✅ Price data received, buffer has ${priceCheckBuffer.length} lines`);
          
          // Parse prices from buffer
          const prices: number[] = [];
          for (const bufLine of priceCheckBuffer) {
            if ((bufLine.includes('+unitPrices+') || bufLine.includes('|          +')) && bufLine.includes('[')) {
              const match = bufLine.match(/\[([0-9.]+)\]/);
              if (match) {
                const price = parseFloat(match[1]);
                if (!isNaN(price)) {
                  prices.push(price);
                  // Stop after 100 prices (first currency type only)
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

      // Inventory change detection
      if (line.includes('ItemChange@') && line.includes('Id=')) {
        const parsed = parseLogLine(line);
        if (parsed) {
          inventoryChanged = true;
        }
      }
    }

    // If inventory changed, rebuild it once after processing all lines
    if (inventoryChanged) {
      const logEntries = readLogFile();
      inventoryManager.buildInventory(logEntries);
    }

    // Send update to renderer if anything changed
    if ((inventoryChanged || priceUpdated) && mainWindow) {
      mainWindow.webContents.send('inventory-updated');
    }

    lastLogPosition = currentSize;
  }
}