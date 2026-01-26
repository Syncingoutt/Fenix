import { ParsedLogEntry } from './logParser';
import { ItemDatabase, PriceCache, PriceCacheEntry, DailyPricePoint } from './database';

export interface InventoryItem {
  itemName: string;
  totalQuantity: number;
  baseId: string;
  price: number | null;
  priceTimestamp: number | null; // Unix timestamp in milliseconds when price was last updated
  instances: number;
  lastUpdated: string;
  pageId: number | null;
  slotId: number | null;
}

export class InventoryManager {
  private inventory = new Map<string, InventoryItem>();
  private priceCache = new Map<string, PriceCacheEntry>();

  constructor(private itemDatabase: ItemDatabase, initialPriceCache: PriceCache = {}) {
    // Load initial price cache
    for (const [baseId, entry] of Object.entries(initialPriceCache)) {
      this.priceCache.set(baseId, entry);
    }
  }

  buildInventory(logEntries: ParsedLogEntry[]): Map<string, InventoryItem> {
    const instanceMap = new Map<string, ParsedLogEntry>();
    const deletedItems = new Set<string>();
    
    // Track deleted items first
    for (const entry of logEntries) {
      if (entry.action === 'Delete') {
        deletedItems.add(entry.fullId);
        continue;
      }
      instanceMap.set(entry.fullId, entry);
    }
    
    // Remove deleted items from instanceMap
    for (const deletedId of deletedItems) {
      instanceMap.delete(deletedId);
    }

    this.inventory.clear();

    for (const entry of instanceMap.values()) {
      const itemData = this.itemDatabase[entry.baseId];
      
      // Skip untradable items (default to tradable if not specified for backwards compatibility)
      if (itemData && itemData.tradable === false) {
        continue;
      }
      
      const itemName = itemData ? itemData.name : `Unknown Item (${entry.baseId})`;

      if (this.inventory.has(entry.baseId)) {
        const existing = this.inventory.get(entry.baseId)!;
        existing.totalQuantity += entry.bagNum;
        existing.instances += 1;
        if (entry.timestamp > existing.lastUpdated) {
          existing.lastUpdated = entry.timestamp;
        }
      } else {
        const cachedEntry = this.priceCache.get(entry.baseId);
        const cachedPrice = cachedEntry ? cachedEntry.price : null;
        const cachedTimestamp = cachedEntry ? cachedEntry.timestamp : null;
        
        this.inventory.set(entry.baseId, {
          itemName,
          totalQuantity: entry.bagNum,
          baseId: entry.baseId,
          price: cachedPrice,
          priceTimestamp: cachedTimestamp,
          instances: 1,
          lastUpdated: entry.timestamp,
          pageId: entry.pageId,
          slotId: entry.slotId
        });
      }
    }

    return this.inventory;
  }

  updatePrice(baseId: string, price: number, listingCount?: number, timestamp: number = Date.now()): void {

    // Build or update per-6-hour history (last 7 days = 28 points)
    // Round timestamp down to nearest 6-hour interval
    const bucket = Math.floor(timestamp / (6 * 60 * 60 * 1000)) * (6 * 60 * 60 * 1000);
    const sixHourKey = new Date(bucket).toISOString().slice(0, 13) + ':00:00';

    let history: DailyPricePoint[] = [];
    const existing = this.priceCache.get(baseId);

    if (existing?.history && Array.isArray(existing.history)) {
      history = [...existing.history];
    }

    const idx = history.findIndex(point => point.date === sixHourKey);
    if (idx >= 0) {
      history[idx] = { date: sixHourKey, price };
    } else {
      history.push({ date: sixHourKey, price });
    }

    // Sort by date ascending and keep only the last 28 points (7 days * 4 updates per day)
    history.sort((a, b) => a.date.localeCompare(b.date));
    if (history.length > 28) {
      history = history.slice(history.length - 28);
    }

    const entry: PriceCacheEntry = {
      price,
      timestamp,
      ...(listingCount !== undefined && { listingCount }),
      ...(history.length > 0 && { history })
    };

    this.priceCache.set(baseId, entry);
    
    if (this.inventory.has(baseId)) {
      const item = this.inventory.get(baseId)!;
      item.price = price;
      item.priceTimestamp = timestamp;
    }
  }

  getInventory(): InventoryItem[] {
    return Array.from(this.inventory.values())
      .filter(item => {
        // Filter out untradable items (default to tradable if not specified)
        const itemData = this.itemDatabase[item.baseId];
        return !itemData || itemData.tradable !== false;
      })
      .sort((a, b) => {
        const nameCompare = a.itemName.localeCompare(b.itemName);
        if (nameCompare !== 0) return nameCompare;
        return a.baseId.localeCompare(b.baseId);
      });
  }

  getInventoryMap(): Map<string, InventoryItem> {
    return this.inventory;
  }

  getPriceCacheAsObject(): PriceCache {
    const obj: PriceCache = {};
    this.priceCache.forEach((entry, baseId) => {
      obj[baseId] = entry;
    });
    return obj;
  }
}