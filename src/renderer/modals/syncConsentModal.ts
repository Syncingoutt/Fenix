// Cloud sync consent modal

import { ElectronAPI } from '../types.js';

declare const electronAPI: ElectronAPI;

const syncConsentModal = document.getElementById('syncConsentModal')!;
const syncConsentEnableBtn = document.getElementById('syncConsentEnableBtn') as HTMLButtonElement | null;
const syncConsentDisableBtn = document.getElementById('syncConsentDisableBtn') as HTMLButtonElement | null;

function showSyncConsentModal(): void {
  syncConsentModal.classList.add('active');
}

function hideSyncConsentModal(): void {
  syncConsentModal.classList.remove('active');
}

export function initSyncConsentModal(): void {
  if (syncConsentEnableBtn) {
    syncConsentEnableBtn.addEventListener('click', async () => {
      await electronAPI.setCloudSyncEnabled(true);
      hideSyncConsentModal();
    });
  }

  if (syncConsentDisableBtn) {
    syncConsentDisableBtn.addEventListener('click', async () => {
      await electronAPI.setCloudSyncEnabled(false);
      hideSyncConsentModal();
    });
  }

  electronAPI.onShowSyncConsent(() => {
    showSyncConsentModal();
  });
}
