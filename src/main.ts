import { app, BrowserWindow, ipcMain, dialog, globalShortcut, Menu, screen, Tray, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { autoUpdater } from 'electron-updater';
import { loadItemDatabase, loadPriceCache, savePriceCache, PriceCacheEntry } from './core/database';
import { readLogFile, parseLogLine, getLogSize, readLogFromPosition, setLogPath, isLogPathConfigured, initLogParser, getSettings, saveSettings, getLogPath, parseMapEvents, resetMapEventPosition, getWindowBounds, saveWindowBounds, getOverlayBounds, saveOverlayBounds, getOverlayOpacity, saveOverlayOpacity, hasCompletedOnboarding, markOnboardingCompleted } from './core/logParser';
import { InventoryManager } from './core/inventory';
import { processPriceCheckData } from './core/priceTracker';
import { ensureLogSizeLimit } from './core/logParser';
import { PriceSyncService } from './core/priceSync';
import { saveHourlySession, loadHourlySessions, deleteHourlySession, clearAllHistory, deleteBucketsByDateAndHour, updateBucketCustomName } from './core/hourlyHistory';

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
      if (fullscreenMode) {
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
      }
    }
  });
}

let mainWindow: BrowserWindow | null = null;
let overlayWidget: BrowserWindow | null = null;
let overlayLockButtonRect: { left: number; top: number; width: number; height: number } | null = null;
let overlayLockCheckInterval: ReturnType<typeof setInterval> | null = null;
let tray: Tray | null = null;
let inventoryManager: InventoryManager;
let priceSyncService: PriceSyncService;
let itemDatabase: ReturnType<typeof loadItemDatabase>;
let lastLogPosition = 0;
let lastSendBaseId: string | null = null; // Track the most recent SEND message's baseId across log reads
let lastSentInventoryUpdate = 0; // Prevent duplicate inventory-updated events
const WATCH_INTERVAL = 500;
let currentKeybind: string = 'CommandOrControl+`'; // Default keybind
let fullscreenMode: boolean = false; // Default to windowed mode
let simplifiedOverlayMode: boolean = false;
/** League/season ID for price snapshots. Change this in code when a new season starts. */
const LEAGUE_ID = 's12-lunaria';
let currentLeagueId: string = LEAGUE_ID;
const VALID_LEAGUE_IDS = new Set(['s12-lunaria', 's11-vorax']);
const LEGACY_LEAGUE_ID_MAP: Record<string, string> = {
  lunaria: 's12-lunaria',
  vorax: 's11-vorax'
};
const PRICE_SYNC_INTERVAL_MS = 5 * 60 * 1000;

function normalizeLeagueId(rawLeagueId?: string): string {
  const trimmed = typeof rawLeagueId === 'string' ? rawLeagueId.trim() : '';
  if (!trimmed) return LEAGUE_ID;
  const lower = trimmed.toLowerCase();
  if (LEGACY_LEAGUE_ID_MAP[lower]) {
    return LEGACY_LEAGUE_ID_MAP[lower];
  }
  if (VALID_LEAGUE_IDS.has(lower)) {
    return lower;
  }
  return LEAGUE_ID;
}

// Overlay widget display values (sent directly from renderer)
let overlayDisplayData: {
  duration: number;
  hourly: number;
  total: number;
  avgTimePerMap: number;
  lastMapProfit: number;
  totalMaps: number;
  isHourlyMode: boolean;
  isPaused: boolean;
  wealthMode: 'realtime' | 'hourly';
  isHourlyActive: boolean;
} = {
  duration: 0,
  hourly: 0,
  total: 0,
  avgTimePerMap: 0,
  lastMapProfit: 0,
  totalMaps: 0,
  isHourlyMode: false,
  isPaused: false,
  wealthMode: 'hourly',
  isHourlyActive: false
};

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

// Price cache debouncing state
let priceCacheSaveTimeout: NodeJS.Timeout | null = null;
let priceCachePendingSave = false;
const PRICE_CACHE_DEBOUNCE_MS = 5000; // 5 seconds debounce
const PRICE_CACHE_PERIODIC_SAVE_MS = 30000; // 30 seconds periodic save

