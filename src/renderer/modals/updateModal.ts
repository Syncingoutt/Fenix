// Update modal management

import { UpdateType, ElectronAPI } from '../types.js';

declare const electronAPI: ElectronAPI;

let currentUpdateType: UpdateType | null = null;
let currentUpdateVersion: string = '';

const updateModal = document.getElementById('updateModal')!;
const updateModalTitle = document.getElementById('updateModalTitle')!;
const updateModalSubtitle = document.getElementById('updateModalSubtitle')!;
const updateModalMessage = document.getElementById('updateModalMessage')!;
const updateModalChangelog = document.getElementById('updateModalChangelog')!;
const updateProgressContainer = document.getElementById('updateProgressContainer')!;
const updateProgressFill = document.getElementById('updateProgressFill')!;
const updateProgressText = document.getElementById('updateProgressText')!;
const updateBtnPrimary = document.getElementById('updateBtnPrimary') as HTMLButtonElement;
const updateBtnSecondary = document.getElementById('updateBtnSecondary') as HTMLButtonElement;

/**
 * Show the update modal
 */
export function showUpdateModal(type: UpdateType, version: string, currentVersion?: string): void {
  currentUpdateType = type;
  currentUpdateVersion = version;
  
  if (type === 'available') {
    updateModalTitle.textContent = 'Update Available';
    updateModalSubtitle.textContent = `Version ${version}`;
    updateModalMessage.textContent = `A new version (${version}) is available!\n\nCurrent version: ${currentVersion || 'Unknown'}\n\nWould you like to download and install it now?`;
    updateModalChangelog.style.display = 'block';
    updateBtnPrimary.textContent = 'Download Now';
    updateBtnSecondary.textContent = 'Later';
    updateProgressContainer.style.display = 'none';
    updateBtnPrimary.style.display = 'block';
    updateBtnSecondary.style.display = 'block';
    updateBtnPrimary.disabled = false;
    updateBtnSecondary.disabled = false;
  } else if (type === 'downloaded') {
    updateModalTitle.textContent = 'Update Downloaded';
    updateModalSubtitle.textContent = `Version ${version}`;
    updateModalMessage.textContent = 'Update downloaded successfully!\n\nThe update will be installed when you restart the application.';
    updateModalChangelog.style.display = 'none';
    updateBtnPrimary.textContent = 'Restart Now';
    updateBtnSecondary.textContent = 'Later';
    updateProgressContainer.style.display = 'none';
    updateBtnPrimary.style.display = 'block';
    updateBtnSecondary.style.display = 'block';
    updateBtnPrimary.disabled = false;
    updateBtnSecondary.disabled = false;
  }
  
  updateModal.classList.add('active');
}

/**
 * Hide the update modal
 */
export function hideUpdateModal(): void {
  updateModal.classList.remove('active');
  currentUpdateType = null;
  currentUpdateVersion = '';
}

/**
 * Show download progress
 */
export function showDownloadProgress(): void {
  updateProgressContainer.style.display = 'block';
  updateModalTitle.textContent = 'Downloading Update';
  updateModalSubtitle.textContent = `Version ${currentUpdateVersion}`;
  updateModalMessage.textContent = 'Please wait while the update is being downloaded...';
  updateModalChangelog.style.display = 'none';
  updateBtnPrimary.style.display = 'none';
  updateBtnSecondary.style.display = 'none';
}

/**
 * Update download progress percentage
 */
export function updateDownloadProgress(percent: number): void {
  if (updateModal.classList.contains('active') && updateProgressContainer.style.display !== 'none') {
    updateProgressFill.style.width = `${percent}%`;
    updateProgressText.textContent = `${Math.round(percent)}%`;
  }
}

/**
 * Transition to install prompt after download completes
 */
export function transitionToInstallPrompt(version: string): void {
  updateProgressContainer.style.display = 'none';
  updateModalTitle.textContent = 'Update Downloaded';
  updateModalSubtitle.textContent = `Version ${version}`;
  updateModalMessage.textContent = 'Update downloaded successfully!\n\nThe update will be installed when you restart the application.';
  updateModalChangelog.style.display = 'none';
  updateBtnPrimary.textContent = 'Restart Now';
  updateBtnSecondary.textContent = 'Later';
  updateBtnPrimary.style.display = 'block';
  updateBtnSecondary.style.display = 'block';
  updateBtnPrimary.disabled = false;
  updateBtnSecondary.disabled = false;
  currentUpdateType = 'downloaded';
}

/**
 * Initialize update modal event listeners
 */
export function initUpdateModal(): void {
  // Button event listeners
  updateBtnPrimary.addEventListener('click', () => {
    if (currentUpdateType === 'available') {
      // Start download
      electronAPI.sendUpdateDialogResponse('download');
      showDownloadProgress();
    } else if (currentUpdateType === 'downloaded') {
      // Restart now
      electronAPI.sendUpdateDialogResponse('restart');
      hideUpdateModal();
    }
  });

  updateBtnSecondary.addEventListener('click', () => {
    electronAPI.sendUpdateDialogResponse('later');
    hideUpdateModal();
  });

  // Listen for update dialog requests from main process
  electronAPI.onShowUpdateDialog((data) => {
    showUpdateModal(data.type, data.version, data.currentVersion);
  });

  // Listen for seamless transition from download to install prompt
  electronAPI.onUpdateDownloadedTransition((data) => {
    transitionToInstallPrompt(data.version);
  });
}
