// History page rendering

import {
  getHistoryDates,
  getSelectedDate,
  getSelectedHour,
  getCurrentHistoryData,
  setSelectedDate,
  setSelectedHour,
  loadHistoryData,
  getOverviewStats,
  HistoryDate
} from '../state/historyState.js';
import { ElectronAPI } from '../types.js';
import { FLAME_ELEMENTIUM_ID } from '../constants.js';

declare const electronAPI: ElectronAPI;

let compareWithToday = false;

// Search state
let historySearchQuery: string = '';

// Sort state
let historySortBy: 'priceUnit' | 'priceTotal' = 'priceTotal';
let historySortOrder: 'asc' | 'desc' = 'desc';

// Track if event listeners have been initialized
let eventListenersInitialized = false;

// Track if dropdown listeners have been initialized
let dropdownListenersInitialized = false;

/**
 * Initialize and render the history page
 */
export async function renderHistoryPage(): Promise<void> {
  await loadHistoryData();

  // Auto-select the latest date if no date is currently selected
  const dates = getHistoryDates();
  if (dates.length > 0 && getSelectedDate() === null) {
    setSelectedDate(dates[0].date);
  }

  renderDateSidebar();
  renderOverview();
  renderHourSelector();
  renderInventory();
  renderPriceComparison();
  updateSortIndicators();

  // Initialize event listeners once
  if (!eventListenersInitialized) {
    initializeEventListeners();
    eventListenersInitialized = true;
  }
}

/**
 * Initialize all event listeners (only run once)
 */
function initializeEventListeners(): void {
  // Date sidebar click handlers (event delegation)
  const sidebarDates = document.getElementById('historySidebarDates');
  if (sidebarDates) {
    sidebarDates.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const dateItem = target.closest('.history-sidebar-date-item');
      if (dateItem) {
        const date = dateItem.getAttribute('data-date');
        if (date) {
          setSelectedDate(date);
          setSelectedHour(null); // Reset hour selection when date changes
          renderHistoryPage();
        }
      }
    });
  }

  // Hour selector change handler
  const hourSelect = document.getElementById('historyHourSelect') as HTMLSelectElement;
  if (hourSelect) {
    hourSelect.addEventListener('change', () => {
      const value = hourSelect.value;
      setSelectedHour(value === '' ? null : parseInt(value, 10));
      renderHistoryPage();
    });
  }

  // Price comparison toggle handler
  const checkbox = document.getElementById('compareWithToday') as HTMLInputElement;
  if (checkbox) {
    checkbox.addEventListener('change', () => {
      compareWithToday = checkbox.checked;
      renderInventory();
    });
  }

  // Search input handler
  const searchInput = document.getElementById('historySearchInput') as HTMLInputElement;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      historySearchQuery = searchInput.value.trim().toLowerCase();
      renderInventory();
    });
  }

  // Sort header click handlers
  const priceSingleSort = document.querySelector('.history-inventory-price-single[data-sort]') as HTMLElement;
  const priceTotalSort = document.querySelector('.history-inventory-price-total[data-sort]') as HTMLElement;

  if (priceSingleSort) {
    priceSingleSort.addEventListener('click', () => {
      if (historySortBy === 'priceUnit') {
        historySortOrder = historySortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        historySortBy = 'priceUnit';
        historySortOrder = 'desc';
      }
      renderInventory();
      updateSortIndicators();
    });
  }

  if (priceTotalSort) {
    priceTotalSort.addEventListener('click', () => {
      if (historySortBy === 'priceTotal') {
        historySortOrder = historySortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        historySortBy = 'priceTotal';
        historySortOrder = 'desc';
      }
      renderInventory();
      updateSortIndicators();
    });
  }

  // Clear history button
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
      showClearHistoryModal();
    });
  }

  // Clear history modal actions
  const clearHistoryCancelBtn = document.getElementById('clearHistoryCancelBtn');
  const clearHistoryConfirmBtn = document.getElementById('clearHistoryConfirmBtn');
  if (clearHistoryCancelBtn) {
    clearHistoryCancelBtn.addEventListener('click', () => {
      hideClearHistoryModal();
    });
  }
  if (clearHistoryConfirmBtn) {
    clearHistoryConfirmBtn.addEventListener('click', () => {
      handleClearHistory();
    });
  }

  // Edit mode toggle button
  const editHoursToggleBtn = document.getElementById('editHoursToggleBtn');
  if (editHoursToggleBtn) {
    editHoursToggleBtn.addEventListener('click', () => {
      showEditMode();
    });
  }

  // Edit mode actions
  const exitEditModeBtn = document.getElementById('exitEditModeBtn');
  const deleteSelectedHoursBtn = document.getElementById('deleteSelectedHoursBtn');
  if (exitEditModeBtn) {
    exitEditModeBtn.addEventListener('click', () => {
      hideEditMode();
    });
  }
  if (deleteSelectedHoursBtn) {
    deleteSelectedHoursBtn.addEventListener('click', () => {
      showDeleteHoursModal();
    });
  }

  // Delete hours modal actions
  const deleteHoursCancelBtn = document.getElementById('deleteHoursCancelBtn');
  const deleteHoursConfirmBtn = document.getElementById('deleteHoursConfirmBtn');
  if (deleteHoursCancelBtn) {
    deleteHoursCancelBtn.addEventListener('click', () => {
      hideDeleteHoursModal();
    });
  }
  if (deleteHoursConfirmBtn) {
    deleteHoursConfirmBtn.addEventListener('click', () => {
      handleDeleteSelectedHours();
    });
  }
}

