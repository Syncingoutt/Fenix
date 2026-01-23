// Inventory state management

import { InventoryItem, ItemDatabase, SortBy, SortOrder } from '../types.js';

// Inventory data
let currentItems: InventoryItem[] = [];
let itemDatabase: ItemDatabase = {};

// Sorting state
let currentSortBy: SortBy = 'priceTotal';
let currentSortOrder: SortOrder = 'desc';

// Filter state
let searchQuery: string = '';
let selectedGroupFilter: string | null = null;
let minPriceFilter: number | null = null;
let maxPriceFilter: number | null = null;

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
