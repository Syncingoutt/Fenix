// renderer.ts
interface InventoryItem {
  itemName: string;
  totalQuantity: number;
  baseId: string;
  price: number | null;
  instances: number;
  lastUpdated: string;
  pageId: number | null;
  slotId: number | null;
}

interface ElectronAPI {
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

declare const electronAPI: ElectronAPI;
declare const Chart: any;

// === INVENTORY STATE ===
let currentItems: InventoryItem[] = [];
let itemDatabase: Record<string, { name: string; tradable?: boolean; group?: string }> = {};

// Sorting
let currentSortBy: 'priceUnit' | 'priceTotal' = 'priceTotal';
let currentSortOrder: 'asc' | 'desc' = 'desc';
let searchQuery: string = '';
let selectedGroupFilter: string | null = null;
let minPriceFilter: number | null = null;
let maxPriceFilter: number | null = null;

// Tax preference
let includeTax: boolean = false;
const TAX_RATE = 0.125; // 12.5% tax rate (1 FE per 8 FE = 1/8 = 12.5%)
const FLAME_ELEMENTIUM_ID = '100300'; // Never apply tax to currency

// === WEALTH TRACKING STATE ===
let wealthMode: 'realtime' | 'hourly' = 'realtime';
let realtimeHistory: { time: number; value: number }[] = [];
let hourlyHistory: { time: number; value: number }[] = [];
const MAX_POINTS = 7200; // Store up to 2 hours of second-by-second data

// Hourly mode: snapshot of inventory at start
let hourlyStartSnapshot: Map<string, number> = new Map(); // baseId -> quantity
let hourlyStartTime = 0;
let hourlyElapsedSeconds = 0;
let isHourlyActive = false;
let hourlyPaused = false;
// Compasses/beacons to track usage for (selected by user)
let includedItems: Set<string> = new Set(); // baseId -> track usage for this item
// Selection state while the compass/beacon picker modal is open
let compassBeaconSelectionState: Set<string> | null = null;
// Track previous quantity of compasses/beacons to detect consumption
let previousQuantities: Map<string, number> = new Map(); // baseId -> previous quantity
// Track usage per hour for compasses/beacons (resets each hour)
let hourlyUsage: Map<string, number> = new Map(); // baseId -> quantity used this hour
// Track purchases per hour for compasses/beacons (resets each hour)
let hourlyPurchases: Map<string, number> = new Map(); // baseId -> quantity purchased this hour

// Hourly buckets - store data for each completed hour
interface HourlyBucket {
  hourNumber: number;
  startValue: number;
  endValue: number;
  earnings: number;
  history: { time: number; value: number }[];
}
let hourlyBuckets: HourlyBucket[] = [];
let currentHourStartValue = 0;

// Realtime tracking
let realtimeStartValue = 0;
let realtimeStartTime = 0;
let realtimeElapsedSeconds = 0;
let isRealtimeInitialized = false;

// === DOM ELEMENTS ===
const wealthValueEl = document.getElementById('wealthValue')!;
const wealthHourlyEl = document.getElementById('wealthHourly')!;
const realtimeBtn = document.getElementById('realtimeBtn') as HTMLButtonElement;
const hourlyBtn = document.getElementById('hourlyBtn') as HTMLButtonElement;
const hourlyControls = document.getElementById('hourlyControls')!;
const startHourlyBtn = document.getElementById('startHourly') as HTMLButtonElement;
const stopHourlyBtn = document.getElementById('stopHourly') as HTMLButtonElement;
const pauseHourlyBtn = document.getElementById('pauseHourly') as HTMLButtonElement;
const resumeHourlyBtn = document.getElementById('resumeHourly') as HTMLButtonElement;
const hourlyTimerEl = document.getElementById('hourlyTimer')!;
const timerEl = document.getElementById('timer')!;
const resetRealtimeBtn = document.getElementById('resetRealtimeBtn') as HTMLButtonElement;

// Chart.js
let chart: any;
let hourCharts: any[] = []; // Store hour chart instances separately

// ---- INITIAL UI STATE ----
startHourlyBtn.style.display = 'inline-block';
stopHourlyBtn.style.display = 'none';
pauseHourlyBtn.style.display = 'none';
resumeHourlyBtn.style.display = 'none';
hourlyControls.classList.remove('active');
realtimeBtn.classList.add('active');
hourlyBtn.classList.remove('active');
resetRealtimeBtn.style.display = 'block'; // Show reset button in realtime mode

// === INITIAL LOAD ===
async function loadInventory() {
  const [inventory, db] = await Promise.all([
    electronAPI.getInventory(),
    electronAPI.getItemDatabase()
  ]);
  
  itemDatabase = db;
  
  // Set Flame Elementium price to 1 FE (it's the currency itself)
  currentItems = inventory.map(item => {
    if (item.baseId === '100300') {
      return { ...item, price: 1 };
    }
    return item;
  });
  
  // Initialize realtime tracking with the loaded inventory value (only once)
  if (!isRealtimeInitialized) {
    initRealtimeTracking();
    isRealtimeInitialized = true;
  }
  
  // Track compass/beacon consumption if hourly mode is active
  if (isHourlyActive && !hourlyPaused) {
    trackCompassBeaconUsage();
  }
  
  // Update previous quantities for tracking
  updatePreviousQuantities();
  
  renderInventory();
  updateStats(currentItems);
  renderBreakdown();
}

// === GET ITEMS TO DISPLAY (based on mode) ===
function getDisplayItems(): InventoryItem[] {
  if (wealthMode === 'hourly' && isHourlyActive) {
    // In hourly mode, show items gained since start
    // Exclude ONLY the compasses/beacons that the user selected (includedItems)
    // Other compasses/beacons that weren't selected will still show in the item list
    // Always show Flame Elementium (FE) even if gainedQty is 0 or negative
    return currentItems
      .filter(item => !includedItems.has(item.baseId)) // Exclude only selected compasses/beacons
      .map(item => {
        const currentQty = item.totalQuantity;
        const startQty = hourlyStartSnapshot.get(item.baseId) || 0;
        
        // Show gained quantity
        const gainedQty = currentQty - startQty;
        return {
          ...item,
          totalQuantity: gainedQty
        };
      })
      .filter(item => {
        // Always show Flame Elementium (FE) even if gainedQty is 0 or negative
        if (item.baseId === '100300') return true;
        // For other items, only show if quantity > 0
        return item.totalQuantity > 0;
      });
  }
  
  // In realtime mode or when hourly isn't active, show all items
  return currentItems;
}

// === FILTER & SORT ===
function getSortedAndFilteredItems(): InventoryItem[] {
  const itemsToDisplay = getDisplayItems();

  let filtered = itemsToDisplay.filter(item => {
    // Search filter
    if (searchQuery && !item.itemName.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    
    // Group filter
    if (selectedGroupFilter !== null) {
      const itemData = itemDatabase[item.baseId];
      const itemGroup = itemData?.group || 'none';
      if (itemGroup !== selectedGroupFilter) {
        return false;
      }
    }
    
    // Price filter (min/max based on total price)
    if (item.price === null) {
      // Items without price are excluded if min price is set
      if (minPriceFilter !== null && minPriceFilter > 0) return false;
      // Items without price pass max filter (they don't have a value to compare)
      return true;
    }
    
    const totalValue = item.price * item.totalQuantity;
    const totalValueAfterTax = applyTax(totalValue, item.baseId);
    
    // Min price filter
    if (minPriceFilter !== null && totalValueAfterTax < minPriceFilter) {
      return false;
    }
    
    // Max price filter
    if (maxPriceFilter !== null && totalValueAfterTax > maxPriceFilter) {
      return false;
    }
    
    return true;
  });

  filtered.sort((a, b) => {
    let comparison = 0;
    if (currentSortBy === 'priceUnit') {
      const priceA = a.price ?? -1;
      const priceB = b.price ?? -1;
      comparison = priceA - priceB;
    } else if (currentSortBy === 'priceTotal') {
      const totalA = applyTax((a.price ?? 0) * a.totalQuantity, a.baseId);
      const totalB = applyTax((b.price ?? 0) * b.totalQuantity, b.baseId);
      comparison = totalA - totalB;
    }
    return currentSortOrder === 'asc' ? comparison : -comparison;
  });

  return filtered;
}

// === PAGE LABEL ===
function getPageLabel(item: InventoryItem): string {
  if (item.pageId === null || item.slotId === null) return '';
  const pagePrefix = item.pageId === 102 ? 'P1' : item.pageId === 103 ? 'P2' : `P${item.pageId}`;
  const slotNumber = item.slotId + 1;
  return `${pagePrefix}:${slotNumber}`;
}

// === RENDER USAGE SECTION ===
function renderUsageSection() {
  const usageSection = document.getElementById('usageSection');
  const usageContent = document.getElementById('usageContent');
  
  if (!usageSection || !usageContent) return;
  
    // Only show in hourly mode when active and items are being tracked
    if (wealthMode === 'hourly' && isHourlyActive && includedItems.size > 0) {
      usageSection.style.display = 'block';
      
      const usageItems: Array<{ baseId: string; itemName: string; netUsage: number; price: number }> = [];
      
      for (const baseId of includedItems) {
        // Always get the latest item data and price from currentItems (prices can be updated during session)
        const item = currentItems.find(i => i.baseId === baseId);
        const currentQty = item ? item.totalQuantity : 0;
        const startQty = hourlyStartSnapshot.get(baseId) || 0;
        
        // Calculate net usage for display: (startQty - currentQty)
        // Positive means used, negative means bought
        const netUsage = startQty - currentQty;
        
        if (!item) {
          // If item not in inventory, try to get from database
          const itemData = itemDatabase[baseId];
          if (itemData) {
            usageItems.push({
              baseId,
              itemName: itemData.name,
              netUsage,
              price: 0 // No price if not in inventory
            });
          }
          continue;
        }
        
        // Always include tracked items, even if netUsage is 0
        // Use current price (may have been updated during session)
        usageItems.push({
          baseId,
          itemName: item.itemName,
          netUsage,
          price: item.price || 0 // Always use current price, not cached
        });
      }
      
      if (usageItems.length === 0) {
        usageSection.style.display = 'none';
        return;
      }
    
    // Sort by total cost (highest absolute value first)
    // Selected compasses/beacons: use raw price without tax for sorting
    usageItems.sort((a, b) => {
      const totalA = a.price > 0 ? Math.abs(a.netUsage * a.price) : 0;
      const totalB = b.price > 0 ? Math.abs(b.netUsage * b.price) : 0;
      return totalB - totalA;
    });
    
    let totalUsageCost = 0;
    
    usageContent.innerHTML = usageItems.map(({ baseId, itemName, netUsage, price }) => {
      // Selected compasses/beacons: do NOT apply tax (use raw price)
      const unitPrice = price > 0 ? price : 0;
      const totalPrice = price > 0 ? Math.abs(netUsage) * price : 0;
      
      // Calculate contribution to total (negative if used more, positive if gained more)
      if (netUsage > 0) {
        // Used more: subtract from total
        totalUsageCost -= totalPrice; // No tax
      } else if (netUsage < 0) {
        // Gained more: add to total
        totalUsageCost += totalPrice; // No tax
      }
      
      const quantityPrefix = netUsage > 0 ? '-' : netUsage < 0 ? '+' : '';
      const quantityDisplay = netUsage !== 0 ? `${quantityPrefix}${Math.abs(netUsage)}` : '0';
      const totalPrefix = netUsage > 0 ? '-' : netUsage < 0 ? '+' : '';
      const totalDisplay = price > 0 && netUsage !== 0 ? `${totalPrefix}${totalPrice.toFixed(2)} FE` : '- FE';
      
      return `
        <div class="item-row">
          <div class="item-name">
            <img src="../../assets/${baseId}.webp" 
                 alt="${itemName}" 
                 class="item-icon"
                 onerror="this.style.display='none'">
            <div class="item-name-content">
              <div class="item-name-text">${itemName}</div>
            </div>
          </div>
          <div class="item-quantity">${quantityDisplay}</div>
          <div class="item-price">
            <div class="price-single ${price === 0 ? 'no-price' : ''}">
              ${price > 0 ? unitPrice.toFixed(2) : 'Not Set'}
            </div>
            ${price > 0 && netUsage !== 0 ? `<div class="price-total">${totalDisplay}</div>` : ''}
          </div>
        </div>
      `;
    }).join('') + (usageItems.length > 0 && totalUsageCost !== 0 ? `
      <div class="usage-footer">
        <div class="usage-footer-label">Net Impact:</div>
        <div class="usage-footer-total">${totalUsageCost > 0 ? '+' : ''}${totalUsageCost.toFixed(2)} FE</div>
      </div>
    ` : '');
  } else {
    usageSection.style.display = 'none';
  }
}

// === RENDER INVENTORY ===
function renderInventory() {
  // Render usage section first
  renderUsageSection();
  
  const container = document.getElementById('inventory');
  if (!container) return;

  const items = getSortedAndFilteredItems();

  if (items.length === 0) {
    const message = (wealthMode === 'hourly' && isHourlyActive) 
      ? 'No new items gained yet' 
      : 'No items match your filters';
    container.innerHTML = `<div class="loading">${message}</div>`;
    updateSortIndicators();
    return;
  }

  container.innerHTML = items
    .map(item => {
      const totalValue = item.price !== null ? item.price * item.totalQuantity : null;
      // Apply tax to total value (but not to base price)
      const totalValueAfterTax = totalValue !== null ? applyTax(totalValue, item.baseId) : null;
      const pageLabel = getPageLabel(item);

      return `
      <div class="item-row">
        <div class="item-name">
          <img src="../../assets/${item.baseId}.webp" 
               alt="${item.itemName}" 
               class="item-icon"
               onerror="this.style.display='none'">
          <div class="item-name-content">
            <div class="item-label">${item.itemName}</div>
            ${pageLabel ? `<div class="page-label">${pageLabel}</div>` : ''}
          </div>
        </div>
        <div class="item-quantity">${item.totalQuantity.toLocaleString()}</div>
        <div class="item-price">
          <div class="price-single ${item.price === null ? 'no-price' : ''}">
            ${item.price !== null ? item.price.toFixed(2) : 'Not Set'}
          </div>
          ${totalValueAfterTax !== null ? `<div class="price-total">${totalValueAfterTax.toFixed(2)}</div>` : ''}
        </div>
      </div>
    `;
    })
    .join('');

  updateSortIndicators();
}

// === UPDATE STATS ===
function updateStats(items: InventoryItem[]) {
  updateRealtimeWealth();
  if (isHourlyActive && !hourlyPaused) {
    updateHourlyWealth();
  }
  renderBreakdown();
}

// === TRACK COMPASS/BEACON USAGE ===
function trackCompassBeaconUsage() {
  // Track usage and purchases separately for selected compasses/beacons
  for (const baseId of includedItems) {
    const currentItem = currentItems.find(item => item.baseId === baseId);
    const currentQty = currentItem ? currentItem.totalQuantity : 0;
    const previousQty = previousQuantities.get(baseId) ?? (hourlyStartSnapshot.get(baseId) ?? currentQty);
    const startQty = hourlyStartSnapshot.get(baseId) ?? currentQty;
    
    // Track usage: quantity decreased (used)
    if (currentQty < previousQty) {
      const used = previousQty - currentQty;
      const currentUsage = hourlyUsage.get(baseId) || 0;
      hourlyUsage.set(baseId, currentUsage + used);
      console.log(`📦 Tracked usage: ${currentItem?.itemName || baseId} used ${used} (total this hour: ${currentUsage + used})`);
    }
    
    // Track purchases: quantity increased (bought)
    if (currentQty > previousQty) {
      const bought = currentQty - previousQty;
      const currentPurchases = hourlyPurchases.get(baseId) || 0;
      hourlyPurchases.set(baseId, currentPurchases + bought);
      console.log(`💰 Tracked purchase: ${currentItem?.itemName || baseId} bought ${bought} (total this hour: ${currentPurchases + bought})`);
    }
    
    // Calculate net usage for display: (startQty - currentQty)
    // Negative means used more, positive means gained more
    const netUsage = startQty - currentQty;
  }
}

// === UPDATE PREVIOUS QUANTITIES ===
function updatePreviousQuantities() {
  // Update previous quantities for all tracked compasses/beacons
  for (const baseId of includedItems) {
    const currentItem = currentItems.find(item => item.baseId === baseId);
    if (currentItem) {
      previousQuantities.set(baseId, currentItem.totalQuantity);
    }
  }
}

// === HELPER: Format Group Name ===
function formatGroupName(group: string): string {
  if (group === 'none') return 'Uncategorized';
  // Replace underscores with spaces and capitalize each word
  return group
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

// === RENDER BREAKDOWN ===
function renderBreakdown() {
  const breakdownEl = document.getElementById('breakdown');
  if (!breakdownEl) return;

  // Use getDisplayItems() to respect current mode (realtime vs hourly)
  const itemsToUse = getDisplayItems();

  // Calculate group totals
  const groupTotals = new Map<string, number>();
  
  for (const item of itemsToUse) {
    if (item.price === null) continue;
    // Skip items with 0 or negative quantity (only show gains in hourly mode)
    if (item.totalQuantity <= 0) continue;
    
    // Skip items that don't pass price filters
    if (!passesPriceFilters(item)) continue;
    
    const itemData = itemDatabase[item.baseId];
    if (!itemData || itemData.tradable === false) continue;
    
    const group = itemData.group || 'none';
    const itemValue = item.price * item.totalQuantity;
    // Apply tax to item value for breakdown
    const itemValueAfterTax = applyTax(itemValue, item.baseId);
    
    groupTotals.set(group, (groupTotals.get(group) || 0) + itemValueAfterTax);
  }

  // Convert to array and sort by total value (highest first)
  const groups = Array.from(groupTotals.entries())
    .map(([group, total]) => ({ group, total }))
    .filter(({ total }) => total > 0) // Only show positive totals
    .sort((a, b) => b.total - a.total);

  if (groups.length === 0) {
    breakdownEl.innerHTML = '<div class="breakdown-empty">No items with prices</div>';
    return;
  }

  // Render in 3-column grid
  breakdownEl.innerHTML = groups.map(({ group, total }) => {
    const formattedGroupName = formatGroupName(group);
    const isSelected = selectedGroupFilter === group;
    return `
      <div class="breakdown-group ${isSelected ? 'selected' : ''}" data-group="${group}" title="${formattedGroupName}">
        <img src="../../assets/${group}.webp" alt="${formattedGroupName}" class="breakdown-icon" title="${formattedGroupName}" onerror="this.style.display='none'">
        <span class="breakdown-group-value" title="${formattedGroupName}">${total.toFixed(0)} FE</span>
      </div>
    `;
  }).join('');
  
  // Add click handlers to breakdown groups
  breakdownEl.querySelectorAll('.breakdown-group').forEach(groupEl => {
    groupEl.addEventListener('click', () => {
      const group = (groupEl as HTMLElement).dataset.group;
      if (group) {
        // Toggle filter: if already selected, clear it; otherwise, set it
        if (selectedGroupFilter === group) {
          selectedGroupFilter = null;
        } else {
          selectedGroupFilter = group;
        }
        // Re-render to update selected state and filtered items
        renderBreakdown();
        renderInventory();
      }
    });
  });
}

// === SORT INDICATORS ===
function updateSortIndicators() {
  document.querySelectorAll('[data-sort]').forEach(el => {
    const sortType = (el as HTMLElement).dataset.sort;
    if (!sortType) return;
    
    // Set text content without "Up" or "Down"
    (el as HTMLElement).textContent = sortType === 'priceUnit' ? 'Price' : 'Total';
    
    // Remove existing sort classes
    (el as HTMLElement).classList.remove('sort-active', 'sort-asc', 'sort-desc');
    
    // Add appropriate classes for active sort
    if (sortType === currentSortBy) {
      (el as HTMLElement).classList.add('sort-active');
      (el as HTMLElement).classList.add(currentSortOrder === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
}

// === HELPER: Format Time ===
function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// === HELPER: Apply Tax ===
function applyTax(value: number, baseId: string | null = null): number {
  // Never apply tax if preference is disabled
  if (!includeTax) return value;
  
  // Never apply tax to Flame Elementium (currency)
  if (baseId === FLAME_ELEMENTIUM_ID) return value;
  
  // Apply tax: subtract 12.5% (1 FE per 8 FE = multiply by 0.875)
  const taxedValue = value * (1 - TAX_RATE);
  return taxedValue;
}

// === HELPER: Check if item passes price filters ===
function passesPriceFilters(item: InventoryItem): boolean {
  if (item.price === null) {
    // Items without price are excluded if min price is set
    if (minPriceFilter !== null && minPriceFilter > 0) return false;
    // Items without price pass max filter
    return true;
  }
  
  const totalValue = item.price * item.totalQuantity;
  const totalValueAfterTax = applyTax(totalValue, item.baseId);
  
  // Min price filter
  if (minPriceFilter !== null && totalValueAfterTax < minPriceFilter) {
    return false;
  }
  
  // Max price filter
  if (maxPriceFilter !== null && totalValueAfterTax > maxPriceFilter) {
    return false;
  }
  
  return true;
}

// === CURRENT TOTAL VALUE ===
function getCurrentTotalValue(): number {
  return currentItems.reduce((sum, item) => {
    // Skip items that don't pass price filters
    if (!passesPriceFilters(item)) {
      return sum;
    }
    
    if (item.price !== null) {
      const totalValue = item.totalQuantity * item.price;
      // Apply tax to total (but not to base price)
      return sum + applyTax(totalValue, item.baseId);
    }
    return sum;
  }, 0);
}

// === HOURLY: Calculate wealth gained since start ===
function getHourlyWealthGain(): number {
  let gainedValue = 0;
  
  // Calculate gains from all items
  // Exclude ONLY the compasses/beacons that the user selected (includedItems)
  // Other compasses/beacons are treated like normal items
  for (const item of currentItems) {
    if (item.price === null) continue;
    
    // Skip only the selected compasses/beacons (they're handled separately)
    if (includedItems.has(item.baseId)) {
      continue;
    }
    
    const currentQty = item.totalQuantity;
    const startQty = hourlyStartSnapshot.get(item.baseId) || 0;
    const gainedQty = currentQty - startQty;
    
    // For Flame Elementium (FE), always count the change (can be negative)
    // For other items, only count gains (positive changes)
    if (item.baseId === '100300') {
      // FE: count change (can be negative, e.g., 200 - 300 = -100)
      const feChange = gainedQty * item.price; // price is 1 for FE
      gainedValue += feChange; // Can be negative
    } else {
      // Other items: only count gains
      if (gainedQty <= 0) continue; // No gain, skip
      
      const itemValueToCheck = gainedQty * item.price;
      const itemValueAfterTax = applyTax(itemValueToCheck, item.baseId);
      
      // Check if gained value passes price filters
      if (minPriceFilter !== null && itemValueAfterTax < minPriceFilter) {
        continue;
      }
      if (maxPriceFilter !== null && itemValueAfterTax > maxPriceFilter) {
        continue;
      }
      
      // Count gained value
      gainedValue += itemValueAfterTax;
    }
  }
  
  // Handle tracked compasses/beacons: net usage affects wealth
  // netUsage = startQty - currentQty
  // netUsage > 0: used items → subtract cost (negative impact)
  // netUsage < 0: bought items → add value (positive impact)
  // Selected compasses/beacons: do NOT apply tax (use raw price)
  
  for (const baseId of includedItems) {
    // Always get the latest price from currentItems (prices can be updated during session)
    const item = currentItems.find(i => i.baseId === baseId);
    if (!item || item.price === null) continue;
    
    const currentQty = item.totalQuantity;
    const startQty = hourlyStartSnapshot.get(baseId) || 0;
    const netUsage = startQty - currentQty; // Calculate net usage
    
    if (netUsage === 0) continue;
    
    // Use current price for calculations (may have been updated during session)
    // Selected compasses/beacons: use raw price without tax
    const value = Math.abs(netUsage) * item.price;
    
    if (netUsage > 0) {
      // Used items: subtract cost (negative impact on FE)
      gainedValue -= value;
    } else {
      // Bought items: add value (positive impact on FE)
      gainedValue += value;
    }
  }
  
  return gainedValue; // Allow negative values
}

// === GRAPH: Init with Chart.js ===
function initGraph() {
  const canvas = document.getElementById('wealth-graph') as HTMLCanvasElement;
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d')!;

  // Destroy existing chart if it exists
  if (chart) {
    chart.destroy();
  }

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Wealth (FE)',
        data: [],
        borderColor: '#DE5C0B',
        backgroundColor: 'rgba(222, 92, 11, 0.1)',
        borderWidth: 2,
        tension: 0.4,
        pointRadius: 0,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          display: true,
          grid: { 
            color: '#7E7E7E',
            drawBorder: false
          },
          ticks: {
            color: '#FAFAFA',
            maxTicksLimit: 10
          }
        },
        y: {
          display: true,
          grid: { 
            color: '#7E7E7E',
            drawBorder: false
          },
          ticks: {
            color: '#FAFAFA',
            callback: function(value: any) {
              const num = value as number;
              // Only show decimal if non-zero
              return num % 1 === 0 ? num.toFixed(0) : num.toFixed(1);
            }
          }
        }
      },
      plugins: {
        legend: { 
          display: false 
        },
        tooltip: {
          enabled: true,
          backgroundColor: '#272727',
          titleColor: '#FAFAFA',
          bodyColor: '#FAFAFA',
          borderColor: '#7E7E7E',
          borderWidth: 1,
          displayColors: false,
          boxWidth: 0,
          boxHeight: 0,
          callbacks: {
            title: (items: any[]) => {
              if (items.length === 0 || !chart) return '';
              const item = items[0];
              const value = item.parsed.y;
              // Format value - only show decimal if non-zero
              const formatted = value % 1 === 0 ? value.toFixed(0) : value.toFixed(1);
              return `Wealth: ${formatted} FE`;
            },
            label: (context: any) => {
              if (!chart) return '';
              const dataIndex = context.dataIndex;
              
              // Get current history from chart (updated dynamically)
              const currentHistory = (chart as any).currentHistory || 
                (wealthMode === 'realtime' ? realtimeHistory : hourlyHistory);
              
              if (dataIndex >= 0 && dataIndex < currentHistory.length) {
                const point = currentHistory[dataIndex];
                const date = new Date(point.time);
                
                // Round to nearest minute (60 seconds) for smoother timestamp updates
                const roundedSeconds = Math.floor(date.getSeconds() / 60) * 60;
                const roundedDate = new Date(date);
                roundedDate.setSeconds(roundedSeconds);
                roundedDate.setMilliseconds(0);
                
                const hours = roundedDate.getHours().toString().padStart(2, '0');
                const minutes = roundedDate.getMinutes().toString().padStart(2, '0');
                return `${hours}:${minutes}`;
              }
              return '';
            },
            footer: () => '' // Remove default footer
          }
        }
      },
      interaction: {
        intersect: false,
        mode: 'index'
      }
    }
  });

  updateGraph();
}

// === GRAPH: Push Point (for Total/Realtime - always tracks) ===
function pushRealtimePoint(value: number) {
  const now = Date.now();
  const point = { time: now, value: Math.round(value) };
  
  // Always push to realtime history (Total tracking never stops)
  realtimeHistory.push(point);
  if (realtimeHistory.length > MAX_POINTS) {
    realtimeHistory.shift();
  }
  
  // Only update graph if we're in realtime mode
  if (wealthMode === 'realtime') {
    updateGraph();
  }
}

// === GRAPH: Push Point (legacy - for mode-based tracking) ===
function pushPoint(value: number) {
  const now = Date.now();
  const point = { time: now, value: Math.round(value) };
  
  if (wealthMode === 'realtime') {
    realtimeHistory.push(point);
    if (realtimeHistory.length > MAX_POINTS) {
      realtimeHistory.shift();
    }
  } else {
    hourlyHistory.push(point);
    if (hourlyHistory.length > MAX_POINTS) {
      hourlyHistory.shift();
    }
  }

  updateGraph();
}

// === GRAPH: Update Chart.js ===
function updateGraph() {
  if (!chart) return;

  const currentHistory = wealthMode === 'realtime' ? realtimeHistory : hourlyHistory;

  // Calculate time interval based on session length
  const sessionDurationHours = currentHistory.length / 3600;
  let intervalMinutes = 60;
  
  if (sessionDurationHours > 5) {
    intervalMinutes = 120;
  }
  if (sessionDurationHours > 10) {
    intervalMinutes = 180;
  }
  if (sessionDurationHours > 20) {
    intervalMinutes = 240;
  }

  const labels = currentHistory.map((p, index) => {
    const date = new Date(p.time);
    const minutes = date.getMinutes();
    const hours = date.getHours();
    
    if (index === 0 || index === currentHistory.length - 1) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }
    
    if (currentHistory.length > 0) {
      const elapsedMinutes = Math.floor((p.time - currentHistory[0].time) / 60000);
      if (elapsedMinutes % intervalMinutes === 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      }
    }
    
    return '';
  });

  const data = currentHistory.map(p => p.value);

  chart.data.labels = labels;
  chart.data.datasets[0].data = data;
  chart.options.scales.x.ticks.maxTicksLimit = Math.min(12, Math.ceil(sessionDurationHours));
  
  // Store history reference in chart for tooltip callbacks
  (chart as any).currentHistory = currentHistory;
  (chart as any).currentMode = wealthMode;
  
  chart.update('none');
}

// === WEALTH: Real-time (always running) ===
function initRealtimeTracking() {
  realtimeStartValue = getCurrentTotalValue();
  realtimeStartTime = Date.now();
  pushPoint(realtimeStartValue);
}

// === REALTIME: Reset Timer ===
function resetRealtimeTracking() {
  console.log('🔄 Resetting realtime timer and per hour calculation');
  
  // Reset timer state
  realtimeElapsedSeconds = 0;
  realtimeStartTime = Date.now();
  
  // Update start value to current total (so per hour calculation starts fresh)
  realtimeStartValue = getCurrentTotalValue();
  
  // Clear realtime history graph
  realtimeHistory = [];
  
  // Tell main process to reset the timer
  electronAPI.resetRealtimeTimer();
  
  // Update display immediately
  timerEl.textContent = formatTime(0);
  updateRealtimeWealth();
  
  // Reset graph with current value
  pushPoint(realtimeStartValue);
}

function updateRealtimeWealth() {
  const currentValue = getCurrentTotalValue();
  const elapsedTimeHours = realtimeElapsedSeconds / 3600;
  const rate = elapsedTimeHours > 0 ? (currentValue - realtimeStartValue) / elapsedTimeHours : 0;
  
  // Always track Total (realtime) regardless of current mode
  pushRealtimePoint(currentValue);
  
  // Update realtime display only when in realtime mode
  if (wealthMode === 'realtime') {
    wealthValueEl.textContent = currentValue.toFixed(2);
    wealthHourlyEl.textContent = rate.toFixed(2);
  }
  
  // Update overlay widget with current data
  updateOverlayWidgetData();
}

function updateOverlayWidgetData() {
  let duration: number;
  let hourly: number;
  let total: number;
  const isHourlyMode = wealthMode === 'hourly' && isHourlyActive;

  if (isHourlyMode) {
    // Hourly mode - use hourly values
    const gainedValue = getHourlyWealthGain();
    const elapsedTimeHours = hourlyElapsedSeconds / 3600;
    duration = hourlyElapsedSeconds;
    hourly = elapsedTimeHours > 0 ? gainedValue / elapsedTimeHours : 0;
    total = gainedValue;
  } else {
    // Realtime mode - use realtime values
    const currentValue = getCurrentTotalValue();
    const elapsedTimeHours = realtimeElapsedSeconds / 3600;
    duration = realtimeElapsedSeconds;
    hourly = elapsedTimeHours > 0 ? (currentValue - realtimeStartValue) / elapsedTimeHours : 0;
    total = currentValue;
  }

  electronAPI.updateOverlayWidget({ duration, hourly, total, isHourlyMode, isPaused: hourlyPaused });
}

// === WEALTH: Hourly tracking ===
function updateHourlyWealth() {
  const gainedValue = getHourlyWealthGain();
  const elapsedTimeHours = hourlyElapsedSeconds / 3600;
  const rate = elapsedTimeHours > 0 ? gainedValue / elapsedTimeHours : 0;
  
  // Update hourly display (allow negative values)
  if (wealthMode === 'hourly') {
    wealthValueEl.textContent = gainedValue.toFixed(2);
    wealthHourlyEl.textContent = rate.toFixed(2);
  }
  
  // Update overlay widget with current data
  updateOverlayWidgetData();
}

// === HOURLY: Start (with prompt) ===
function startHourlyTracking() {
  // Show prompt asking if user wants to include compasses/beacons
  showCompassBeaconPrompt();
}

// === HOURLY: Actually start tracking ===
function actuallyStartHourlyTracking() {
  console.log('🕐 Starting hourly tracking...');

  // Take snapshot of current inventory
  hourlyStartSnapshot.clear();
  previousQuantities.clear();
  hourlyUsage.clear();
  hourlyPurchases.clear();
  
  for (const item of currentItems) {
    // Snapshot all items normally
    hourlyStartSnapshot.set(item.baseId, item.totalQuantity);
    
    // For tracked compasses/beacons, initialize previous quantity
    if (includedItems.has(item.baseId)) {
      previousQuantities.set(item.baseId, item.totalQuantity);
    }
  }

  hourlyStartTime = Date.now();
  hourlyHistory = [];
  hourlyBuckets = [];
  currentHourStartValue = 0;
  
  // Start with 0 gain
  if (wealthMode === 'hourly') {
    hourlyHistory.push({ time: Date.now(), value: 0 });
  }

  startHourlyBtn.style.display = 'none';
  stopHourlyBtn.style.display = 'inline-block';
  pauseHourlyBtn.style.display = 'inline-block';
  resumeHourlyBtn.style.display = 'none';

  hourlyTimerEl.textContent = '00:00:00';
  
  // Set state flags
  isHourlyActive = true;
  hourlyPaused = false;
  
  // Tell main process to start the timer
  electronAPI.startHourlyTimer();
  
  // Initial update
  updateHourlyWealth();
  renderInventory();
  renderBreakdown(); // Reset breakdown to show only gained items
}

// === HOURLY: Capture bucket at end of each hour ===
function captureHourlyBucket() {
  const currentValue = getHourlyWealthGain();
  const hourNumber = Math.floor(hourlyElapsedSeconds / 3600);
  
  const bucket: HourlyBucket = {
    hourNumber,
    startValue: currentHourStartValue,
    endValue: currentValue,
    earnings: currentValue - currentHourStartValue,
    history: [...hourlyHistory] // Copy current history
  };
  
  hourlyBuckets.push(bucket);
  
  // Reset for next hour
  currentHourStartValue = currentValue;
  hourlyHistory = [{ time: Date.now(), value: currentValue }];
  
  // Reset usage and purchase tracking for next hour and update previous quantities
  hourlyUsage.clear();
  hourlyPurchases.clear();
  for (const baseId of includedItems) {
    const currentItem = currentItems.find(item => item.baseId === baseId);
    if (currentItem) {
      previousQuantities.set(baseId, currentItem.totalQuantity);
    }
  }
  
  // Show notification (positioned relative to stats container)
  const statsContainer = document.querySelector('.stats-container');
  if (statsContainer) {
    const anim = document.createElement('div');
    anim.className = 'earnings-animation';
    anim.textContent = `Hour ${hourNumber} Complete! +${bucket.earnings.toFixed(2)} FE`;
    anim.style.color = '#10b981';
    statsContainer.appendChild(anim);
    setTimeout(() => anim.remove(), 2000);
  }
}

// === HOURLY: Pause ===
function pauseHourlyTracking() {
  console.log('⏸️ Pausing hourly tracking');
  hourlyPaused = true;
  electronAPI.pauseHourlyTimer();
  
  // Update previous quantities before pausing to avoid false usage detection on resume
  updatePreviousQuantities();
  
  pauseHourlyBtn.style.display = 'none';
  resumeHourlyBtn.style.display = 'inline-block';
  
  // Update overlay widget immediately
  updateOverlayWidgetData();
}

// === HOURLY: Resume ===
function resumeHourlyTracking() {
  console.log('▶️ Resuming hourly tracking');
  hourlyPaused = false;
  electronAPI.resumeHourlyTimer();
  
  // Update previous quantities on resume to start tracking from current state
  updatePreviousQuantities();
  
  pauseHourlyBtn.style.display = 'inline-block';
  resumeHourlyBtn.style.display = 'none';
  
  // Update overlay widget immediately
  updateOverlayWidgetData();
}

// === HOURLY: Stop ===
function stopHourlyTracking(auto = false) {
  console.log('⏹️ Stopping hourly tracking');
  
  // Tell main process to stop timer
  electronAPI.stopHourlyTimer();

  const finalGain = getHourlyWealthGain();

  // Always capture the current hour as a complete bucket, regardless of time elapsed
  const currentHourNumber = hourlyBuckets.length + 1;
  
  const bucket: HourlyBucket = {
    hourNumber: currentHourNumber,
    startValue: currentHourStartValue,
    endValue: finalGain,
    earnings: finalGain - currentHourStartValue,
    history: [...hourlyHistory]
  };
  hourlyBuckets.push(bucket);

  // Show breakdown modal
  showBreakdownModal();

  // UI reset
  startHourlyBtn.style.display = 'inline-block';
  stopHourlyBtn.style.display = 'none';
  pauseHourlyBtn.style.display = 'none';
  resumeHourlyBtn.style.display = 'none';
  hourlyTimerEl.textContent = '00:00:00';
  hourlyElapsedSeconds = 0;
  
  // Reset state flags
  isHourlyActive = false;
  hourlyPaused = false;
  
  // Update UI to show all items (not just gained items) after stopping hourly mode
  renderInventory();
  renderBreakdown();
  
  // Update overlay widget with realtime data since hourly mode ended
  updateOverlayWidgetData();
}

// === BREAKDOWN MODAL ===
function showBreakdownModal() {
  const modal = document.getElementById('breakdownModal')!;
  const totalEl = document.getElementById('breakdownTotal')!;
  const hoursContainer = document.getElementById('breakdownHours')!;
  
  const totalEarnings = hourlyBuckets.reduce((sum, bucket) => sum + bucket.earnings, 0);
  
  // Animate total with count-up effect
  totalEl.textContent = `${totalEarnings.toFixed(2)} FE`;
  
  // Generate hour cards
  hoursContainer.innerHTML = hourlyBuckets.map((bucket, index) => {
    const duration = bucket.hourNumber <= Math.floor(hourlyElapsedSeconds / 3600) ? '60:00' : formatTime(hourlyElapsedSeconds % 3600).substring(3);
    return `
      <div class="hour-card">
        <div class="hour-header">
          <div class="hour-label">Hour ${bucket.hourNumber}</div>
          <div class="hour-earnings">+${bucket.earnings.toFixed(2)} FE</div>
        </div>
        <canvas class="hour-graph" id="hourGraph${index}"></canvas>
      </div>
    `;
  }).join('');
  
  // Show modal
  modal.classList.add('active');
  
  // Render mini graphs for each hour
  setTimeout(() => {
    hourlyBuckets.forEach((bucket, index) => {
      renderHourGraph(bucket, index);
    });
  }, 100);
}

function renderHourGraph(bucket: HourlyBucket, index: number) {
  const canvas = document.getElementById(`hourGraph${index}`) as HTMLCanvasElement;
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d')!;
  
  if (bucket.history.length === 0) return;
  
  // Sample data to max 60 points for performance
  const sampleInterval = Math.max(1, Math.floor(bucket.history.length / 60));
  const sampledHistory = bucket.history.filter((_, i) => i % sampleInterval === 0 || i === bucket.history.length - 1);
  
  // Create labels showing time progression (always showing as if it's a full hour)
  const labels = Array.from({ length: 61 }, (_, i) => {
    if (i % 10 === 0) return `${i}m`;
    return '';
  });
  
  // Map the actual data across the full 60-minute span with timestamps
  const dataPoints: { x: number; y: number; time: number }[] = Array.from({ length: 61 }, (_, i) => {
    const dataIndex = Math.floor((i / 60) * (sampledHistory.length - 1));
    const point = sampledHistory[dataIndex];
    return {
      x: i,
      y: point ? point.value - bucket.startValue : 0,
      time: point ? point.time : 0
    };
  });
  
  // Calculate start time for this hour (approximate based on bucket)
  const hourStartTime = bucket.history.length > 0 ? bucket.history[0].time : Date.now();
  
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        data: dataPoints.map(p => p.y),
        borderColor: '#DE5C0B',
        backgroundColor: 'rgba(222, 92, 11, 0.1)',
        borderWidth: 2,
        tension: 0.4,
        pointRadius: 0,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: { 
          display: true,
          grid: { color: '#7E7E7E', drawBorder: false },
          ticks: { color: '#FAFAFA', maxTicksLimit: 7 }
        },
        y: { 
          display: true,
          grid: { color: '#7E7E7E', drawBorder: false },
          ticks: { 
            color: '#FAFAFA', 
            maxTicksLimit: 5,
            callback: function(value: any) {
              const num = value as number;
              // Only show decimal if non-zero
              return num % 1 === 0 ? num.toFixed(0) : num.toFixed(1);
            }
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          backgroundColor: '#272727',
          titleColor: '#FAFAFA',
          bodyColor: '#FAFAFA',
          borderColor: '#7E7E7E',
          borderWidth: 1,
          displayColors: false,
          boxWidth: 0,
          boxHeight: 0,
          callbacks: {
            title: (items: any[]) => {
              if (items.length === 0) return '';
              const item = items[0];
              const value = item.parsed.y;
              // Format value - only show decimal if non-zero
              const formatted = value % 1 === 0 ? value.toFixed(0) : value.toFixed(1);
              return `${formatted} FE`;
            },
            label: (context: any) => {
              const dataIndex = context.dataIndex;
              
              if (dataIndex >= 0 && dataIndex < dataPoints.length) {
                const point = dataPoints[dataIndex];
                let date: Date;
                
                if (point.time > 0) {
                  date = new Date(point.time);
                } else {
                  // Fallback: calculate time from hour start + minutes
                  date = new Date(hourStartTime + dataIndex * 60000);
                }
                
                // Round to nearest minute (60 seconds) for smoother timestamp updates
                const roundedSeconds = Math.floor(date.getSeconds() / 60) * 60;
                const roundedDate = new Date(date);
                roundedDate.setSeconds(roundedSeconds);
                roundedDate.setMilliseconds(0);
                
                const hours = roundedDate.getHours().toString().padStart(2, '0');
                const minutes = roundedDate.getMinutes().toString().padStart(2, '0');
                return `${hours}:${minutes}`;
              }
              return '';
            },
            footer: () => '' // Remove default footer
          }
        }
      },
      interaction: {
        intersect: false,
        mode: 'index'
      }
    }
  });
}

