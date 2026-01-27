// Settings menu and management

import { ElectronAPI } from '../types.js';

declare const electronAPI: ElectronAPI;

let settingsMenuOpen = false;

const myAccountButton = document.getElementById('myAccountButton')!;
const myAccountMenu = document.getElementById('myAccountMenu')!;
const myAccountUsername = document.getElementById('myAccountUsername')!;
const appVersionEl = document.getElementById('appVersion')!;

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
  
  // Load and display username
  updateUsernameDisplay();
  
  // Toggle my account menu
  myAccountButton.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsMenuOpen = !settingsMenuOpen;
    myAccountMenu.style.display = settingsMenuOpen ? 'block' : 'none';
    myAccountButton.classList.toggle('active', settingsMenuOpen);
  });
  
  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (settingsMenuOpen && !myAccountMenu.contains(e.target as Node) && !myAccountButton.contains(e.target as Node)) {
      settingsMenuOpen = false;
      myAccountMenu.style.display = 'none';
      myAccountButton.classList.remove('active');
    }
  });
  
  return { open: settingsMenuOpen };
}

/**
 * Update the username display in the header
 */
export async function updateUsernameDisplay(): Promise<void> {
  try {
    const usernameInfo = await electronAPI.getUsernameInfo();
    if (usernameInfo.username) {
      const displayName = usernameInfo.displayName || `${usernameInfo.username}${usernameInfo.tag ? `#${usernameInfo.tag}` : ''}`;
      myAccountUsername.textContent = displayName;
      myAccountUsername.style.display = 'block';
    } else {
      myAccountUsername.style.display = 'none';
    }
  } catch (error) {
    // If there's an error, hide the username display
    myAccountUsername.style.display = 'none';
  }
}
