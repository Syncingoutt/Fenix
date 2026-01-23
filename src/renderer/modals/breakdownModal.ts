// Breakdown modal for hourly tracking results

import { HourlyBucket } from '../types.js';
import { getHourlyBuckets, getHourlyElapsedSeconds, setHourlyBuckets, setHourlyStartSnapshot, setHourlyHistory, setCurrentHourStartValue, setIncludedItems, setPreviousQuantities, setHourlyUsage, setHourlyPurchases } from '../state/wealthState.js';
import { formatTime } from '../utils/formatting.js';
import { renderHourGraph } from '../graph/hourGraphRenderer.js';

let renderInventory: () => void;
let renderBreakdown: () => void;

export function initBreakdownModal(
  inventoryRenderer: () => void,
  breakdownRenderer: () => void
): void {
  renderInventory = inventoryRenderer;
  renderBreakdown = breakdownRenderer;
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
  const hourlyElapsedSeconds = getHourlyElapsedSeconds();
  
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