/**
 * Render the date sidebar
 */
function renderDateSidebar(): void {
  const sidebarDates = document.getElementById('historySidebarDates');
  if (!sidebarDates) return;

  const dates = getHistoryDates();

  if (dates.length === 0) {
    sidebarDates.innerHTML = '<div class="history-empty-state">No history data available</div>';
    return;
  }

  const selectedDate = getSelectedDate();
  const selectedDateValue = selectedDate || dates[0]?.date || null;

  sidebarDates.innerHTML = dates.map(date => {
    const isActive = date.date === selectedDateValue;
    return `
      <button class="history-sidebar-date-item ${isActive ? 'active' : ''}"
              data-date="${date.date}">
        ${date.displayDate}
      </button>
    `;
  }).join('');
}

/**
 * Render the overview section
 */
function renderOverview(): void {
  const stats = getOverviewStats();

  // Update DOM elements
  const totalDurationEl = document.getElementById('historyTotalDuration');
  const fePerHourEl = document.getElementById('historyFePerHour');
  const totalFeEl = document.getElementById('historyTotalFe');
  const bucketsCountEl = document.getElementById('historyBucketsCount');
  const bucketsItem = document.getElementById('historyBucketsItem');

  if (totalDurationEl) {
    totalDurationEl.textContent = formatDuration(stats.totalDuration);
  }
  if (fePerHourEl) {
    fePerHourEl.textContent = formatNumber(stats.fePerHour);
  }
  if (totalFeEl) {
    totalFeEl.textContent = formatNumber(stats.totalFe);
  }
  if (bucketsCountEl) {
    bucketsCountEl.textContent = stats.bucketsCount.toString();
  }
  if (bucketsItem) {
    // Show buckets count only when no specific hour is selected
    const selectedHour = getSelectedHour();
    bucketsItem.style.display = selectedHour === null ? 'flex' : 'none';
  }

  // Render graph in background
  renderOverviewGraph();
}

/**
 * Render the overview graph in the background
 */
function renderOverviewGraph(): void {
  const canvas = document.getElementById('historyOverviewGraph') as HTMLCanvasElement;
  if (!canvas) return;

  // TODO: Implement graph rendering using Chart.js or similar
  // This will show the wealth progression for the selected date/hour
  const data = getCurrentHistoryData();
  if (!data || data.buckets.length === 0) return;

  const selectedHour = getSelectedHour();
  const buckets = selectedHour !== null
    ? data.buckets.filter(b => b.hourNumber === selectedHour)
    : data.buckets;

  // Combine all history points from buckets
  const allHistoryPoints: { time: number; value: number }[] = [];

  for (const bucket of buckets) {
    allHistoryPoints.push(...bucket.history);
  }

  // Sort by time and render
  allHistoryPoints.sort((a, b) => a.time - b.time);

  renderGraph(canvas, allHistoryPoints);
}

