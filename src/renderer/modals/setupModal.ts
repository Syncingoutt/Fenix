// Setup modal for log path configuration (first launch)

import { ElectronAPI } from '../types.js';

declare const electronAPI: ElectronAPI;

const setupModal = document.getElementById('setupModal')!;
const setupBtnSelect = document.getElementById('setupBtnSelect') as HTMLButtonElement;

let loadInventory: () => Promise<void>;

/**
 * Show the setup modal
 */
export function showSetupModal(): void {
  setupModal.classList.add('active');
}

/**
 * Hide the setup modal
 */
export function hideSetupModal(): void {
  setupModal.classList.remove('active');
}

/**
 * Initialize setup modal event listeners
 */
export function initSetupModal(inventoryLoader: () => Promise<void>): void {
  loadInventory = inventoryLoader;

  // Log file selection button
  setupBtnSelect.addEventListener('click', async () => {
    try {
      const selectedPath = await electronAPI.selectLogFile();
      if (selectedPath) {
        hideSetupModal();
        // Reload inventory with the new path
        loadInventory();
      }
    } catch (error: any) {
      console.error('Failed to select log file:', error);
    }
  });

  // Listen for first launch setup request
  electronAPI.onShowLogPathSetup(() => {
    showSetupModal();
  });
}
