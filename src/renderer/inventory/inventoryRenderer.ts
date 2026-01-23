// Inventory list rendering

import { InventoryItem } from '../types.js';
import { getSortedAndFilteredItems, getPageLabel } from './inventoryLogic.js';
import { getWealthMode, getIsHourlyActive } from '../state/wealthState.js';
import { applyTax } from '../utils/tax.js';
import { getPriceAgeClass } from '../utils/formatting.js';
import { renderUsageSection } from './usageRenderer.js';
import { updateSortIndicators } from './breakdownRenderer.js';

/**
 * Render the inventory list
 */
export function renderInventory(): void {
  // Render usage section first
  renderUsageSection();
  
  const container = document.getElementById('inventory');
  if (!container) return;

  const items = getSortedAndFilteredItems();
  const wealthMode = getWealthMode();
  const isHourlyActive = getIsHourlyActive();

  if (items.length === 0) {
    const message = (wealthMode === 'hourly' && isHourlyActive) 
      ? 'No new items gained yet' 
      : 'No items match your filters';
    container.innerHTML = `<div class="loading">${message}</div>`;
    return;
  }

  container.innerHTML = items
    .map(item => {
      const totalValue = item.price !== null ? item.price * item.totalQuantity : null;
      // Apply tax to total value (but not to base price)
      const totalValueAfterTax = totalValue !== null ? applyTax(totalValue, item.baseId) : null;
      const pageLabel = getPageLabel(item);

      const priceAgeClass = getPriceAgeClass(item.priceTimestamp);
      
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
          <div class="price-single ${item.price === null ? 'no-price' : ''} ${priceAgeClass}">
            ${item.price !== null ? item.price.toFixed(2) : 'Not Set'}
          </div>
          ${totalValueAfterTax !== null ? `<div class="price-total ${priceAgeClass}">${totalValueAfterTax.toFixed(2)}</div>` : ''}
        </div>
      </div>
    `;
    })
    .join('');
  
  // Update sort indicators after rendering
  updateSortIndicators();
}