function closeBreakdownModal() {
  const modal = document.getElementById('breakdownModal')!;
  modal.classList.remove('active');
  
  // Destroy all hour charts to free memory
  hourCharts.forEach(chart => {
    if (chart) chart.destroy();
  });
  hourCharts = [];
  
  // Reset everything
  hourlyBuckets = [];
  hourlyStartSnapshot.clear();
  hourlyHistory = [];
  currentHourStartValue = 0;
  includedItems.clear();
  previousQuantities.clear();
  hourlyUsage.clear();
  hourlyPurchases.clear();
  
  // Re-render to show all items again
  renderInventory();
  renderBreakdown();
}

// === COMPASS/BEACON SELECTION ===
function showCompassBeaconPrompt() {
  const modal = document.getElementById('compassBeaconPromptModal')!;
  modal.classList.add('active');
}

function hideCompassBeaconPrompt() {
  const modal = document.getElementById('compassBeaconPromptModal')!;
  modal.classList.remove('active');
}

function showCompassBeaconSelection() {
  const modal = document.getElementById('compassBeaconSelectionModal')!;
  const container = document.getElementById('compassBeaconCheckboxes')!;
  const searchInput = document.getElementById('compassBeaconSearch') as HTMLInputElement;
  const helperActions = document.getElementById('compassBeaconHelperActions')!;
  
  // Clear previous selections
  container.innerHTML = '';
  includedItems.clear();
  if (searchInput) {
    searchInput.value = '';
  }
  
  // Check for last selection and show restore option
  const lastSelectionJson = localStorage.getItem('lastCompassBeaconSelection');
  if (lastSelectionJson) {
    helperActions.style.display = 'block';
  } else {
    helperActions.style.display = 'none';
  }
  
  // Get all compasses and beacons from database (not just inventory)
  interface CompassBeaconItem {
    baseId: string;
    itemName: string;
    group: string;
    quantity: number;
  }
  
  interface ItemGroup {
    key: string;
    title: string;
    items: CompassBeaconItem[];
    categorizer: (itemName: string, itemGroup: string, baseId: string) => boolean;
  }
  
  // Centralized categorization logic
  type CategorizerFunction = (itemName: string, itemGroup: string, baseId: string) => boolean;
  
  const categorizers: Record<string, CategorizerFunction> = {
    resonance: (name, group, baseId) => 
      baseId === '5028' || baseId === '5040', // Netherrealm Resonance or Deep Space Resonance
    
    beaconsT8: (name, group, baseId) => 
      group === 'beacon' && (name.includes('(Timemark 8)') || name === 'Deep Space Beacon'),
    
    beaconsT7: (name, group, baseId) => 
      group === 'beacon' && (name.includes('(Timemark 7)') || (!name.includes('(Timemark 8)') && name !== 'Deep Space Beacon')),
    
    probes: (name, group, baseId) => 
      group === 'compass' && name.includes('Probe'),
    
    scalpels: (name, group, baseId) => 
      group === 'compass' && name.includes('Scalpel'),
    
    compasses: (name, group, baseId) => 
      group === 'compass' && !name.includes('Probe') && !name.includes('Scalpel')
  };
  
  // Define groups with metadata - easy to add new groups here
  const groupDefinitions: Omit<ItemGroup, 'items'>[] = [
    { key: 'resonance', title: 'Resonance', categorizer: categorizers.resonance },
    { key: 'beaconsT8', title: 'T8 Beacons', categorizer: categorizers.beaconsT8 },
    { key: 'beaconsT7', title: 'T7 Beacons', categorizer: categorizers.beaconsT7 },
    { key: 'probes', title: 'Probes', categorizer: categorizers.probes },
    { key: 'scalpels', title: 'Scalpels', categorizer: categorizers.scalpels },
    { key: 'compasses', title: 'Compasses/Astrolabes', categorizer: categorizers.compasses }
  ];
  
  // Initialize groups
  const itemGroups: ItemGroup[] = groupDefinitions.map(def => ({
    ...def,
    items: []
  }));
  
  // Collect and categorize items
  for (const [baseId, itemData] of Object.entries(itemDatabase)) {
    // Include compass, beacon, and currency (for resonance items)
    if (itemData.group === 'compass' || itemData.group === 'beacon' || itemData.group === 'currency') {
      const inventoryItem = currentItems.find(item => item.baseId === baseId);
      const item: CompassBeaconItem = {
        baseId,
        itemName: itemData.name,
        group: itemData.group,
        quantity: inventoryItem ? inventoryItem.totalQuantity : 0
      };
      
      // Find matching group using categorizer (now includes baseId)
      for (const itemGroup of itemGroups) {
        if (itemGroup.categorizer(itemData.name, itemData.group, baseId)) {
          itemGroup.items.push(item);
          break; // Item can only belong to one group
        }
      }
    }
  }
  
  // Helper: Sort items in a group by name
  const sortGroupItems = (group: ItemGroup): void => {
    group.items.sort((a, b) => a.itemName.localeCompare(b.itemName));
  };
  
  // Helper: Filter items in a group by search query
  const filterGroupItems = (group: ItemGroup, query: string): ItemGroup => {
    const lowerQuery = query.toLowerCase();
    return {
      ...group,
      items: group.items.filter(item => 
        item.itemName.toLowerCase().includes(lowerQuery)
      )
    };
  };
  
  // Sort all groups
  itemGroups.forEach(sortGroupItems);
  
  // Store original groups for filtering
  const allItemGroups = itemGroups;
  
  // Persistent checked items state - survives filtering/searching
  const checkedItemsSet = new Set<string>();
  
  // Always include Netherrealm Resonance 5028 (automatically selected)
  checkedItemsSet.add('5028');
  compassBeaconSelectionState = checkedItemsSet;
  
  // Helper: Sync checked state from DOM (used on initial render)
  const syncCheckedItemsFromDOM = (): void => {
    const existingCheckboxes = container.querySelectorAll('input[type="checkbox"]:checked');
    existingCheckboxes.forEach(checkbox => {
      const baseId = (checkbox as HTMLInputElement).dataset.baseid;
      if (baseId) {
        checkedItemsSet.add(baseId);
      }
    });
  };
  
  // Helper: Update confirm button visibility
  const updateConfirmButtonVisibility = (): void => {
    const confirmBtn = document.getElementById('compassBeaconSelectionConfirm');
    if (confirmBtn) {
      // Show button if any item other than 5028 is selected
      const hasOtherSelections = Array.from(checkedItemsSet).some(id => id !== '5028');
      if (hasOtherSelections) {
        confirmBtn.style.display = 'block';
        // Add visible class for animation after a tiny delay to ensure display block is applied
        setTimeout(() => {
          confirmBtn.classList.add('visible');
        }, 10);
      } else {
        confirmBtn.classList.remove('visible');
        // Remove display after animation completes
        setTimeout(() => {
          if (!confirmBtn.classList.contains('visible')) {
            confirmBtn.style.display = 'none';
          }
        }, 300);
      }
    }
  };
  
  // Helper: Update checked state when checkbox changes
  const handleCheckboxChange = (baseId: string, checked: boolean): void => {
    if (checked) {
      checkedItemsSet.add(baseId);
    } else {
      checkedItemsSet.delete(baseId);
    }
    updateConfirmButtonVisibility();
  };
  
  // Helper: Create checkbox element for an item
  const createCheckboxElement = (item: CompassBeaconItem): HTMLDivElement => {
    const checkboxDiv = document.createElement('div');
    checkboxDiv.className = 'compass-beacon-checkbox-item';
    
    const label = document.createElement('label');
    
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.baseid = item.baseId;
    input.dataset.type = item.group;
    input.checked = checkedItemsSet.has(item.baseId);
    
    // Add event listener to update persistent state
    input.addEventListener('change', () => {
      handleCheckboxChange(item.baseId, input.checked);
    });
    
    const checkboxLabel = document.createElement('span');
    checkboxLabel.className = 'checkbox-label';
    
    const icon = document.createElement('img');
    icon.src = `../../assets/${item.baseId}.webp`;
    icon.alt = item.itemName;
    icon.className = 'checkbox-icon';
    icon.onerror = () => { icon.style.display = 'none'; };
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = item.itemName;
    
    checkboxLabel.appendChild(icon);
    checkboxLabel.appendChild(nameSpan);
    
    if (item.quantity > 0) {
      const quantitySpan = document.createElement('span');
      quantitySpan.className = 'checkbox-quantity';
      quantitySpan.textContent = `(${item.quantity})`;
      checkboxLabel.appendChild(quantitySpan);
    }
    
    label.appendChild(input);
    label.appendChild(checkboxLabel);
    checkboxDiv.appendChild(label);
    
    return checkboxDiv;
  };
  
  // Helper: Render a single group
  const renderGroup = (group: ItemGroup): void => {
    if (group.items.length === 0) return;
    
    // Create group header
    const header = document.createElement('div');
    header.className = 'compass-beacon-group-header';
    header.textContent = group.title;
    container.appendChild(header);
    
    // Create group container
    const groupContainer = document.createElement('div');
    groupContainer.className = 'compass-beacon-group-items';
    
    // Create checkbox for each item
    group.items.forEach(item => {
      const checkboxElement = createCheckboxElement(item);
      groupContainer.appendChild(checkboxElement);
    });
    
    container.appendChild(groupContainer);
  };
  
  // Function to render items based on search
  const renderItems = (groupsToRender: ItemGroup[], skipSync: boolean = false): void => {
    // Sync any existing checked items from DOM before clearing (only needed on first render or when not skipping)
    if (container.children.length > 0 && !skipSync) {
      syncCheckedItemsFromDOM();
    }
    
    container.innerHTML = '';
    
    // Render all groups
    groupsToRender.forEach(group => renderGroup(group));
    
    // Show message if no items found
    if (container.children.length === 0) {
      const noItemsDiv = document.createElement('div');
      noItemsDiv.style.textAlign = 'center';
      noItemsDiv.style.color = 'var(--border)';
      noItemsDiv.style.padding = '20px';
      noItemsDiv.textContent = 'No items found';
      container.appendChild(noItemsDiv);
    }
  };
  
  // Initial render
  renderItems(allItemGroups);
  
  // Add search functionality
  if (searchInput) {
    searchInput.oninput = (e) => {
      const query = (e.target as HTMLInputElement).value.trim();
      if (query === '') {
        renderItems(allItemGroups);
      } else {
        // Filter all groups
        const filteredGroups = allItemGroups.map(group => filterGroupItems(group, query));
        renderItems(filteredGroups);
      }
    };
  }
  
  // Add Clear Selection button handler
  const clearBtn = document.getElementById('compassBeaconSelectionClear');
  if (clearBtn) {
    clearBtn.onclick = () => {
      // Clear all checkboxes except 5028 (Netherrealm Resonance)
      checkedItemsSet.clear();
      checkedItemsSet.add('5028'); // Keep 5028 always selected
      
      // Update button visibility
      updateConfirmButtonVisibility();
      
      // Re-render to reflect changes (skip sync since we're manually setting the state)
      const currentQuery = searchInput?.value.trim() || '';
      if (currentQuery === '') {
        renderItems(allItemGroups, true);
      } else {
        const filteredGroups = allItemGroups.map(group => filterGroupItems(group, currentQuery));
        renderItems(filteredGroups, true);
      }
    };
  }
  
  // Add Restore Last Selection handler
  const restoreBtn = document.getElementById('compassBeaconRestore');
  if (restoreBtn) {
    restoreBtn.onclick = () => {
      const lastSelectionJson = localStorage.getItem('lastCompassBeaconSelection');
      if (lastSelectionJson) {
        try {
          const lastSelection = JSON.parse(lastSelectionJson) as string[];
          
          // Clear current selection and restore last one
          checkedItemsSet.clear();
          lastSelection.forEach(baseId => {
            checkedItemsSet.add(baseId);
          });
          
          // Update button visibility
          updateConfirmButtonVisibility();
          
          // Re-render to reflect changes (skip sync since we're manually setting the state)
          const currentQuery = searchInput?.value.trim() || '';
          if (currentQuery === '') {
            renderItems(allItemGroups, true);
          } else {
            const filteredGroups = allItemGroups.map(group => filterGroupItems(group, currentQuery));
            renderItems(filteredGroups, true);
          }
        } catch (e) {
          console.error('Failed to restore last selection:', e);
        }
      }
    };
  }
  
  // Initial button visibility check
  updateConfirmButtonVisibility();
  
  // Show modal
  modal.classList.add('active');
}