/**
 * Render line graph on canvas
 */
function renderGraph(canvas: HTMLCanvasElement, data: { time: number; value: number }[]): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Clear canvas
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  ctx.clearRect(0, 0, rect.width, rect.height);

  if (data.length < 2) return;

  // Calculate scale
  const times = data.map(d => d.time);
  const values = data.map(d => d.value);

  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);

  const timeRange = maxTime - minTime || 1;
  const valueRange = maxValue - minValue || 1;

  const padding = 10;
  const graphWidth = rect.width - padding * 2;
  const graphHeight = rect.height - padding * 2;

  // Draw line graph
  ctx.beginPath();
  ctx.strokeStyle = '#DE5C0B';
  ctx.lineWidth = 2;

  for (let i = 0; i < data.length; i++) {
    const x = padding + ((data[i].time - minTime) / timeRange) * graphWidth;
    const y = padding + ((data[i].value - minValue) / valueRange) * graphHeight;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();
}

/**
 * Setup custom dropdown event handlers
 */
function setupCustomDropdown(): void {
  const dropdownWrapper = document.getElementById('hourDropdownWrapper') as HTMLElement;
  const dropdownTrigger = document.getElementById('hourDropdownTrigger') as HTMLElement;
  const dropdownMenu = document.getElementById('hourDropdownMenu') as HTMLElement;

  if (!dropdownWrapper || !dropdownTrigger || !dropdownMenu) return;

  // Toggle dropdown on trigger click
  dropdownTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownWrapper.classList.toggle('open');
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!dropdownWrapper.contains(e.target as Node)) {
      dropdownWrapper.classList.remove('open');
    }
  });

  // Handle keyboard navigation
  dropdownTrigger.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      dropdownWrapper.classList.toggle('open');
    } else if (e.key === 'Escape') {
      dropdownWrapper.classList.remove('open');
    }
  });

  // Attach click handler to menu using event delegation (only once)
  dropdownMenu.addEventListener('click', handleDropdownOptionClick);
}

/**
 * Handle dropdown option click
 */
function handleDropdownOptionClick(e: Event): void {
  const target = e.target as HTMLElement;
  const option = target.closest('.custom-dropdown-option') as HTMLElement;

  if (!option) return;

  e.stopPropagation();

  const dropdownWrapper = document.getElementById('hourDropdownWrapper') as HTMLElement;
  const dropdownValue = document.getElementById('hourDropdownValue') as HTMLElement;
  const dropdownMenu = document.getElementById('hourDropdownMenu') as HTMLElement;

  const value = option.getAttribute('data-value');
  const hourNumber = value ? parseInt(value, 10) : null;

  // Update selected value
  setSelectedHour(hourNumber);
  if (dropdownValue) {
    dropdownValue.textContent = option.textContent;
  }

  // Update selected state
  const options = dropdownMenu?.querySelectorAll('.custom-dropdown-option') as NodeListOf<HTMLElement>;
  if (options) {
    options.forEach(opt => opt.classList.remove('selected'));
  }
  option.classList.add('selected');

  // Close dropdown
  if (dropdownWrapper) {
    dropdownWrapper.classList.remove('open');
  }

  // Re-render page
  renderHistoryPage();
}

/**
 * Render the hour selector dropdown
 */
