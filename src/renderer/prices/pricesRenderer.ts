// Prices page renderer with sparklines

import { ElectronAPI, PriceCache, ItemDatabase, PriceHistoryPoint, PriceHistoryByItem } from '../types.js';

// Re-export for convenience
export type { PriceCache, PriceCacheEntry } from '../types.js';
import { FLAME_ELEMENTIUM_ID } from '../constants.js';
import { getPriceAgeClass } from '../utils/formatting.js';

declare const electronAPI: ElectronAPI;

interface SparklineHistoryPoint {
  date: string;
  price: number;
  timestamp?: number;
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
  history?: SparklineHistoryPoint[];
}

interface RenderRowData {
  item: PriceItem;
  history: SparklineHistoryPoint[] | undefined;
  trendData: { trend: 'up' | 'down' | 'neutral'; percent: number };
}

let itemDatabase: ItemDatabase = {};
let priceCache: PriceCache = {};
let allPriceItems: PriceItem[] = [];
let filteredPriceItems: PriceItem[] = [];
let sortColumn: string = 'price';
let sortDirection: 'asc' | 'desc' = 'desc';
let currentGroup: string = 'currency';
let currentSearchTerm: string = '';
let currentLeagueId = 's12-lunaria';
const VALID_LEAGUE_IDS = new Set(['s12-lunaria', 's11-vorax']);
const LEGACY_LEAGUE_ID_MAP: Record<string, string> = {
  lunaria: 's12-lunaria',
  vorax: 's11-vorax'
};
let selectedBaseId: string | null = null;
let detailChart: any = null;
const detailHistoryCache = new Map<string, PriceHistoryPoint[]>();
const detailHistoryLoadedKeys = new Set<string>();
let last7DayHistoryByItem: PriceHistoryByItem = {};
let isDetailViewOpen = false;
let detailFullHistory: PriceHistoryPoint[] = [];
let detailRangeStartIndex = 0;
let detailRangeEndIndex = 0;
let detailRequestVersion = 0;
let list7HistoryRequestVersion = 0;
let detail90HistoryRequestVersion = 0;
let last7HistoryLoadedAt = 0;
let last7HistoryLeagueId = '';
let isCloudSyncEnabledForPrices = true;
const HISTORY_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const SPARKLINES_PER_FRAME = 24;
const TREND_MIN_PERCENT = 1;
let sparklineRenderRequestVersion = 0;
const cloudSparklineHistoryCache = new Map<string, SparklineHistoryPoint[]>();
let lastDetailChartSignature = '';
let isRangeSelectionDragging = false;
let rangeSelectionDragSource: 'main' | 'nav' | null = null;
let rangeSelectionDragStartClientX = 0;
let rangeSelectionDragStartIndex = 0;
let rangeSelectionDragEndIndex = 0;

declare const Chart: any;

function normalizeLeagueId(rawLeagueId?: string): string {
  const trimmed = typeof rawLeagueId === 'string' ? rawLeagueId.trim() : '';
  if (!trimmed) return 's12-lunaria';
  const lower = trimmed.toLowerCase();
  if (LEGACY_LEAGUE_ID_MAP[lower]) {
    return LEGACY_LEAGUE_ID_MAP[lower];
  }
  if (VALID_LEAGUE_IDS.has(lower)) {
    return lower;
  }
  return 's12-lunaria';
}

/**
 * Calculate trend based on real price history when available.
 * When history is missing/insufficient, default to neutral to avoid
 * showing a misleading synthetic negative trend.
 */
function calculateTrendFromHistory(history: SparklineHistoryPoint[] | undefined): { trend: 'up' | 'down' | 'neutral'; percent: number } {
  if (history && history.length >= 2) {
    let first = history[0];
    let last = history[0];
    let firstOrder = getHistoryPointOrder(first, 0);
    let lastOrder = firstOrder;

    history.forEach((point, index) => {
      const order = getHistoryPointOrder(point, index);
      if (order < firstOrder) {
        first = point;
        firstOrder = order;
      }
      if (order > lastOrder || (order === lastOrder && index > 0)) {
        last = point;
        lastOrder = order;
      }
    });

    if (first.price > 0) {
      const diff = last.price - first.price;
      const percent = (diff / first.price) * 100;

      if (percent >= TREND_MIN_PERCENT) {
        return { trend: 'up', percent };
      } else if (percent <= -TREND_MIN_PERCENT) {
        return { trend: 'down', percent };
      }
      return { trend: 'neutral', percent: 0 };
    }
  }
  return { trend: 'neutral', percent: 0 };
}

