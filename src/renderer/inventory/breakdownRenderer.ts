// Breakdown section rendering

import { getDisplayItems } from './inventoryLogic.js';
import { getItemDatabase, getSelectedGroupFilter, setSelectedGroupFilter, getCurrentSortBy, getCurrentSortOrder } from '../state/inventoryState.js';
import { applyTax } from '../utils/tax.js';
import { passesPriceFilters } from '../utils/filters.js';
import { formatGroupName } from '../utils/formatting.js';

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
 * Render the breakdown section showing group totals
 */
export function renderBreakdown(renderInventoryFn: () => void): void {
  const breakdownEl = document.getElementById('breakdown');
  if (!breakdownEl) return;

  // Use getDisplayItems() to respect current mode (realtime vs hourly)
  const itemsToUse = getDisplayItems();
  const itemDatabase = getItemDatabase();
  const selectedGroupFilter = getSelectedGroupFilter();

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
          setSelectedGroupFilter(null);
        } else {
          setSelectedGroupFilter(group);
        }
        // Re-render to update selected state and filtered items
        renderBreakdown(renderInventoryFn);
        renderInventoryFn();
      }
    });
  });
}

/**
 * Update sort indicators in the UI
 */
export function updateSortIndicators(): void {
  const currentSortBy = getCurrentSortBy();
  const currentSortOrder = getCurrentSortOrder();
  
  document.querySelectorAll('[data-sort]').forEach(el => {
    const sortType = (el as HTMLElement).dataset.sort;
    if (!sortType) return;
    
    // Set content - include help icon for Price column
    if (sortType === 'priceUnit') {
      (el as HTMLElement).innerHTML = 'Price' + PRICE_HELP_ICON_HTML;
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
