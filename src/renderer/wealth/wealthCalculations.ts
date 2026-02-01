// Wealth calculation logic

import { InventoryItem } from '../types.js';
import { FLAME_ELEMENTIUM_ID } from '../constants.js';
import { getCurrentItems, getMinPriceFilter, getMaxPriceFilter, getPriceCache } from '../state/inventoryState.js';
import { getHourlyStartSnapshot, getIncludedItems } from '../state/wealthState.js';
import { applyTax } from '../utils/tax.js';
import { passesPriceFilters } from '../utils/filters.js';

/**
 * Calculate current total value of all items in inventory
 */
export function getCurrentTotalValue(): number {
  const currentItems = getCurrentItems();
  
  return currentItems.reduce((sum, item) => {
    // Skip items that don't pass price filters
    if (!passesPriceFilters(item)) {
      return sum;
    }
    
    if (item.price !== null) {
      const totalValue = item.totalQuantity * item.price;
      // Apply tax to total (but not to base price)
      return sum + applyTax(totalValue, item.baseId);
    }
    return sum;
  }, 0);
}

/**
 * Calculate wealth gained since hourly tracking started
 */
export function getHourlyWealthGain(): number {
  const currentItems = getCurrentItems();
  const hourlyStartSnapshot = getHourlyStartSnapshot();
  const includedItems = getIncludedItems();
  const minPriceFilter = getMinPriceFilter();
  const maxPriceFilter = getMaxPriceFilter();
  
  let gainedValue = 0;
  
  // Calculate gains from all items
  // Exclude ONLY the compasses/beacons that the user selected (includedItems)
  // Other compasses/beacons are treated like normal items
  for (const item of currentItems) {
    if (item.price === null) continue;
    
    // Skip only the selected compasses/beacons (they're handled separately)
    if (includedItems.has(item.baseId)) {
      continue;
    }
    
    const currentQty = item.totalQuantity;
    const startQty = hourlyStartSnapshot.get(item.baseId) || 0;
    const gainedQty = currentQty - startQty;
    
    // For Flame Elementium (FE), always count the change (can be negative)
    // For other items, only count gains (positive changes)
    if (item.baseId === FLAME_ELEMENTIUM_ID) {
      // FE: count change (can be negative, e.g., 200 - 300 = -100)
      const feChange = gainedQty * item.price; // price is 1 for FE
      gainedValue += feChange; // Can be negative
    } else {
      // Other items: only count gains
      if (gainedQty <= 0) continue; // No gain, skip
      
      const itemValueToCheck = gainedQty * item.price;
      const itemValueAfterTax = applyTax(itemValueToCheck, item.baseId);
      
      // Check if gained value passes price filters
      if (minPriceFilter !== null && itemValueAfterTax < minPriceFilter) {
        continue;
      }
      if (maxPriceFilter !== null && itemValueAfterTax > maxPriceFilter) {
        continue;
      }
      
      // Count gained value
      gainedValue += itemValueAfterTax;
    }
  }
  
  // Handle tracked compasses/beacons: net usage affects wealth
  // netUsage = startQty - currentQty
  // netUsage > 0: used items → subtract cost (negative impact)
  // netUsage < 0: bought items → add value (positive impact)
  // Selected compasses/beacons: do NOT apply tax (use raw price)

  const priceCache = getPriceCache();

  for (const baseId of includedItems) {
    const currentQtyItem = currentItems.find(i => i.baseId === baseId);
    const currentQty = currentQtyItem ? currentQtyItem.totalQuantity : 0;
    const startQty = hourlyStartSnapshot.get(baseId) || 0;
    const netUsage = startQty - currentQty; // Calculate net usage

    if (netUsage === 0) continue;

    // Get price from price_cache.json instead of inventory
    // This ensures we have prices even if the user doesn't have the item or runs out
    const priceCacheEntry = priceCache[baseId];
    if (!priceCacheEntry || priceCacheEntry.price === undefined || priceCacheEntry.price === null) continue;

    const value = Math.abs(netUsage) * priceCacheEntry.price;

    if (netUsage > 0) {
      // Used items: subtract cost (negative impact on FE)
      gainedValue -= value;
    } else {
      // Bought items: add value (positive impact on FE)
      gainedValue += value;
    }
  }
  
  return gainedValue; // Allow negative values
}
