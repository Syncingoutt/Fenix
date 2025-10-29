import { ParsedLogEntry } from './logParser';
import { ItemDatabase, PriceCache } from './database';

export interface InventoryItem {
  itemName: string;
  totalQuantity: number;
  baseId: string;
  price: number | null;
  instances: number;
  lastUpdated: string;
  pageId: number | null;
  slotId: number | null;
}

export class InventoryManager {
  private inventory = new Map<string, InventoryItem>();
  private priceCache = new Map<string, number>();

  constructor(private itemDatabase: ItemDatabase, initialPriceCache: PriceCache = {}) {
    // Load initial price cache
    for (const [baseId, price] of Object.entries(initialPriceCache)) {
      this.priceCache.set(baseId, price);
    }
  }

  buildInventory(logEntries: ParsedLogEntry[]): Map<string, InventoryItem> {
    const instanceMap = new Map<string, ParsedLogEntry>();
    
    for (const entry of logEntries) {
      instanceMap.set(entry.fullId, entry);
    }

    this.inventory.clear();

    for (const entry of instanceMap.values()) {
      const itemData = this.itemDatabase[entry.baseId];
      const itemName = itemData ? itemData.name : `Unknown Item (${entry.baseId})`;

      if (this.inventory.has(entry.baseId)) {
        const existing = this.inventory.get(entry.baseId)!;
        existing.totalQuantity += entry.bagNum;
        existing.instances += 1;
        if (entry.timestamp > existing.lastUpdated) {
          existing.lastUpdated = entry.timestamp;
        }
      } else {
        const cachedPrice = this.priceCache.get(entry.baseId) || null;
        
        this.inventory.set(entry.baseId, {
          itemName,
          totalQuantity: entry.bagNum,
          baseId: entry.baseId,
          price: cachedPrice,
          instances: 1,
          lastUpdated: entry.timestamp,
          pageId: entry.pageId,
          slotId: entry.slotId
        });
      }
    }

    return this.inventory;
  }

  updatePrice(baseId: string, price: number): void {
    this.priceCache.set(baseId, price);
    
    if (this.inventory.has(baseId)) {
      const item = this.inventory.get(baseId)!;
      item.price = price;
    }
  }

  getInventory(): InventoryItem[] {
    return Array.from(this.inventory.values()).sort((a, b) => {
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
    this.priceCache.forEach((price, baseId) => {
      obj[baseId] = price;
    });
    return obj;
  }
}