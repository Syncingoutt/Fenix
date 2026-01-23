// Settings modal management

import { ElectronAPI } from '../types.js';
import { getIncludeTax, setIncludeTax } from '../state/settingsState.js';
import { formatKeybind } from '../utils/formatting.js';

declare const electronAPI: ElectronAPI;

let isRecordingKeybind = false;
let currentSettings: { keybind?: string; fullscreenMode?: boolean; includeTax?: boolean } = {};
let pendingKeybind: string | null = null;
let pendingFullscreenMode: boolean | null = null;
let pendingIncludeTax: boolean | null = null;

let settingsMenuOpen = false;
let renderInventory: () => void;
let renderBreakdown: () => void;
let updateStats: (items: any[]) => void;

const settingsModal = document.getElementById('settingsModal')!;
const settingsCloseBtn = document.getElementById('settingsCloseBtn') as HTMLButtonElement;
const keybindInput = document.getElementById('keybindInput') as HTMLInputElement;
const changeKeybindBtn = document.getElementById('changeKeybindBtn') as HTMLButtonElement;
const resetKeybindBtn = document.getElementById('resetKeybindBtn') as HTMLButtonElement;
const keybindStatus = document.getElementById('keybindStatus')!;
const settingsSaveBtn = document.getElementById('settingsSaveBtn') as HTMLButtonElement;
const settingsFooterMessage = document.getElementById('settingsFooterMessage')!;
const generalSection = document.getElementById('generalSection')!;
const preferencesSection = document.getElementById('preferencesSection')!;
const fullscreenModeRadio = document.getElementById('fullscreenModeRadio') as HTMLInputElement;
const normalModeRadio = document.getElementById('normalModeRadio') as HTMLInputElement;
const includeTaxCheckbox = document.getElementById('includeTaxCheckbox') as HTMLInputElement | null;
const settingsSidebarItems = document.querySelectorAll('.settings-sidebar-item');