// Debounced save function - batches rapid updates
function debouncedSavePriceCache(): void {
  if (priceCacheSaveTimeout) {
    clearTimeout(priceCacheSaveTimeout);
  }
  
  priceCachePendingSave = true;
  
  priceCacheSaveTimeout = setTimeout(async () => {
    if (priceCachePendingSave && inventoryManager) {
      try {
        await savePriceCache(inventoryManager.getPriceCacheAsObject());
        priceCachePendingSave = false;
      } catch (error) {
        console.error('Failed to save price cache:', error);
      }
    }
  }, PRICE_CACHE_DEBOUNCE_MS);
}

// Force immediate save (for app shutdown)
async function forceSavePriceCache(): Promise<void> {
  if (priceCacheSaveTimeout) {
    clearTimeout(priceCacheSaveTimeout);
    priceCacheSaveTimeout = null;
  }
  
  if (inventoryManager) {
    try {
      await savePriceCache(inventoryManager.getPriceCacheAsObject());
      priceCachePendingSave = false;
    } catch (error) {
      console.error('Failed to save price cache:', error);
    }
  }
}

function shouldApplyCloudEntry(localEntry: PriceCacheEntry | undefined, cloudEntry: PriceCacheEntry): boolean {
  if (!localEntry) return true;
  if (cloudEntry.timestamp > localEntry.timestamp) return true;
  if (cloudEntry.timestamp < localEntry.timestamp) return false;
  const cloudListings = cloudEntry.listingCount ?? 0;
  const localListings = localEntry.listingCount ?? 0;
  return cloudListings > localListings;
}

function applyCloudPriceUpdate(baseId: string, entry: PriceCacheEntry): boolean {
  if (!inventoryManager) return false;
  const localCache = inventoryManager.getPriceCacheAsObject();
  const localEntry = localCache[baseId];
  if (!shouldApplyCloudEntry(localEntry, entry)) {
    return false;
  }
  inventoryManager.updatePrice(baseId, entry.price, entry.listingCount, entry.timestamp);
  return true;
}

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
        return iconPath;
      }
    }
    // Log all tried paths for debugging
    console.error(`Icon not found in any of these locations:`);
    possiblePaths.forEach(p => console.error(`   - ${p}`));
    // Fallback - return first path anyway
    return possiblePaths[0];
  } else {
    // In development
    return path.join(__dirname, '../assets/AppIcon.ico');
  }
}

const DEFAULT_WINDOW_WIDTH = 1440;
const DEFAULT_WINDOW_HEIGHT = 900;
const MIN_WINDOW_WIDTH = 520;
const MIN_WINDOW_HEIGHT = 500;

