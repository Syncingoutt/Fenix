interface InventoryItem {
  itemName: string;
  totalQuantity: number;
  baseId: string;
  price: number | null;
  instances: number;
  lastUpdated: string;
  pageId: number | null;
  slotId: number | null;
}

interface ElectronAPI {
  getInventory: () => Promise<InventoryItem[]>;
  onInventoryUpdate: (callback: () => void) => void;
}

declare const electronAPI: ElectronAPI;

let currentItems: InventoryItem[] = [];

// New sorting state
let currentSortBy: 'priceUnit' | 'priceTotal' = 'priceTotal';
let currentSortOrder: 'asc' | 'desc' = 'desc';

async function loadInventory() {
  const inventory = await electronAPI.getInventory();
  currentItems = inventory;
  renderInventory();
  updateStats(inventory);
}

function getSortedAndFilteredItems(): InventoryItem[] {
  const minPriceInput = document.getElementById('minPrice') as HTMLInputElement | null;
  const minPrice = parseFloat(minPriceInput?.value || '0') || 0;

  // Filter by minimum price
  let filtered = currentItems.filter(item => {
    if (item.price === null) return minPrice === 0;
    const totalValue = item.price * item.totalQuantity;
    return totalValue >= minPrice;
  });

  // Sort
  filtered.sort((a, b) => {
    let comparison = 0;

    if (currentSortBy === 'priceUnit') {
      const priceA = a.price ?? -1;
      const priceB = b.price ?? -1;
      comparison = priceA - priceB;
    } else if (currentSortBy === 'priceTotal') {
      const totalA = (a.price ?? 0) * a.totalQuantity;
      const totalB = (b.price ?? 0) * b.totalQuantity;
      comparison = totalA - totalB;
    }

    return currentSortOrder === 'asc' ? comparison : -comparison;
  });

  return filtered;
}

function getPageLabel(item: InventoryItem): string {
  if (item.pageId === null || item.slotId === null) return '';

  const pagePrefix = item.pageId === 102 ? 'P1' : item.pageId === 103 ? 'P2' : `P${item.pageId}`;
  const slotNumber = item.slotId + 1; // Add 1 for user-friendly numbering

  return `${pagePrefix}:${slotNumber}`;
}

function renderInventory() {
  const container = document.getElementById('inventory');
  if (!container) return;

  const items = getSortedAndFilteredItems();

  if (items.length === 0) {
    container.innerHTML = '<div class="loading">No items match your filters</div>';
    updateSortIndicators();
    return;
  }

  container.innerHTML = items.map(item => {
    const totalValue = item.price !== null ? item.price * item.totalQuantity : null;
    const pageLabel = getPageLabel(item);

    return `
      <div class="item-row">
        <div class="item-name">
          ${item.itemName}
          ${item.instances > 1 ? `<span style="color: #9ca3af; font-size: 14px;"> (${item.instances} stacks)</span>` : ''}
          ${pageLabel ? `<div style="color: white; opacity: 0.5; font-size: 12px; margin-top: 4px;">${pageLabel}</div>` : ''}
        </div>
        <div class="item-quantity">${item.totalQuantity.toLocaleString()}</div>
        <div class="item-price">
          <div class="price-single ${item.price === null ? 'no-price' : ''}" style="text-align: left;">
            ${item.price !== null ? item.price.toFixed(2) : 'Not Set'}
          </div>
          ${totalValue !== null ? `<div class="price-total" style="text-align: right;">${totalValue.toFixed(2)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');

  updateSortIndicators();
}

function updateStats(items: InventoryItem[]) {
  const itemsPriced = items.filter(item => item.price !== null).length;
  const totalValue = items.reduce((sum, item) => {
    if (item.price !== null) {
      return sum + (item.totalQuantity * item.price);
    }
    return sum;
  }, 0);

  const itemsPricedEl = document.getElementById('itemsPriced');
  const totalValueEl = document.getElementById('totalValue');

  if (itemsPricedEl) itemsPricedEl.textContent = `${itemsPriced}/${items.length}`;
  if (totalValueEl) totalValueEl.textContent = totalValue > 0 ? totalValue.toFixed(2) : '-';
}

// --- Sort indicator (▲ ▼)
function updateSortIndicators() {
  document.querySelectorAll('[data-sort]').forEach(el => {
    const sortType = (el as HTMLElement).dataset.sort;
    if (!sortType) return;

    (el as HTMLElement).textContent =
      sortType === 'priceUnit' ? 'Price' : 'Total';

    if (sortType === currentSortBy) {
      (el as HTMLElement).textContent += currentSortOrder === 'asc' ? ' ▲' : ' ▼';
    }
  });
}

// --- Event listeners ---

// Listen for Electron inventory updates
electronAPI.onInventoryUpdate(() => {
  loadInventory();
});

// Handle min price filter
document.getElementById('minPrice')?.addEventListener('input', renderInventory);

// Handle click sorting
document.querySelectorAll('[data-sort]').forEach(el => {
  el.addEventListener('click', () => {
    const sortType = (el as HTMLElement).dataset.sort as 'priceUnit' | 'priceTotal';
    if (!sortType) return;

    if (currentSortBy === sortType) {
      // Toggle direction if same column clicked
      currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      // Switch to new sort type
      currentSortBy = sortType;
      currentSortOrder = 'desc';
    }

    renderInventory();
  });
});

// Initial load
loadInventory();