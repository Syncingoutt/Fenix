// Wealth calculation logic

import { InventoryItem } from '../types.js';
import { FLAME_ELEMENTIUM_ID } from '../constants.js';
import { getCurrentItems, getMinPriceFilter, getMaxPriceFilter } from '../state/inventoryState.js';
import { getHourlyStartSnapshot, getIncludedItems, getHourlyAHSales, getHourlyPurchases, getHourlyUsage } from '../state/wealthState.js';
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
  
  const hourlyAHSales = getHourlyAHSales();
  const hourlyPurchases = getHourlyPurchases();
  const hourlyUsage = getHourlyUsage();
  
  for (const baseId of includedItems) {
    // Always get the latest price from currentItems (prices can be updated during session)
    const item = currentItems.find(i => i.baseId === baseId);
    if (!item || item.price === null) continue;
    
    const itemsGained = hourlyPurchases.get(baseId) || 0;
    const itemsUsed = hourlyUsage.get(baseId) || 0;
    const ahSalesQty = hourlyAHSales.get(baseId) || 0;
    
    // Calculate net impact same as usage section: used - bought
    // Account for AH sales: items sold in AH reduce the effective "bought" count
    const effectiveBought = Math.max(0, itemsGained - ahSalesQty);
    const netUsage = itemsUsed - effectiveBought;
    
    // Apply net impact directly to wealth
    // Positive netUsage (used > bought) = cost (negative impact) → subtract
    // Negative netUsage (bought > used) = gain (positive impact) → add
    const netValue = netUsage * item.price;
    gainedValue -= netValue;
  }
  
  return gainedValue; // Allow negative values
}
