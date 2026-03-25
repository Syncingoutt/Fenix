// Breakdown modal for hourly tracking results

import { getHourlyBuckets, setHourlyBuckets, setHourlyStartSnapshot, setHourlyHistory, setCurrentHourStartValue, setIncludedItems, setPreviousQuantities, setHourlyUsage, setHourlyPurchases } from '../state/wealthState.js';
import { renderHourGraph } from '../graph/hourGraphRenderer.js';

let renderInventory: () => void;
let renderBreakdown: () => void;
let exportButtonBound = false;

interface ExportSessionItem {
  itemName: string;
  itemQuantity: number;
}

interface ExportSessionData {
  duration: number;
  items: ExportSessionItem[];
}

function parseItemsFromInventorySnapshot(inventorySnapshot: string): ExportSessionItem[] {
  if (!inventorySnapshot) return [];

  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = inventorySnapshot;

  const rows = tempDiv.querySelectorAll('.item-row');
  const aggregated = new Map<string, number>();

  rows.forEach(row => {
    const labelEl = row.querySelector('.item-label');
    const quantityEl = row.querySelector('.item-quantity');
    const itemName = labelEl?.textContent?.trim() || '';
    const quantityText = quantityEl?.textContent?.replace(/,/g, '').trim() || '';
    const itemQuantity = Number(quantityText);

    if (!itemName || Number.isNaN(itemQuantity) || itemQuantity <= 0) return;

    aggregated.set(itemName, (aggregated.get(itemName) || 0) + itemQuantity);
  });

  return Array.from(aggregated.entries())
    .map(([itemName, itemQuantity]) => ({ itemName, itemQuantity }))
    .sort((a, b) => b.itemQuantity - a.itemQuantity);
}

function buildExportSessionData(): ExportSessionData | null {
  const hourlyBuckets = getHourlyBuckets();
  if (!hourlyBuckets.length) return null;

  const duration = hourlyBuckets.reduce((sum, bucket) => sum + (bucket.duration || 0), 0);
  const lastBucket = hourlyBuckets[hourlyBuckets.length - 1];
  const items = parseItemsFromInventorySnapshot(lastBucket.inventorySnapshot);

  return { duration, items };
}

function exportHourlySessionJson(): void {
  const exportData = buildExportSessionData();
  if (!exportData) return;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `hourly-session-${timestamp}.json`;
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(downloadUrl);
}

export function initBreakdownModal(
  inventoryRenderer: () => void,
  breakdownRenderer: () => void
): void {
  renderInventory = inventoryRenderer;
  renderBreakdown = breakdownRenderer;

  if (!exportButtonBound) {
    document.getElementById('exportSessionJson')?.addEventListener('click', exportHourlySessionJson);
    exportButtonBound = true;
  }
}

/**
 * Show the breakdown modal with hourly earnings
 */
export function showBreakdownModal(): void {
  const modal = document.getElementById('breakdownModal');
  const totalEl = document.getElementById('breakdownTotal');
  const hoursContainer = document.getElementById('breakdownHours');
  
  if (!modal || !totalEl || !hoursContainer) return;
  
  const hourlyBuckets = getHourlyBuckets();
  
  const totalEarnings = hourlyBuckets.reduce((sum, bucket) => sum + bucket.earnings, 0);
  
  // Animate total with count-up effect
  totalEl.textContent = `${totalEarnings.toFixed(2)}`;
  
  // Generate session cards
  hoursContainer.innerHTML = hourlyBuckets.map((bucket, index) => {
    return `
      <div class="hour-card">
        <div class="hour-header">
          <div class="hour-label">Session ${bucket.hourNumber}</div>
          <div class="hour-earnings">+${bucket.earnings.toFixed(2)}</div>
        </div>
        <canvas class="hour-graph" id="hourGraph${index}"></canvas>
      </div>
    `;
  }).join('');

  // Show modal
  modal.classList.add('active');

  // Render mini graphs for each session
  setTimeout(() => {
    hourlyBuckets.forEach((bucket, index) => {
      renderHourGraph(bucket, index);
    });
  }, 100);
}

/**
 * Close the breakdown modal and reset state
 */
export function closeBreakdownModal(): void {
  const modal = document.getElementById('breakdownModal');
  if (!modal) return;
  
  modal.classList.remove('active');
  
  // Reset everything
  setHourlyBuckets([]);
  setHourlyStartSnapshot(new Map());
  setHourlyHistory([]);
  setCurrentHourStartValue(0);
  setIncludedItems(new Set());
  setPreviousQuantities(new Map());
  setHourlyUsage(new Map());
  setHourlyPurchases(new Map());
  
  // Re-render to show all items again
  renderInventory();
  renderBreakdown();
}
