// renderer.js
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
  onInventoryUpdate: (callback: () => void) => void;
}

declare const electronAPI: ElectronAPI;

// === INVENTORY STATE ===
let currentItems: InventoryItem[] = [];

// Sorting
let currentSortBy: 'priceUnit' | 'priceTotal' = 'priceTotal';
let currentSortOrder: 'asc' | 'desc' = 'desc';

// === WEALTH TRACKING STATE ===
let wealthMode: 'realtime' | 'hourly' = 'realtime';
let wealthHistory: { time: number; value: number }[] = [];
const MAX_POINTS = 120; // ~10 min realtime, 1h hourly

let hourlyStartTime = 0;
let hourlyStartValue = 0;
let hourlyInterval: number | null = null;
let hourlyPausedTime = 0; // Total time spent paused (in seconds)
let hourlyPausedAt = 0; // When pause was initiated

// === DOM ELEMENTS ===
const wealthValueEl = document.getElementById('wealthValue')!;
const wealthRateEl = document.getElementById('wealthRate')!;
const realtimeBtn = document.getElementById('realtimeBtn') as HTMLButtonElement;
const hourlyBtn = document.getElementById('hourlyBtn') as HTMLButtonElement;
const hourlyControls = document.getElementById('hourlyControls')!;
const startHourlyBtn = document.getElementById('startHourly') as HTMLButtonElement;
const stopHourlyBtn = document.getElementById('stopHourly') as HTMLButtonElement;
const pauseHourlyBtn = document.getElementById('pauseHourly') as HTMLButtonElement;
const resumeHourlyBtn = document.getElementById('resumeHourly') as HTMLButtonElement;
const hourlyTimerEl = document.getElementById('hourlyTimer')!;
const timerEl = document.getElementById('timer')!;

// Canvas
const canvas = document.getElementById('wealthGraph') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

// ---- INITIAL UI STATE ----
startHourlyBtn.style.display = 'inline-block';
stopHourlyBtn.style.display = 'none';
pauseHourlyBtn.style.display = 'none';
resumeHourlyBtn.style.display = 'none';
hourlyControls.classList.remove('active');
realtimeBtn.classList.add('active');
hourlyBtn.classList.remove('active');

// Resize canvas
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
}
window.addEventListener('resize', () => {
  resizeCanvas();
  drawGraph();
});
resizeCanvas();

// === INITIAL LOAD ===
async function loadInventory() {
  const inventory = await electronAPI.getInventory();
  currentItems = inventory;
  renderInventory();
  updateStats(inventory);
}

