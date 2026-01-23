// Prices page renderer with sparklines

import { ElectronAPI, PriceCache, ItemDatabase } from '../types.js';

// Re-export for convenience
export type { PriceCache, PriceCacheEntry } from '../types.js';
import { FLAME_ELEMENTIUM_ID } from '../constants.js';
import { getPriceAgeClass } from '../utils/formatting.js';

declare const electronAPI: ElectronAPI;

interface PriceHistoryPoint {
  date: string;
  price: number;
}

interface PriceItem {
  baseId: string;
  name: string;
  price: number;
  timestamp: number;
  listingCount?: number;
  trend: 'up' | 'down' | 'neutral';
  trendPercent: number;
  group?: string;
  history?: PriceHistoryPoint[];
}

let itemDatabase: ItemDatabase = {};
let priceCache: PriceCache = {};
let allPriceItems: PriceItem[] = [];
let filteredPriceItems: PriceItem[] = [];
let sortColumn: string = 'name';
let sortDirection: 'asc' | 'desc' = 'asc';
let currentGroup: string = 'currency';
let currentSearchTerm: string = '';

/**
 * Calculate trend based on real price history when available.
 * Falls back to a simple timestamp-based heuristic if we only have a single point.
 */
function calculateTrendFromHistory(history: PriceHistoryPoint[] | undefined, price: number, timestamp: number): { trend: 'up' | 'down' | 'neutral'; percent: number } {
  if (history && history.length >= 2) {
    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];

    if (first.price > 0) {
      const diff = last.price - first.price;
      const percent = (diff / first.price) * 100;

      if (percent > 0.01) {
        return { trend: 'up', percent };
      } else if (percent < -0.01) {
        return { trend: 'down', percent };
      }
      return { trend: 'neutral', percent: 0 };
    }
  }

  // Fallback: simple timestamp-based heuristic
  const hoursSinceUpdate = (Date.now() - timestamp) / (1000 * 60 * 60);

  if (hoursSinceUpdate < 24) {
    return { trend: 'neutral', percent: 0 };
  }

  return { trend: 'down', percent: -1.5 };
}

/**
 * Render a sparkline on a canvas element
 */