function renderHourSelector(): void {
  const dropdownWrapper = document.getElementById('hourDropdownWrapper') as HTMLElement;
  const dropdownTrigger = document.getElementById('hourDropdownTrigger') as HTMLElement;
  const dropdownValue = document.getElementById('hourDropdownValue') as HTMLElement;
  const dropdownMenu = document.getElementById('hourDropdownMenu') as HTMLElement;
  const hourSelector = document.querySelector('.history-hour-selector') as HTMLElement;
  if (!dropdownWrapper || !dropdownTrigger || !dropdownValue || !dropdownMenu || !hourSelector) return;

  const data = getCurrentHistoryData();
  const selectedHour = getSelectedHour();

  if (!data || data.buckets.length === 0) {
    dropdownValue.textContent = 'All Hours';
    dropdownMenu.innerHTML = '<div class="custom-dropdown-option selected" data-value="">All Hours</div>';
    hideEditMode();
    return;
  }

  // Create options for each hour bucket
  const options = ['<div class="custom-dropdown-option" data-value="">All Hours</div>'];

  let selectedDisplay = 'All Hours';

  data.buckets.forEach(bucket => {
    const hourLabel = formatHour(bucket.hourNumber);
    const customName = bucket.customName || '';
    const displayName = customName ? `${hourLabel}: ${customName}` : hourLabel;
    const isSelected = bucket.hourNumber === selectedHour ? 'selected' : '';
    const option = `<div class="custom-dropdown-option ${isSelected}" data-value="${bucket.hourNumber}">${displayName}</div>`;
    options.push(option);

    if (bucket.hourNumber === selectedHour) {
      selectedDisplay = displayName;
    }
  });

  dropdownMenu.innerHTML = options.join('');
  dropdownValue.textContent = selectedDisplay;

  // Hide edit mode when re-rendering (user needs to click Edit to enter edit mode)
  hideEditMode();

  // Ensure hour selector div is visible
  hourSelector.style.display = 'flex';

  // Setup custom dropdown event listeners (only once)
  if (!dropdownListenersInitialized) {
    setupCustomDropdown();
    dropdownListenersInitialized = true;
  }
}

/**
 * Update hour selector dropdown options without closing edit mode
 */
function updateHourSelectorOptions(): void {
  const dropdownMenu = document.getElementById('hourDropdownMenu') as HTMLElement;
  const dropdownValue = document.getElementById('hourDropdownValue') as HTMLElement;
  if (!dropdownMenu || !dropdownValue) return;

  const data = getCurrentHistoryData();
  const selectedHour = getSelectedHour();

  if (!data || data.buckets.length === 0) {
    dropdownValue.textContent = 'All Hours';
    dropdownMenu.innerHTML = '<div class="custom-dropdown-option selected" data-value="">All Hours</div>';
    return;
  }

  // Create options for each hour bucket
  const options = ['<div class="custom-dropdown-option" data-value="">All Hours</div>'];

  let selectedDisplay = 'All Hours';

  data.buckets.forEach(bucket => {
    const hourLabel = formatHour(bucket.hourNumber);
    const customName = bucket.customName || '';
    const displayName = customName ? `${hourLabel}: ${customName}` : hourLabel;
    const isSelected = bucket.hourNumber === selectedHour ? 'selected' : '';
    const option = `<div class="custom-dropdown-option ${isSelected}" data-value="${bucket.hourNumber}">${displayName}</div>`;
    options.push(option);

    if (bucket.hourNumber === selectedHour) {
      selectedDisplay = displayName;
    }
  });

  dropdownMenu.innerHTML = options.join('');
  dropdownValue.textContent = selectedDisplay;
}

/**
 * Render the inventory list
 */
function renderInventory(): void {
  const inventoryContent = document.getElementById('historyInventoryContent');
  if (!inventoryContent) return;

  const data = getCurrentHistoryData();
  const selectedHour = getSelectedHour();

  if (!data || data.buckets.length === 0) {
    inventoryContent.innerHTML = '<div class="history-empty-state">Select a date to view inventory</div>';
    return;
  }

  // Get bucket(s) to display
  const bucketsToShow = selectedHour !== null
    ? data.buckets.filter(b => b.hourNumber === selectedHour)
    : data.buckets;

  if (bucketsToShow.length === 0) {
    inventoryContent.innerHTML = '<div class="history-empty-state">No items found</div>';
    return;
  }

  // If single hour selected, use saved inventory snapshot from bucket
  if (selectedHour !== null && bucketsToShow.length > 0) {
    inventoryContent.innerHTML = bucketsToShow[0].inventorySnapshot;
    return;
  }

  // All hours - aggregate items
  const aggregatedItems = aggregateBuckets(bucketsToShow);

  if (Object.keys(aggregatedItems).length === 0) {
    inventoryContent.innerHTML = '<div class="history-empty-state">No items found</div>';
    return;
  }

  // Render aggregated inventory
  renderAggregatedInventory(aggregatedItems, data.date).then(html => {
    inventoryContent.innerHTML = html;
  });

  // Update sort indicators
  updateSortIndicators();
}