function hideCompassBeaconSelection() {
  const modal = document.getElementById('compassBeaconSelectionModal')!;
  modal.classList.remove('active');
  compassBeaconSelectionState = null;
}

function handleCompassBeaconSelectionConfirm() {
  // Collect all checked items (these are the compasses/beacons to include in calculation)
  includedItems.clear();
  const selectionSet = compassBeaconSelectionState;
  if (selectionSet) {
    selectionSet.forEach(baseId => {
      includedItems.add(baseId);
    });
  } else {
    const checkboxes = document.querySelectorAll('#compassBeaconSelectionModal input[type="checkbox"]:checked');
    checkboxes.forEach(checkbox => {
      const baseId = (checkbox as HTMLInputElement).dataset.baseid;
      if (baseId) {
        includedItems.add(baseId);
      }
    });
  }
  
  // Save selection to localStorage for restore feature
  const selectionArray = Array.from(includedItems);
  localStorage.setItem('lastCompassBeaconSelection', JSON.stringify(selectionArray));
  
  console.log(`✅ Including ${includedItems.size} compasses/beacons in hourly calculation`);
  
  // Hide selection modal and start tracking
  hideCompassBeaconSelection();
  actuallyStartHourlyTracking();
}

// === REALTIME: Timer (always running in main process) ===
async function initRealtimeTimer() {
  // Get initial state from main process
  const state = await electronAPI.getTimerState();
  realtimeElapsedSeconds = state.realtimeSeconds;
  timerEl.textContent = formatTime(realtimeElapsedSeconds);
  
  console.log('✅ Realtime timer initialized from main process');
}