function renderSparkline(canvas: HTMLCanvasElement, prices: number[], trend: 'up' | 'down' | 'neutral'): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || prices.length === 0) return;

  const width = canvas.width;
  const height = canvas.height;
  const padding = 2;

  ctx.clearRect(0, 0, width, height);

  // If we only have one price point, draw a flat line
  if (prices.length === 1) {
    const y = height / 2;
    ctx.strokeStyle = trend === 'up' ? '#4CAF50' : trend === 'down' ? '#F44336' : '#7E7E7E';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
    return;
  }

  // Find min and max for scaling
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1; // Avoid division by zero

  // Generate sample points if we have too many
  let dataPoints: number[];
  if (prices.length > 50) {
    const step = Math.ceil(prices.length / 50);
    dataPoints = prices.filter((_, i) => i % step === 0 || i === prices.length - 1);
  } else {
    dataPoints = prices;
  }

  // Set color based on trend
  const isPositive = trend === 'up' || (trend === 'neutral' && dataPoints[dataPoints.length - 1] >= dataPoints[0]);
  ctx.strokeStyle = isPositive ? '#4CAF50' : '#F44336';
  ctx.fillStyle = isPositive ? 'rgba(76, 175, 80, 0.1)' : 'rgba(244, 67, 54, 0.1)';
  ctx.lineWidth = 1.5;

  // Draw the line
  ctx.beginPath();
  const stepX = (width - padding * 2) / (dataPoints.length - 1);
  
  dataPoints.forEach((price, index) => {
    const x = padding + index * stepX;
    const normalizedPrice = (price - minPrice) / priceRange;
    const y = height - padding - (normalizedPrice * (height - padding * 2));
    
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  
  ctx.stroke();

  // Fill area under the line
  ctx.lineTo(width - padding, height - padding);
  ctx.lineTo(padding, height - padding);
  ctx.closePath();
  ctx.fill();
}

/**
 * Build sparkline data from real price history.
 * If we don't have history, fall back to a flat line.
 */
function generateSparklineData(history: PriceHistoryPoint[] | undefined, currentPrice: number): number[] {
  if (history && history.length > 0) {
    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
    return sorted.map(point => point.price);
  }

  // No history yet – show a flat line at current price (or 0 if no price)
  const value = currentPrice > 0 ? currentPrice : 0;
  return new Array(7).fill(value);
}

/**
 * Format price for display
 */
function formatPrice(price: number): string {
  if (price === 0) {
    return '0.00';
  }
  if (price >= 1000000) {
    return (price / 1000000).toFixed(2) + 'M';
  } else if (price >= 1000) {
    return (price / 1000).toFixed(2) + 'K';
  }
  return price.toFixed(2);
}

/**
 * Render a single price row
 */
function renderPriceRow(item: PriceItem, index: number): string {
  const sparklineId = `sparkline-${item.baseId}`;
  const sparklineData = generateSparklineData(item.history, item.price);
  
  // Get item icon - images are in assets folder with format {baseId}.webp
  const iconPath = `../../assets/${item.baseId}.webp`;
  
  const trendClass = `trend-${item.trend}`;
  const priceFormatted = formatPrice(item.price);
  const hasPrice = item.price > 0;
  
  // Apply price age class based on timestamp (same logic as inventory)
  const priceAgeClass = hasPrice ? getPriceAgeClass(item.timestamp) : '';
  const priceClass = hasPrice ? priceAgeClass : 'no-price';
  const trendText = hasPrice ? `${item.trendPercent > 0 ? '+' : ''}${item.trendPercent.toFixed(0)}%` : '';
  
  return `
    <tr class="prices-row" data-base-id="${item.baseId}">
      <td class="prices-col-name">
        <div class="prices-name-cell">
          <img src="${iconPath}" alt="${item.name}" class="prices-item-icon" onerror="this.style.display='none'">
          <span class="prices-item-name">${escapeHtml(item.name)}</span>
        </div>
      </td>
      <td class="prices-col-price">
        <span class="prices-price-value ${priceClass}">${priceFormatted}</span>
      </td>
      <td class="prices-col-sparkline">
        <div class="prices-sparkline-cell">
          <canvas id="${sparklineId}" class="prices-sparkline" width="80" height="28" 
                  data-prices="${sparklineData.join(',')}" 
                  data-trend="${item.trend}"></canvas>
          <span class="prices-trend ${trendClass}">${trendText}</span>
        </div>
      </td>
    </tr>
  `;
}

/**
 * Escape HTML
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Sort price items
 */
function sortPriceItems(items: PriceItem[], column: string, direction: 'asc' | 'desc'): PriceItem[] {
  const sorted = [...items].sort((a, b) => {
    let aVal: any;
    let bVal: any;
    
    switch (column) {
      case 'name':
        aVal = a.name.toLowerCase();
        bVal = b.name.toLowerCase();
        break;
      case 'price':
        aVal = a.price;
        bVal = b.price;
        break;
      case 'trend':
        aVal = a.trendPercent;
        bVal = b.trendPercent;
        break;
      default:
        return 0;
    }
    
    if (aVal < bVal) return direction === 'asc' ? -1 : 1;
    if (aVal > bVal) return direction === 'asc' ? 1 : -1;
    return 0;
  });
  
  return sorted;
}

/**
 * Render all price items
 */
export function renderPrices(): void {
  const tbody = document.getElementById('pricesTableBody');
  if (!tbody) return;

  // Sort items
  const sortedItems = sortPriceItems(filteredPriceItems, sortColumn, sortDirection);
  
  // Update item count
  const itemCountEl = document.getElementById('pricesItemCount');
  if (itemCountEl) {
    itemCountEl.textContent = `${sortedItems.length} item${sortedItems.length !== 1 ? 's' : ''}`;
  }
  
  // Render rows
  tbody.innerHTML = sortedItems.map((item, index) => renderPriceRow(item, index)).join('');
  
  // Render sparklines after DOM is updated
  setTimeout(() => {
    sortedItems.forEach(item => {
      const canvas = document.getElementById(`sparkline-${item.baseId}`) as HTMLCanvasElement;
      if (canvas) {
        const pricesStr = canvas.getAttribute('data-prices');
        const trend = canvas.getAttribute('data-trend') as 'up' | 'down' | 'neutral';
        if (pricesStr) {
          const prices = pricesStr.split(',').map(p => parseFloat(p));
          renderSparkline(canvas, prices, trend);
        }
      }
    });
  }, 0);
}

/**
 * Load and process price data
 */
export async function loadPrices(): Promise<void> {
  try {
    const [cache, db] = await Promise.all([
      electronAPI.getPriceCache(),
      electronAPI.getItemDatabase()
    ]);
    
    itemDatabase = db;
    priceCache = cache;
    
    // Get all items from database, not just ones with prices
    const allItemsWithNulls: (PriceItem | null)[] = Object.entries(itemDatabase)
      .map(([baseId, itemData]) => {
        // Skip Flame Elementium (it's the currency)
        if (baseId === FLAME_ELEMENTIUM_ID) {
          return null;
        }
        
        // Skip untradable items
        if (itemData.tradable === false) {
          return null;
        }
        
        const name = itemData.name || `Unknown Item (${baseId})`;
        const cachedEntry = priceCache[baseId];
        
        // Use cached price if available, otherwise default to 0
        const price = cachedEntry?.price ?? 0;
        const timestamp = cachedEntry?.timestamp ?? Date.now();
        const listingCount = cachedEntry?.listingCount;
        const history = cachedEntry?.history as PriceHistoryPoint[] | undefined;

        // Calculate trend using real history when available
        const trendData = price > 0
          ? calculateTrendFromHistory(history, price, timestamp)
          : { trend: 'neutral' as const, percent: 0 };
        
        return {
          baseId,
          name,
          price,
          timestamp,
          listingCount,
          trend: trendData.trend,
          trendPercent: trendData.percent,
          group: itemData.group,
          history
        };
      });
    
    // Filter out nulls and sort
    const allItems: PriceItem[] = allItemsWithNulls
      .filter((item): item is PriceItem => item !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
    
    allPriceItems = allItems;
    applyFilters();
    renderPrices();
  } catch (error) {
    console.error('Failed to load prices:', error);
  }
}

/**
 * Apply both group and search filters
 */
function applyFilters(): void {
  let items = [...allPriceItems];
  
  // Filter by group
  if (currentGroup !== 'all') {
    items = items.filter(item => item.group === currentGroup);
  }
  
  // Filter by search term
  if (currentSearchTerm) {
    const term = currentSearchTerm.toLowerCase();
    items = items.filter(item =>
      item.name.toLowerCase().includes(term) ||
      item.baseId.toLowerCase().includes(term)
    );
  }
  
  filteredPriceItems = items;
}

/**
 * Filter prices by search term
 */
export function filterPrices(searchTerm: string): void {
  currentSearchTerm = searchTerm.trim();
  applyFilters();
  renderPrices();
}

/**
 * Filter prices by group
 */
export function filterByGroup(group: string): void {
  currentGroup = group;
  
  // Update sidebar active state
  document.querySelectorAll('.prices-sidebar-item').forEach(item => {
    item.classList.remove('active');
    if (item.getAttribute('data-group') === group) {
      item.classList.add('active');
    }
  });
  
  applyFilters();
  renderPrices();
}

/**
 * Handle column sorting
 */
export function handleSort(column: string): void {
  if (sortColumn === column) {
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    sortColumn = column;
    sortDirection = 'asc';
  }
  
  // Update sort indicators
  document.querySelectorAll('.prices-table th').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.getAttribute('data-sort') === column) {
      th.classList.add(`sort-${sortDirection}`);
    }
  });
  
  renderPrices();
}

