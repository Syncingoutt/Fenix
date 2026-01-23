// Usage section rendering (for compass/beacon tracking)

import { getDisplayItems } from './inventoryLogic.js';
import {
  getWealthMode,
  getIsHourlyActive,
  getHourlyStartSnapshot,
  getIncludedItems
} from '../state/wealthState.js';
import { getCurrentItems, getItemDatabase } from '../state/inventoryState.js';

/**
 * Render the usage section showing compass/beacon consumption
 */
export function renderUsageSection(): void {
  const usageSection = document.getElementById('usageSection');
  const usageContent = document.getElementById('usageContent');
  
  if (!usageSection || !usageContent) return;
  
  const wealthMode = getWealthMode();
  const isHourlyActive = getIsHourlyActive();
  const includedItems = getIncludedItems();
  
  // Only show in hourly mode when active and items are being tracked
  if (wealthMode === 'hourly' && isHourlyActive && includedItems.size > 0) {
    usageSection.style.display = 'block';
    
    const currentItems = getCurrentItems();
    const hourlyStartSnapshot = getHourlyStartSnapshot();
    const itemDatabase = getItemDatabase();
    
    const usageItems: Array<{ baseId: string; itemName: string; netUsage: number; price: number }> = [];
    
    for (const baseId of includedItems) {
      // Always get the latest item data and price from currentItems (prices can be updated during session)
      const item = currentItems.find(i => i.baseId === baseId);
      const currentQty = item ? item.totalQuantity : 0;
      const startQty = hourlyStartSnapshot.get(baseId) || 0;
      
      // Calculate net usage for display: (startQty - currentQty)
      // Positive means used, negative means bought
      const netUsage = startQty - currentQty;
      
      if (!item) {
        // If item not in inventory, try to get from database
        const itemData = itemDatabase[baseId];
        if (itemData) {
          usageItems.push({
            baseId,
            itemName: itemData.name,
            netUsage,
            price: 0 // No price if not in inventory
          });
        }
        continue;
      }
      
      // Always include tracked items, even if netUsage is 0
      // Use current price (may have been updated during session)
      usageItems.push({
        baseId,
        itemName: item.itemName,
        netUsage,
        price: item.price || 0 // Always use current price, not cached
      });
    }
    
    if (usageItems.length === 0) {
      usageSection.style.display = 'none';
      return;
    }
  
    // Sort by total cost (highest absolute value first)
    // Selected compasses/beacons: use raw price without tax for sorting
    usageItems.sort((a, b) => {
      const totalA = a.price > 0 ? Math.abs(a.netUsage * a.price) : 0;
      const totalB = b.price > 0 ? Math.abs(b.netUsage * b.price) : 0;
      return totalB - totalA;
    });
    
    let totalUsageCost = 0;
    
    usageContent.innerHTML = usageItems.map(({ baseId, itemName, netUsage, price }) => {
      // Selected compasses/beacons: do NOT apply tax (use raw price)
      const unitPrice = price > 0 ? price : 0;
      const totalPrice = price > 0 ? Math.abs(netUsage) * price : 0;
      
      // Calculate contribution to total (negative if used more, positive if gained more)
      if (netUsage > 0) {
        // Used more: subtract from total
        totalUsageCost -= totalPrice; // No tax
      } else if (netUsage < 0) {
        // Gained more: add to total
        totalUsageCost += totalPrice; // No tax
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
