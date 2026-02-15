// Inventory state management

import { InventoryItem, ItemDatabase, SortBy, SortOrder, PriceCache } from '../types.js';

// Inventory data
let currentItems: InventoryItem[] = [];
let itemDatabase: ItemDatabase = {};
let priceCache: PriceCache = {};

// Sorting state
let currentSortBy: SortBy = 'priceTotal';
let currentSortOrder: SortOrder = 'desc';

// Filter state
let searchQuery: string = '';
let selectedGroupFilter: string | null = null;
let minPriceFilter: number | null = null;
let maxPriceFilter: number | null = null;
// BaseIds unchecked = excluded from total/per hour (default: all checked = empty set)
let excludedFromCountBaseIds: Set<string> = new Set();

// Getters
export function getCurrentItems(): InventoryItem[] {
  return currentItems;
}

export function getItemDatabase(): ItemDatabase {
  return itemDatabase;
}

export function getCurrentSortBy(): SortBy {
  return currentSortBy;
}

export function getCurrentSortOrder(): SortOrder {
  return currentSortOrder;
}

export function getSearchQuery(): string {
  return searchQuery;
}

export function getSelectedGroupFilter(): string | null {
  return selectedGroupFilter;
}

export function getMinPriceFilter(): number | null {
  return minPriceFilter;
}

export function getMaxPriceFilter(): number | null {
  return maxPriceFilter;
}

export function isItemCountEnabled(baseId: string): boolean {
  return !excludedFromCountBaseIds.has(baseId);
}

export function getExcludedFromCountBaseIds(): Set<string> {
  return new Set(excludedFromCountBaseIds);
}

export function getPriceCache(): PriceCache {
  return priceCache;
}

export function setPriceCache(cache: PriceCache): void {
  priceCache = cache;
}

// Setters
export function setCurrentItems(items: InventoryItem[]): void {
  currentItems = items;
}

export function setItemDatabase(db: ItemDatabase): void {
  itemDatabase = db;
}

export function setCurrentSortBy(sortBy: SortBy): void {
  currentSortBy = sortBy;
}

export function setCurrentSortOrder(order: SortOrder): void {
  currentSortOrder = order;
}

export function setSearchQuery(query: string): void {
  searchQuery = query;
}

export function setSelectedGroupFilter(group: string | null): void {
  selectedGroupFilter = group;
}

export function setMinPriceFilter(min: number | null): void {
  minPriceFilter = min;
}

export function setMaxPriceFilter(max: number | null): void {
  maxPriceFilter = max;
}

export function setItemCountEnabled(baseId: string, enabled: boolean): void {
  if (enabled) {
    excludedFromCountBaseIds.delete(baseId);
  } else {
    excludedFromCountBaseIds.add(baseId);
  }
}

export function toggleItemCountEnabled(baseId: string): void {
  if (excludedFromCountBaseIds.has(baseId)) {
    excludedFromCountBaseIds.delete(baseId);
  } else {
    excludedFromCountBaseIds.add(baseId);
  }
}
