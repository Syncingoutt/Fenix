// Breakdown section rendering

import { getDisplayItems } from './inventoryLogic.js';
import { getItemDatabase, getSelectedGroupFilter, setSelectedGroupFilter } from '../state/inventoryState.js';
import { applyTax } from '../utils/tax.js';
import { passesPriceFilters } from '../utils/filters.js';
import { formatGroupName } from '../utils/formatting.js';

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
    breakdownEl.innerHTML = '';
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