// Listen to timer ticks from main process
electronAPI.onTimerTick((data) => {
  if (data.type === 'realtime') {
    realtimeElapsedSeconds = data.seconds;
    
    // Only update the timer display if we're in realtime mode
    if (wealthMode === 'realtime') {
      timerEl.textContent = formatTime(realtimeElapsedSeconds);
    }
    
    // Update wealth values every second
    updateRealtimeWealth();
  } else if (data.type === 'hourly') {
    hourlyElapsedSeconds = data.seconds;
    hourlyTimerEl.textContent = formatTime(hourlyElapsedSeconds);
    
    // Update wealth and push to history
    const currentGain = getHourlyWealthGain();
    if (wealthMode === 'hourly') {
      hourlyHistory.push({ time: Date.now(), value: currentGain });
      updateGraph();
    }
    
    updateHourlyWealth();
    renderInventory();
    renderBreakdown(); // Update breakdown during hourly session

    // Check if we've completed an hour
    if (hourlyElapsedSeconds % 3600 === 0 && hourlyElapsedSeconds > 0) {
      console.log(`🎉 Hour ${Math.floor(hourlyElapsedSeconds / 3600)} completed!`);
      captureHourlyBucket();
    }
  }
});

// === MODE SWITCHING ===
realtimeBtn.addEventListener('click', () => {
  wealthMode = 'realtime';
  realtimeBtn.classList.add('active');
  hourlyBtn.classList.remove('active');
  hourlyControls.classList.remove('active');
  
  // Show realtime timer and reset button
  timerEl.style.display = 'block';
  resetRealtimeBtn.style.display = 'block';
  timerEl.textContent = formatTime(realtimeElapsedSeconds);
  
  // Update display to show realtime values
  updateRealtimeWealth();
  renderInventory(); // Show all items
  renderBreakdown(); // Update breakdown for realtime mode
  updateGraph();
});

