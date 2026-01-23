// Inventory filtering and sorting logic

import { InventoryItem } from '../types.js';
import { FLAME_ELEMENTIUM_ID } from '../constants.js';
import {
  getCurrentItems,
  getItemDatabase,
  getSearchQuery,
  getSelectedGroupFilter,
  getCurrentSortBy,
  getCurrentSortOrder
} from '../state/inventoryState.js';
import {
  getWealthMode,
  getIsHourlyActive,
  getHourlyStartSnapshot,
  getIncludedItems
} from '../state/wealthState.js';
import { applyTax } from '../utils/tax.js';
import { passesPriceFilters } from '../utils/filters.js';

/**
 * Get items to display based on current mode (realtime vs hourly)
 */
export function getDisplayItems(): InventoryItem[] {
  const currentItems = getCurrentItems();
  const wealthMode = getWealthMode();
  const isHourlyActive = getIsHourlyActive();
  
  if (wealthMode === 'hourly' && isHourlyActive) {
    const hourlyStartSnapshot = getHourlyStartSnapshot();
    const includedItems = getIncludedItems();
    
    // In hourly mode, show items gained since start
    // Exclude ONLY the compasses/beacons that the user selected (includedItems)
    // Other compasses/beacons that weren't selected will still show in the item list
    // Always show Flame Elementium (FE) even if gainedQty is 0 or negative
    return currentItems
      .filter(item => !includedItems.has(item.baseId)) // Exclude only selected compasses/beacons
      .map(item => {
        const currentQty = item.totalQuantity;
        const startQty = hourlyStartSnapshot.get(item.baseId) || 0;
        
        // Show gained quantity
        const gainedQty = currentQty - startQty;
        return {
          ...item,
          totalQuantity: gainedQty
        };
      })
      .filter(item => {
        // Always show Flame Elementium (FE) even if gainedQty is 0 or negative
        if (item.baseId === FLAME_ELEMENTIUM_ID) return true;
        // For other items, only show if quantity > 0
        return item.totalQuantity > 0;
      });
  }
  
  // In realtime mode or when hourly isn't active, show all items
  return currentItems;
}

/**
 * Get sorted and filtered items based on current filters and sort settings
 */
export function getSortedAndFilteredItems(): InventoryItem[] {
  const itemsToDisplay = getDisplayItems();
  const searchQuery = getSearchQuery();
  const selectedGroupFilter = getSelectedGroupFilter();
  const itemDatabase = getItemDatabase();
  const currentSortBy = getCurrentSortBy();
  const currentSortOrder = getCurrentSortOrder();

  let filtered = itemsToDisplay.filter(item => {
    // Search filter
    if (searchQuery && !item.itemName.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    
    // Group filter
    if (selectedGroupFilter !== null) {
      const itemData = itemDatabase[item.baseId];
      const itemGroup = itemData?.group || 'none';
      if (itemGroup !== selectedGroupFilter) {
        return false;
      }
    }
    
    // Price filter is handled by passesPriceFilters
    return passesPriceFilters(item);
  });

  filtered.sort((a, b) => {
    let comparison = 0;
    if (currentSortBy === 'priceUnit') {
      const priceA = a.price ?? -1;
      const priceB = b.price ?? -1;
      comparison = priceA - priceB;
    } else if (currentSortBy === 'priceTotal') {
      const totalA = applyTax((a.price ?? 0) * a.totalQuantity, a.baseId);
      const totalB = applyTax((b.price ?? 0) * b.totalQuantity, b.baseId);
      comparison = totalA - totalB;
    }
    return currentSortOrder === 'asc' ? comparison : -comparison;
  });

  return filtered;
}

/**
 * Get page label for an item (e.g., "P1:5")
 */
export function getPageLabel(item: InventoryItem): string {
  if (item.pageId === null || item.slotId === null) return '';
  const pagePrefix = item.pageId === 102 ? 'P1' : item.pageId === 103 ? 'P2' : `P${item.pageId}`;
  const slotNumber = item.slotId + 1;
  return `${pagePrefix}:${slotNumber}`;
}