// === FILTER & SORT ===
function getSortedAndFilteredItems(): InventoryItem[] {
  const minPriceInput = document.getElementById('minPrice') as HTMLInputElement | null;
  const minPrice = parseFloat(minPriceInput?.value || '0') || 0;

  let filtered = currentItems.filter(item => {
    if (item.price === null) return minPrice === 0;
    const totalValue = item.price * item.totalQuantity;
    return totalValue >= minPrice;
  });

  filtered.sort((a, b) => {
    let comparison = 0;
    if (currentSortBy === 'priceUnit') {
      const priceA = a.price ?? -1;
      const priceB = b.price ?? -1;
      comparison = priceA - priceB;
    } else if (currentSortBy === 'priceTotal') {
      const totalA = (a.price ?? 0) * a.totalQuantity;
      const totalB = (b.price ?? 0) * b.totalQuantity;
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
    container.innerHTML = '<div class="loading">No items match your filters</div>';
    updateSortIndicators();
    return;
  }

  container.innerHTML = items
    .map(item => {
      const totalValue = item.price !== null ? item.price * item.totalQuantity : null;
      const pageLabel = getPageLabel(item);

      return `
        <div class="item-row">
          <div class="item-name">
            ${item.itemName}
            ${item.instances > 1 ? `<span style="color: #9ca3af; font-size: 14px;"> (${item.instances} stacks)</span>` : ''}
            ${pageLabel ? `<div style="color: white; opacity: 0.5; font-size: 12px; margin-top: 4px;">${pageLabel}</div>` : ''}
          </div>
          <div class="item-quantity">${item.totalQuantity.toLocaleString()}</div>
          <div class="item-price">
            <div class="price-single ${item.price === null ? 'no-price' : ''}" style="text-align: left;">
              ${item.price !== null ? item.price.toFixed(2) : 'Not Set'}
            </div>
            ${totalValue !== null ? `<div class="price-total" style="text-align: right;">${totalValue.toFixed(2)}</div>` : ''}
          </div>
        </div>
      `;
    })
    .join('');

  updateSortIndicators();
}

// === UPDATE STATS ===
function updateStats(items: InventoryItem[]) {
  const itemsPriced = items.filter(item => item.price !== null).length;
  const totalValue = items.reduce((sum, item) => {
    if (item.price !== null) return sum + item.totalQuantity * item.price;
    return sum;
  }, 0);

  const itemsPricedEl = document.getElementById('itemsPriced');
  if (itemsPricedEl) itemsPricedEl.textContent = `${itemsPriced}/${items.length}`;

  if (wealthMode === 'realtime') {
    updateWealthRealtime(totalValue);
  } else if (wealthMode === 'hourly' && hourlyInterval === null) {
    wealthValueEl.textContent = `${totalValue.toFixed(2)} FE`;
  }
}

// === SORT INDICATORS ===
function updateSortIndicators() {
  document.querySelectorAll('[data-sort]').forEach(el => {
    const sortType = (el as HTMLElement).dataset.sort;
    if (!sortType) return;
    (el as HTMLElement).textContent = sortType === 'priceUnit' ? 'Price' : 'Total';
    if (sortType === currentSortBy) {
      (el as HTMLElement).textContent += currentSortOrder === 'asc' ? ' Up' : ' Down';
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

// === CURRENT TOTAL VALUE ===
function getCurrentTotalValue(): number {
  return currentItems.reduce((sum, item) => {
    if (item.price !== null) return sum + item.totalQuantity * item.price;
    return sum;
  }, 0);
}

// === GRAPH: Init ===
function initGraph() {
  wealthHistory = [];
  drawGraph();
}

// === GRAPH: Push Point ===
function pushPoint(value: number) {
  const now = Date.now();
  wealthHistory.push({ time: now, value });
  if (wealthHistory.length > MAX_POINTS) wealthHistory.shift();
  drawGraph();
}

// === GRAPH: Draw ===
function drawGraph() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (wealthHistory.length === 0) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = '14px monospace';
    ctx.fillText('Collecting data…', 12, canvas.height / 2);
    return;
  }

  const padding = 12;
  const w = canvas.width - padding * 2;
  const h = canvas.height - padding * 2;

  const values = wealthHistory.map(p => p.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;

  // Grid
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding + (i / 4) * h;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(padding + w, y);
    ctx.stroke();
  }

  // Line
  ctx.strokeStyle = '#667eea';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  wealthHistory.forEach((p, i) => {
    const x = padding + (i / (wealthHistory.length - 1)) * w;
    const y = padding + h - ((p.value - minV) / range) * h;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Latest dot
  const last = wealthHistory[wealthHistory.length - 1];
  const lastX = padding + w;
  const lastY = padding + h - ((last.value - minV) / range) * h;
  ctx.fillStyle = '#667eea';
  ctx.beginPath();
  ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
  ctx.fill();
}

// === WEALTH: Real-time ===
function updateWealthRealtime(currentValue: number) {
  wealthValueEl.textContent = `${currentValue.toFixed(2)} FE`;
  pushPoint(currentValue);

  if (wealthHistory.length >= 2) {
    const first = wealthHistory[0];
    const timeH = (Date.now() - first.time) / 3_600_000;
    const rate = timeH > 0 ? (currentValue - first.value) / timeH : 0;
    wealthRateEl.textContent = `${rate > 0 ? '+' : ''}${rate.toFixed(2)} FE/hr`;
    wealthRateEl.className = rate >= 0 ? 'wealth-rate positive' : 'wealth-rate negative';
  } else {
    wealthRateEl.textContent = '';
  }
}

// === HOURLY: Start ===
function startHourlyTracking() {
  if (hourlyInterval) return;

  hourlyStartValue = getCurrentTotalValue();
  hourlyStartTime = Date.now();
  hourlyPausedTime = 0;

  initGraph();
  pushPoint(hourlyStartValue);

  startHourlyBtn.style.display = 'none';
  stopHourlyBtn.style.display = 'inline-block';
  pauseHourlyBtn.style.display = 'inline-block';
  resumeHourlyBtn.style.display = 'none';
  wealthValueEl.textContent = `${hourlyStartValue.toFixed(2)} FE`;

  let elapsedSec = 0;
  hourlyTimerEl.textContent = '00:00:00';

  hourlyInterval = window.setInterval(() => {
    elapsedSec++;
    hourlyTimerEl.textContent = formatTime(elapsedSec);
    const nowValue = getCurrentTotalValue();
    pushPoint(nowValue);
    wealthValueEl.textContent = `${nowValue.toFixed(2)} FE`;

    if (elapsedSec >= 3600) stopHourlyTracking(true);
  }, 1000);
}

// === HOURLY: Pause ===
function pauseHourlyTracking() {
  if (!hourlyInterval) return;
  
  clearInterval(hourlyInterval);
  hourlyInterval = null;
  hourlyPausedAt = Date.now();

  pauseHourlyBtn.style.display = 'none';
  resumeHourlyBtn.style.display = 'inline-block';
}

// === HOURLY: Resume ===
function resumeHourlyTracking() {
  if (hourlyInterval) return;

  // Add the pause duration to the total paused time
  hourlyPausedTime += (Date.now() - hourlyPausedAt) / 1000;
  
  // Restart the interval
  let elapsedSec = parseInt(hourlyTimerEl.textContent.split(':')[0]) * 3600 +
                   parseInt(hourlyTimerEl.textContent.split(':')[1]) * 60 +
                   parseInt(hourlyTimerEl.textContent.split(':')[2]);

  hourlyInterval = window.setInterval(() => {
    elapsedSec++;
    hourlyTimerEl.textContent = formatTime(elapsedSec);
    const nowValue = getCurrentTotalValue();
    pushPoint(nowValue);
    wealthValueEl.textContent = `${nowValue.toFixed(2)} FE`;

    if (elapsedSec >= 3600) stopHourlyTracking(true);
  }, 1000);

  pauseHourlyBtn.style.display = 'inline-block';
  resumeHourlyBtn.style.display = 'none';
}

// === HOURLY: Stop ===
function stopHourlyTracking(auto = false) {
  if (hourlyInterval === null) return;
  clearInterval(hourlyInterval);
  hourlyInterval = null;

  const final = getCurrentTotalValue();
  const gain = final - hourlyStartValue;

  // earnings animation
  const box = document.querySelector('.wealth-box')!;
  const anim = document.createElement('div');
  anim.className = 'earnings-animation';
  anim.textContent = `${gain >= 0 ? '+' : ''}${gain.toFixed(2)} FE`;
  anim.style.color = gain >= 0 ? '#10b981' : '#ef4444';
  box.appendChild(anim);
  setTimeout(() => anim.remove(), 2000);

  // UI reset
  startHourlyBtn.style.display = 'inline-block';
  stopHourlyBtn.style.display = 'none';
  pauseHourlyBtn.style.display = 'none';
  resumeHourlyBtn.style.display = 'none';
  hourlyTimerEl.textContent = '00:00:00';
}

// === REALTIME: Start
function startRealtimeTimer() {
  if (!timerEl) {
    console.error('Timer element not found.');
    return;
  }

  let elapsedSec = 0;

  function formatTime(seconds: number): string {
    const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  timerEl.textContent = '00:00:00';

  setInterval(() => {
    elapsedSec++;
    timerEl.textContent = formatTime(elapsedSec);
  }, 1000);

  // === REALTIME: Timer hiding based on mode
  // Switch to Realtime mode
  realtimeBtn.addEventListener('click', () => {
    realtimeBtn.classList.add('active');
    hourlyBtn.classList.remove('active');

    timerEl.style.display = 'inline';
    hourlyControls.classList.remove('active');

    // Reset timer counter
    elapsedSec = 0;
    timerEl.textContent = formatTime(elapsedSec);
  });

  hourlyBtn.addEventListener('click', () => {
    hourlyBtn.classList.add('active');
    realtimeBtn.classList.remove('active');

    timerEl.style.display = 'none';
    hourlyControls.classList.add('active');

    // Reset timer counter
    elapsedSec = 0;
    timerEl.textContent = formatTime(elapsedSec);
  });
}

// === MODE SWITCHING ===
realtimeBtn.addEventListener('click', () => {
  wealthMode = 'realtime';
  realtimeBtn.classList.add('active');
  hourlyBtn.classList.remove('active');
  hourlyControls.classList.remove('active');
  if (hourlyInterval) stopHourlyTracking();
  initGraph();
  updateWealthRealtime(getCurrentTotalValue());
});

hourlyBtn.addEventListener('click', () => {
  wealthMode = 'hourly';
  realtimeBtn.classList.remove('active');
  hourlyBtn.classList.add('active');
  hourlyControls.classList.add('active');

  // reset graph & show big centered message
  initGraph();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#9ca3af';
  ctx.font = '18px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Press "Start Hour" to begin', canvas.width / 2, canvas.height / 2);

  const cur = getCurrentTotalValue();
  wealthValueEl.textContent = `${cur.toFixed(2)} FE`;
});

startHourlyBtn.addEventListener('click', startHourlyTracking);
stopHourlyBtn.addEventListener('click', () => stopHourlyTracking(false));
pauseHourlyBtn.addEventListener('click', pauseHourlyTracking);
resumeHourlyBtn.addEventListener('click', resumeHourlyTracking);

// === EVENT LISTENERS ===
electronAPI.onInventoryUpdate(loadInventory);

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

// === INITIALIZE ===
initGraph();
loadInventory();
startRealtimeTimer();