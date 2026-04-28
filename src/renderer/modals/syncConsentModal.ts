// Cloud sync retirement modal

import { ElectronAPI } from '../types.js';

declare const electronAPI: ElectronAPI;

const syncConsentModal = document.getElementById('syncConsentModal')!;
const syncConsentCloseBtn = document.getElementById('syncConsentDisableBtn') as HTMLButtonElement | null;

export function showSyncConsentModal(): void {
  syncConsentModal.classList.add('active');
}

function hideSyncConsentModal(): void {
  syncConsentModal.classList.remove('active');
}

export function initSyncConsentModal(): void {
  const externalLinks = syncConsentModal.querySelectorAll<HTMLAnchorElement>('a[href^="http"]');
  externalLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      electronAPI.openExternal(link.href);
    });
  });

  if (syncConsentCloseBtn) {
    syncConsentCloseBtn.addEventListener('click', () => {
      hideSyncConsentModal();
    });
  }

  electronAPI.onShowSyncConsent(() => {
    showSyncConsentModal();
  });

  // Show retirement notice on every app launch.
  showSyncConsentModal();
}