hourlyBtn.addEventListener('click', () => {
  wealthMode = 'hourly';
  realtimeBtn.classList.remove('active');
  hourlyBtn.classList.add('active');
  hourlyControls.classList.add('active');

  // Hide realtime timer and reset button when in hourly mode, show controls
  timerEl.style.display = 'none';
  resetRealtimeBtn.style.display = 'none';

  // Update display to show hourly values (if session is active)
  if (isHourlyActive) {
    updateHourlyWealth();
    renderInventory(); // Show only new items
    renderBreakdown(); // Update breakdown for hourly mode
  } else {
    wealthValueEl.textContent = '0.00';
    wealthHourlyEl.textContent = '0.00';
    renderInventory(); // Show all items (no active hourly session)
    renderBreakdown(); // Update breakdown (will show 0s if no hourly session)
  }
  updateGraph();
  
  // Update overlay widget with current mode
  updateOverlayWidgetData();
});

startHourlyBtn.addEventListener('click', startHourlyTracking);
stopHourlyBtn.addEventListener('click', () => stopHourlyTracking(false));
pauseHourlyBtn.addEventListener('click', pauseHourlyTracking);
resumeHourlyBtn.addEventListener('click', resumeHourlyTracking);
resetRealtimeBtn.addEventListener('click', resetRealtimeTracking);

