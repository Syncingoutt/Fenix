// Inventory list rendering

import { InventoryItem } from '../types.js';
import { getSortedAndFilteredItems } from './inventoryLogic.js';
import { getWealthMode, getIsHourlyActive } from '../state/wealthState.js';
import { getCurrentSortBy, getCurrentSortOrder, isItemCountEnabled } from '../state/inventoryState.js';
import { applyTax } from '../utils/tax.js';
import { getPriceAgeClass } from '../utils/formatting.js';
import { renderUsageSection } from './usageRenderer.js';
import { FLAME_ELEMENTIUM_ID } from '../constants.js';

const PRICE_HELP_ICON_HTML = `
<span class="price-help-icon">
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
    <circle cx="8" cy="8" r="6.5"/>
    <text x="8" y="11.5" text-anchor="middle" font-size="9" font-weight="600" fill="currentColor" stroke="none">i</text>
  </svg>
  <span class="price-help-tooltip">
    <strong>Price Color Guide</strong><br>
    <span style="color: #fff;">● White</span> = Fresh (&lt; 3 days)<br>
    <span style="color: #DE5C0B;">● Orange</span> = Stale (3-7 days)<br>
    <span style="color: #982104;">● Dark Orange</span> = Very stale (7+ days)
  </span>
</span>`;

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

  const CHECKED_SVG = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 6L5 9L10 3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  container.innerHTML = items
    .map(item => {
      const totalValue = item.price !== null ? item.price * item.totalQuantity : null;
      // Apply tax to total value (but not to base price)
      const totalValueAfterTax = totalValue !== null ? applyTax(totalValue, item.baseId) : null;

      const priceAgeClass = item.baseId === FLAME_ELEMENTIUM_ID ? '' : getPriceAgeClass(item.priceTimestamp);
      const counted = isItemCountEnabled(item.baseId);

      return `
      <div class="item-row">
        <div class="item-checkbox-cell">
          <button type="button" class="inventory-item-checkbox ${counted ? 'checked' : ''}" data-base-id="${item.baseId}" aria-label="${counted ? 'Exclude from total' : 'Include in total'}" title="${counted ? 'Exclude from total' : 'Include in total'}">${counted ? CHECKED_SVG : ''}</button>
        </div>
        <div class="item-name">
          <img src="../../assets/${item.baseId}.webp"
               alt="${item.itemName}"
               class="item-icon"
               onerror="this.style.display='none'">
          <div class="item-name-content">
            <div class="item-label">${item.itemName}</div>
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

/**
 * Update sort indicators in the UI
 */
export function updateSortIndicators(): void {
  const currentSortBy = getCurrentSortBy();
  const currentSortOrder = getCurrentSortOrder();
  
  // Scope sort indicators to inventory section only so we don't affect other pages (e.g. Prices)
  document.querySelectorAll('.inventory-section [data-sort]').forEach(el => {
    const sortType = (el as HTMLElement).dataset.sort;
    if (!sortType) return;
    
    // Set content - include help icon for Price column
    if (sortType === 'priceUnit') {
      (el as HTMLElement).innerHTML = 'Price' + PRICE_HELP_ICON_HTML;
    } else if (sortType === 'quantity') {
      (el as HTMLElement).textContent = 'Quantity';
    } else {
      (el as HTMLElement).textContent = 'Total';
    }
    
    // Remove existing sort classes
    (el as HTMLElement).classList.remove('sort-active', 'sort-asc', 'sort-desc');
    
    // Add appropriate classes for active sort
    if (sortType === currentSortBy) {
      (el as HTMLElement).classList.add('sort-active');
      (el as HTMLElement).classList.add(currentSortOrder === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
}