export function initSettingsModal(
  inventoryRenderer: () => void,
  breakdownRenderer: () => void,
  statsUpdater: (items: any[]) => void,
  settingsMenuState: { open: boolean }
): void {
  renderInventory = inventoryRenderer;
  renderBreakdown = breakdownRenderer;
  updateStats = statsUpdater;
  settingsMenuOpen = settingsMenuState.open;
  
  // Open settings modal
  const openSettingsBtn = document.getElementById('openSettingsBtn') as HTMLButtonElement;
  if (openSettingsBtn) {
    openSettingsBtn.addEventListener('click', async () => {
      settingsMenuState.open = false;
      const settingsMenu = document.getElementById('settingsMenu');
      if (settingsMenu) {
        settingsMenu.style.display = 'none';
      }
      
      // Load current settings
      currentSettings = await electronAPI.getSettings();
      pendingKeybind = currentSettings.keybind || 'CommandOrControl+`';
      pendingFullscreenMode = currentSettings.fullscreenMode !== undefined ? currentSettings.fullscreenMode : false;
      pendingIncludeTax = currentSettings.includeTax !== undefined ? currentSettings.includeTax : false;
      setIncludeTax(pendingIncludeTax);
      
      // Display current keybind
      keybindInput.value = formatKeybind(pendingKeybind);
      keybindStatus.textContent = '';
      keybindStatus.className = 'keybind-status';
      
      // Set window mode radio buttons
      if (pendingFullscreenMode) {
        fullscreenModeRadio.checked = true;
        normalModeRadio.checked = false;
      } else {
        fullscreenModeRadio.checked = false;
        normalModeRadio.checked = true;
      }
      
      // Set tax checkbox
      if (includeTaxCheckbox) {
        includeTaxCheckbox.checked = pendingIncludeTax;
      }
      
      // Reset save button state
      settingsSaveBtn.disabled = false;
      settingsSaveBtn.textContent = 'Save';
      
      // Clear footer message
      settingsFooterMessage.textContent = '';
      settingsFooterMessage.classList.remove('show', 'success', 'error');
      
      // Show general section by default
      generalSection.classList.add('active');
      preferencesSection.classList.remove('active');
      
      // Reset sidebar active state
      settingsSidebarItems.forEach(item => {
        const section = item.getAttribute('data-section');
        if (section === 'general') {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }
      });
      
      settingsModal.classList.add('active');
    });
  }
  
  // Close settings modal
  settingsCloseBtn.addEventListener('click', () => {
    closeSettingsModal();
  });
  
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      closeSettingsModal();
    }
  });
  
  // Change keybind button
  changeKeybindBtn.addEventListener('click', () => {
    if (isRecordingKeybind) {
      isRecordingKeybind = false;
      keybindInput.classList.remove('recording');
      keybindInput.value = formatKeybind(pendingKeybind || currentSettings.keybind || 'CommandOrControl+`');
      changeKeybindBtn.textContent = 'Change';
      keybindStatus.textContent = '';
      keybindStatus.className = 'keybind-status';
      keybindInput.blur();
    } else {
      isRecordingKeybind = true;
      keybindInput.classList.add('recording');
      keybindInput.value = 'Press keys...';
      changeKeybindBtn.textContent = 'Cancel';
      keybindStatus.textContent = 'Press your desired key combination';
      keybindStatus.className = 'keybind-status';
      keybindInput.focus();
    }
  });
  
  // Reset keybind button
  resetKeybindBtn.addEventListener('click', () => {
    pendingKeybind = 'CommandOrControl+`';
    keybindInput.value = formatKeybind(pendingKeybind);
    keybindInput.classList.remove('recording');
    isRecordingKeybind = false;
    changeKeybindBtn.textContent = 'Change';
    keybindStatus.textContent = 'Reset to default keybind';
    keybindStatus.className = 'keybind-status';
  });
  
  // Keybind input - capture key presses
  keybindInput.addEventListener('keydown', async (e) => {
    if (!isRecordingKeybind) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const parts: string[] = [];
    
    if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    
    let key = '';
    if (e.key === '`' || e.key === '~') {
      key = '`';
    } else if (e.key === 'Escape') {
      isRecordingKeybind = false;
      keybindInput.classList.remove('recording');
      const currentKeybind = pendingKeybind || currentSettings.keybind || 'CommandOrControl+`';
      keybindInput.value = formatKeybind(currentKeybind);
      changeKeybindBtn.textContent = 'Change';
      keybindStatus.textContent = '';
      keybindStatus.className = 'keybind-status';
      keybindInput.blur();
      return;
    } else if (e.key.length === 1) {
      key = e.key.toLowerCase();
    } else if (e.key.startsWith('F') && e.key.length <= 3) {
      key = e.key;
    } else {
      const keyMap: { [key: string]: string } = {
        'Enter': 'Return',
        ' ': 'Space',
        'ArrowUp': 'Up',
        'ArrowDown': 'Down',
        'ArrowLeft': 'Left',
        'ArrowRight': 'Right',
        'Backspace': 'Backspace',
        'Delete': 'Delete',
        'Tab': 'Tab',
        'Home': 'Home',
        'End': 'End',
        'PageUp': 'PageUp',
        'PageDown': 'PageDown'
      };
      key = keyMap[e.key] || e.key;
    }
    
    if (key) {
      parts.push(key);
      const keybind = parts.join('+');
      
      const testResult = await electronAPI.testKeybind(keybind);
      
      if (testResult.success) {
        pendingKeybind = keybind;
        keybindInput.value = formatKeybind(keybind);
        keybindInput.classList.remove('recording');
        isRecordingKeybind = false;
        changeKeybindBtn.textContent = 'Change';
        keybindStatus.textContent = 'Keybind set successfully';
        keybindStatus.className = 'keybind-status success';
      } else {
        keybindStatus.textContent = testResult.error || 'Keybind is already in use';
        keybindStatus.className = 'keybind-status error';
      }
    }
  });
  
  // Handle window mode radio button changes
  fullscreenModeRadio.addEventListener('change', () => {
    if (fullscreenModeRadio.checked) {
      pendingFullscreenMode = true;
    }
  });
  
  normalModeRadio.addEventListener('change', () => {
    if (normalModeRadio.checked) {
      pendingFullscreenMode = false;
    }
  });
  
  // Handle tax checkbox change
  if (includeTaxCheckbox) {
    includeTaxCheckbox.addEventListener('change', () => {
      if (includeTaxCheckbox) {
        pendingIncludeTax = includeTaxCheckbox.checked;
      }
    });
  }
  
  // Sidebar navigation
  settingsSidebarItems.forEach(item => {
    item.addEventListener('click', () => {
      const section = item.getAttribute('data-section');
      if (!section) return;
      
      settingsSidebarItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      
      if (section === 'general') {
        generalSection.classList.add('active');
        preferencesSection.classList.remove('active');
      } else if (section === 'preferences') {
        generalSection.classList.remove('active');
        preferencesSection.classList.add('active');
      }
    });
  });
  
  // Save settings
  settingsSaveBtn.addEventListener('click', async () => {
    settingsSaveBtn.disabled = true;
    settingsSaveBtn.textContent = 'Saving...';
    
    try {
      const settingsToSave: { keybind?: string; fullscreenMode?: boolean; includeTax?: boolean } = {};
      
      if (pendingKeybind) {
        settingsToSave.keybind = pendingKeybind;
      }
      
      if (pendingFullscreenMode !== null) {
        settingsToSave.fullscreenMode = pendingFullscreenMode;
      }
      
      const checkboxElement = document.getElementById('includeTaxCheckbox') as HTMLInputElement | null;
      const currentTaxValue = checkboxElement ? checkboxElement.checked : (pendingIncludeTax ?? false);
      settingsToSave.includeTax = currentTaxValue;
      
      const result = await electronAPI.saveSettings(settingsToSave);
      
      if (result.success) {
        currentSettings = { ...currentSettings, ...settingsToSave };
        
        if (settingsToSave.keybind) {
          pendingKeybind = settingsToSave.keybind;
        }
        if (settingsToSave.fullscreenMode !== undefined) {
          pendingFullscreenMode = settingsToSave.fullscreenMode;
        }
        
        setIncludeTax(currentTaxValue);
        pendingIncludeTax = currentTaxValue;
        
        renderInventory();
        renderBreakdown();
        // Get current items from state for stats update
        const { getCurrentItems } = require('../state/inventoryState');
        updateStats(getCurrentItems());
        
        settingsFooterMessage.textContent = 'Settings saved successfully';
        settingsFooterMessage.className = 'settings-footer-message success show';
        
        keybindStatus.textContent = '';
        keybindStatus.className = 'keybind-status';
        
        settingsSaveBtn.disabled = false;
        settingsSaveBtn.textContent = 'Save';
        
        setTimeout(() => {
          settingsFooterMessage.classList.remove('show');
        }, 3000);
      } else {
        settingsFooterMessage.textContent = result.error || 'Failed to save settings';
        settingsFooterMessage.className = 'settings-footer-message error show';
        
        keybindStatus.textContent = '';
        keybindStatus.className = 'keybind-status';
        
        settingsSaveBtn.disabled = false;
        settingsSaveBtn.textContent = 'Save';
      }
    } catch (error: any) {
      settingsFooterMessage.textContent = error.message || 'Failed to save settings';
      settingsFooterMessage.className = 'settings-footer-message error show';
      
      keybindStatus.textContent = '';
      keybindStatus.className = 'keybind-status';
      
      settingsSaveBtn.disabled = false;
      settingsSaveBtn.textContent = 'Save';
    }
  });
}

function closeSettingsModal(): void {
  settingsModal.classList.remove('active');
  isRecordingKeybind = false;
  keybindInput.classList.remove('recording');
  changeKeybindBtn.textContent = 'Change';
  pendingKeybind = null;
  pendingFullscreenMode = null;
  pendingIncludeTax = null;
}

export { closeSettingsModal };
