// Usage section rendering (for compass/beacon tracking)

import {
  getWealthMode,
  getIsHourlyActive,
  getIncludedItems,
  getHourlyUsage,
  getHourlyStartSnapshot
} from '../state/wealthState.js';
import { getCurrentItems, getItemDatabase, getPriceCache } from '../state/inventoryState.js';

/**
 * Render the usage section showing compass/beacon consumption
 */
export function renderUsageSection(): void {
  const usageSection = document.getElementById('usageSection');
  const usageContent = document.getElementById('usageContent');
  
  if (!usageSection || !usageContent) {
    return;
  }
  
  const wealthMode = getWealthMode();
  const isHourlyActive = getIsHourlyActive();
  const includedItems = getIncludedItems();
  
  // Only show in hourly mode when active and items are being tracked
  if (wealthMode === 'hourly' && isHourlyActive && includedItems.size > 0) {
    usageSection.style.display = 'block';

    const currentItems = getCurrentItems();
    const hourlyUsage = getHourlyUsage();
    const hourlyStartSnapshot = getHourlyStartSnapshot();
    const itemDatabase = getItemDatabase();
    const priceCache = getPriceCache();

    const usageItems: Array<{ baseId: string; itemName: string; netUsage: number; price: number }> = [];

    for (const baseId of includedItems) {
      const used = hourlyUsage.get(baseId) || 0;

      // Only show items that were actually used this session.
      if (used <= 0) {
        continue;
      }

      const item = currentItems.find(i => i.baseId === baseId);
      const currentQty = item ? item.totalQuantity : 0;
      const startQty = hourlyStartSnapshot.get(baseId) || 0;
      const netUsage = startQty - currentQty;

      // Get price from price_cache.json instead of inventory
      // This ensures we have prices even if the user doesn't have the item or runs out
      const priceCacheEntry = priceCache[baseId];
      const price = priceCacheEntry?.price ?? 0;

      const dbEntry = itemDatabase[baseId];
      if (!dbEntry) {
        continue;
      }

      const itemName = item?.itemName ?? dbEntry.name;

      usageItems.push({
        baseId,
        itemName,
        netUsage,
        price
      });
    }
    
    if (usageItems.length === 0) {
      usageSection.style.display = 'none';
      return;
    }
  
    // Sort by total cost (highest absolute value first)
    // Selected compasses/beacons: use raw price without tax for sorting
    usageItems.sort((a, b) => {
      const totalA = a.price > 0 ? Math.abs(a.netUsage) * a.price : 0;
      const totalB = b.price > 0 ? Math.abs(b.netUsage) * b.price : 0;
      return totalB - totalA;
    });
    
    let totalUsageCost = 0;
    
    usageContent.innerHTML = usageItems.map(({ baseId, itemName, netUsage, price }) => {
      // Selected compasses/beacons: do NOT apply tax (use raw price)
      const unitPrice = price > 0 ? price : 0;
      const totalPrice = price > 0 ? Math.abs(netUsage) * price : 0;
      
      // Net impact can rise/fall as used items are also picked up.
      if (netUsage > 0) {
        totalUsageCost -= totalPrice;
      } else if (netUsage < 0) {
        totalUsageCost += totalPrice;
      }
      
      const quantityPrefix = netUsage > 0 ? '-' : netUsage < 0 ? '+' : '';
      const quantityDisplay = netUsage !== 0 ? `${quantityPrefix}${Math.abs(netUsage)}` : '0';
      const totalPrefix = netUsage > 0 ? '-' : netUsage < 0 ? '+' : '';
      const totalDisplay = price > 0 && netUsage !== 0 ? `${totalPrefix}${totalPrice.toFixed(2)} FE` : '- FE';
      
      return `
        <div class="item-row">
          <div class="item-name">
            <img src="../../assets/${baseId}.webp" 
                 alt="${itemName}" 
                 class="item-icon"
                 onerror="this.style.display='none'">
            <div class="item-name-content">
              <div class="item-name-text">${itemName}</div>
            </div>
          </div>
          <div class="item-quantity">${quantityDisplay}</div>
          <div class="item-price">
            <div class="price-single ${price === 0 ? 'no-price' : ''}">
              ${price > 0 ? unitPrice.toFixed(2) : 'Not Set'}
            </div>
            ${price > 0 && netUsage !== 0 ? `<div class="price-total">${totalDisplay}</div>` : ''}
          </div>
        </div>
      `;
    }).join('') + (usageItems.length > 0 && totalUsageCost !== 0 ? `
      <div class="usage-footer">
        <div class="usage-footer-label">Net Impact:</div>
        <div class="usage-footer-total">${totalUsageCost > 0 ? '+' : ''}${totalUsageCost.toFixed(2)} FE</div>
      </div>
    ` : '');
  } else {
    usageSection.style.display = 'none';
  }
}