/**
 * Render price comparison toggle
 */
function renderPriceComparison(): void {
  const checkbox = document.getElementById('compareWithToday') as HTMLInputElement;
  if (!checkbox) return;

  checkbox.checked = compareWithToday;
}

/**
 * Aggregate items from multiple buckets
 */
function aggregateBuckets(buckets: { inventorySnapshot: string }[]): { [baseId: string]: { name: string; quantity: number; price: number; total: number; iconPath?: string } } {
  const items: { [baseId: string]: { name: string; quantity: number; price: number; total: number; iconPath?: string } } = {};

  for (const bucket of buckets) {
    // Parse the inventory snapshot HTML to extract items
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = bucket.inventorySnapshot;

    // Find all item rows
    const itemRows = tempDiv.querySelectorAll('.item-row, .history-inventory-item');

    itemRows.forEach(row => {
      const nameEl = row.querySelector('.item-name-content, .history-inventory-item-name-content');
      const qtyEl = row.querySelector('.item-quantity, .history-inventory-item-quantity');
      const priceEl = row.querySelector('.price-single, .history-inventory-item-price-single');
      const totalEl = row.querySelector('.price-total, .history-inventory-item-price-total');
      const iconEl = row.querySelector('.item-icon, .history-inventory-item-icon');

      if (nameEl) {
        const labelEl = nameEl.querySelector('.item-label, .history-inventory-item-label');
        const name = labelEl ? labelEl.textContent.trim() : '';
        const quantity = parseFloat(qtyEl?.textContent?.replace(/,/g, '') || '0');
        const price = parseFloat(priceEl?.textContent?.replace(/,/g, '') || '0');
        const total = parseFloat(totalEl?.textContent?.replace(/,/g, '') || '0');
        const iconPath = iconEl?.getAttribute('src') || '';

        // Find baseId from icon path
        const baseIdMatch = iconPath.match(/assets\/(.+?)\.webp/);
        if (baseIdMatch) {
          const baseId = baseIdMatch[1];

          if (!items[baseId]) {
            items[baseId] = { name, quantity: 0, price, total: 0, iconPath };
          }

          items[baseId].quantity += quantity;
          items[baseId].total += total;
        }
      }
    });
  }

  return items;
}

/**
 * Render aggregated inventory items
 */
async function renderAggregatedInventory(items: { [baseId: string]: { name: string; quantity: number; price: number; total: number; iconPath?: string } }, selectedDate: string): Promise<string> {
  // Always load price cache to access price history
  const priceCache = await electronAPI.getPriceCache();

  // Check if selected date is today (using local date, not UTC)
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const isToday = selectedDate === today;

  console.log('[History] Today:', today, 'Selected:', selectedDate, 'isToday:', isToday, 'compareWithToday:', compareWithToday);

  // First, calculate all prices and totals for filtering
  const itemsWithPrices = Object.entries(items).map(([baseId, item]) => {
    let price: number;
    let total: number;

    const cacheEntry = priceCache[baseId];

    // Flame Elementium is the currency, always has price 1
    if (baseId === FLAME_ELEMENTIUM_ID) {
      price = 1;
      total = item.quantity;
    } else if (compareWithToday && priceCache[baseId]) {
      price = priceCache[baseId].price;
      total = price * item.quantity;
    } else if (isToday && priceCache[baseId]) {
      price = priceCache[baseId].price;
      total = price * item.quantity;
    } else if (priceCache[baseId]?.history) {
      const history = priceCache[baseId].history;
      const dayHistory = history.filter(h => h.date.startsWith(selectedDate));

      if (dayHistory.length > 0) {
        price = dayHistory[dayHistory.length - 1].price;
        total = price * item.quantity;
      } else {
        price = item.quantity > 0 ? item.total / item.quantity : 0;
        total = item.total;
      }
    } else {
      price = item.quantity > 0 ? item.total / item.quantity : 0;
      total = item.total;
    }

    return { baseId, item, price, total };
  });

  // Filter by search query
  const filteredItems = itemsWithPrices.filter(({ item }) => {
    if (historySearchQuery && !item.name.toLowerCase().includes(historySearchQuery)) {
      return false;
    }
    return true;
  });

  // Sort items
  filteredItems.sort((a, b) => {
    const aValue = historySortBy === 'priceUnit' ? a.price : a.total;
    const bValue = historySortBy === 'priceUnit' ? b.price : b.total;
    const comparison = aValue - bValue;
    return historySortOrder === 'desc' ? -comparison : comparison;
  });

  return filteredItems.map(({ baseId, item, price, total }) => {
    console.log(`[History] ${item.name} (${baseId}): price=${price}, total=${total}`);
    return `
      <div class="history-inventory-item">
        <div class="history-inventory-item-name">
          <img src="${item.iconPath}" alt="${item.name}" class="history-inventory-item-icon" onerror="this.style.display='none'">
          <div class="history-inventory-item-name-content">
            <div class="history-inventory-item-label">${item.name}</div>
          </div>
        </div>
        <div class="history-inventory-item-quantity">${formatInteger(item.quantity)}</div>
        <div class="history-inventory-item-price">
          <div class="history-inventory-item-price-single">${price.toFixed(2)}</div>
          <div class="history-inventory-item-price-total">${total.toFixed(2)}</div>
        </div>
      </div>
    `;
  })
  .join('');
}

