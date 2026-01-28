// Update panel management (passive notification)

import { ElectronAPI } from '../types.js';

declare const electronAPI: ElectronAPI;

// Update panel state
let isPanelVisible = false;
let panelUpdateVersion = '';

const updatePanel = document.getElementById('updatePanel')!;
const updatePanelVersion = document.getElementById('updatePanelVersion')!;
const updatePanelStatus = document.getElementById('updatePanelStatus')!;
const updatePanelBtn = document.getElementById('updatePanelBtn') as HTMLButtonElement;
const updatePanelClose = document.getElementById('updatePanelClose') as HTMLButtonElement;

/**
 * Show the update panel (passive notification)
 */
export function showUpdatePanel(version: string): void {
  panelUpdateVersion = version;
  updatePanelVersion.textContent = `v${version}`;
  updatePanelStatus.textContent = '';
  updatePanelBtn.textContent = 'Update now';
  updatePanelBtn.disabled = false;
  updatePanel.classList.add('active');
  isPanelVisible = true;
}

/**
 * Hide the update panel
 */
export function hideUpdatePanel(): void {
  updatePanel.classList.remove('active');
  isPanelVisible = false;
}

/**
 * Update panel state (e.g., after download starts)
 */
export function updatePanelState(state: 'downloading' | 'downloaded'): void {
  if (state === 'downloading') {
    updatePanelStatus.textContent = 'Downloading...';
    updatePanelBtn.disabled = true;
  } else if (state === 'downloaded') {
    updatePanelStatus.textContent = 'Update will be completed after you restart';
    updatePanelBtn.textContent = 'Restart now';
    updatePanelBtn.disabled = false;
  }
}

/**
 * Initialize update panel event listeners
 */
export function initUpdatePanel(): void {
  // Update panel event listeners
  updatePanelClose.addEventListener('click', () => {
    hideUpdatePanel();
  });

  updatePanelBtn.addEventListener('click', () => {
    if (updatePanelBtn.textContent === 'Update now') {
      // Start download
      electronAPI.sendUpdateDialogResponse('download');
      updatePanelState('downloading');
    } else if (updatePanelBtn.textContent === 'Restart now') {
      // Restart to install update
      electronAPI.sendUpdateDialogResponse('restart');
      hideUpdatePanel();
    }
  });

  // Listen for update panel requests from main process (mid-session updates)
  (window as any).electronAPI.onShowUpdatePanel((data: { version: string }) => {
    showUpdatePanel(data.version);
  });

  // Listen for seamless transition from download to install prompt
  (window as any).electronAPI.onUpdateDownloadedTransition((data: { version: string }) => {
    updatePanelState('downloaded');
  });

  // Handle changelog link clicks to open in external browser
  const changelogLink = document.querySelector('.update-panel-changelog') as HTMLAnchorElement;
  if (changelogLink) {
    changelogLink.addEventListener('click', (e) => {
      e.preventDefault();
      electronAPI.openExternal(changelogLink.href);
    });
  }
}