// Overlay widget toggle button
const overlayWidgetBtn = document.getElementById('overlayWidgetBtn');
overlayWidgetBtn?.addEventListener('click', () => {
  electronAPI.toggleOverlayWidget();
});

// Listen for widget pause/resume buttons
electronAPI.onWidgetPauseHourly(() => {
  if (isHourlyActive && !hourlyPaused) {
    pauseHourlyTracking();
  }
});

electronAPI.onWidgetResumeHourly(() => {
  if (isHourlyActive && hourlyPaused) {
    resumeHourlyTracking();
  }
});

// Compass/Beacon prompt modal event listeners
document.getElementById('compassBeaconPromptNo')?.addEventListener('click', () => {
  includedItems.clear();
  hideCompassBeaconPrompt();
  actuallyStartHourlyTracking();
});

document.getElementById('compassBeaconPromptYes')?.addEventListener('click', () => {
  hideCompassBeaconPrompt();
  showCompassBeaconSelection();
});

// Compass/Beacon selection modal event listeners
document.getElementById('compassBeaconSelectionClose')?.addEventListener('click', () => {
  includedItems.clear();
  hideCompassBeaconSelection();
});

document.getElementById('compassBeaconSelectionConfirm')?.addEventListener('click', handleCompassBeaconSelectionConfirm);

// Close modals when clicking outside
document.getElementById('compassBeaconPromptModal')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('compassBeaconPromptModal')) {
    includedItems.clear();
    hideCompassBeaconPrompt();
  }
});

document.getElementById('compassBeaconSelectionModal')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('compassBeaconSelectionModal')) {
    includedItems.clear();
    hideCompassBeaconSelection();
  }
});

// Breakdown modal close button
document.getElementById('closeBreakdown')?.addEventListener('click', closeBreakdownModal);

// === EVENT LISTENERS ===
electronAPI.onInventoryUpdate(() => {
  loadInventory(); // Reload inventory data, but don't control timers
});

// Price filter functionality
const minPriceInput = document.getElementById('minPriceInput') as HTMLInputElement;
const maxPriceInput = document.getElementById('maxPriceInput') as HTMLInputElement;

function updatePriceFilters() {
  const minValue = minPriceInput?.value.trim();
  const maxValue = maxPriceInput?.value.trim();
  
  minPriceFilter = minValue && minValue !== '' ? parseFloat(minValue) : null;
  maxPriceFilter = maxValue && maxValue !== '' ? parseFloat(maxValue) : null;
  
  // Validate: min should be less than max if both are set
  if (minPriceFilter !== null && maxPriceFilter !== null && minPriceFilter > maxPriceFilter) {
    // Invalid range, don't update filters
    return;
  }
  
  // Update inventory display
  renderInventory();
  // Update wealth calculations (Total and Per hour)
  if (wealthMode === 'realtime') {
    updateRealtimeWealth();
  } else if (wealthMode === 'hourly' && isHourlyActive) {
    updateHourlyWealth();
  }
  // Update breakdown to reflect filtered items
  renderBreakdown();
}

minPriceInput?.addEventListener('input', updatePriceFilters);
maxPriceInput?.addEventListener('input', updatePriceFilters);

document.querySelectorAll('[data-sort]').forEach(el => {
  el.addEventListener('click', () => {
    const sortType = (el as HTMLElement).dataset.sort as 'priceUnit' | 'priceTotal';
    if (!sortType) return;
    if (currentSortBy === sortType) {
      currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      currentSortBy = sortType;
      currentSortOrder = 'desc';
    }
    renderInventory();
  });
});

// Search functionality
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const clearSearch = document.getElementById('clearSearch') as HTMLButtonElement;

searchInput?.addEventListener('input', (e) => {
  searchQuery = (e.target as HTMLInputElement).value;
  renderInventory();
  
  // Show/hide clear button
  if (searchQuery) {
    clearSearch.style.display = 'block';
  } else {
    clearSearch.style.display = 'none';
  }
});

clearSearch?.addEventListener('click', () => {
  searchQuery = '';
  searchInput.value = '';
  clearSearch.style.display = 'none';
  renderInventory();
});

// === SETTINGS MENU ===
const settingsButton = document.getElementById('settingsButton')!;
const settingsMenu = document.getElementById('settingsMenu')!;
const appVersionEl = document.getElementById('appVersion')!;
const checkUpdatesBtn = document.getElementById('checkUpdatesBtn') as HTMLButtonElement;
const openSettingsBtn = document.getElementById('openSettingsBtn') as HTMLButtonElement;
const updateSpinner = document.getElementById('updateSpinner')!;
const updateStatus = document.getElementById('updateStatus')!;

// Load app version
electronAPI.getAppVersion().then(version => {
  appVersionEl.textContent = version;
});

// Toggle settings menu
let settingsMenuOpen = false;
settingsButton.addEventListener('click', (e) => {
  e.stopPropagation();
  settingsMenuOpen = !settingsMenuOpen;
  settingsMenu.style.display = settingsMenuOpen ? 'block' : 'none';
});

// Close settings menu when clicking outside
document.addEventListener('click', (e) => {
  if (settingsMenuOpen && !settingsMenu.contains(e.target as Node) && !settingsButton.contains(e.target as Node)) {
    settingsMenuOpen = false;
    settingsMenu.style.display = 'none';
  }
});

// Check for updates button
checkUpdatesBtn.addEventListener('click', async () => {
  checkUpdatesBtn.disabled = true;
  updateSpinner.style.display = 'inline-block';
  updateStatus.style.display = 'none';
  
  try {
    const result = await electronAPI.checkForUpdates();
    if (!result.success) {
      updateStatus.textContent = result.message || 'Failed to check for updates';
      updateStatus.className = 'update-status error';
      updateStatus.style.display = 'block';
      checkUpdatesBtn.disabled = false;
      updateSpinner.style.display = 'none';
    }
    // If successful, we'll wait for update-status events
  } catch (error: any) {
    updateStatus.textContent = error.message || 'Failed to check for updates';
    updateStatus.className = 'update-status error';
    updateStatus.style.display = 'block';
    checkUpdatesBtn.disabled = false;
    updateSpinner.style.display = 'none';
  }
});