/**
 * Format duration in seconds to HH:MM:SS
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Format hour number to readable format (shows time range)
 */
function formatHour(hour: number): string {
  const startHour = hour;
  const endHour = (hour + 1) % 24;

  const formatHour = (h: number) => {
    if (h === 0) return '12:00 AM';
    if (h < 12) return `${h}:00 AM`;
    if (h === 12) return '12:00 PM';
    return `${h - 12}:00 PM`;
  };

  return `${formatHour(startHour)} → ${formatHour(endHour)}`;
}

/**
 * Format number with commas
 */
function formatNumber(num: number): string {
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Format integer (for quantity) - no decimals
 */
function formatInteger(num: number): string {
  return Math.floor(num).toLocaleString('en-US');
}

/**
 * Update sort indicators in the UI
 */
function updateSortIndicators(): void {
  const priceSingleSort = document.querySelector('.history-inventory-price-single[data-sort]') as HTMLElement;
  const priceTotalSort = document.querySelector('.history-inventory-price-total[data-sort]') as HTMLElement;

  if (priceSingleSort) {
    priceSingleSort.classList.remove('sort-active', 'sort-asc', 'sort-desc');
    if (historySortBy === 'priceUnit') {
      priceSingleSort.classList.add('sort-active');
      priceSingleSort.classList.add(historySortOrder === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  }

  if (priceTotalSort) {
    priceTotalSort.classList.remove('sort-active', 'sort-asc', 'sort-desc');
    if (historySortBy === 'priceTotal') {
      priceTotalSort.classList.add('sort-active');
      priceTotalSort.classList.add(historySortOrder === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  }
}

/**
 * Show clear history modal
 */
function showClearHistoryModal(): void {
  const modal = document.getElementById('clearHistoryModal') as HTMLElement;
  if (modal) {
    modal.classList.add('active');
  }
}

/**
 * Hide clear history modal
 */
function hideClearHistoryModal(): void {
  const modal = document.getElementById('clearHistoryModal') as HTMLElement;
  if (modal) {
    modal.classList.remove('active');
  }
}

/**
 * Handle clear all history
 */
async function handleClearHistory(): Promise<void> {
  try {
    await electronAPI.clearAllHistory();
    hideClearHistoryModal();
    await loadHistoryData();
    renderHistoryPage();
  } catch (error) {
    console.error('Failed to clear history:', error);
    alert('Failed to clear history. Please try again.');
  }
}

/**
 * Show delete hours modal
 */
function showDeleteHoursModal(): void {
  const checkboxes = document.querySelectorAll('.edit-hour-checkbox:checked') as NodeListOf<HTMLInputElement>;
  const selectedCount = Array.from(checkboxes).length;

  if (selectedCount === 0) {
    return;
  }

  const deleteHoursCount = document.getElementById('deleteHoursCount');
  if (deleteHoursCount) {
    deleteHoursCount.textContent = selectedCount.toString();
  }

  const modal = document.getElementById('deleteHoursModal') as HTMLElement;
  if (modal) {
    modal.classList.add('active');
  }
}

/**
 * Hide delete hours modal
 */
function hideDeleteHoursModal(): void {
  const modal = document.getElementById('deleteHoursModal') as HTMLElement;
  if (modal) {
    modal.classList.remove('active');
  }
}

/**
 * Show edit mode
 */
function showEditMode(): void {
  const editSelector = document.getElementById('historyEditSelector') as HTMLElement;
  const hourSelector = document.querySelector('.history-hour-selector') as HTMLElement;
  const editHourCheckboxList = document.getElementById('editHourCheckboxList') as HTMLElement;

  if (!editSelector || !hourSelector || !editHourCheckboxList) return;

  // Get current data
  const data = getCurrentHistoryData();
  if (!data || data.buckets.length === 0) return;

  // Hide the main hour selector div and show edit mode
  hourSelector.style.display = 'none';
  editSelector.style.display = 'block';

  // Populate the checkbox list
  const checkboxItems: string[] = [];
  data.buckets.forEach(bucket => {
    const hourLabel = formatHour(bucket.hourNumber);
    const customName = bucket.customName || '';
    const displayName = customName ? `${hourLabel}: ${customName}` : hourLabel;
    const checkboxItem = `
      <label class="edit-hour-checkbox-item">
        <input type="checkbox" class="edit-hour-checkbox" value="${bucket.hourNumber}">
        <span class="edit-hour-checkbox-label" data-hour="${bucket.hourNumber}" data-baselabel="${hourLabel}" data-customname="${customName}">${displayName}</span>
        <button class="edit-hour-name-btn" data-hour="${bucket.hourNumber}" title="Edit Name">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M18.5 2.50023C18.8978 2.1024 19.5374 2.1024 19.9352 2.50023L21.4998 4.06479C21.8976 4.46261 21.8976 5.10217 21.4998 5.5L12 15L8 16L9 12L18.5 2.50023Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </label>
    `;
    checkboxItems.push(checkboxItem);
  });
  editHourCheckboxList.innerHTML = checkboxItems.join('');

  // Attach event listeners to edit name buttons
  const editNameButtons = editHourCheckboxList.querySelectorAll('.edit-hour-name-btn') as NodeListOf<HTMLButtonElement>;
  editNameButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const hourNumber = parseInt(btn.getAttribute('data-hour') || '0', 10);
      const label = editHourCheckboxList.querySelector(`.edit-hour-checkbox-label[data-hour="${hourNumber}"]`) as HTMLElement;
      if (label) {
        makeLabelEditable(label);
      }
    });
  });

  // Attach event listeners to checkboxes to show/hide delete button
  const hourCheckboxes = editHourCheckboxList.querySelectorAll('.edit-hour-checkbox') as NodeListOf<HTMLInputElement>;
  hourCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('change', updateDeleteButtonVisibility);
  });

  // Initial visibility check
  updateDeleteButtonVisibility();
}

