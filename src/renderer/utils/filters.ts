// Filtering utilities

import { InventoryItem } from '../types.js';
import { getMinPriceFilter, getMaxPriceFilter } from '../state/inventoryState.js';
import { applyTax } from './tax.js';

/**
 * Check if an item passes the current price filters
 */
export function passesPriceFilters(item: InventoryItem): boolean {
  const minPriceFilter = getMinPriceFilter();
  const maxPriceFilter = getMaxPriceFilter();
  
  if (item.price === null) {
    // Items without price are excluded if min price is set
    if (minPriceFilter !== null && minPriceFilter > 0) return false;
    // Items without price pass max filter
    return true;
  }
  
  const totalValue = item.price * item.totalQuantity;
  const totalValueAfterTax = applyTax(totalValue, item.baseId);
  
  // Min price filter
  if (minPriceFilter !== null && totalValueAfterTax < minPriceFilter) {
    return false;
  }
  
  // Max price filter
  if (maxPriceFilter !== null && totalValueAfterTax > maxPriceFilter) {
    return false;
  }
  
  return true;
}
