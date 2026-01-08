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
  getLogPath: () => Promise<string>;
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
  
  renderInventory();
  updateStats(currentItems);
  renderBreakdown();
}

// === GET ITEMS TO DISPLAY (based on mode) ===
function getDisplayItems(): InventoryItem[] {
  if (wealthMode === 'hourly' && isHourlyActive) {
    // In hourly mode, only show items gained since start
    return currentItems.map(item => {
      const currentQty = item.totalQuantity;
      const startQty = hourlyStartSnapshot.get(item.baseId) || 0;
      const gainedQty = currentQty - startQty;
      
      return {
        ...item,
        totalQuantity: gainedQty
      };
    }).filter(item => item.totalQuantity > 0); // Only show items with gains
  }
  
  // In realtime mode or when hourly isn't active, show all items
  return currentItems;
}

// === FILTER & SORT ===
function getSortedAndFilteredItems(): InventoryItem[] {
  const minPriceInput = document.getElementById('minPrice') as HTMLInputElement | null;
  const minPrice = parseFloat(minPriceInput?.value || '0') || 0;

  const itemsToDisplay = getDisplayItems();

  let filtered = itemsToDisplay.filter(item => {
    // Search filter
    if (searchQuery && !item.itemName.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    
    // Price filter
    if (item.price === null) return minPrice === 0;
    const totalValue = item.price * item.totalQuantity;
    const totalValueAfterTax = applyTax(totalValue, item.baseId);
    return totalValueAfterTax >= minPrice;
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

// === RENDER INVENTORY ===
function renderInventory() {
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
            <div>${item.itemName}</div>
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
    .sort((a, b) => b.total - a.total);

  if (groups.length === 0) {
    breakdownEl.innerHTML = '<div class="breakdown-empty">No items with prices</div>';
    return;
  }

  // Render in 3-column grid
  breakdownEl.innerHTML = groups.map(({ group, total }) => {
    return `
      <div class="breakdown-group">
        <img src="../../assets/${group}.webp" alt="${group}" class="breakdown-icon" onerror="this.style.display='none'">
        <span class="breakdown-group-value">${total.toFixed(0)} FE</span>
      </div>
    `;
  }).join('');
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

// === CURRENT TOTAL VALUE ===
function getCurrentTotalValue(): number {
  return currentItems.reduce((sum, item) => {
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
  
  for (const item of currentItems) {
    if (item.price === null) continue;
    
    const currentQty = item.totalQuantity;
    const startQty = hourlyStartSnapshot.get(item.baseId) || 0;
    const gainedQty = currentQty - startQty;
    
    if (gainedQty > 0) {
      const itemValue = gainedQty * item.price;
      // Apply tax to gained value
      gainedValue += applyTax(itemValue, item.baseId);
    }
  }
  
  return gainedValue;
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
            color: '#FAFAFA'
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
          borderWidth: 1
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

// === GRAPH: Push Point ===
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
  
  // Update realtime display
  if (wealthMode === 'realtime') {
    wealthValueEl.textContent = currentValue.toFixed(2);
    wealthHourlyEl.textContent = rate.toFixed(2);
    pushPoint(currentValue);
  }
}

// === WEALTH: Hourly tracking ===
function updateHourlyWealth() {
  const gainedValue = getHourlyWealthGain();
  const elapsedTimeHours = hourlyElapsedSeconds / 3600;
  const rate = elapsedTimeHours > 0 ? gainedValue / elapsedTimeHours : 0;
  
  // Update hourly display
  if (wealthMode === 'hourly') {
    wealthValueEl.textContent = gainedValue.toFixed(2);
    wealthHourlyEl.textContent = rate.toFixed(2);
  }
}

// === HOURLY: Start ===
function startHourlyTracking() {
  console.log('🕐 Starting hourly tracking...');

  // Take snapshot of current inventory
  hourlyStartSnapshot.clear();
  for (const item of currentItems) {
    hourlyStartSnapshot.set(item.baseId, item.totalQuantity);
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
  
  pauseHourlyBtn.style.display = 'none';
  resumeHourlyBtn.style.display = 'inline-block';
}

// === HOURLY: Resume ===
function resumeHourlyTracking() {
  console.log('▶️ Resuming hourly tracking');
  hourlyPaused = false;
  electronAPI.resumeHourlyTimer();

  pauseHourlyBtn.style.display = 'inline-block';
  resumeHourlyBtn.style.display = 'none';
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
  
  // Map the actual data across the full 60-minute span
  const dataPoints = Array.from({ length: 61 }, (_, i) => {
    const dataIndex = Math.floor((i / 60) * (sampledHistory.length - 1));
    const point = sampledHistory[dataIndex];
    return point ? point.value - bucket.startValue : 0;
  });
  
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        data: dataPoints,
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
          ticks: { color: '#FAFAFA', maxTicksLimit: 5 }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false }
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
  
  // Re-render to show all items again
  renderInventory();
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
});

startHourlyBtn.addEventListener('click', startHourlyTracking);
stopHourlyBtn.addEventListener('click', () => stopHourlyTracking(false));
pauseHourlyBtn.addEventListener('click', pauseHourlyTracking);
resumeHourlyBtn.addEventListener('click', resumeHourlyTracking);
resetRealtimeBtn.addEventListener('click', resetRealtimeTracking);

// Breakdown modal close button
document.getElementById('closeBreakdown')?.addEventListener('click', closeBreakdownModal);

// === EVENT LISTENERS ===
electronAPI.onInventoryUpdate(() => {
  loadInventory(); // Reload inventory data, but don't control timers
});

document.getElementById('minPrice')?.addEventListener('input', renderInventory);

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
  updateTitleBarVisibility(settings.fullscreenMode !== false); // Default to true if undefined
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
  pendingFullscreenMode = currentSettings.fullscreenMode !== undefined ? currentSettings.fullscreenMode : true;
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