/**
 * Update delete button visibility based on checkbox selections
 */
function updateDeleteButtonVisibility(): void {
  const checkboxes = document.querySelectorAll('.edit-hour-checkbox:checked') as NodeListOf<HTMLInputElement>;
  const deleteBtn = document.getElementById('deleteSelectedHoursBtn') as HTMLElement;

  if (deleteBtn) {
    const hasSelection = Array.from(checkboxes).length > 0;
    deleteBtn.style.display = hasSelection ? 'flex' : 'none';
  }
}

/**
 * Hide edit mode
 */
function hideEditMode(): void {
  const editSelector = document.getElementById('historyEditSelector') as HTMLElement;
  const hourSelector = document.querySelector('.history-hour-selector') as HTMLElement;

  if (!editSelector || !hourSelector) return;

  // Show the main hour selector div and hide edit mode
  hourSelector.style.display = 'flex';
  editSelector.style.display = 'none';

  // Clear checkbox selections
  const checkboxes = document.querySelectorAll('.edit-hour-checkbox') as NodeListOf<HTMLInputElement>;
  checkboxes.forEach(checkbox => {
    checkbox.checked = false;
  });

  // Hide delete button
  const deleteBtn = document.getElementById('deleteSelectedHoursBtn') as HTMLElement;
  if (deleteBtn) {
    deleteBtn.style.display = 'none';
  }
}

