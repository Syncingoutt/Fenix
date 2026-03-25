// Settings modal management

import { ElectronAPI } from '../types.js';
import { getIncludeTax, setIncludeTax } from '../state/settingsState.js';
import { formatKeybind } from '../utils/formatting.js';
import { getCurrentItems } from '../state/inventoryState.js';
import { resizeGraph } from '../graph/graphManager.js';
import { showSyncDisableConfirmModal } from './syncDisableConfirmModal.js';
import { showSetupModal } from './setupModal.js';
import { updateUsernameDisplay } from '../settings/settingsManager.js';

declare const electronAPI: ElectronAPI;

let isRecordingKeybind = false;
let currentSettings: { keybind?: string; fullscreenMode?: boolean; includeTax?: boolean; leagueId?: string; layoutStyle?: 1 | 2 } = {};
let currentUsernameInfo: { username?: string; tag?: string; displayName?: string; nextChangeAt?: number; canChange: boolean } | null = null;
let pendingKeybind: string | null = null;
let pendingFullscreenMode: boolean | null = null;
let pendingIncludeTax: boolean | null = null;
let pendingUsername: string | null = null;
let pendingCloudSyncEnabled: boolean | null = null;
let pendingLayoutStyle: 1 | 2 | null = null;
let currentCloudSyncEnabled: boolean | null = null;

let settingsMenuOpen = false;
let renderInventory: () => void;
let renderBreakdown: () => void;
let updateStats: (items: any[]) => void;

const keybindInput = document.getElementById('keybindInput') as HTMLInputElement;
const changeKeybindBtn = document.getElementById('changeKeybindBtn') as HTMLButtonElement | null;
const resetKeybindBtn = document.getElementById('resetKeybindBtn') as HTMLButtonElement;
const keybindStatus = document.getElementById('keybindStatus')!;
const settingsSaveBtn = document.getElementById('settingsSaveBtn') as HTMLButtonElement | null;
const settingsToast = document.getElementById('settingsToast')!;
const generalSection = document.getElementById('generalSection')!;
const preferencesSection = document.getElementById('preferencesSection')!;
const fullscreenModeRadio = document.getElementById('fullscreenModeRadio') as HTMLInputElement;
const normalModeRadio = document.getElementById('normalModeRadio') as HTMLInputElement;
const includeTaxCheckbox = document.getElementById('includeTaxCheckbox') as HTMLInputElement | null;
const usernameInput = document.getElementById('usernameInput') as HTMLInputElement | null;
const usernameTagDisplay = document.getElementById('usernameTagDisplay') as HTMLElement | null;
const usernameHelperText = document.getElementById('usernameHelperText') as HTMLElement | null;
const cloudSyncCheckbox = document.getElementById('cloudSyncCheckbox') as HTMLInputElement | null;
const cloudSyncHelperText = document.getElementById('cloudSyncHelperText') as HTMLElement | null;
const changeLogPathBtn = document.getElementById('changeLogPathBtn') as HTMLButtonElement | null;
const logPathHelpBtn = document.getElementById('logPathHelpBtn') as HTMLButtonElement | null;
const logPathHelperText = document.getElementById('logPathHelperText') as HTMLElement | null;
const layoutStyle1Radio = document.getElementById('layoutStyle1Radio') as HTMLInputElement | null;
const layoutStyle2Radio = document.getElementById('layoutStyle2Radio') as HTMLInputElement | null;
const settingsSidebarItems = document.querySelectorAll('.settings-sidebar-item');

function applyLayoutStyle(style: 1 | 2): void {
  if (style === 1) {
    document.body.classList.add('layout-style-1');
  } else {
    document.body.classList.remove('layout-style-1');
  }
  resizeGraph();
}

