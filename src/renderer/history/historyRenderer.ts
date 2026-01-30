// History page rendering

import {
  getHistoryDates,
  getSelectedDate,
  getSelectedHour,
  getCurrentHistoryData,
  setSelectedDate,
  setSelectedHour,
  HistoryDate,
  HistoryHourBucket
} from '../state/historyState.js';

/**
 * Initialize and render the history page
 */
export function renderHistoryPage(): void {
  renderDateSidebar();
  renderOverview();
  renderHourSelector();
  renderInventory();
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

  // Add click handlers
  sidebarDates.querySelectorAll('.history-sidebar-date-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const date = (btn as HTMLElement).dataset.date;
      if (date) {
        setSelectedDate(date);
        setSelectedHour(null); // Reset hour selection when date changes
        renderHistoryPage();
      }
    });
  });
}

/**
 * Render the overview section
 */
function renderOverview(): void {
  // TODO: Calculate and display overview stats
  const data = getCurrentHistoryData();
  const selectedHour = getSelectedHour();

  // Placeholder values
  const totalDuration = 0;
  const fePerHour = 0;
  const totalFe = 0;
  const bucketsCount = data?.buckets.length || 0;

  // Update DOM elements
  const totalDurationEl = document.getElementById('historyTotalDuration');
  const fePerHourEl = document.getElementById('historyFePerHour');
  const totalFeEl = document.getElementById('historyTotalFe');
  const bucketsCountEl = document.getElementById('historyBucketsCount');
  const bucketsItem = document.getElementById('historyBucketsItem');

  if (totalDurationEl) {
    totalDurationEl.textContent = formatDuration(totalDuration);
  }
  if (fePerHourEl) {
    fePerHourEl.textContent = formatNumber(fePerHour);
  }
  if (totalFeEl) {
    totalFeEl.textContent = formatNumber(totalFe);
  }
  if (bucketsCountEl) {
    bucketsCountEl.textContent = bucketsCount.toString();
  }
  if (bucketsItem) {
    // Show buckets count only when no specific hour is selected
    bucketsItem.style.display = selectedHour === null ? 'flex' : 'none';
  }

  // TODO: Render graph in background
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
    return;
  }

  // Create options for each hour bucket
  const options = ['<option value="">All Hours</option>'];
  
  data.buckets.forEach(bucket => {
    const hourLabel = formatHour(bucket.hour);
    const option = `<option value="${bucket.hour}" ${bucket.hour === selectedHour ? 'selected' : ''}>${hourLabel}</option>`;
    options.push(option);
  });

  hourSelect.innerHTML = options.join('');

  // Add change handler
  hourSelect.addEventListener('change', () => {
    const value = hourSelect.value;
    setSelectedHour(value === '' ? null : parseInt(value, 10));
    renderHistoryPage();
  });
}

/**
 * Render the inventory list
 */
function renderInventory(): void {
  const inventoryContent = document.getElementById('historyInventoryContent');
  if (!inventoryContent) return;

  const data = getCurrentHistoryData();
  const selectedHour = getSelectedHour();

  if (!data) {
    inventoryContent.innerHTML = '<div class="history-empty-state">Select a date to view inventory</div>';
    return;
  }

  // Get items for selected hour or all hours
  let items: { [baseId: string]: { name: string; quantity: number; price: number; total: number; iconPath?: string } } = {};

  const bucketsToProcess = selectedHour !== null
    ? data.buckets.filter(b => b.hour === selectedHour)
    : data.buckets;

  bucketsToProcess.forEach(bucket => {
    bucket.items.forEach(item => {
      if (!items[item.baseId]) {
        items[item.baseId] = {
          name: item.name,
          quantity: 0,
          price: item.price,
          total: 0,
          iconPath: item.iconPath
        };
      }
      items[item.baseId].quantity += item.quantity;
      items[item.baseId].total += item.total;
    });
  });

  if (Object.keys(items).length === 0) {
    inventoryContent.innerHTML = '<div class="history-empty-state">No items found</div>';
    return;
  }

  // Render inventory items
  inventoryContent.innerHTML = Object.entries(items)
    .map(([baseId, item]) => {
      const iconPath = `../../assets/${baseId}.webp`;
      return `
        <div class="history-inventory-item">
          <div class="history-inventory-item-name">
            <img src="${iconPath}" alt="${item.name}" class="history-inventory-item-icon" onerror="this.style.display='none'">
            <span>${item.name}</span>
          </div>
          <div class="history-inventory-item-quantity">${formatNumber(item.quantity)}</div>
          <div class="history-inventory-item-price">${formatNumber(item.price)}</div>
          <div class="history-inventory-item-total">${formatNumber(item.total)}</div>
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
 * Format hour number to readable format
 */
function formatHour(hour: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour}:00 ${period}`;
}

/**
 * Format number with commas
 */
function formatNumber(num: number): string {
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