/**
 * Make label editable
 */
async function makeLabelEditable(label: HTMLElement): Promise<void> {
  const hourNumber = parseInt(label.getAttribute('data-hour') || '0', 10);
  const baseLabel = label.getAttribute('data-baselabel') || '';
  const currentCustomName = label.getAttribute('data-customname') || '';
  const data = getCurrentHistoryData();
  const selectedDate = getSelectedDate();

  if (!data || !selectedDate) return;

  const bucket = data.buckets.find(b => b.hourNumber === hourNumber);
  if (!bucket) return;

  // Create input element
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentCustomName;
  input.className = 'edit-hour-name-input';
  input.style.width = '100%';
  input.style.padding = '4px 8px';
  input.style.fontSize = 'inherit';
  input.style.fontFamily = 'inherit';
  input.style.background = 'rgba(0, 0, 0, 0.3)';
  input.style.border = '1px solid #DE5C0B';
  input.style.borderRadius = '4px';
  input.style.color = 'inherit';
  input.style.outline = 'none';

  // Replace label with input
  label.replaceWith(input);
  input.focus();

  // Save function
  const save = async () => {
    const newName = input.value.trim();
    const newDisplayName = newName ? `${baseLabel}: ${newName}` : baseLabel;

    // Update bucket in memory
    bucket.customName = newName || undefined;

    // Save to persistent storage
    try {
      await electronAPI.updateBucketCustomName(selectedDate, hourNumber, newName || undefined);
    } catch (error) {
      console.error('Failed to save custom name:', error);
      // Still update UI even if save fails
    }

    // Create new label element
    const newLabel = document.createElement('span');
    newLabel.className = 'edit-hour-checkbox-label';
    newLabel.setAttribute('data-hour', hourNumber.toString());
    newLabel.setAttribute('data-baselabel', baseLabel);
    newLabel.setAttribute('data-customname', newName || '');
    newLabel.textContent = newDisplayName;

    // Replace input with new label
    input.replaceWith(newLabel);

    // Update hour selector dropdown options (without closing edit mode)
    updateHourSelectorOptions();

    console.log(`Updated hour ${hourNumber} name to: ${bucket.customName}`);
  };

  // Save on Enter key
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      // Cancel on Escape - revert to original
      const newLabel = document.createElement('span');
      newLabel.className = 'edit-hour-checkbox-label';
      newLabel.setAttribute('data-hour', hourNumber.toString());
      newLabel.setAttribute('data-baselabel', baseLabel);
      newLabel.setAttribute('data-customname', currentCustomName);
      newLabel.textContent = currentCustomName ? `${baseLabel}: ${currentCustomName}` : baseLabel;
      input.replaceWith(newLabel);
    }
  });

  // Save when clicking away (blur)
  input.addEventListener('blur', () => {
    // Small delay to allow other events to fire
    setTimeout(save, 10);
  });
}

/**
 * Handle delete selected hours
 */
async function handleDeleteSelectedHours(): Promise<void> {
  const selectedDate = getSelectedDate();
  const checkboxes = document.querySelectorAll('.edit-hour-checkbox:checked') as NodeListOf<HTMLInputElement>;

  if (!selectedDate) return;

  // Get selected hours
  const selectedCheckboxes = Array.from(checkboxes);

  if (selectedCheckboxes.length === 0) {
    hideDeleteHoursModal();
    return;
  }

  try {
    // Delete each selected hour
    for (const checkbox of selectedCheckboxes) {
      const hourNumber = parseInt(checkbox.value, 10);
      await electronAPI.deleteBucketsByDateAndHour(selectedDate, hourNumber);
    }

    // Hide modal, exit edit mode and reload
    hideDeleteHoursModal();
    hideEditMode();
    setSelectedHour(null);
    await loadHistoryData();
    renderHistoryPage();
  } catch (error) {
    console.error('Failed to delete selected hours:', error);
    alert('Failed to delete hours. Please try again.');
    hideDeleteHoursModal();
  }
}
