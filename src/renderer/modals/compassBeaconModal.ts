// Compass/beacon selection modal

import { getCurrentItems, getItemDatabase } from '../state/inventoryState.js';
import { getIncludedItems, setIncludedItems, getCompassBeaconSelectionState, setCompassBeaconSelectionState } from '../state/wealthState.js';
import { actuallyStartHourlyTracking } from '../wealth/hourlyTracker.js';

interface CompassBeaconItem {
  baseId: string;
  itemName: string;
  group: string;
  quantity: number;
}

interface ItemGroup {
  key: string;
  title: string;
  items: CompassBeaconItem[];
  categorizer: (itemName: string, itemGroup: string, baseId: string) => boolean;
}

type CategorizerFunction = (itemName: string, itemGroup: string, baseId: string) => boolean;

const categorizers: Record<string, CategorizerFunction> = {
  resonance: (name, group, baseId) => 
    baseId === '5028' || baseId === '5040', // Netherrealm Resonance or Deep Space Resonance
  
  beaconsT8: (name, group, baseId) => 
    group === 'beacon' && (name.includes('(Timemark 8)') || name === 'Deep Space Beacon'),
  
  beaconsT7: (name, group, baseId) => 
    group === 'beacon' && (name.includes('(Timemark 7)') || (!name.includes('(Timemark 8)') && name !== 'Deep Space Beacon')),
  
  probes: (name, group, baseId) => 
    group === 'probe',
  
  scalpels: (name, group, baseId) => 
    group === 'scalpel',
  
  compasses: (name, group, baseId) => 
    group === 'compass'
};

const groupDefinitions: Omit<ItemGroup, 'items'>[] = [
  { key: 'resonance', title: 'Resonance', categorizer: categorizers.resonance },
  { key: 'beaconsT8', title: 'T8 Beacons', categorizer: categorizers.beaconsT8 },
  { key: 'beaconsT7', title: 'T7 Beacons', categorizer: categorizers.beaconsT7 },
  { key: 'probes', title: 'Probes', categorizer: categorizers.probes },
  { key: 'scalpels', title: 'Scalpels', categorizer: categorizers.scalpels },
  { key: 'compasses', title: 'Compasses/Astrolabes', categorizer: categorizers.compasses }
];

/**
 * Show the compass/beacon prompt modal
 */
export function showCompassBeaconPrompt(): void {
  const modal = document.getElementById('compassBeaconPromptModal');
  if (modal) {
    modal.classList.add('active');
  }
}

/**
 * Hide the compass/beacon prompt modal
 */
export function hideCompassBeaconPrompt(): void {
  const modal = document.getElementById('compassBeaconPromptModal');
  if (modal) {
    modal.classList.remove('active');
  }
}

/**
 * Show the compass/beacon selection modal
 */