function getHistoryPointOrder(point: SparklineHistoryPoint, index: number): number {
  if (typeof point.timestamp === 'number' && Number.isFinite(point.timestamp)) {
    return point.timestamp;
  }
  const parsedDate = Date.parse(point.date);
  if (Number.isFinite(parsedDate)) {
    // Keep stable order for points that share the same day string.
    return parsedDate + index / 1000;
  }
  return index;
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

  // Neutral trend should always render as a flat line.
  if (trend === 'neutral') {
    const y = height / 2;
    ctx.strokeStyle = '#7E7E7E';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
    return;
  }

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

  // Set color based on trend (neutral already returned above).
  if (trend === 'up') {
    ctx.strokeStyle = '#4CAF50';
    ctx.fillStyle = 'rgba(76, 175, 80, 0.1)';
  } else {
    ctx.strokeStyle = '#F44336';
    ctx.fillStyle = 'rgba(244, 67, 54, 0.1)';
  }
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
function generateSparklineData(history: SparklineHistoryPoint[] | undefined, currentPrice: number): number[] {
  if (history && history.length > 0) {
    return [...history]
      .map((point, index) => ({ point, index }))
      .sort((a, b) => getHistoryPointOrder(a.point, a.index) - getHistoryPointOrder(b.point, b.index))
      .map(({ point }) => point.price);
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

function formatTooltipPriceFe(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return '0';
  if (price >= 1000000) {
    const value = price / 1000000;
    const precision = value >= 10 ? 0 : 1;
    return `${value.toFixed(precision)}m`;
  }
  if (price >= 1000) {
    const value = price / 1000;
    const precision = value >= 10 ? 0 : 1;
    return `${value.toFixed(precision)}k`;
  }
  if (price < 1) {
    return price.toFixed(2);
  }
  return price.toFixed(0);
}

function formatDetailTooltipDate(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return '--';
  return new Date(timestamp).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

function getSelectedDetailItem(): PriceItem | null {
  if (!selectedBaseId) return null;
  return allPriceItems.find(item => item.baseId === selectedBaseId) ?? null;
}

function ensureDetailChartTooltip(chart: any): HTMLDivElement | null {
  const chartWrap = chart?.canvas?.parentElement as HTMLElement | null;
  if (!chartWrap) return null;
  let tooltipEl = chartWrap.querySelector('#pricesDetailChartTooltip') as HTMLDivElement | null;
  if (tooltipEl) return tooltipEl;

  tooltipEl = document.createElement('div');
  tooltipEl.id = 'pricesDetailChartTooltip';
  tooltipEl.className = 'prices-detail-chart-tooltip';
  tooltipEl.style.opacity = '0';
  chartWrap.appendChild(tooltipEl);
  return tooltipEl;
}

function renderDetailChartTooltip(context: { chart: any; tooltip: any }): void {
  const { chart, tooltip } = context;
  const tooltipEl = ensureDetailChartTooltip(chart);
  if (!tooltipEl) return;

  if (!tooltip || tooltip.opacity === 0 || !Array.isArray(tooltip.dataPoints) || tooltip.dataPoints.length === 0) {
    tooltipEl.style.opacity = '0';
    return;
  }

  const firstPoint = tooltip.dataPoints[0];
  const dataIndex = Number(firstPoint?.dataIndex ?? 0);
  const rawTimestamp = chart?.data?.labels?.[dataIndex];
  const timestamp = Number(rawTimestamp);
  const price = Number(firstPoint?.raw ?? firstPoint?.parsed?.y ?? 0);
  const selectedItem = getSelectedDetailItem();
  const itemIconPath = selectedItem ? `../../assets/${selectedItem.baseId}.webp` : '';
  const itemName = selectedItem?.name ?? 'Item';
  const safeItemName = escapeHtml(itemName);

  tooltipEl.innerHTML = `
    <div class="prices-detail-chart-tooltip-date">${formatDetailTooltipDate(timestamp)}</div>
    <div class="prices-detail-chart-tooltip-row">
      <span class="prices-detail-chart-tooltip-fe">${formatTooltipPriceFe(price)}</span>
      <img src="../../assets/100300.webp" alt="FE" class="prices-detail-chart-tooltip-icon prices-detail-chart-tooltip-fe-icon" onerror="this.style.display='none'">
      <span class="prices-detail-chart-tooltip-arrow" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 3 4 7l4 4"></path>
          <path d="M4 7h16"></path>
          <path d="m16 21 4-4-4-4"></path>
          <path d="M20 17H4"></path>
        </svg>
      </span>
      <span class="prices-detail-chart-tooltip-qty">1.0</span>
      ${itemIconPath
        ? `<img src="${itemIconPath}" alt="${safeItemName}" class="prices-detail-chart-tooltip-icon prices-detail-chart-tooltip-item-icon" onerror="this.style.display='none'">`
        : ''}
    </div>
  `;

  const canvasWidth = Number(chart?.width ?? 0);
  const canvasHeight = Number(chart?.height ?? 0);
  const caretX = Number(tooltip.caretX ?? 0);
  const caretY = Number(tooltip.caretY ?? 0);
  const offset = 18;

  const tooltipWidth = tooltipEl.offsetWidth;
  const tooltipHeight = tooltipEl.offsetHeight;
  const canPlaceRight = caretX + offset + tooltipWidth <= canvasWidth - 4;
  const nextLeft = canPlaceRight ? caretX + offset : Math.max(4, caretX - tooltipWidth - offset);
  const nextTop = caretY + offset + tooltipHeight <= canvasHeight - 4
    ? caretY + offset
    : Math.max(4, caretY - tooltipHeight - offset);

  tooltipEl.style.left = `${nextLeft}px`;
  tooltipEl.style.top = `${nextTop}px`;
  tooltipEl.style.opacity = '1';
}

function formatUpdatedAt(timestamp: number): string {
  if (!timestamp || Number.isNaN(timestamp)) {
    return '--';
  }
  return new Date(timestamp).toLocaleString();
}

function buildTliDbItemUrl(itemName: string): string {
  const slug = itemName
    .trim()
    .replace(/['’]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `https://tlidb.com/en/${slug || 'Unknown_Item'}`;
}

function calculateSevenDayAveragePrice(baseId: string, fallbackPoints: PriceHistoryPoint[]): number | null {
  const cloudHistory = last7DayHistoryByItem[baseId];
  let points = cloudHistory && cloudHistory.length > 0 ? cloudHistory : fallbackPoints;
  if (points.length === 0) {
    return null;
  }

  if (!cloudHistory || cloudHistory.length === 0) {
    const latestTimestamp = Math.max(...points.map(point => point.timestamp || 0));
    if (Number.isFinite(latestTimestamp) && latestTimestamp > 0) {
      const cutoff = latestTimestamp - 7 * 24 * 60 * 60 * 1000;
      const recentPoints = points.filter(point => point.timestamp >= cutoff);
      if (recentPoints.length > 0) {
        points = recentPoints;
      }
    }
  }

  const validPrices = points
    .map(point => point.price)
    .filter(price => Number.isFinite(price) && price >= 0);
  if (validPrices.length === 0) {
    return null;
  }

  const sum = validPrices.reduce((acc, price) => acc + price, 0);
  return sum / validPrices.length;
}

function updateDetailPriceStats(baseId: string, currentPrice: number, fallbackPoints: PriceHistoryPoint[]): void {
  const detailPriceValue = document.getElementById('pricesDetailPriceValue');
  const detailAveragePriceValue = document.getElementById('pricesDetailAveragePriceValue');
  if (detailPriceValue) {
    detailPriceValue.textContent = formatPrice(currentPrice);
  }
  if (detailAveragePriceValue) {
    const avgPrice = calculateSevenDayAveragePrice(baseId, fallbackPoints);
    detailAveragePriceValue.textContent = avgPrice === null ? '--' : formatPrice(avgPrice);
  }
}

function toPriceHistoryPoints(history: SparklineHistoryPoint[] | undefined): PriceHistoryPoint[] {
  if (!history || history.length === 0) {
    return [];
  }

  const fallbackNow = Date.now();
  return history
    .map((point, index) => {
      const parsedDate = Date.parse(point.date);
      const resolvedTimestamp = typeof point.timestamp === 'number' && Number.isFinite(point.timestamp)
        ? point.timestamp
        : (Number.isFinite(parsedDate) ? parsedDate : fallbackNow + index);
      return {
        date: point.date,
        timestamp: resolvedTimestamp,
        price: point.price
      } satisfies PriceHistoryPoint;
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Render a single price row
 */
function renderPriceRow(item: PriceItem): string {
  const sparklineId = `sparkline-${item.baseId}`;
  const displayHistory = getDisplayHistory(item);
  const trendData = item.price > 0
    ? calculateTrendFromHistory(displayHistory)
    : { trend: 'neutral' as const, percent: 0 };
  
  // Get item icon - images are in assets folder with format {baseId}.webp
  const iconPath = `../../assets/${item.baseId}.webp`;
  
  const trendClass = `trend-${trendData.trend}`;
  const priceFormatted = formatPrice(item.price);
  const hasPrice = item.price > 0;
  
  // Apply price age class based on timestamp (same logic as inventory)
  const priceAgeClass = hasPrice ? getPriceAgeClass(item.timestamp) : '';
  const priceClass = hasPrice ? priceAgeClass : 'no-price';
  const trendText = hasPrice
    ? (trendData.trend === 'neutral'
      ? '0%'
      : `${trendData.percent > 0 ? '+' : ''}${Math.round(trendData.percent)}%`)
    : '';
  
  return `
    <tr class="prices-row" data-base-id="${item.baseId}">
      <td class="prices-col-name">
        <div class="prices-name-cell">
          <img src="${iconPath}" alt="${item.name}" class="prices-item-icon" onerror="this.style.display='none'">
          <span class="prices-item-name">${escapeHtml(item.name)}</span>
        </div>
      </td>
      <td class="prices-col-updated">
        <span class="prices-updated-at">${formatUpdatedAt(item.timestamp)}</span>
      </td>
      <td class="prices-col-price">
        <span class="prices-price-value ${priceClass}">${priceFormatted}</span>
      </td>
      <td class="prices-col-sparkline">
        <div class="prices-sparkline-cell">
          <canvas id="${sparklineId}" class="prices-sparkline" width="80" height="28" 
                  ></canvas>
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
        aVal = getTrendPercentForSort(a);
        bVal = getTrendPercentForSort(b);
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
  
  // Update sort indicators
  document.querySelectorAll('.prices-table th').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.getAttribute('data-sort') === sortColumn) {
      th.classList.add(`sort-${sortDirection}`);
    }
  });
  
  // Update item count
  const itemCountEl = document.getElementById('pricesItemCount');
  if (itemCountEl) {
    itemCountEl.textContent = `${sortedItems.length} item${sortedItems.length !== 1 ? 's' : ''}`;
  }
  
  // Render rows
  tbody.innerHTML = sortedItems.map((item) => renderPriceRow(item)).join('');

  const renderData: RenderRowData[] = sortedItems.map(item => {
    const history = getDisplayHistory(item);
    const trendData = item.price > 0
      ? calculateTrendFromHistory(history)
      : { trend: 'neutral' as const, percent: 0 };
    return { item, history, trendData };
  });

  scheduleSparklineRender(renderData);
}

function setDetailViewMode(open: boolean): void {
  isDetailViewOpen = open;
  const listView = document.getElementById('pricesListView');
  const detailView = document.getElementById('pricesDetailView');
  if (listView) listView.style.display = open ? 'none' : 'block';
  if (detailView) detailView.style.display = open ? 'block' : 'none';
}

function formatDisplayDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) {
    return `rgba(222, 92, 11, ${alpha})`;
  }
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getPricesChartTheme(): { primary: string; text: string; border: string; bgShade: string } {
  const styles = getComputedStyle(document.documentElement);
  return {
    primary: styles.getPropertyValue('--primary').trim() || '#DE5C0B',
    text: styles.getPropertyValue('--text').trim() || '#FAFAFA',
    border: styles.getPropertyValue('--border').trim() || '#7E7E7E',
    bgShade: styles.getPropertyValue('--bg-shade').trim() || '#272727'
  };
}

function getDetailHistoryForItem(baseId: string): PriceHistoryPoint[] {
  const detailCache = detailHistoryCache.get(`${currentLeagueId}:${baseId}`);
  if (detailCache && detailCache.length > 0) return detailCache;
  const history7 = last7DayHistoryByItem[baseId];
  if (history7 && history7.length > 0) return history7;
  const item = allPriceItems.find(priceItem => priceItem.baseId === baseId);
  if (item?.history && item.history.length > 0) return toPriceHistoryPoints(item.history);
  return [];
}

function getDefaultRangeStartIndex(points: PriceHistoryPoint[]): number {
  if (points.length === 0) return 0;
  const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const start = points.findIndex(point => point.timestamp >= cutoffMs);
  if (start >= 0) return start;
  return Math.max(0, points.length - 1);
}

function getSelectedDetailPoints(): PriceHistoryPoint[] {
  if (detailFullHistory.length === 0) return [];
  const start = Math.max(0, Math.min(detailRangeStartIndex, detailFullHistory.length - 1));
  const end = Math.max(start, Math.min(detailRangeEndIndex, detailFullHistory.length - 1));
  return detailFullHistory.slice(start, end + 1);
}

function updateRangeControlsUi(): void {
  const startInput = document.getElementById('pricesRangeStart') as HTMLInputElement | null;
  const endInput = document.getElementById('pricesRangeEnd') as HTMLInputElement | null;
  const navStartInput = document.getElementById('pricesRangeNavigatorStart') as HTMLInputElement | null;
  const navEndInput = document.getElementById('pricesRangeNavigatorEnd') as HTMLInputElement | null;
  const label = document.getElementById('pricesRangeLabel');
  const hoverStartLabel = document.getElementById('pricesRangeHoverStart');
  const hoverEndLabel = document.getElementById('pricesRangeHoverEnd');
  const hoverLabels = hoverStartLabel?.parentElement as HTMLElement | null;
  const sliderShell = document.getElementById('pricesRangeSliderShell') as HTMLElement | null;
  const navShell = document.getElementById('pricesRangeNavigatorShell') as HTMLElement | null;
  const total = detailFullHistory.length;

  if (!startInput || !endInput || !navStartInput || !navEndInput || !label || !sliderShell || !navShell || !hoverStartLabel || !hoverEndLabel) return;

  if (total === 0) {
    startInput.min = '0';
    startInput.max = '0';
    startInput.value = '0';
    startInput.disabled = true;
    endInput.min = '0';
    endInput.max = '0';
    endInput.value = '0';
    endInput.disabled = true;
    navStartInput.min = '0';
    navStartInput.max = '0';
    navStartInput.value = '0';
    navStartInput.disabled = true;
    navEndInput.min = '0';
    navEndInput.max = '0';
    navEndInput.value = '0';
    navEndInput.disabled = true;
    label.textContent = 'No data available';
    hoverStartLabel.textContent = '--';
    hoverEndLabel.textContent = '--';
    sliderShell.style.setProperty('--prices-range-start', '0%');
    sliderShell.style.setProperty('--prices-range-end', '100%');
    navShell.style.setProperty('--prices-range-start', '0%');
    navShell.style.setProperty('--prices-range-end', '100%');
    hoverLabels?.style.setProperty('--prices-range-start', '0%');
    hoverLabels?.style.setProperty('--prices-range-end', '100%');
    return;
  }

  const maxIndex = total - 1;
  startInput.disabled = false;
  endInput.disabled = false;
  navStartInput.disabled = false;
  navEndInput.disabled = false;
  startInput.min = '0';
  startInput.max = String(maxIndex);
  endInput.min = '0';
  endInput.max = String(maxIndex);
  navStartInput.min = '0';
  navStartInput.max = String(maxIndex);
  navEndInput.min = '0';
  navEndInput.max = String(maxIndex);
  startInput.value = String(detailRangeStartIndex);
  endInput.value = String(detailRangeEndIndex);
  navStartInput.value = String(detailRangeStartIndex);
  navEndInput.value = String(detailRangeEndIndex);

  const startPoint = detailFullHistory[detailRangeStartIndex];
  const endPoint = detailFullHistory[detailRangeEndIndex];
  label.textContent = `${detailRangeEndIndex - detailRangeStartIndex + 1} checks`;
  hoverStartLabel.textContent = formatDisplayDate(startPoint.timestamp);
  hoverEndLabel.textContent = formatDisplayDate(endPoint.timestamp);

  const startPct = maxIndex === 0 ? 0 : (detailRangeStartIndex / maxIndex) * 100;
  const endPct = maxIndex === 0 ? 100 : (detailRangeEndIndex / maxIndex) * 100;
  sliderShell.style.setProperty('--prices-range-start', `${startPct}%`);
  sliderShell.style.setProperty('--prices-range-end', `${endPct}%`);
  navShell.style.setProperty('--prices-range-start', `${startPct}%`);
  navShell.style.setProperty('--prices-range-end', `${endPct}%`);
  hoverLabels?.style.setProperty('--prices-range-start', `${startPct}%`);
  hoverLabels?.style.setProperty('--prices-range-end', `${endPct}%`);
}

function setActiveRangeHandle(handle: 'start' | 'end'): void {
  const startInput = document.getElementById('pricesRangeStart') as HTMLInputElement | null;
  const endInput = document.getElementById('pricesRangeEnd') as HTMLInputElement | null;
  const navStartInput = document.getElementById('pricesRangeNavigatorStart') as HTMLInputElement | null;
  const navEndInput = document.getElementById('pricesRangeNavigatorEnd') as HTMLInputElement | null;
  if (!startInput || !endInput) return;

  if (handle === 'start') {
    startInput.classList.add('prices-range-slider-active');
    endInput.classList.remove('prices-range-slider-active');
    navStartInput?.classList.add('prices-range-slider-active');
    navEndInput?.classList.remove('prices-range-slider-active');
  } else {
    endInput.classList.add('prices-range-slider-active');
    startInput.classList.remove('prices-range-slider-active');
    navEndInput?.classList.add('prices-range-slider-active');
    navStartInput?.classList.remove('prices-range-slider-active');
  }
}

function clampRangeToBounds(start: number, end: number): { start: number; end: number } {
  const maxIndex = Math.max(0, detailFullHistory.length - 1);
  const nextStart = Math.max(0, Math.min(start, maxIndex));
  const nextEnd = Math.max(nextStart, Math.min(end, maxIndex));
  return { start: nextStart, end: nextEnd };
}

function setDetailRange(start: number, end: number): void {
  if (detailFullHistory.length === 0) return;
  const clamped = clampRangeToBounds(start, end);
  detailRangeStartIndex = clamped.start;
  detailRangeEndIndex = clamped.end;
  updateRangeControlsUi();
  renderDetailChart(getSelectedDetailPoints());
}

function shiftDetailRangeWindow(delta: number): void {
  if (detailFullHistory.length === 0) return;
  const maxIndex = detailFullHistory.length - 1;
  const width = Math.max(0, detailRangeEndIndex - detailRangeStartIndex);
  let nextStart = detailRangeStartIndex + delta;
  nextStart = Math.max(0, Math.min(nextStart, maxIndex - width));
  const nextEnd = Math.min(maxIndex, nextStart + width);
  setDetailRange(nextStart, nextEnd);
}

function getRangeIndexFromClientX(clientX: number, shell: HTMLElement): number {
  const rect = shell.getBoundingClientRect();
  if (rect.width <= 0 || detailFullHistory.length === 0) return 0;
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return Math.round(ratio * (detailFullHistory.length - 1));
}

function onRangeShellPointerDown(event: PointerEvent, source: 'main' | 'nav'): void {
  if (detailFullHistory.length === 0) return;
  const target = event.target as HTMLElement;
  if (target.closest('input.prices-range-slider') || target.closest('.prices-range-selection')) {
    return;
  }

  const shell = source === 'main'
    ? document.getElementById('pricesRangeSliderShell')
    : document.getElementById('pricesRangeNavigatorShell');
  if (!shell) return;

  const clickedIndex = getRangeIndexFromClientX(event.clientX, shell);
  const rangeWidth = Math.max(0, detailRangeEndIndex - detailRangeStartIndex);
  const centerOffset = Math.floor(rangeWidth / 2);
  const nextStart = clickedIndex - centerOffset;
  setDetailRange(nextStart, nextStart + rangeWidth);
}

function startRangeSelectionDrag(event: PointerEvent, source: 'main' | 'nav'): void {
  if (detailFullHistory.length === 0) return;
  const target = event.target as HTMLElement;
  const selection = target.closest('.prices-range-selection') as HTMLElement | null;
  if (!selection) return;

  isRangeSelectionDragging = true;
  rangeSelectionDragSource = source;
  rangeSelectionDragStartClientX = event.clientX;
  rangeSelectionDragStartIndex = detailRangeStartIndex;
  rangeSelectionDragEndIndex = detailRangeEndIndex;
  selection.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function onRangeSelectionPointerMove(event: PointerEvent): void {
  if (!isRangeSelectionDragging || !rangeSelectionDragSource || detailFullHistory.length === 0) return;
  const shell = rangeSelectionDragSource === 'main'
    ? document.getElementById('pricesRangeSliderShell')
    : document.getElementById('pricesRangeNavigatorShell');
  if (!shell) return;
  const rect = shell.getBoundingClientRect();
  if (rect.width <= 0) return;

  const deltaRatio = (event.clientX - rangeSelectionDragStartClientX) / rect.width;
  const maxIndex = detailFullHistory.length - 1;
  const deltaIndex = Math.round(deltaRatio * maxIndex);
  const width = rangeSelectionDragEndIndex - rangeSelectionDragStartIndex;
  let nextStart = rangeSelectionDragStartIndex + deltaIndex;
  nextStart = Math.max(0, Math.min(nextStart, maxIndex - width));
  const nextEnd = Math.min(maxIndex, nextStart + width);
  setDetailRange(nextStart, nextEnd);
}

function stopRangeSelectionDrag(event?: PointerEvent): void {
  if (!isRangeSelectionDragging) return;
  if (event) {
    const target = event.target as HTMLElement | null;
    try {
      target?.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore pointer release failures.
    }
  }
  isRangeSelectionDragging = false;
  rangeSelectionDragSource = null;
}

function applyDetailHistory(points: PriceHistoryPoint[], resetToDefaultRange: boolean): void {
  detailFullHistory = [...points].sort((a, b) => a.timestamp - b.timestamp);
  if (detailFullHistory.length === 0) {
    detailRangeStartIndex = 0;
    detailRangeEndIndex = 0;
    updateRangeControlsUi();
    renderDetailChart([]);
    return;
  }

  if (resetToDefaultRange) {
    detailRangeStartIndex = getDefaultRangeStartIndex(detailFullHistory);
    detailRangeEndIndex = detailFullHistory.length - 1;
  } else {
    detailRangeEndIndex = Math.min(detailRangeEndIndex, detailFullHistory.length - 1);
    detailRangeStartIndex = Math.min(detailRangeStartIndex, detailRangeEndIndex);
  }

  updateRangeControlsUi();
  renderDetailChart(getSelectedDetailPoints());
}

async function ensureDetailHistoryLoaded(baseId: string): Promise<void> {
  if (!isCloudSyncEnabledForPrices) return;
  const cacheKey = `${currentLeagueId}:${baseId}`;
  if (detailHistoryLoadedKeys.has(cacheKey)) return;

  const requestVersion = ++detail90HistoryRequestVersion;

  try {
    const history = await electronAPI.getPriceHistory({
      baseId,
      leagueId: currentLeagueId,
      maxDays: 90
    });
    if (requestVersion !== detail90HistoryRequestVersion) return;
    detailHistoryCache.set(cacheKey, history ?? []);
    detailHistoryLoadedKeys.add(cacheKey);

    if (selectedBaseId === baseId) {
      applyDetailHistory(history ?? [], true);
      const selectedItem = allPriceItems.find(item => item.baseId === baseId);
      if (selectedItem) {
        updateDetailPriceStats(baseId, selectedItem.price, history ?? []);
      }
    }
  } catch (error) {
    if (requestVersion !== detail90HistoryRequestVersion) return;
    console.error('Failed to fetch item detail history:', error);
  }
}

function renderDetailChart(points: PriceHistoryPoint[]): void {
  const chartCanvas = document.getElementById('pricesDetailChart') as HTMLCanvasElement | null;
  const emptyEl = document.getElementById('pricesDetailEmpty');
  if (!chartCanvas || !emptyEl) return;
  const theme = getPricesChartTheme();

  if (points.length === 0) {
    if (detailChart) {
      const existingTooltip = document.getElementById('pricesDetailChartTooltip');
      if (existingTooltip) {
        existingTooltip.remove();
      }
      detailChart.destroy();
      detailChart = null;
    }
    lastDetailChartSignature = '';
    emptyEl.textContent = 'No history yet for this item.';
    emptyEl.style.display = 'flex';
    return;
  }

  emptyEl.style.display = 'none';
  const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
  const chartSignature = sorted.map(point => `${point.timestamp}:${point.price}`).join('|');
  if (detailChart && chartSignature === lastDetailChartSignature) {
    return;
  }
  lastDetailChartSignature = chartSignature;
  const labels = sorted.map(point => point.timestamp);
  const values = sorted.map(point => point.price);
  const pointRadius = sorted.length > 120 ? 0 : 3;

  if (detailChart) {
    detailChart.data.labels = labels;
    const dataset = detailChart.data.datasets[0];
    dataset.data = values;
    dataset.borderColor = theme.primary;
    dataset.backgroundColor = hexToRgba(theme.primary, 0.10);
    dataset.pointRadius = pointRadius;
    dataset.pointHoverRadius = pointRadius === 0 ? 3 : 4;
    dataset.pointBackgroundColor = theme.primary;
    detailChart.update('none');
    return;
  }

  detailChart = new Chart(chartCanvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Price (FE)',
        data: values,
        borderColor: theme.primary,
        backgroundColor: hexToRgba(theme.primary, 0.10),
        fill: true,
        tension: 0.25,
        pointRadius,
        pointHoverRadius: pointRadius === 0 ? 3 : 4,
        pointBackgroundColor: theme.primary,
        pointBorderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: renderDetailChartTooltip,
          backgroundColor: theme.bgShade,
          borderColor: theme.border,
          borderWidth: 1,
          titleColor: theme.text,
          bodyColor: theme.text,
          displayColors: false
        }
      },
      scales: {
        x: {
          ticks: {
            color: theme.text,
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 10,
            callback: function (this: { getLabelForValue: (value: number) => string }, value: number | string): string {
              const tickIndex = arguments[1] as number;
              if (tickIndex % 3 !== 0) {
                return '';
              }
              const numericValue = typeof value === 'number' ? value : Number(value);
              const label = this.getLabelForValue(numericValue);
              const timestamp = Number(label);
              if (!Number.isFinite(timestamp)) return '';
              const date = new Date(timestamp);
              if (date.getDate() === 1) {
                return date.toLocaleDateString(undefined, { month: 'short' });
              }
              return String(date.getDate());
            }
          },
          border: { color: theme.border },
          grid: {
            display: true,
            color: 'rgba(126, 126, 126, 0.25)',
            drawTicks: false
          }
        },
        y: {
          ticks: { color: theme.text },
          border: { color: theme.border },
          grid: {
            display: true,
            color: 'rgba(126, 126, 126, 0.25)',
            drawTicks: false
          },
          beginAtZero: false
        }
      }
    }
  });
}

async function showItemDetail(baseId: string): Promise<void> {
  const selectedItem = allPriceItems.find(item => item.baseId === baseId);
  if (!selectedItem) return;

  selectedBaseId = baseId;
  detailRequestVersion += 1;
  const requestVersion = detailRequestVersion;
  setDetailViewMode(true);

  const detailName = document.getElementById('pricesDetailName') as HTMLButtonElement | null;
  const detailIcon = document.getElementById('pricesDetailIcon') as HTMLImageElement | null;

  if (detailName) {
    detailName.textContent = selectedItem.name;
    detailName.dataset.tlidbUrl = buildTliDbItemUrl(selectedItem.name);
    detailName.disabled = false;
  }
  if (detailIcon) {
    detailIcon.src = `../../assets/${selectedItem.baseId}.webp`;
    detailIcon.alt = selectedItem.name;
    detailIcon.style.display = 'block';
    detailIcon.onerror = () => {
      detailIcon.style.display = 'none';
    };
  }

  const cacheKey = `${currentLeagueId}:${baseId}`;
  const immediateHistory = getDetailHistoryForItem(baseId);
  detailHistoryCache.set(cacheKey, immediateHistory);
  updateDetailPriceStats(baseId, selectedItem.price, immediateHistory);

  if (requestVersion !== detailRequestVersion || selectedBaseId !== baseId) {
    return;
  }

  applyDetailHistory(immediateHistory, true);

  if (isCloudSyncEnabledForPrices) {
    // Load full point-level detail history in background.
    void ensureDetailHistoryLoaded(baseId);
  }
}

function applyCloud7DayHistoryToTable(): void {
  cloudSparklineHistoryCache.clear();
  applyFilters();
  renderPrices();
}

function getDisplayHistory(item: PriceItem): SparklineHistoryPoint[] | undefined {
  const cloudHistory = last7DayHistoryByItem[item.baseId];
  if (cloudHistory && cloudHistory.length > 0) {
    const cached = cloudSparklineHistoryCache.get(item.baseId);
    if (cached) return cached;

    const mapped = cloudHistory.map(point => ({ date: point.date, price: point.price, timestamp: point.timestamp }));
    cloudSparklineHistoryCache.set(item.baseId, mapped);
    return mapped;
  }

  return item.history;
}

function getTrendPercentForSort(item: PriceItem): number {
  if (item.price <= 0) return 0;
  const history = getDisplayHistory(item);
  return calculateTrendFromHistory(history).percent;
}

function scheduleSparklineRender(renderData: RenderRowData[]): void {
  const requestVersion = ++sparklineRenderRequestVersion;
  let index = 0;

  const renderChunk = () => {
    if (requestVersion !== sparklineRenderRequestVersion) return;

    const chunkEnd = Math.min(index + SPARKLINES_PER_FRAME, renderData.length);
    for (; index < chunkEnd; index += 1) {
      const rowData = renderData[index];
      const canvas = document.getElementById(`sparkline-${rowData.item.baseId}`) as HTMLCanvasElement | null;
      if (!canvas) continue;

      const prices = generateSparklineData(rowData.history, rowData.item.price);
      renderSparkline(canvas, prices, rowData.trendData.trend);
    }

    if (index < renderData.length) {
      requestAnimationFrame(renderChunk);
    }
  };

  requestAnimationFrame(renderChunk);
}

/**
 * Load and process price data
 */
export async function loadPrices(): Promise<void> {
  try {
    const [db, cloudSyncStatus] = await Promise.all([
      electronAPI.getItemDatabase(),
      electronAPI.getCloudSyncStatus()
    ]);

    itemDatabase = db;
    isCloudSyncEnabledForPrices = !!cloudSyncStatus?.enabled;
    let allItems: PriceItem[] = [];

    if (isCloudSyncEnabledForPrices) {
      // Cloud-enabled mode: avoid showing stale local cache values while cloud history loads.
      const historyByItem = await electronAPI.getPriceHistoryBatch({ leagueId: currentLeagueId, maxDays: 7, maxSnapshotDocs: 160 });
      last7DayHistoryByItem = historyByItem ?? {};
      cloudSparklineHistoryCache.clear();
      last7HistoryLoadedAt = Date.now();
      last7HistoryLeagueId = currentLeagueId;
      priceCache = {};
      const cloudItems: PriceItem[] = [];
      Object.entries(itemDatabase).forEach(([baseId, itemData]) => {
        if (baseId === FLAME_ELEMENTIUM_ID) {
          return;
        }
        if (itemData.tradable === false) {
          return;
        }

        const name = itemData.name || `Unknown Item (${baseId})`;
        const cloudHistoryRaw = last7DayHistoryByItem[baseId] ?? [];
        const cloudHistory = [...cloudHistoryRaw].sort((a, b) => a.timestamp - b.timestamp);
        const latestPoint = cloudHistory.length > 0 ? cloudHistory[cloudHistory.length - 1] : null;
        const history = cloudHistory.map(point => ({ date: point.date, price: point.price, timestamp: point.timestamp }));
        const price = latestPoint?.price ?? 0;
        const timestamp = latestPoint?.timestamp ?? 0;
        const listingCount = latestPoint?.listingCount;
        const trendData = price > 0
          ? calculateTrendFromHistory(history)
          : { trend: 'neutral' as const, percent: 0 };

        cloudItems.push({
          baseId,
          name,
          price,
          timestamp,
          listingCount,
          trend: trendData.trend,
          trendPercent: trendData.percent,
          group: itemData.group,
          history
        });
      });
      allItems = cloudItems.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      // Cloud-disabled mode: rely only on local cache, no cloud DB reads.
      const cache = await electronAPI.getPriceCache();
      priceCache = cache;
      last7DayHistoryByItem = {};
      cloudSparklineHistoryCache.clear();
      last7HistoryLoadedAt = 0;
      last7HistoryLeagueId = '';
      const localItems: PriceItem[] = [];
      Object.entries(itemDatabase).forEach(([baseId, itemData]) => {
        if (baseId === FLAME_ELEMENTIUM_ID) {
          return;
        }
        if (itemData.tradable === false) {
          return;
        }

        const name = itemData.name || `Unknown Item (${baseId})`;
        const cachedEntry = priceCache[baseId];
        const price = cachedEntry?.price ?? 0;
        const timestamp = cachedEntry?.timestamp ?? 0;
        const listingCount = cachedEntry?.listingCount;
        const history = cachedEntry?.history as SparklineHistoryPoint[] | undefined;
        const trendData = price > 0
          ? calculateTrendFromHistory(history)
          : { trend: 'neutral' as const, percent: 0 };

        localItems.push({
          baseId,
          name,
          price,
          timestamp,
          listingCount,
          trend: trendData.trend,
          trendPercent: trendData.percent,
          group: itemData.group,
          history
        });
      });
      allItems = localItems.sort((a, b) => a.name.localeCompare(b.name));
    }
    
    allPriceItems = allItems;
    if (selectedBaseId && !allPriceItems.some(item => item.baseId === selectedBaseId)) {
      selectedBaseId = null;
      detailRequestVersion += 1;
      setDetailViewMode(false);
      if (detailChart) {
        const existingTooltip = document.getElementById('pricesDetailChartTooltip');
        if (existingTooltip) {
          existingTooltip.remove();
        }
        detailChart.destroy();
        detailChart = null;
      }
    }
    applyFilters();
    renderPrices();

    if (selectedBaseId) {
      const history = getDetailHistoryForItem(selectedBaseId);
      applyDetailHistory(history, false);
      const selectedItem = allPriceItems.find(item => item.baseId === selectedBaseId);
      if (selectedItem) {
        updateDetailPriceStats(selectedBaseId, selectedItem.price, history);
      }
    }
  } catch (error) {
    console.error('Failed to load prices:', error);
  }
}

/**
 * Apply both group and search filters
 */
function applyFilters(): void {
  let items = [...allPriceItems];
  
  // If there's a search term, ignore group filter and search across all items
  if (currentSearchTerm) {
    const term = currentSearchTerm.toLowerCase();
    items = items.filter(item =>
      item.name.toLowerCase().includes(term) ||
      item.baseId.toLowerCase().includes(term)
    );
  } else {
    // Only apply group filter when there's no search term
    if (currentGroup !== 'all') {
      items = items.filter(item => item.group === currentGroup);
    }
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
  if (isDetailViewOpen) {
    detailRequestVersion += 1;
    setDetailViewMode(false);
  }
  
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
  const pricesBody = document.getElementById('pricesTableBody');
  const seasonSelect = document.getElementById('pricesSeasonSelect') as HTMLSelectElement | null;
  const detailBackBtn = document.getElementById('pricesDetailBackBtn');
  const detailNameBtn = document.getElementById('pricesDetailName') as HTMLButtonElement | null;
  const rangeSliderShell = document.getElementById('pricesRangeSliderShell') as HTMLElement | null;
  const rangeNavShell = document.getElementById('pricesRangeNavigatorShell') as HTMLElement | null;
  const rangeMainSelection = document.getElementById('pricesRangeMainSelection') as HTMLElement | null;
  const rangeNavSelection = document.getElementById('pricesRangeNavigatorSelection') as HTMLElement | null;
  const rangeStartInput = document.getElementById('pricesRangeStart') as HTMLInputElement | null;
  const rangeEndInput = document.getElementById('pricesRangeEnd') as HTMLInputElement | null;
  const navStartInput = document.getElementById('pricesRangeNavigatorStart') as HTMLInputElement | null;
  const navEndInput = document.getElementById('pricesRangeNavigatorEnd') as HTMLInputElement | null;
  
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

  if (pricesBody) {
    pricesBody.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const row = target.closest('tr[data-base-id]') as HTMLElement | null;
      const baseId = row?.getAttribute('data-base-id');
      if (baseId) {
        void showItemDetail(baseId);
      }
    });
  }

  if (seasonSelect) {
    currentLeagueId = normalizeLeagueId(seasonSelect.value);
    seasonSelect.value = currentLeagueId;
    seasonSelect.addEventListener('change', () => {
      currentLeagueId = normalizeLeagueId(seasonSelect.value);
      seasonSelect.value = currentLeagueId;
      detailHistoryCache.clear();
      detailHistoryLoadedKeys.clear();
      detailFullHistory = [];
      detailRangeStartIndex = 0;
      detailRangeEndIndex = 0;
      updateRangeControlsUi();
      list7HistoryRequestVersion += 1;
      detail90HistoryRequestVersion += 1;
      last7DayHistoryByItem = {};
      cloudSparklineHistoryCache.clear();
      last7HistoryLoadedAt = 0;
      last7HistoryLeagueId = '';
      void loadPrices();
      if (isDetailViewOpen && selectedBaseId) {
        void showItemDetail(selectedBaseId);
      }
    });
  }

  if (detailBackBtn) {
    detailBackBtn.addEventListener('click', () => {
      detailRequestVersion += 1;
      setDetailViewMode(false);
    });
  }

  if (detailNameBtn) {
    detailNameBtn.addEventListener('click', () => {
      const url = detailNameBtn.dataset.tlidbUrl;
      if (url) {
        electronAPI.openExternal(url);
      }
    });
  }

  if (rangeStartInput) {
    rangeStartInput.addEventListener('pointerdown', () => setActiveRangeHandle('start'));
    rangeStartInput.addEventListener('focus', () => setActiveRangeHandle('start'));
    rangeStartInput.addEventListener('input', () => {
      if (detailFullHistory.length === 0) return;
      const nextStart = Number(rangeStartInput.value);
      if (!Number.isFinite(nextStart)) return;
      setDetailRange(nextStart, detailRangeEndIndex);
    });
  }

  if (rangeEndInput) {
    rangeEndInput.addEventListener('pointerdown', () => setActiveRangeHandle('end'));
    rangeEndInput.addEventListener('focus', () => setActiveRangeHandle('end'));
    rangeEndInput.addEventListener('input', () => {
      if (detailFullHistory.length === 0) return;
      const nextEnd = Number(rangeEndInput.value);
      if (!Number.isFinite(nextEnd)) return;
      setDetailRange(detailRangeStartIndex, nextEnd);
    });
  }

  if (navStartInput) {
    navStartInput.addEventListener('pointerdown', () => setActiveRangeHandle('start'));
    navStartInput.addEventListener('focus', () => setActiveRangeHandle('start'));
    navStartInput.addEventListener('input', () => {
      if (detailFullHistory.length === 0) return;
      const nextStart = Number(navStartInput.value);
      if (!Number.isFinite(nextStart)) return;
      setDetailRange(nextStart, detailRangeEndIndex);
    });
  }

  if (navEndInput) {
    navEndInput.addEventListener('pointerdown', () => setActiveRangeHandle('end'));
    navEndInput.addEventListener('focus', () => setActiveRangeHandle('end'));
    navEndInput.addEventListener('input', () => {
      if (detailFullHistory.length === 0) return;
      const nextEnd = Number(navEndInput.value);
      if (!Number.isFinite(nextEnd)) return;
      setDetailRange(detailRangeStartIndex, nextEnd);
    });
  }

  if (rangeSliderShell) {
    rangeSliderShell.addEventListener('pointerdown', event => onRangeShellPointerDown(event, 'main'));
  }
  if (rangeNavShell) {
    rangeNavShell.addEventListener('pointerdown', event => onRangeShellPointerDown(event, 'nav'));
  }
  if (rangeMainSelection) {
    rangeMainSelection.addEventListener('pointerdown', event => startRangeSelectionDrag(event, 'main'));
  }
  if (rangeNavSelection) {
    rangeNavSelection.addEventListener('pointerdown', event => startRangeSelectionDrag(event, 'nav'));
  }
  document.addEventListener('pointermove', onRangeSelectionPointerMove);
  document.addEventListener('pointerup', event => stopRangeSelectionDrag(event));
  document.addEventListener('pointercancel', event => stopRangeSelectionDrag(event));
  
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

  // Keep startup fast by lazy-loading prices only when the page is opened.
  setActiveRangeHandle('end');
  updateRangeControlsUi();
  setDetailViewMode(false);
  
  // Listen for inventory updates to refresh prices
  electronAPI.onInventoryUpdate(() => {
    const pricesPage = document.getElementById('page-prices');
    if (pricesPage?.classList.contains('active')) {
      loadPrices();
    }
  });
}