/**
 * Initialize prices page
 */
export function initPrices(): void {
  const searchInput = document.getElementById('pricesSearchInput') as HTMLInputElement;
  const clearSearch = document.getElementById('pricesClearSearch') as HTMLButtonElement;
  const sortHeaders = document.querySelectorAll('.prices-table th[data-sort]');
  
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const term = (e.target as HTMLInputElement).value;
      filterPrices(term);
      
      if (clearSearch) {
        clearSearch.style.display = term ? 'block' : 'none';
      }
    });
  }
  
  if (clearSearch) {
    clearSearch.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        filterPrices('');
        clearSearch.style.display = 'none';
      }
    });
  }
  
  sortHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const column = header.getAttribute('data-sort');
      if (column) {
        handleSort(column);
      }
    });
  });
  
  // Sidebar group filter handlers
  const sidebarItems = document.querySelectorAll('.prices-sidebar-item');
  sidebarItems.forEach(item => {
    item.addEventListener('click', () => {
      const group = item.getAttribute('data-group');
      if (group) {
        filterByGroup(group);
      }
    });
  });
  
  // Load prices when page becomes visible
  const pricesPage = document.getElementById('page-prices');
  if (pricesPage) {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const isActive = pricesPage.classList.contains('active');
          if (isActive) {
            // Reload prices when page becomes active (in case prices were updated)
            loadPrices();
          }
        }
      });
    });
    
    observer.observe(pricesPage, { attributes: true });
  }
  
  // Initial load if page is already active
  if (pricesPage?.classList.contains('active')) {
    loadPrices();
  }
  
  // Listen for inventory updates to refresh prices
  electronAPI.onInventoryUpdate(() => {
    const pricesPage = document.getElementById('page-prices');
    if (pricesPage?.classList.contains('active')) {
      loadPrices();
    }
  });
}