// Listen for update status events
electronAPI.onUpdateStatus((data) => {
  updateSpinner.style.display = 'none';
  updateStatus.style.display = 'block';
  
  switch (data.status) {
    case 'checking':
      updateStatus.textContent = 'Checking for updates...';
      updateStatus.className = 'update-status info';
      break;
    case 'available':
      updateStatus.textContent = `Update available: ${data.version}. Downloading...`;
      updateStatus.className = 'update-status success';
      // For manual checks, download starts automatically, so show progress modal
      // If modal is not showing, it means this is a manual check that auto-started
      if (currentUpdateType === null) {
        showUpdateModal('available', data.version || '');
        showDownloadProgress();
      }
      break;
    case 'not-available':
      updateStatus.textContent = 'You are up to date!';
      updateStatus.className = 'update-status success';
      checkUpdatesBtn.disabled = false;
      break;
    case 'downloading':
      updateStatus.textContent = data.message || 'Downloading update...';
      updateStatus.className = 'update-status info';
      break;
    case 'downloaded':
      updateStatus.textContent = 'Update downloaded! Restart to install.';
      updateStatus.className = 'update-status success';
      checkUpdatesBtn.disabled = false;
      // Transition to install prompt if modal is showing
      if (updateModal.classList.contains('active')) {
        transitionToInstallPrompt(data.version || '');
      }
      break;
    case 'error':
      updateStatus.textContent = data.message || 'Error checking for updates';
      updateStatus.className = 'update-status error';
      checkUpdatesBtn.disabled = false;
      break;
  }
});

// Listen for download progress
electronAPI.onUpdateProgress((percent) => {
  if (settingsMenuOpen && updateStatus.style.display !== 'none') {
    updateStatus.textContent = `Downloading update: ${percent}%`;
  }
  // Update progress bar in modal if it's showing
  updateDownloadProgress(percent);
});

// === UPDATE MODAL ===
const updateModal = document.getElementById('updateModal')!;
const updateModalTitle = document.getElementById('updateModalTitle')!;
const updateModalSubtitle = document.getElementById('updateModalSubtitle')!;
const updateModalMessage = document.getElementById('updateModalMessage')!;
const updateModalChangelog = document.getElementById('updateModalChangelog')!;
const updateProgressContainer = document.getElementById('updateProgressContainer')!;
const updateProgressFill = document.getElementById('updateProgressFill')!;
const updateProgressText = document.getElementById('updateProgressText')!;
const updateBtnPrimary = document.getElementById('updateBtnPrimary') as HTMLButtonElement;
const updateBtnSecondary = document.getElementById('updateBtnSecondary') as HTMLButtonElement;

let currentUpdateType: 'available' | 'downloaded' | null = null;
let currentUpdateVersion: string = '';

function showUpdateModal(type: 'available' | 'downloaded', version: string, currentVersion?: string) {
  currentUpdateType = type;
  currentUpdateVersion = version;
  
  if (type === 'available') {
    updateModalTitle.textContent = 'Update Available';
    updateModalSubtitle.textContent = `Version ${version}`;
    updateModalMessage.textContent = `A new version (${version}) is available!\n\nCurrent version: ${currentVersion || 'Unknown'}\n\nWould you like to download and install it now?`;
    updateModalChangelog.style.display = 'block';
    updateBtnPrimary.textContent = 'Download Now';
    updateBtnSecondary.textContent = 'Later';
    updateProgressContainer.style.display = 'none';
    updateBtnPrimary.style.display = 'block';
    updateBtnSecondary.style.display = 'block';
    updateBtnPrimary.disabled = false;
    updateBtnSecondary.disabled = false;
  } else if (type === 'downloaded') {
    updateModalTitle.textContent = 'Update Downloaded';
    updateModalSubtitle.textContent = `Version ${version}`;
    updateModalMessage.textContent = 'Update downloaded successfully!\n\nThe update will be installed when you restart the application.';
    updateModalChangelog.style.display = 'none';
    updateBtnPrimary.textContent = 'Restart Now';
    updateBtnSecondary.textContent = 'Later';
    updateProgressContainer.style.display = 'none';
    updateBtnPrimary.style.display = 'block';
    updateBtnSecondary.style.display = 'block';
    updateBtnPrimary.disabled = false;
    updateBtnSecondary.disabled = false;
  }
  
  updateModal.classList.add('active');
}

function hideUpdateModal() {
  updateModal.classList.remove('active');
  currentUpdateType = null;
  currentUpdateVersion = '';
}

function showDownloadProgress() {
  updateProgressContainer.style.display = 'block';
  updateModalTitle.textContent = 'Downloading Update';
  updateModalSubtitle.textContent = `Version ${currentUpdateVersion}`;
  updateModalMessage.textContent = 'Please wait while the update is being downloaded...';
  updateModalChangelog.style.display = 'none';
  updateBtnPrimary.style.display = 'none';
  updateBtnSecondary.style.display = 'none';
}

function updateDownloadProgress(percent: number) {
  if (updateModal.classList.contains('active') && updateProgressContainer.style.display !== 'none') {
    updateProgressFill.style.width = `${percent}%`;
    updateProgressText.textContent = `${Math.round(percent)}%`;
  }
}

function transitionToInstallPrompt(version: string) {
  updateProgressContainer.style.display = 'none';
  updateModalTitle.textContent = 'Update Downloaded';
  updateModalSubtitle.textContent = `Version ${version}`;
  updateModalMessage.textContent = 'Update downloaded successfully!\n\nThe update will be installed when you restart the application.';
  updateModalChangelog.style.display = 'none';
  updateBtnPrimary.textContent = 'Restart Now';
  updateBtnSecondary.textContent = 'Later';
  updateBtnPrimary.style.display = 'block';
  updateBtnSecondary.style.display = 'block';
  updateBtnPrimary.disabled = false;
  updateBtnSecondary.disabled = false;
  currentUpdateType = 'downloaded';
}

// Button event listeners
updateBtnPrimary.addEventListener('click', () => {
  if (currentUpdateType === 'available') {
    // Start download
    electronAPI.sendUpdateDialogResponse('download');
    showDownloadProgress();
  } else if (currentUpdateType === 'downloaded') {
    // Restart now
    electronAPI.sendUpdateDialogResponse('restart');
    hideUpdateModal();
  }
});

updateBtnSecondary.addEventListener('click', () => {
  electronAPI.sendUpdateDialogResponse('later');
  hideUpdateModal();
});

// Listen for update dialog requests from main process
electronAPI.onShowUpdateDialog((data) => {
  showUpdateModal(data.type, data.version, data.currentVersion);
});

// Listen for seamless transition from download to install prompt
electronAPI.onUpdateDownloadedTransition((data) => {
  transitionToInstallPrompt(data.version);
});

// === LOG PATH SETUP MODAL ===
const setupModal = document.getElementById('setupModal')!;
const setupBtnSelect = document.getElementById('setupBtnSelect') as HTMLButtonElement;

setupBtnSelect.addEventListener('click', async () => {
  try {
    const selectedPath = await electronAPI.selectLogFile();
    if (selectedPath) {
      setupModal.classList.remove('active');
      // Reload inventory with the new path
      loadInventory();
    }
  } catch (error: any) {
    console.error('Failed to select log file:', error);
  }
});

// Listen for first launch setup request
electronAPI.onShowLogPathSetup(() => {
  setupModal.classList.add('active');
});

// Listen for close settings modal request (when window mode changes)
electronAPI.onCloseSettingsModal(() => {
  closeSettingsModal();
});

// === CUSTOM TITLE BAR ===
const customTitleBar = document.getElementById('custom-title-bar')!;
const titleBarMinimize = document.getElementById('title-bar-minimize') as HTMLButtonElement;
const titleBarMaximize = document.getElementById('title-bar-maximize') as HTMLButtonElement;
const titleBarClose = document.getElementById('title-bar-close') as HTMLButtonElement;

// Function to update title bar visibility
function updateTitleBarVisibility(fullscreenMode: boolean) {
  if (fullscreenMode) {
    customTitleBar.style.display = 'none';
    document.body.classList.remove('has-title-bar');
  } else {
    customTitleBar.style.display = 'flex';
    document.body.classList.add('has-title-bar');
  }
}

// Listen for window mode changes
electronAPI.onWindowModeChanged((data) => {
  updateTitleBarVisibility(data.fullscreenMode);
});

// Initialize title bar visibility on load
electronAPI.getSettings().then(settings => {
  updateTitleBarVisibility(settings.fullscreenMode === true); // Default to false if undefined
});

// Title bar button handlers
titleBarMinimize.addEventListener('click', () => {
  electronAPI.minimizeWindow();
});

titleBarMaximize.addEventListener('click', () => {
  electronAPI.maximizeWindow();
});

titleBarClose.addEventListener('click', () => {
  electronAPI.closeWindow();
});

// SVG icons for maximize button states
const maximizeIcon = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="0.75" y="0.75" width="10.5" height="10.5" stroke="#808080" stroke-width="1.5" fill="none"/>
</svg>`;

const restoreIcon = `<svg width="17" height="17" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="0.75" y="4.27686" width="11.9316" height="11.9737" stroke="#808080" stroke-width="1.5"/>
  <rect x="0.752037" y="0.747944" width="11.1078" height="11.1156" transform="matrix(0.999996 -0.00273721 0.00272013 0.999996 3.99797 0.0367292)" stroke="#808080" stroke-width="1.5"/>
  <rect x="1.25977" y="4.79004" width="10.91" height="10.9474" fill="#272727"/>