export function showCompassBeaconSelection(): void {
  const modal = document.getElementById('compassBeaconSelectionModal');
  const container = document.getElementById('compassBeaconCheckboxes');
  const searchInput = document.getElementById('compassBeaconSearch') as HTMLInputElement;
  const helperActions = document.getElementById('compassBeaconHelperActions');
  
  if (!modal || !container) return;
  
  const currentItems = getCurrentItems();
  const itemDatabase = getItemDatabase();
  const includedItems = getIncludedItems();
  
  // Clear previous selections
  container.innerHTML = '';
  includedItems.clear();
  if (searchInput) {
    searchInput.value = '';
  }
  
  // Check for last selection and show restore option
  const lastSelectionJson = localStorage.getItem('lastCompassBeaconSelection');
  if (helperActions) {
    if (lastSelectionJson) {
      helperActions.style.display = 'block';
    } else {
      helperActions.style.display = 'none';
    }
  }
  
  // Initialize groups
  const itemGroups: ItemGroup[] = groupDefinitions.map(def => ({
    ...def,
    items: []
  }));
  
  // Collect and categorize items
  for (const [baseId, itemData] of Object.entries(itemDatabase)) {
    // Include compass, probe, scalpel, beacon, and currency (for resonance items)
    if (itemData.group === 'compass' || itemData.group === 'probe' || itemData.group === 'scalpel' || itemData.group === 'beacon' || itemData.group === 'currency') {
      const inventoryItem = currentItems.find(item => item.baseId === baseId);
      const item: CompassBeaconItem = {
        baseId,
        itemName: itemData.name,
        group: itemData.group,
        quantity: inventoryItem ? inventoryItem.totalQuantity : 0
      };
      
      // Find matching group using categorizer
      for (const itemGroup of itemGroups) {
        if (itemGroup.categorizer(itemData.name, itemData.group, baseId)) {
          itemGroup.items.push(item);
          break; // Item can only belong to one group
        }
      }
    }
  }
  
  // Sort all groups
  itemGroups.forEach(group => {
    group.items.sort((a, b) => a.itemName.localeCompare(b.itemName));
  });
  
  // Store original groups for filtering
  const allItemGroups = itemGroups;
  
  // Persistent checked items state - survives filtering/searching
  const checkedItemsSet = new Set<string>();
  
  // Always include Netherrealm Resonance 5028 (automatically selected)
  checkedItemsSet.add('5028');
  setCompassBeaconSelectionState(checkedItemsSet);
  
  // Helper: Sync checked state from DOM
  const syncCheckedItemsFromDOM = (): void => {
    const existingCheckboxes = container.querySelectorAll('input[type="checkbox"]:checked');
    existingCheckboxes.forEach(checkbox => {
      const baseId = (checkbox as HTMLInputElement).dataset.baseid;
      if (baseId) {
        checkedItemsSet.add(baseId);
      }
    });
  };
  
  // Helper: Update checked state when checkbox changes
  const handleCheckboxChange = (baseId: string, checked: boolean): void => {
    if (checked) {
      checkedItemsSet.add(baseId);
    } else {
      checkedItemsSet.delete(baseId);
    }
  };
  
  // Helper: Create checkbox element for an item
  const createCheckboxElement = (item: CompassBeaconItem): HTMLDivElement => {
    const checkboxDiv = document.createElement('div');
    checkboxDiv.className = 'compass-beacon-checkbox-item';
    
    const label = document.createElement('label');
    
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.baseid = item.baseId;
    input.dataset.type = item.group;
    input.checked = checkedItemsSet.has(item.baseId);
    
    input.addEventListener('change', () => {
      handleCheckboxChange(item.baseId, input.checked);
    });
    
    const checkboxLabel = document.createElement('span');
    checkboxLabel.className = 'checkbox-label';
    
    const icon = document.createElement('img');
    icon.src = `../../assets/${item.baseId}.webp`;
    icon.alt = item.itemName;
    icon.className = 'checkbox-icon';
    icon.onerror = () => { icon.style.display = 'none'; };
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = item.itemName;
    
    checkboxLabel.appendChild(icon);
    checkboxLabel.appendChild(nameSpan);
    
    if (item.quantity > 0) {
      const quantitySpan = document.createElement('span');
      quantitySpan.className = 'checkbox-quantity';
      quantitySpan.textContent = `(${item.quantity})`;
      checkboxLabel.appendChild(quantitySpan);
    }
    
    label.appendChild(input);
    label.appendChild(checkboxLabel);
    checkboxDiv.appendChild(label);
    
    return checkboxDiv;
  };
  
  // Helper: Render a single group
  const renderGroup = (group: ItemGroup): void => {
    if (group.items.length === 0) return;
    
    const header = document.createElement('div');
    header.className = 'compass-beacon-group-header';
    header.textContent = group.title;
    container.appendChild(header);
    
    const groupContainer = document.createElement('div');
    groupContainer.className = 'compass-beacon-group-items';
    
    group.items.forEach(item => {
      const checkboxElement = createCheckboxElement(item);
      groupContainer.appendChild(checkboxElement);
    });
    
    container.appendChild(groupContainer);
  };
  
  // Helper: Filter items in a group by search query
  const filterGroupItems = (group: ItemGroup, query: string): ItemGroup => {
    const lowerQuery = query.toLowerCase();
    return {
      ...group,
      items: group.items.filter(item => 
        item.itemName.toLowerCase().includes(lowerQuery)
      )
    };
  };
  
  // Function to render items based on search
  const renderItems = (groupsToRender: ItemGroup[], skipSync: boolean = false): void => {
    if (container.children.length > 0 && !skipSync) {
      syncCheckedItemsFromDOM();
    }
    
    container.innerHTML = '';
    
    groupsToRender.forEach(group => renderGroup(group));
    
    if (container.children.length === 0) {
      const noItemsDiv = document.createElement('div');
      noItemsDiv.style.textAlign = 'center';
      noItemsDiv.style.color = 'var(--border)';
      noItemsDiv.style.padding = '20px';
      noItemsDiv.textContent = 'No items found';
      container.appendChild(noItemsDiv);
    }
  };
  
  // Initial render
  renderItems(allItemGroups);
  
  // Add search functionality
  if (searchInput) {
    searchInput.oninput = (e) => {
      const query = (e.target as HTMLInputElement).value.trim();
      if (query === '') {
        renderItems(allItemGroups);
      } else {
        const filteredGroups = allItemGroups.map(group => filterGroupItems(group, query));
        renderItems(filteredGroups);
      }
    };
  }
  
  // Add Clear Selection button handler
  const clearBtn = document.getElementById('compassBeaconSelectionClear');
  if (clearBtn) {
    clearBtn.onclick = () => {
      checkedItemsSet.clear();
      checkedItemsSet.add('5028');

      const currentQuery = searchInput?.value.trim() || '';
      if (currentQuery === '') {
        renderItems(allItemGroups, true);
      } else {
        const filteredGroups = allItemGroups.map(group => filterGroupItems(group, currentQuery));
        renderItems(filteredGroups, true);
      }
    };
  }

  // Helper function to restore last selection
  const restoreLastSelection = (): void => {
    const lastSelectionJson = localStorage.getItem('lastCompassBeaconSelection');
    if (lastSelectionJson) {
      try {
        const lastSelection = JSON.parse(lastSelectionJson) as string[];

        checkedItemsSet.clear();
        lastSelection.forEach(baseId => {
          checkedItemsSet.add(baseId);
        });

        const currentQuery = searchInput?.value.trim() || '';
        if (currentQuery === '') {
          renderItems(allItemGroups, true);
        } else {
          const filteredGroups = allItemGroups.map(group => filterGroupItems(group, currentQuery));
          renderItems(filteredGroups, true);
        }

        // Also update the checkbox state to match
        if (restoreCheckbox) {
          restoreCheckbox.checked = true;
        }
      } catch (e) {
        console.error('Failed to restore last selection:', e);
        if (restoreCheckbox) {
          restoreCheckbox.checked = false;
        }
      }
    }
  };

  // Add Restore Last Selection handler
  const restoreCheckbox = document.getElementById('compassBeaconRestore') as HTMLInputElement;
  if (restoreCheckbox) {
    restoreCheckbox.addEventListener('change', () => {
      if (restoreCheckbox.checked) {
        restoreLastSelection();
      } else {
        // If unchecked, clear back to default (just 5028)
        checkedItemsSet.clear();
        checkedItemsSet.add('5028');

        const currentQuery = searchInput?.value.trim() || '';
        if (currentQuery === '') {
          renderItems(allItemGroups, true);
        } else {
          const filteredGroups = allItemGroups.map(group => filterGroupItems(group, currentQuery));
          renderItems(filteredGroups, true);
        }
      }
    });

    // If there's a last selection, auto-restore it on modal open
    const lastSelectionJson = localStorage.getItem('lastCompassBeaconSelection');
    if (lastSelectionJson) {
      restoreLastSelection();
    }
  }

  modal.classList.add('active');
}

/**
 * Hide the compass/beacon selection modal
 */
export function hideCompassBeaconSelection(): void {
  const modal = document.getElementById('compassBeaconSelectionModal');
  if (modal) {
    modal.classList.remove('active');
  }
  setCompassBeaconSelectionState(null);
}

/**
 * Handle compass/beacon selection confirmation
 */
export function handleCompassBeaconSelectionConfirm(): void {
  const includedItems = getIncludedItems();
  const selectionSet = getCompassBeaconSelectionState();
  
  includedItems.clear();
  
  if (selectionSet) {
    selectionSet.forEach(baseId => {
      includedItems.add(baseId);
    });
  } else {
    const checkboxes = document.querySelectorAll('#compassBeaconSelectionModal input[type="checkbox"]:checked');
    checkboxes.forEach(checkbox => {
      const baseId = (checkbox as HTMLInputElement).dataset.baseid;
      if (baseId) {
        includedItems.add(baseId);
      }
    });
  }
  
  // Save selection to localStorage
  const selectionArray = Array.from(includedItems);
  localStorage.setItem('lastCompassBeaconSelection', JSON.stringify(selectionArray));
  
  
  hideCompassBeaconSelection();
  actuallyStartHourlyTracking();
}