/** Clamp window bounds to fit within the primary display work area */
function clampBoundsToDisplay(
  bounds: { x: number; y: number; width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  const workArea = screen.getPrimaryDisplay().workArea;
  const w = Math.max(MIN_WINDOW_WIDTH, Math.min(bounds.width, workArea.width));
  const h = Math.max(MIN_WINDOW_HEIGHT, Math.min(bounds.height, workArea.height));
  const x = Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - w));
  const y = Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - h));
  return { x, y, width: w, height: h };
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  // Use bounds for fullscreen (includes taskbar area), workAreaSize for windowed
  const { x, y, width, height } = primaryDisplay.bounds;

  let winWidth: number;
  let winHeight: number;
  let winX: number | undefined;
  let winY: number | undefined;
  let savedMaximized = false;

  if (fullscreenMode) {
    winWidth = width;
    winHeight = height;
    winX = x;
    winY = y;
  } else {
    const saved = getWindowBounds();
    if (
      typeof saved.width === 'number' &&
      typeof saved.height === 'number' &&
      saved.width >= MIN_WINDOW_WIDTH &&
      saved.height >= MIN_WINDOW_HEIGHT
    ) {
      const clamped = clampBoundsToDisplay({
        x: typeof saved.x === 'number' ? saved.x : primaryDisplay.workArea.x,
        y: typeof saved.y === 'number' ? saved.y : primaryDisplay.workArea.y,
        width: saved.width,
        height: saved.height
      });
      winWidth = clamped.width;
      winHeight = clamped.height;
      winX = clamped.x;
      winY = clamped.y;
      savedMaximized = Boolean(saved.maximized);
    } else {
      winWidth = DEFAULT_WINDOW_WIDTH;
      winHeight = DEFAULT_WINDOW_HEIGHT;
      // No saved bounds: keep original behavior (start maximized)
      savedMaximized = true;
    }
  }

  // Always create frameless window - we'll use custom title bar for windowed mode
  // This avoids needing to recreate the window when switching modes
  mainWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: winX,
    y: winY,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    icon: getIconPath(),
    frame: false, // Always frameless - we'll add custom title bar
    skipTaskbar: fullscreenMode,
    resizable: !fullscreenMode,
    movable: !fullscreenMode,
    focusable: true,
    fullscreenable: !fullscreenMode,
    transparent: false,
    hasShadow: !fullscreenMode,
    thickFrame: !fullscreenMode, // Disable thick frame in fullscreen to remove border gaps
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
  
  mainWindow.webContents.session.clearCache();
  mainWindow.loadFile(path.join(__dirname, 'ui/index.html'));
  
  // Show window only after content is ready (prevents flash)
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    
    if (fullscreenMode) {
      // Set bounds to cover entire screen including taskbar
      // Add small buffer to ensure complete coverage
      const buffer = 8;
      mainWindow.setBounds({ 
        x: x - buffer, 
        y: y - buffer, 
        width: width + buffer * 2, 
        height: height + buffer * 2 
      });
      mainWindow.setSkipTaskbar(true);
      // Use 'screen-saver' level to ensure window appears above taskbar
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      // Don't show automatically in fullscreen - user toggles with hotkey
    } else {
      // In windowed mode: restore saved size/position and maximized state
      mainWindow.setSkipTaskbar(false);
      mainWindow.setAlwaysOnTop(false);
      if (savedMaximized) {
        mainWindow.maximize();
      }
      mainWindow.show();
    }
  });

  // Remember window size/position when resized or moved (debounced)
  let windowBoundsSaveTimeout: NodeJS.Timeout | null = null;
  const scheduleSaveWindowBounds = () => {
    if (windowBoundsSaveTimeout) clearTimeout(windowBoundsSaveTimeout);
    windowBoundsSaveTimeout = setTimeout(() => {
      windowBoundsSaveTimeout = null;
      if (mainWindow && !mainWindow.isDestroyed() && !fullscreenMode) {
        const b = mainWindow.getBounds();
        saveWindowBounds({
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          maximized: mainWindow.isMaximized()
        });
      }
    }, 300);
  };
  mainWindow.on('resize', scheduleSaveWindowBounds);
  mainWindow.on('move', scheduleSaveWindowBounds);
  mainWindow.on('maximize', scheduleSaveWindowBounds);
  mainWindow.on('unmaximize', scheduleSaveWindowBounds);

  mainWindow.on('close', () => {
    if (mainWindow && !fullscreenMode) {
      const b = mainWindow.getBounds();
      saveWindowBounds({
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        maximized: mainWindow.isMaximized()
      });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  
  mainWindow.on('show', () => {
    if (mainWindow) {
      if (fullscreenMode) {
        mainWindow.setSkipTaskbar(true);
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        // Force Windows to recognize app as focused
        mainWindow.moveTop();
        mainWindow.focus();
        app.focus({ steal: true });
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
    console.error(`Tray icon not found at: ${iconPath}`);
    console.error(`   Trying to continue without tray icon...`);
    // Try to create tray anyway with empty string - might use default
    try {
      tray = new Tray(iconPath);
    } catch (error) {
      console.error(`Failed to create tray: ${error}`);
      return; // Exit early if we can't create tray
    }
  } else {
    tray = new Tray(iconPath);
  }
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Overlay (Ctrl+`)',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          if (fullscreenMode) {
            mainWindow.setAlwaysOnTop(true, 'screen-saver');
          }
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
          isManualCheck = true;
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
        if (fullscreenMode) {
          mainWindow.setAlwaysOnTop(true, 'screen-saver');
        }
      }
    }
  });
}

// Create overlay widget window
function createOverlayWidget() {
  if (overlayWidget && !overlayWidget.isDestroyed()) {
    overlayWidget.show();
    overlayWidget.focus();
    return;
  }

  const bounds = getOverlayBounds();
  const winOptions: Electron.BrowserWindowConstructorOptions = {
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minWidth: 160,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  };
  if (bounds.x != null && bounds.y != null) {
    winOptions.x = bounds.x;
    winOptions.y = bounds.y;
  }
  overlayWidget = new BrowserWindow(winOptions);

  overlayWidget.loadFile(path.join(__dirname, 'ui/overlay-widget.html'));
  
  overlayWidget.setAlwaysOnTop(true, 'screen-saver');
  overlayWidget.setOpacity(getOverlayOpacity());

  overlayWidget.on('close', () => {
    if (overlayWidget && !overlayWidget.isDestroyed()) {
      const b = overlayWidget.getBounds();
      saveOverlayBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
    }
  });

  overlayWidget.on('closed', () => {
    stopOverlayLockHoverCheck();
    overlayWidget = null;
  });

  // Send initial data
  overlayWidget.webContents.once('did-finish-load', () => {
    updateOverlayWidget();
  });
}

function updateOverlayWidget() {
  if (overlayWidget && !overlayWidget.isDestroyed()) {
    // Just pass through the display values from renderer plus overlay prefs
    overlayWidget.webContents.send('widget-update', {
      ...overlayDisplayData,
      simplifiedOverlay: simplifiedOverlayMode
    });
  }
}

function closeOverlayWidget() {
  if (overlayWidget && !overlayWidget.isDestroyed()) {
    overlayWidget.close();
    overlayWidget = null;
  }
}

// Configure auto-updater
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

let isManualCheck = false; // Track if update check was triggered manually

autoUpdater.on('checking-for-update', () => {
  if (mainWindow && isManualCheck) {
    mainWindow.webContents.send('update-status', {
      status: 'checking',
      message: 'Checking for updates...'
    });
  }
});

autoUpdater.on('update-available', (info) => {
  if (mainWindow && isManualCheck) {
    // For manual checks, notify renderer and start download automatically
    mainWindow.webContents.send('update-status', {
      status: 'available',
      message: `Update available: ${info.version}`,
      version: info.version
    });
    autoUpdater.downloadUpdate();
  } else if (mainWindow && !isManualCheck) {
    // For automatic checks (launch-time and mid-session), show passive panel
    mainWindow.webContents.send('show-update-panel', {
      version: info.version
    });
  }
});

autoUpdater.on('update-not-available', (info) => {
  if (mainWindow && isManualCheck) {
    mainWindow.webContents.send('update-status', {
      status: 'not-available',
      message: 'You are up to date!'
    });
    isManualCheck = false;
  }
});

autoUpdater.on('error', (err) => {
  console.error('Error checking for updates:', err);
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

app.whenReady().then(async () => {
  // Menu.setApplicationMenu(null);

  // Initialize log parser with userData path
  initLogParser(app.getPath('userData'));
  
  // Now that log parser is initialized, we can safely check log size limits
  ensureLogSizeLimit(300);
  setInterval(() => ensureLogSizeLimit(300), 60 * 60 * 1000);
  
  itemDatabase = loadItemDatabase();

  const initialSettings = getSettings();

  priceSyncService = new PriceSyncService();
  const priceCache = await loadPriceCache((options) => priceSyncService.syncPrices({ ...options, leagueId: currentLeagueId }));
  
  inventoryManager = new InventoryManager(itemDatabase, priceCache);

  priceSyncService.setRemoteUpdateHandler((baseId, entry) => {
    const applied = applyCloudPriceUpdate(baseId, entry);
    if (applied) {
      debouncedSavePriceCache();
      if (mainWindow) {
        mainWindow.webContents.send('inventory-updated');
      }
    }
  });
  
  createWindow();
  createTray();

  if (mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      const syncStatus = priceSyncService.getSyncStatus();
      if (syncStatus.consent === 'pending') {
        mainWindow?.webContents.send('show-sync-consent');
      }

      // Initial update check - runs after window is ready
      if (app.isPackaged) {
        autoUpdater.checkForUpdates();
      }
    });
  }
  
  // Show onboarding only once for first-time users
  if (!hasCompletedOnboarding()) {
    if (mainWindow) {
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow?.webContents.send('show-log-path-setup');
      });
    }
  } else {
    // Load inventory if path is configured
    const logEntries = readLogFile();
    inventoryManager.buildInventory(logEntries);
    lastLogPosition = getLogSize();
  }

  // Start main process timers (never throttled)
  
  // Realtime timer - always running
  setInterval(() => {
    timerState.realtimeSeconds++;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('timer-tick', {
        type: 'realtime',
        seconds: timerState.realtimeSeconds
      });
    }
    // Update overlay widget
    updateOverlayWidget();
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


  // Periodic price cache save - every 30 seconds if there are pending updates
  setInterval(async () => {
    if (priceCachePendingSave && inventoryManager) {
      try {
        await savePriceCache(inventoryManager.getPriceCacheAsObject());
        priceCachePendingSave = false;
      } catch (error) {
        console.error('Failed to save price cache (periodic):', error);
      }
    }
  }, PRICE_CACHE_PERIODIC_SAVE_MS);

  // Periodic cloud sync - fetch latest prices every 5 minutes
  setInterval(async () => {
    if (!priceSyncService || !inventoryManager) return;
    const cloudCache = await priceSyncService.syncPrices({ leagueId: currentLeagueId });
    const localCache = inventoryManager.getPriceCacheAsObject();
    let appliedUpdates = 0;

    for (const [baseId, cloudEntry] of Object.entries(cloudCache)) {
      const localEntry = localCache[baseId];
      if (shouldApplyCloudEntry(localEntry, cloudEntry)) {
        inventoryManager.updatePrice(baseId, cloudEntry.price, cloudEntry.listingCount, cloudEntry.timestamp);
        appliedUpdates += 1;
      }
    }

    if (appliedUpdates > 0) {
      debouncedSavePriceCache();
      if (mainWindow) {
        mainWindow.webContents.send('inventory-updated');
      }
    }
  }, PRICE_SYNC_INTERVAL_MS);

  // Periodic update check - every 120 minutes (7,200,000ms)
  setInterval(() => {
    if (app.isPackaged) {
      autoUpdater.checkForUpdates();
    }
  }, 120 * 60 * 1000);

  // Load settings and register keybind
  const settings = getSettings();
  if (settings.keybind) {
    currentKeybind = settings.keybind;
  }
  if (typeof settings.fullscreenMode === 'boolean') {
    fullscreenMode = settings.fullscreenMode;
  }
  if (typeof settings.simplifiedOverlay === 'boolean') {
    simplifiedOverlayMode = settings.simplifiedOverlay;
  }
  const normalizedSettingsLeagueId = normalizeLeagueId(settings.leagueId);
  // Runtime writes should follow the current season by default.
  currentLeagueId = normalizedSettingsLeagueId === 's11-vorax' ? LEAGUE_ID : normalizedSettingsLeagueId;
  if (settings.leagueId !== currentLeagueId) {
    saveSettings({ leagueId: currentLeagueId });
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

app.on('window-all-closed', async () => {
  await forceSavePriceCache();
  
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
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        // Delay focus operations to ensure window is fully shown
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.moveTop();
            mainWindow.focus();
            mainWindow.webContents.focus();
            app.focus({ steal: true });
          }
        }, 50);
      }
    }
  });
  
  if (ret) {
    currentKeybind = keybind;
  } else {
    console.error(`Failed to register keybind: ${keybind}`);
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

ipcMain.handle('get-price-cache', () => {
  return inventoryManager.getPriceCacheAsObject();
});

ipcMain.handle('get-price-history', async (_event, payload: { baseId: string; leagueId?: string; maxDays?: number; maxSnapshotDocs?: number }) => {
  if (!priceSyncService) return [];
  const baseId = payload?.baseId ?? '';
  const leagueId = normalizeLeagueId(payload?.leagueId || currentLeagueId);
  const maxDays = typeof payload?.maxDays === 'number' ? payload.maxDays : 120;
  const maxSnapshotDocs = typeof payload?.maxSnapshotDocs === 'number' ? payload.maxSnapshotDocs : undefined;
  return priceSyncService.getPriceHistory({ baseId, leagueId, maxDays, maxSnapshotDocs });
});

ipcMain.handle('get-price-history-batch', async (_event, payload?: { leagueId?: string; maxDays?: number; maxSnapshotDocs?: number }) => {
  if (!priceSyncService) return {};
  const leagueId = normalizeLeagueId(payload?.leagueId || currentLeagueId);
  const maxDays = typeof payload?.maxDays === 'number' ? payload.maxDays : 7;
  const maxSnapshotDocs = typeof payload?.maxSnapshotDocs === 'number' ? payload.maxSnapshotDocs : undefined;
  return priceSyncService.getPriceHistoryBatch({ leagueId, maxDays, maxSnapshotDocs });
});

ipcMain.handle('get-map-events', () => {
  return parseMapEvents();
});

ipcMain.on('reset-map-events', () => {
  resetMapEventPosition();
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

// Open external links in default browser
ipcMain.on('open-external', (_event, url: string) => {
  shell.openExternal(url);
});

ipcMain.handle('get-maximize-state', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow.isMaximized();
  }
  return false;
});

// Overlay widget IPC handlers
ipcMain.on('toggle-overlay-widget', () => {
  if (overlayWidget && !overlayWidget.isDestroyed()) {
    closeOverlayWidget();
  } else {
    createOverlayWidget();
  }
});

ipcMain.on('close-overlay-widget', () => {
  closeOverlayWidget();
});

// Receives already-calculated display values from renderer
ipcMain.on('update-overlay-widget', (_event, data: { duration: number; hourly: number; total: number; avgTimePerMap: number; lastMapProfit: number; totalMaps: number; isHourlyMode: boolean; isPaused: boolean; wealthMode?: 'realtime' | 'hourly'; isHourlyActive?: boolean }) => {
  overlayDisplayData = { ...overlayDisplayData, ...data };
  updateOverlayWidget();
});

// Widget pause/resume buttons forward to renderer
ipcMain.on('widget-pause-hourly', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('widget-pause-hourly');
  }
});

ipcMain.on('widget-resume-hourly', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('widget-resume-hourly');
  }
});

ipcMain.on('widget-reset-realtime', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('widget-reset-realtime');
  }
});

ipcMain.on('widget-start-hourly', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('widget-start-hourly');
  }
});

ipcMain.on('widget-stop-hourly', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('widget-stop-hourly');
  }
});

// Overlay resize (frameless window has no OS resize handle)
ipcMain.handle('get-overlay-bounds', () => {
  if (overlayWidget && !overlayWidget.isDestroyed()) {
    return overlayWidget.getBounds();
  }
  return null;
});
ipcMain.on('set-overlay-bounds', (_event, bounds: { x: number; y: number; width: number; height: number }) => {
  if (overlayWidget && !overlayWidget.isDestroyed()) {
    overlayWidget.setBounds(bounds);
  }
});

ipcMain.on('save-overlay-bounds', (_event, bounds: { x: number; y: number; width: number; height: number }) => {
  saveOverlayBounds(bounds);
});

ipcMain.on('set-overlay-click-through', (_event, enabled: boolean) => {
  if (overlayWidget && !overlayWidget.isDestroyed()) {
    overlayWidget.setIgnoreMouseEvents(enabled, { forward: enabled });
  }
});

function stopOverlayLockHoverCheck(): void {
  if (overlayLockCheckInterval !== null) {
    clearInterval(overlayLockCheckInterval);
    overlayLockCheckInterval = null;
  }
  overlayLockButtonRect = null;
  if (overlayWidget && !overlayWidget.isDestroyed()) {
    overlayWidget.setIgnoreMouseEvents(false);
  }
}

ipcMain.on('overlay-lock-button-bounds', (_event, rect: { left: number; top: number; width: number; height: number }) => {
  overlayLockButtonRect = rect;
  stopOverlayLockHoverCheck();
  if (!overlayWidget || overlayWidget.isDestroyed()) return;
  overlayWidget.setIgnoreMouseEvents(true, { forward: true });
  const CHECK_MS = 50;
  overlayLockCheckInterval = setInterval(() => {
    if (!overlayWidget || overlayWidget.isDestroyed() || !overlayLockButtonRect) {
      stopOverlayLockHoverCheck();
      return;
    }
    const bounds = overlayWidget.getBounds();
    const r = overlayLockButtonRect;
    const screenX = bounds.x + r.left;
    const screenY = bounds.y + r.top;
    const point = screen.getCursorScreenPoint();
    const overLock = point.x >= screenX && point.x <= screenX + r.width && point.y >= screenY && point.y <= screenY + r.height;
    overlayWidget.setIgnoreMouseEvents(!overLock, { forward: !overLock });
  }, CHECK_MS);
});

ipcMain.on('overlay-unlocked', () => {
  stopOverlayLockHoverCheck();
});

ipcMain.handle('get-overlay-opacity', () => getOverlayOpacity());
ipcMain.on('set-overlay-opacity', (_event, opacity: number) => {
  const value = Math.max(0, Math.min(1, Number(opacity)));
  saveOverlayOpacity(value);
  if (overlayWidget && !overlayWidget.isDestroyed()) {
    overlayWidget.setOpacity(value);
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
    // Silent install: true = no UI, true = run after install
    autoUpdater.quitAndInstall(true, true);
  }
  // 'later' response just closes the modal, no action needed
});

ipcMain.handle('is-log-path-configured', () => {
  return isLogPathConfigured();
});

ipcMain.handle('get-log-path', () => {
  return getLogPath();
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
    markOnboardingCompleted();
    
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

ipcMain.handle('get-cloud-sync-status', () => {
  return priceSyncService.getSyncStatus();
});

ipcMain.handle('set-cloud-sync-enabled', async (event, enabled: boolean) => {
  try {
    await priceSyncService.setSyncEnabled(enabled);
    if (enabled && inventoryManager) {
      const cloudCache = await priceSyncService.syncPrices({ forceFull: true, leagueId: currentLeagueId });
      const localCache = inventoryManager.getPriceCacheAsObject();
      let appliedUpdates = 0;
      for (const [baseId, cloudEntry] of Object.entries(cloudCache)) {
        const localEntry = localCache[baseId];
        if (shouldApplyCloudEntry(localEntry, cloudEntry)) {
          inventoryManager.updatePrice(baseId, cloudEntry.price, cloudEntry.listingCount, cloudEntry.timestamp);
          appliedUpdates += 1;
        }
      }
      if (appliedUpdates > 0) {
        debouncedSavePriceCache();
        if (mainWindow) {
          mainWindow.webContents.send('inventory-updated');
        }
      }
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to update cloud sync setting' };
  }
});

ipcMain.handle('get-username-info', () => {
  return priceSyncService.getUsernameInfo();
});

ipcMain.handle('set-username', async (event, username: string) => {
  try {
    await priceSyncService.setUsername(username);
    const info = priceSyncService.getUsernameInfo();
    return { success: true, nextChangeAt: info.nextChangeAt };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to update username' };
  }
});

ipcMain.handle('save-settings', async (event, settings: { keybind?: string; fullscreenMode?: boolean; includeTax?: boolean; leagueId?: string; layoutStyle?: 1 | 2; simplifiedOverlay?: boolean }) => {
  try {
    const normalizedSettings = { ...settings };
    if (typeof settings.leagueId === 'string') {
      const normalizedLeagueId = normalizeLeagueId(settings.leagueId);
      // Prevent old-season values from becoming the active write league.
      normalizedSettings.leagueId = normalizedLeagueId === 's11-vorax' ? LEAGUE_ID : normalizedLeagueId;
      currentLeagueId = normalizedSettings.leagueId;
    }
    saveSettings(normalizedSettings);
    if (typeof settings.simplifiedOverlay === 'boolean') {
      simplifiedOverlayMode = settings.simplifiedOverlay;
      updateOverlayWidget();
    }
    
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
          mainWindow.setAlwaysOnTop(true, 'screen-saver'); // Above taskbar
          mainWindow.setSkipTaskbar(true);
          mainWindow.setResizable(false);
          mainWindow.setMovable(false);
          // Add small buffer to compensate for thick frame border (if window was created in windowed mode)
          const buffer = 8;
          mainWindow.setBounds({ 
            x: x - buffer, 
            y: y - buffer, 
            width: width + buffer * 2, 
            height: height + buffer * 2 
          });
        } else {
          // Switch to normal window mode
          mainWindow.setAlwaysOnTop(false);
          mainWindow.setSkipTaskbar(false);
          mainWindow.setResizable(true);
          mainWindow.setMovable(true);
          // Resize to normal window size and maximize
          mainWindow.setBounds({ 
            x: x + (width - 1440) / 2, 
            y: y + (height - 900) / 2, 
            width: 1440, 
            height: 900 
          });
          mainWindow.maximize();
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

// Hourly history IPC handlers
ipcMain.handle('save-hourly-session', async (_event, buckets) => {
  return saveHourlySession(buckets);
});

ipcMain.handle('load-hourly-sessions', async () => {
  return loadHourlySessions();
});

ipcMain.handle('delete-hourly-session', async (_event, sessionId) => {
  return deleteHourlySession(sessionId);
});

ipcMain.handle('clear-all-history', async () => {
  return clearAllHistory();
});

ipcMain.handle('delete-buckets-by-date-hour', async (_event, dateStr: string, hourNumber: number) => {
  return deleteBucketsByDateAndHour(dateStr, hourNumber);
});

ipcMain.handle('update-bucket-custom-name', async (_event, dateStr: string, hourNumber: number, customName?: string) => {
  return updateBucketCustomName(dateStr, hourNumber, customName);
});

// Log file watcher
function watchLogFile() {
  // Check log size limit frequently (every 500ms) to prevent file from growing too large
  // The function will return early if size is OK, so this is efficient
  ensureLogSizeLimit(300);

  // Get current size after potential truncation
  const currentSize = getLogSize();

  // Detect log file truncation (when ensureLogSizeLimit runs)
  if (currentSize < lastLogPosition) {
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
        // Use the most recent SEND message's baseId
        currentPriceCheckBaseId = lastSendBaseId;
        // If not found in lastSendBaseId, try to extract from the send message buffer
        if (!currentPriceCheckBaseId && sendMessageBuffer.length > 0) {
          for (const bufLine of sendMessageBuffer) {
            if ((bufLine.includes('+itemBaseId') || bufLine.includes('+refer')) && bufLine.includes('[')) {
              const match = bufLine.match(/\+refer\s*\[(\d+)\]/);
              if (match) {
                currentPriceCheckBaseId = match[1];
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
              const timestamp = Date.now();
              inventoryManager.updatePrice(priceResult.baseId, priceResult.avgPrice, priceResult.listingCount, timestamp);
              if (priceSyncService) {
                priceSyncService.queuePriceWrite(priceResult.baseId, {
                  price: priceResult.avgPrice,
                  timestamp,
                  listingCount: priceResult.listingCount
                }, { leagueId: currentLeagueId });
              }
              debouncedSavePriceCache();
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
              
              priceUpdated = true;
            } else {
            }
          } else {
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

    // FIX: Debounce inventory-updated to prevent race conditions
    // When multiple updates happen rapidly, we might send duplicate events
    // This can cause renderer to capture incomplete inventory state, corrupting hourly snapshots
    if ((inventoryChanged || priceUpdated) && mainWindow) {
      if (Date.now() - lastSentInventoryUpdate > 100) {
        mainWindow.webContents.send('inventory-updated');
        lastSentInventoryUpdate = Date.now();
      }
    }

    lastLogPosition = currentSize;
  }
}