async function saveSettingsNow(): Promise<void> {
  settingsSaveBtn?.setAttribute('disabled', 'true');
  if (settingsSaveBtn) settingsSaveBtn.textContent = 'Saving...';

  try {
    const settingsToSave: { keybind?: string; fullscreenMode?: boolean; includeTax?: boolean; leagueId?: string; layoutStyle?: 1 | 2 } = {};

    if (pendingKeybind) {
      settingsToSave.keybind = pendingKeybind;
    }

    if (pendingFullscreenMode !== null) {
      settingsToSave.fullscreenMode = pendingFullscreenMode;
    }

    const checkboxElement = document.getElementById('includeTaxCheckbox') as HTMLInputElement | null;
    const currentTaxValue = checkboxElement ? checkboxElement.checked : (pendingIncludeTax ?? false);
    settingsToSave.includeTax = currentTaxValue;

    const layoutStyleValue = layoutStyle2Radio?.checked ? 2 : (pendingLayoutStyle ?? 1);
    settingsToSave.layoutStyle = layoutStyleValue;

    if (pendingCloudSyncEnabled !== null && currentCloudSyncEnabled !== null) {
      if (pendingCloudSyncEnabled !== currentCloudSyncEnabled) {
        if (!pendingCloudSyncEnabled) {
          const confirmDisable = await showSyncDisableConfirmModal();
          if (!confirmDisable) {
            if (cloudSyncCheckbox) {
              cloudSyncCheckbox.checked = currentCloudSyncEnabled;
            }
            pendingCloudSyncEnabled = currentCloudSyncEnabled;
          } else {
            const syncResult = await electronAPI.setCloudSyncEnabled(false);
            if (!syncResult.success) {
              settingsToast.textContent = syncResult.error || 'Failed to update Cloud Sync';
              settingsToast.className = 'settings-toast error show';
              settingsSaveBtn?.removeAttribute('disabled');
              if (settingsSaveBtn) settingsSaveBtn.textContent = 'Save';
              return;
            } else {
              currentCloudSyncEnabled = false;
            }
          }
        } else {
            const syncResult = await electronAPI.setCloudSyncEnabled(true);
            if (!syncResult.success) {
              settingsToast.textContent = syncResult.error || 'Failed to update Cloud Sync';
              settingsToast.className = 'settings-toast error show';
              settingsSaveBtn?.removeAttribute('disabled');
              if (settingsSaveBtn) settingsSaveBtn.textContent = 'Save';
              return;
            } else {
            currentCloudSyncEnabled = true;
          }
        }
      }
    }

    const result = await electronAPI.saveSettings(settingsToSave);

    if (result.success) {
      currentSettings = { ...currentSettings, ...settingsToSave };

      if (settingsToSave.layoutStyle !== undefined) {
        applyLayoutStyle(settingsToSave.layoutStyle);
        pendingLayoutStyle = settingsToSave.layoutStyle;
      }

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
      updateStats(getCurrentItems());

      settingsToast.textContent = 'Saved';
      settingsToast.className = 'settings-toast success show';

      keybindStatus.textContent = '';
      keybindStatus.className = 'keybind-status';

      if (cloudSyncCheckbox && cloudSyncHelperText && currentCloudSyncEnabled !== null) {
        cloudSyncCheckbox.checked = currentCloudSyncEnabled;
        cloudSyncHelperText.textContent = currentCloudSyncEnabled
          ? 'Cloud Sync is enabled. Disabling it will stop all cloud reads and writes.'
          : 'Cloud Sync is disabled. You will only see local prices.';
      }

      setTimeout(() => {
        settingsToast.classList.remove('show');
      }, 2000);
    } else {
      settingsToast.textContent = result.error || 'Failed to save settings';
      settingsToast.className = 'settings-toast error show';

      keybindStatus.textContent = '';
      keybindStatus.className = 'keybind-status';
    }
  } catch (error: any) {
    settingsToast.textContent = error.message || 'Failed to save settings';
    settingsToast.className = 'settings-toast error show';

    keybindStatus.textContent = '';
    keybindStatus.className = 'keybind-status';
  } finally {
    settingsSaveBtn?.removeAttribute('disabled');
    if (settingsSaveBtn) settingsSaveBtn.textContent = 'Save';
  }
}

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
      const myAccountMenu = document.getElementById('myAccountMenu');
      if (myAccountMenu) {
        myAccountMenu.style.display = 'none';
      }
      const myAccountButton = document.getElementById('myAccountButton');
      if (myAccountButton) {
        myAccountButton.classList.remove('active');
      }
      
      // Load current settings
      currentSettings = await electronAPI.getSettings();
      currentUsernameInfo = await electronAPI.getUsernameInfo();
      pendingKeybind = currentSettings.keybind || 'CommandOrControl+`';
      pendingFullscreenMode = currentSettings.fullscreenMode !== undefined ? currentSettings.fullscreenMode : false;
      pendingIncludeTax = currentSettings.includeTax !== undefined ? currentSettings.includeTax : false;
      setIncludeTax(pendingIncludeTax);
      pendingLayoutStyle = currentSettings.layoutStyle === 2 ? 2 : 1;
      pendingUsername = currentUsernameInfo.username || '';
      const cloudSyncStatus = await electronAPI.getCloudSyncStatus();
      currentCloudSyncEnabled = cloudSyncStatus.enabled;
      pendingCloudSyncEnabled = cloudSyncStatus.enabled;
      const currentLogPath = await electronAPI.getLogPath();
      
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

      if (layoutStyle1Radio && layoutStyle2Radio) {
        layoutStyle1Radio.checked = (pendingLayoutStyle ?? 1) === 1;
        layoutStyle2Radio.checked = (pendingLayoutStyle ?? 1) === 2;
      }

      // Set username input, tag (inline suffix), and next-change tip (only when can't change)
      if (usernameInput && usernameTagDisplay && usernameHelperText && currentUsernameInfo) {
        usernameInput.value = pendingUsername || '';
        usernameTagDisplay.textContent = currentUsernameInfo.tag ? `#${currentUsernameInfo.tag}` : '';
        if (currentUsernameInfo.canChange) {
          usernameHelperText.textContent = '';
          usernameHelperText.classList.add('hidden');
        } else if (currentUsernameInfo.nextChangeAt) {
          const nextChange = new Date(currentUsernameInfo.nextChangeAt).toLocaleString();
          usernameHelperText.textContent = `Next change available at ${nextChange}.`;
          usernameHelperText.classList.remove('hidden');
        } else {
          usernameHelperText.textContent = '';
          usernameHelperText.classList.add('hidden');
        }
      }

      if (cloudSyncCheckbox && cloudSyncHelperText && currentCloudSyncEnabled !== null) {
        cloudSyncCheckbox.checked = currentCloudSyncEnabled;
        cloudSyncHelperText.textContent = currentCloudSyncEnabled
          ? 'Cloud Sync is enabled. Disabling it will stop all cloud reads and writes.'
          : 'Cloud Sync is disabled. You will only see local prices.';
      }

      if (logPathHelperText) {
        logPathHelperText.textContent = currentLogPath ? `${currentLogPath}` : 'Current: Not set';
      }
      
      // Clear toast
      settingsToast.textContent = '';
      settingsToast.classList.remove('show', 'success', 'error');
      
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
      
      (window as any).navigateToPage?.('settings');
    });
  }
  
  // Click keybind input to start or cancel recording (same as old "Change" button)
  keybindInput.addEventListener('click', () => {
    if (isRecordingKeybind) {
      isRecordingKeybind = false;
      keybindInput.classList.remove('recording');
      keybindInput.value = formatKeybind(pendingKeybind || currentSettings.keybind || 'CommandOrControl+`');
      if (changeKeybindBtn) changeKeybindBtn.textContent = 'Change';
      keybindStatus.textContent = '';
      keybindStatus.className = 'keybind-status';
      keybindInput.blur();
    } else {
      isRecordingKeybind = true;
      keybindInput.classList.add('recording');
      keybindInput.value = 'Press keys...';
      if (changeKeybindBtn) changeKeybindBtn.textContent = 'Cancel';
      keybindStatus.textContent = 'Press your desired key combination';
      keybindStatus.className = 'keybind-status';
      keybindInput.focus();
    }
  });

  // Reset keybind button
  resetKeybindBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pendingKeybind = 'CommandOrControl+`';
    keybindInput.value = formatKeybind(pendingKeybind);
    keybindInput.classList.remove('recording');
    isRecordingKeybind = false;
    if (changeKeybindBtn) changeKeybindBtn.textContent = 'Change';
    keybindStatus.textContent = 'Reset to default keybind';
    keybindStatus.className = 'keybind-status';
    saveSettingsNow();
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
      if (changeKeybindBtn) changeKeybindBtn.textContent = 'Change';
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
        if (changeKeybindBtn) changeKeybindBtn.textContent = 'Change';
        keybindStatus.textContent = 'Keybind set successfully';
        keybindStatus.className = 'keybind-status success';
        saveSettingsNow();
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
      saveSettingsNow();
    }
  });

  normalModeRadio.addEventListener('change', () => {
    if (normalModeRadio.checked) {
      pendingFullscreenMode = false;
      saveSettingsNow();
    }
  });

  // Handle tax checkbox change
  if (includeTaxCheckbox) {
    includeTaxCheckbox.addEventListener('change', () => {
      if (includeTaxCheckbox) {
        pendingIncludeTax = includeTaxCheckbox.checked;
        saveSettingsNow();
      }
    });
  }

  if (usernameInput) {
    usernameInput.addEventListener('input', () => {
      pendingUsername = usernameInput.value.trim();
    });
  }

  const saveUsernameBtn = document.getElementById('saveUsernameBtn') as HTMLButtonElement | null;
  if (saveUsernameBtn && usernameInput && usernameTagDisplay && usernameHelperText) {
    saveUsernameBtn.addEventListener('click', async () => {
      const newUsername = usernameInput.value.trim();
      pendingUsername = newUsername;
      const currentUsername = currentUsernameInfo?.username ?? '';
      if (newUsername === currentUsername) {
        settingsToast.textContent = 'No change';
        settingsToast.className = 'settings-toast success show';
        setTimeout(() => settingsToast.classList.remove('show'), 1500);
        return;
      }
      saveUsernameBtn.disabled = true;
      saveUsernameBtn.textContent = 'Saving...';
      try {
        const usernameResult = await electronAPI.setUsername(newUsername);
        if (usernameResult.success) {
          currentUsernameInfo = await electronAPI.getUsernameInfo();
          if (currentUsernameInfo) {
            usernameInput.value = currentUsernameInfo.username || '';
            usernameTagDisplay.textContent = currentUsernameInfo.tag ? `#${currentUsernameInfo.tag}` : '';
            if (currentUsernameInfo.canChange) {
              usernameHelperText.textContent = '';
              usernameHelperText.classList.add('hidden');
            } else if (currentUsernameInfo.nextChangeAt) {
              const nextChange = new Date(currentUsernameInfo.nextChangeAt).toLocaleString();
              usernameHelperText.textContent = `Next change available at ${nextChange}.`;
              usernameHelperText.classList.remove('hidden');
            } else {
              usernameHelperText.textContent = '';
              usernameHelperText.classList.add('hidden');
            }
          }
          updateUsernameDisplay();
          settingsToast.textContent = 'Saved';
          settingsToast.className = 'settings-toast success show';
          setTimeout(() => settingsToast.classList.remove('show'), 2000);
        } else {
          settingsToast.textContent = usernameResult.error || 'Failed to update username';
          settingsToast.className = 'settings-toast error show';
        }
      } catch (e: any) {
        settingsToast.textContent = e?.message || 'Failed to update username';
        settingsToast.className = 'settings-toast error show';
      } finally {
        saveUsernameBtn.disabled = false;
        saveUsernameBtn.textContent = 'Save';
      }
    });
  }

  if (cloudSyncCheckbox) {
    cloudSyncCheckbox.addEventListener('change', () => {
      pendingCloudSyncEnabled = cloudSyncCheckbox.checked;
      saveSettingsNow();
    });
  }

  if (layoutStyle1Radio) {
    layoutStyle1Radio.addEventListener('change', () => {
      if (layoutStyle1Radio.checked) {
        pendingLayoutStyle = 1;
        saveSettingsNow();
      }
    });
  }
  if (layoutStyle2Radio) {
    layoutStyle2Radio.addEventListener('change', () => {
      if (layoutStyle2Radio.checked) {
        pendingLayoutStyle = 2;
        saveSettingsNow();
      }
    });
  }

  if (changeLogPathBtn) {
    changeLogPathBtn.addEventListener('click', async () => {
      const selectedPath = await electronAPI.selectLogFile();
      if (selectedPath && logPathHelperText) {
        logPathHelperText.textContent = `${selectedPath}`;
      }
    });
  }

  if (logPathHelpBtn) {
    logPathHelpBtn.addEventListener('click', () => {
      showSetupModal();
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
}

function closeSettingsModal(): void {
  (window as any).navigateToPage?.('home');
  isRecordingKeybind = false;
  keybindInput.classList.remove('recording');
  if (changeKeybindBtn) changeKeybindBtn.textContent = 'Change';
  pendingKeybind = null;
  pendingFullscreenMode = null;
  pendingIncludeTax = null;
  pendingUsername = null;
  pendingCloudSyncEnabled = null;
  pendingLayoutStyle = null;
  currentCloudSyncEnabled = null;
}

export { closeSettingsModal };
