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

declare const electronAPI: ElectronAPI;

let compareWithToday = false;

// Track if event listeners have been initialized
let eventListenersInitialized = false;

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
 * Render the hour selector dropdown
 */
function renderHourSelector(): void {
  const hourSelect = document.getElementById('historyHourSelect') as HTMLSelectElement;
  if (!hourSelect) return;

  const data = getCurrentHistoryData();
  const selectedHour = getSelectedHour();

  if (!data || data.buckets.length === 0) {
    hourSelect.innerHTML = '<option value="">All Hours</option>';
    hideEditMode();
    return;
  }

  // Create options for each hour bucket
  const options = ['<option value="">All Hours</option>'];

  data.buckets.forEach(bucket => {
    const hourLabel = formatHour(bucket.hourNumber);
    const option = `<option value="${bucket.hourNumber}" ${bucket.hourNumber === selectedHour ? 'selected' : ''}>${hourLabel}</option>`;
    options.push(option);
  });

  hourSelect.innerHTML = options.join('');

  // Hide edit mode when re-rendering (user needs to click Edit to enter edit mode)
  hideEditMode();
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
  renderAggregatedInventory(aggregatedItems).then(html => {
    inventoryContent.innerHTML = html;
  });
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
      const nameEl = row.querySelector('.item-name, .history-inventory-item-name span');
      const qtyEl = row.querySelector('.item-quantity, .history-inventory-item-quantity');
      const priceEl = row.querySelector('.item-price, .history-inventory-item-price');
      const totalEl = row.querySelector('.item-total, .history-inventory-item-total');
      const iconEl = row.querySelector('.item-icon, .history-inventory-item-icon');

      if (nameEl) {
        const name = nameEl.textContent.trim();
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
async function renderAggregatedInventory(items: { [baseId: string]: { name: string; quantity: number; price: number; total: number; iconPath?: string } }): Promise<string> {
  let priceCache: { [baseId: string]: { price: number; timestamp: number } } | null = null;

  if (compareWithToday) {
    priceCache = await electronAPI.getPriceCache();
  }

  return Object.entries(items)
    .map(([baseId, item]) => {
      let price = item.price;

      if (compareWithToday && priceCache && priceCache[baseId]) {
        price = priceCache[baseId].price;
      }

      const total = price * item.quantity;

      return `
        <div class="history-inventory-item">
          <div class="history-inventory-item-name">
            <img src="${item.iconPath}" alt="${item.name}" class="history-inventory-item-icon" onerror="this.style.display='none'">
            <span>${item.name}</span>
          </div>
          <div class="history-inventory-item-quantity">${formatNumber(item.quantity)}</div>
          <div class="history-inventory-item-price ${compareWithToday ? 'highlighted' : ''}">${formatNumber(price)}</div>
          <div class="history-inventory-item-total">${formatNumber(total)}</div>
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
 * Show edit mode
 */
function showEditMode(): void {
  const editSelector = document.getElementById('historyEditSelector') as HTMLElement;
  const hourSelect = document.getElementById('historyHourSelect') as HTMLSelectElement;
  const editHourSelect = document.getElementById('editHourSelect') as HTMLSelectElement;

  if (!editSelector || !hourSelect || !editHourSelect) return;

  // Get current data
  const data = getCurrentHistoryData();
  if (!data || data.buckets.length === 0) return;

  // Hide the main hour selector and show edit mode
  hourSelect.style.display = 'none';
  editSelector.style.display = 'block';

  // Populate the multi-select dropdown
  const options: string[] = [];
  data.buckets.forEach(bucket => {
    const hourLabel = formatHour(bucket.hourNumber);
    const option = `<option value="${bucket.hourNumber}">${hourLabel}</option>`;
    options.push(option);
  });
  editHourSelect.innerHTML = options.join('');
}

/**
 * Hide edit mode
 */
function hideEditMode(): void {
  const editSelector = document.getElementById('historyEditSelector') as HTMLElement;
  const hourSelect = document.getElementById('historyHourSelect') as HTMLSelectElement;

  if (!editSelector || !hourSelect) return;

  // Show the main hour selector and hide edit mode
  hourSelect.style.display = 'block';
  editSelector.style.display = 'none';

  // Clear selections
  const editHourSelect = document.getElementById('editHourSelect') as HTMLSelectElement;
  if (editHourSelect) {
    Array.from(editHourSelect.selectedOptions).forEach(option => {
      option.selected = false;
    });
  }
}

/**
 * Handle delete selected hours
 */
async function handleDeleteSelectedHours(): Promise<void> {
  const selectedDate = getSelectedDate();
  const editHourSelect = document.getElementById('editHourSelect') as HTMLSelectElement;

  if (!selectedDate || !editHourSelect) return;

  // Get selected hours
  const selectedOptions = Array.from(editHourSelect.selectedOptions);

  if (selectedOptions.length === 0) {
    alert('Please select at least one hour to delete.');
    return;
  }

  // Confirm deletion
  const hoursToDelete = selectedOptions.map(opt => opt.textContent || '').join(', ');
  const confirmed = confirm(`Are you sure you want to delete the following hours?\n\n${hoursToDelete}\n\nThis action cannot be undone.`);

  if (!confirmed) return;

  try {
    // Delete each selected hour
    for (const option of selectedOptions) {
      const hourNumber = parseInt(option.value, 10);
      await electronAPI.deleteBucketsByDateAndHour(selectedDate, hourNumber);
    }

    // Exit edit mode and reload
    hideEditMode();
    setSelectedHour(null);
    await loadHistoryData();
    renderHistoryPage();
  } catch (error) {
    console.error('Failed to delete selected hours:', error);
    alert('Failed to delete hours. Please try again.');
  }
}
