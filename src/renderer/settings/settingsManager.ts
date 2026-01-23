// Settings menu and management

import { ElectronAPI } from '../types.js';
import { showUpdateModal, showDownloadProgress, updateDownloadProgress, transitionToInstallPrompt } from '../modals/updateModal.js';

declare const electronAPI: ElectronAPI;

let settingsMenuOpen = false;
let currentUpdateType: 'available' | 'downloaded' | null = null;

const settingsButton = document.getElementById('settingsButton')!;
const settingsMenu = document.getElementById('settingsMenu')!;
const appVersionEl = document.getElementById('appVersion')!;
const checkUpdatesBtn = document.getElementById('checkUpdatesBtn') as HTMLButtonElement;
const updateSpinner = document.getElementById('updateSpinner')!;
const updateStatus = document.getElementById('updateStatus')!;

/**
 * Initialize settings menu
 */
export function initSettingsManager(): { open: boolean } {
  // Load app version
  electronAPI.getAppVersion().then(version => {
    if (appVersionEl) {
      appVersionEl.textContent = version;
    }
  });
  
  // Toggle settings menu
  settingsButton.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsMenuOpen = !settingsMenuOpen;
    settingsMenu.style.display = settingsMenuOpen ? 'block' : 'none';
  });
  
  // Close settings menu when clicking outside
  document.addEventListener('click', (e) => {
    if (settingsMenuOpen && !settingsMenu.contains(e.target as Node) && !settingsButton.contains(e.target as Node)) {
      settingsMenuOpen = false;
      settingsMenu.style.display = 'none';
    }
  });
  
  // Check for updates button
  checkUpdatesBtn.addEventListener('click', async () => {
    checkUpdatesBtn.disabled = true;
    updateSpinner.style.display = 'inline-block';
    updateStatus.style.display = 'none';
    
    try {
      const result = await electronAPI.checkForUpdates();
      if (!result.success) {
        updateStatus.textContent = result.message || 'Failed to check for updates';
        updateStatus.className = 'update-status error';
        updateStatus.style.display = 'block';
        checkUpdatesBtn.disabled = false;
        updateSpinner.style.display = 'none';
      }
    } catch (error: any) {
      updateStatus.textContent = error.message || 'Failed to check for updates';
      updateStatus.className = 'update-status error';
      updateStatus.style.display = 'block';
      checkUpdatesBtn.disabled = false;
      updateSpinner.style.display = 'none';
    }
  });
  
  // Listen for update status events
  electronAPI.onUpdateStatus((data) => {
    updateSpinner.style.display = 'none';
    updateStatus.style.display = 'block';
    
    switch (data.status) {
      case 'checking':
        updateStatus.textContent = 'Checking for updates...';
        updateStatus.className = 'update-status info';
        break;
      case 'available':
        updateStatus.textContent = `Update available: ${data.version}. Downloading...`;
        updateStatus.className = 'update-status success';
        // For manual checks, download starts automatically, so show progress modal
        if (currentUpdateType === null) {
          showUpdateModal('available', data.version || '');
          showDownloadProgress();
        }
        break;
      case 'not-available':
        updateStatus.textContent = 'You are up to date!';
        updateStatus.className = 'update-status success';
        checkUpdatesBtn.disabled = false;
        break;
      case 'downloading':
        updateStatus.textContent = data.message || 'Downloading update...';
        updateStatus.className = 'update-status info';
        break;
      case 'downloaded':
        updateStatus.textContent = 'Update downloaded! Restart to install.';
        updateStatus.className = 'update-status success';
        checkUpdatesBtn.disabled = false;
        // Transition to install prompt if modal is showing
        const updateModal = document.getElementById('updateModal');
        if (updateModal && updateModal.classList.contains('active')) {
          transitionToInstallPrompt(data.version || '');
        }
        break;
      case 'error':
        updateStatus.textContent = data.message || 'Error checking for updates';
        updateStatus.className = 'update-status error';
        checkUpdatesBtn.disabled = false;
        break;
    }
  });
  
  // Listen for download progress
  electronAPI.onUpdateProgress((percent) => {
    if (settingsMenuOpen && updateStatus.style.display !== 'none') {
      updateStatus.textContent = `Downloading update: ${percent}%`;
    }
    // Update progress bar in modal if it's showing
    updateDownloadProgress(percent);
  });
  
  return { open: settingsMenuOpen };
}