</svg>`;

// Update maximize button icon based on window state
function updateMaximizeIcon(isMaximized: boolean) {
  titleBarMaximize.innerHTML = isMaximized ? restoreIcon : maximizeIcon;
  titleBarMaximize.title = isMaximized ? 'Restore' : 'Maximize';
}

// Listen for maximize state changes
electronAPI.onMaximizeStateChanged((isMaximized) => {
  updateMaximizeIcon(isMaximized);
});

// Initialize maximize button icon on load
electronAPI.getMaximizeState().then((isMaximized) => {
  updateMaximizeIcon(isMaximized);
});

// === SETTINGS MODAL ===
const settingsModal = document.getElementById('settingsModal')!;
const settingsCloseBtn = document.getElementById('settingsCloseBtn') as HTMLButtonElement;
const keybindInput = document.getElementById('keybindInput') as HTMLInputElement;
const changeKeybindBtn = document.getElementById('changeKeybindBtn') as HTMLButtonElement;
const resetKeybindBtn = document.getElementById('resetKeybindBtn') as HTMLButtonElement;
const keybindStatus = document.getElementById('keybindStatus')!;
const settingsSaveBtn = document.getElementById('settingsSaveBtn') as HTMLButtonElement;
const settingsFooterMessage = document.getElementById('settingsFooterMessage')!;
const generalSection = document.getElementById('generalSection')!;
const preferencesSection = document.getElementById('preferencesSection')!;
const fullscreenModeRadio = document.getElementById('fullscreenModeRadio') as HTMLInputElement;
const normalModeRadio = document.getElementById('normalModeRadio') as HTMLInputElement;
const includeTaxCheckbox = document.getElementById('includeTaxCheckbox') as HTMLInputElement | null;
const settingsSidebarItems = document.querySelectorAll('.settings-sidebar-item');

let isRecordingKeybind = false;
let currentSettings: { keybind?: string; fullscreenMode?: boolean; includeTax?: boolean } = {};
let pendingKeybind: string | null = null;
let pendingFullscreenMode: boolean | null = null;
let pendingIncludeTax: boolean | null = null;

// Open settings modal
openSettingsBtn.addEventListener('click', async () => {
  settingsMenuOpen = false;
  settingsMenu.style.display = 'none';
  
  // Load current settings
  currentSettings = await electronAPI.getSettings();
  pendingKeybind = currentSettings.keybind || 'CommandOrControl+`';
  pendingFullscreenMode = currentSettings.fullscreenMode !== undefined ? currentSettings.fullscreenMode : false;
  pendingIncludeTax = currentSettings.includeTax !== undefined ? currentSettings.includeTax : false;
  includeTax = pendingIncludeTax;
  
  // Display current keybind
  keybindInput.value = formatKeybind(pendingKeybind);
  keybindStatus.textContent = '';
  keybindStatus.className = 'keybind-status';
  
  // Set window mode radio buttons
  if (pendingFullscreenMode) {
    fullscreenModeRadio.checked = true;
    normalModeRadio.checked = false;
  } else {
    fullscreenModeRadio.checked = false;
    normalModeRadio.checked = true;
  }
  
  // Set tax checkbox
  if (includeTaxCheckbox) {
    includeTaxCheckbox.checked = pendingIncludeTax;
  }
  
  // Reset save button state
  settingsSaveBtn.disabled = false;
  settingsSaveBtn.textContent = 'Save';
  
  // Clear footer message
  settingsFooterMessage.textContent = '';
  settingsFooterMessage.classList.remove('show', 'success', 'error');
  
  // Show general section by default
  generalSection.classList.add('active');
  preferencesSection.classList.remove('active');
  
  // Reset sidebar active state
  settingsSidebarItems.forEach(item => {
    const section = item.getAttribute('data-section');
    if (section === 'general') {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
  
  settingsModal.classList.add('active');
});

// Close settings modal when clicking outside or on close button
settingsCloseBtn.addEventListener('click', () => {
  closeSettingsModal();
});

settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) {
    closeSettingsModal();
  }
});

function closeSettingsModal() {
  settingsModal.classList.remove('active');
  isRecordingKeybind = false;
  keybindInput.classList.remove('recording');
  changeKeybindBtn.textContent = 'Change';
  pendingKeybind = null;
  pendingFullscreenMode = null;
  pendingIncludeTax = null;
}

// Change keybind button
changeKeybindBtn.addEventListener('click', () => {
  if (isRecordingKeybind) {
    // Stop recording
    isRecordingKeybind = false;
    keybindInput.classList.remove('recording');
    keybindInput.value = formatKeybind(pendingKeybind || currentSettings.keybind || 'CommandOrControl+`');
    changeKeybindBtn.textContent = 'Change';
    keybindStatus.textContent = '';
    keybindStatus.className = 'keybind-status';
    keybindInput.blur();
  } else {
    // Start recording
    isRecordingKeybind = true;
    keybindInput.classList.add('recording');
    keybindInput.value = 'Press keys...';
    changeKeybindBtn.textContent = 'Cancel';
    keybindStatus.textContent = 'Press your desired key combination';
    keybindStatus.className = 'keybind-status';
    keybindInput.focus();
  }
});

// Reset keybind button
resetKeybindBtn.addEventListener('click', () => {
  pendingKeybind = 'CommandOrControl+`';
  keybindInput.value = formatKeybind(pendingKeybind);
  keybindInput.classList.remove('recording');
  isRecordingKeybind = false;
  changeKeybindBtn.textContent = 'Change';
  keybindStatus.textContent = 'Reset to default keybind';
  keybindStatus.className = 'keybind-status';
});

// Keybind input - capture key presses
keybindInput.addEventListener('keydown', async (e) => {
  if (!isRecordingKeybind) return;
  
  e.preventDefault();
  e.stopPropagation();
  
  const parts: string[] = [];
  
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  
  // Get the key
  let key = '';
  if (e.key === '`' || e.key === '~') {
    key = '`';
  } else if (e.key === 'Escape') {
    // Cancel recording
    isRecordingKeybind = false;
    keybindInput.classList.remove('recording');
    const currentKeybind = pendingKeybind || currentSettings.keybind || 'CommandOrControl+`';
    keybindInput.value = formatKeybind(currentKeybind);
    changeKeybindBtn.textContent = 'Change';
    keybindStatus.textContent = '';
    keybindStatus.className = 'keybind-status';
    keybindInput.blur();
    return;
  } else if (e.key.length === 1) {
    // Single character key
    key = e.key.toLowerCase();
  } else if (e.key.startsWith('F') && e.key.length <= 3) {
    // Function keys (F1-F12)
    key = e.key;
  } else {
    // Other special keys
    const keyMap: { [key: string]: string } = {
      'Enter': 'Return',
      ' ': 'Space',
      'ArrowUp': 'Up',
      'ArrowDown': 'Down',
      'ArrowLeft': 'Left',
      'ArrowRight': 'Right',
      'Backspace': 'Backspace',
      'Delete': 'Delete',
      'Tab': 'Tab',
      'Home': 'Home',
      'End': 'End',
      'PageUp': 'PageUp',
      'PageDown': 'PageDown'
    };
    key = keyMap[e.key] || e.key;
  }
  
  if (key) {
    parts.push(key);
    const keybind = parts.join('+');
    
    // Test if keybind is available
    const testResult = await electronAPI.testKeybind(keybind);
    
    if (testResult.success) {
      pendingKeybind = keybind;
      keybindInput.value = formatKeybind(keybind);
      keybindInput.classList.remove('recording');
      isRecordingKeybind = false;
      changeKeybindBtn.textContent = 'Change';
      keybindStatus.textContent = 'Keybind set successfully';
      keybindStatus.className = 'keybind-status success';
    } else {
      keybindStatus.textContent = testResult.error || 'Keybind is already in use';
      keybindStatus.className = 'keybind-status error';
    }
  }
});

// Format keybind for display
function formatKeybind(keybind: string): string {
  return keybind
    .replace(/CommandOrControl/g, 'Ctrl')
    .replace(/Alt/g, 'Alt')
    .replace(/Shift/g, 'Shift');
}

// Handle window mode radio button changes
fullscreenModeRadio.addEventListener('change', () => {
  if (fullscreenModeRadio.checked) {
    pendingFullscreenMode = true;
  }
});

normalModeRadio.addEventListener('change', () => {
  if (normalModeRadio.checked) {
    pendingFullscreenMode = false;
  }
});

// Handle tax checkbox change
if (includeTaxCheckbox) {
  includeTaxCheckbox.addEventListener('change', () => {
    if (includeTaxCheckbox) {
      pendingIncludeTax = includeTaxCheckbox.checked;
    }
  });
}

// Sidebar navigation
settingsSidebarItems.forEach(item => {
  item.addEventListener('click', () => {
    const section = item.getAttribute('data-section');
    if (!section) return;
    
    // Update active state
    settingsSidebarItems.forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    
    // Show/hide sections
    if (section === 'general') {
      generalSection.classList.add('active');
      preferencesSection.classList.remove('active');
    } else if (section === 'preferences') {
      generalSection.classList.remove('active');
      preferencesSection.classList.add('active');
    }
  });
});

// Save settings
settingsSaveBtn.addEventListener('click', async () => {
  settingsSaveBtn.disabled = true;
  settingsSaveBtn.textContent = 'Saving...';
  
  try {
    const settingsToSave: { keybind?: string; fullscreenMode?: boolean; includeTax?: boolean } = {};
    
    if (pendingKeybind) {
      settingsToSave.keybind = pendingKeybind;
    }
    
    if (pendingFullscreenMode !== null) {
      settingsToSave.fullscreenMode = pendingFullscreenMode;
    }
    
      // Always include tax preference from checkbox state (get fresh reference to ensure we have latest state)
      const checkboxElement = document.getElementById('includeTaxCheckbox') as HTMLInputElement | null;
      const currentTaxValue = checkboxElement ? checkboxElement.checked : (pendingIncludeTax ?? false);
      settingsToSave.includeTax = currentTaxValue;
      
      const result = await electronAPI.saveSettings(settingsToSave);
      
      if (result.success) {
        currentSettings = { ...currentSettings, ...settingsToSave };
        
        // Update pending values to match saved values
        if (settingsToSave.keybind) {
          pendingKeybind = settingsToSave.keybind;
        }
        if (settingsToSave.fullscreenMode !== undefined) {
          pendingFullscreenMode = settingsToSave.fullscreenMode;
        }
        
        // CRITICAL: Update the global tax preference BEFORE calling render functions
        includeTax = currentTaxValue;
        pendingIncludeTax = currentTaxValue;
        
        // Refresh all displays when tax preference changes
        renderInventory();
        renderBreakdown();
        updateStats(currentItems);
        
        // Show success message in footer
        settingsFooterMessage.textContent = 'Settings saved successfully';
        settingsFooterMessage.className = 'settings-footer-message success show';
      
      // Clear keybind status
      keybindStatus.textContent = '';
      keybindStatus.className = 'keybind-status';
      
      // Re-enable save button
      settingsSaveBtn.disabled = false;
      settingsSaveBtn.textContent = 'Save';
      
      // Auto-hide success message after 3 seconds
      setTimeout(() => {
        settingsFooterMessage.classList.remove('show');
      }, 3000);
    } else {
      // Show error message in footer
      settingsFooterMessage.textContent = result.error || 'Failed to save settings';
      settingsFooterMessage.className = 'settings-footer-message error show';
      
      // Clear keybind status
      keybindStatus.textContent = '';
      keybindStatus.className = 'keybind-status';
      
      settingsSaveBtn.disabled = false;
      settingsSaveBtn.textContent = 'Save';
    }
  } catch (error: any) {
    // Show error message in footer
    settingsFooterMessage.textContent = error.message || 'Failed to save settings';
    settingsFooterMessage.className = 'settings-footer-message error show';
    
    // Clear keybind status
    keybindStatus.textContent = '';
    keybindStatus.className = 'keybind-status';
    
    settingsSaveBtn.disabled = false;
    settingsSaveBtn.textContent = 'Save';
  }
});

// === INITIALIZE ===
// Load tax preference on startup and initialize
Promise.all([
  electronAPI.getSettings(),
  electronAPI.isLogPathConfigured()
]).then(([settings, configured]) => {
  includeTax = settings.includeTax !== undefined ? settings.includeTax : false;
  
  if (configured) {
    initGraph();
    loadInventory(); // This will call initRealtimeTracking() after inventory is loaded
    initRealtimeTimer(); // Initialize from main process timer
  } else {
    // Show setup modal - it will be shown when main process sends the event
    // But we can also show it here if needed
    initGraph();
    initRealtimeTimer();
  }
});