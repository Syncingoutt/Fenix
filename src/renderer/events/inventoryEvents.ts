// Inventory-related event handlers

import { getCurrentSortBy, setCurrentSortBy, getCurrentSortOrder, setCurrentSortOrder, setSearchQuery, setMinPriceFilter, setMaxPriceFilter } from '../state/inventoryState.js';
import { getWealthMode } from '../state/wealthState.js';
import { getIsHourlyActive } from '../state/wealthState.js';
import { SortBy } from '../types.js';
import { minPriceInput, maxPriceInput, searchInput } from '../dom/domElements.js';

let renderInventory: () => void;
let renderBreakdown: () => void;
let updateRealtimeWealth: () => void;
let updateHourlyWealth: () => void;

export function initInventoryEvents(
  inventoryRenderer: () => void,
  breakdownRenderer: () => void,
  realtimeWealthUpdater: () => void,
  hourlyWealthUpdater: () => void
): void {
  renderInventory = inventoryRenderer;
  renderBreakdown = breakdownRenderer;
  updateRealtimeWealth = realtimeWealthUpdater;
  updateHourlyWealth = hourlyWealthUpdater;
  
  // Price filter functionality
  function updatePriceFilters(): void {
    const minValue = minPriceInput?.value.trim();
    const maxValue = maxPriceInput?.value.trim();
    
    const minPrice = minValue && minValue !== '' ? parseFloat(minValue) : null;
    const maxPrice = maxValue && maxValue !== '' ? parseFloat(maxValue) : null;
    
    // Validate: min should be less than max if both are set
    if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
      // Invalid range, don't update filters
      return;
    }
    
    setMinPriceFilter(minPrice);
    setMaxPriceFilter(maxPrice);
    
    // Update inventory display
    renderInventory();
    
    // Update wealth calculations (Total and Per hour)
    const wealthMode = getWealthMode();
    if (wealthMode === 'realtime') {
      updateRealtimeWealth();
    } else if (wealthMode === 'hourly' && getIsHourlyActive()) {
      updateHourlyWealth();
    }
    
    // Update breakdown to reflect filtered items
    renderBreakdown();
  }
  
  minPriceInput?.addEventListener('input', updatePriceFilters);
  maxPriceInput?.addEventListener('input', updatePriceFilters);
  
  // Sort functionality
  document.querySelectorAll('[data-sort]').forEach(el => {
    el.addEventListener('click', () => {
      const sortType = (el as HTMLElement).dataset.sort as SortBy;
      if (!sortType) return;
      
      const currentSortBy = getCurrentSortBy();
      const currentSortOrder = getCurrentSortOrder();
      
      if (currentSortBy === sortType) {
        setCurrentSortOrder(currentSortOrder === 'asc' ? 'desc' : 'asc');
      } else {
        setCurrentSortBy(sortType);
        setCurrentSortOrder('desc');
      }
      renderInventory();
    });
  });
  
  // Search functionality
  searchInput?.addEventListener('input', (e) => {
    const query = (e.target as HTMLInputElement).value;
    setSearchQuery(query);
    renderInventory();
  });
}
