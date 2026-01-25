// Usage section rendering (for compass/beacon tracking)

import { getDisplayItems } from './inventoryLogic.js';
import {
  getWealthMode,
  getIsHourlyActive,
  getHourlyStartSnapshot,
  getIncludedItems,
  getHourlyUsage,
  getHourlyPurchases
} from '../state/wealthState.js';
import { getCurrentItems, getItemDatabase } from '../state/inventoryState.js';

/**
 * Render the usage section showing compass/beacon consumption
 */
export function renderUsageSection(): void {
  console.log('[Usage Section] renderUsageSection() called');
  
  const usageSection = document.getElementById('usageSection');
  const usageContent = document.getElementById('usageContent');
  
  if (!usageSection || !usageContent) {
    console.log('[Usage Section] ERROR: usageSection or usageContent not found in DOM');
    return;
  }
  
  const wealthMode = getWealthMode();
  const isHourlyActive = getIsHourlyActive();
  const includedItems = getIncludedItems();
  
  console.log(`[Usage Section] Rendering. wealthMode=${wealthMode}, isHourlyActive=${isHourlyActive}, includedItems.size=${includedItems.size}`);
  console.log(`[Usage Section] Included items:`, Array.from(includedItems));
  
  // Only show in hourly mode when active and items are being tracked
  if (wealthMode === 'hourly' && isHourlyActive) {
    if (includedItems.size === 0) {
      console.log('[Usage Section] WARNING: includedItems is empty! Section will not show.');
      usageSection.style.display = 'none';
      return;
    }
    const currentItems = getCurrentItems();
    const hourlyStartSnapshot = getHourlyStartSnapshot();
    const hourlyUsage = getHourlyUsage();
    const hourlyPurchases = getHourlyPurchases();
    const itemDatabase = getItemDatabase();
    
    console.log(`[Usage Section] hourlyUsage map:`, Array.from(hourlyUsage.entries()));
    console.log(`[Usage Section] hourlyPurchases map:`, Array.from(hourlyPurchases.entries()));
    
    const usageItems: Array<{ baseId: string; itemName: string; netUsage: number; price: number }> = [];
    
    for (const baseId of includedItems) {
      // Get tracked usage and purchases (purchases includes drops obtained in map)
      const used = hourlyUsage.get(baseId) || 0;
      const bought = hourlyPurchases.get(baseId) || 0;
      
      console.log(`[Usage Section] Checking ${baseId}: used=${used}, bought=${bought}`);
      
      // Only show items that have been used at least once
      // If an item has been used, show it in usage section (including any drops obtained)
      // If an item has never been used, don't show here (drops go to main inventory)
      if (used === 0) {
        console.log(`[Usage Section] Skipping ${baseId} - never used, drops go to main inventory`);
        continue;
      }
      
      // Calculate net usage: positive = used more than obtained, negative = obtained more than used
      const netUsage = used - bought;
      
      // Always get the latest item data and price from currentItems (prices can be updated during session)
      const item = currentItems.find(i => i.baseId === baseId);
      
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
      
      // Use current price (may have been updated during session)
      usageItems.push({
        baseId,
        itemName: item.itemName,
        netUsage,
        price: item.price || 0 // Always use current price, not cached
      });
    }
    
    // Show section if there are items to display
    console.log(`[Usage Section] Total usage items found: ${usageItems.length}`);
    if (usageItems.length === 0) {
      console.log(`[Usage Section] Hiding section - no usage items`);
      usageSection.style.display = 'none';
      return;
    }
    
    // Show the section
    console.log(`[Usage Section] Showing section with ${usageItems.length} items`);
    usageSection.style.display = 'block';
  
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
      
      // Calculate contribution to total
      if (netUsage > 0) {
        // Used more than obtained: subtract from total (negative impact)
        totalUsageCost -= totalPrice; // No tax
      } else if (netUsage < 0) {
        // Obtained more than used: add to total (positive impact, but still in usage section since item was used)
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
