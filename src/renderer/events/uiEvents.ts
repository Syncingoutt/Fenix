// UI event handlers (title bar, etc.)

import { ElectronAPI } from '../types.js';
import { customTitleBar, titleBarMinimize, titleBarMaximize, titleBarClose } from '../dom/domElements.js';

declare const electronAPI: ElectronAPI;

const maximizeIcon = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="0.75" y="0.75" width="10.5" height="10.5" stroke="#808080" stroke-width="1.5" fill="none"/>
</svg>`;

const restoreIcon = `<svg width="17" height="17" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="0.75" y="4.27686" width="11.9316" height="11.9737" stroke="#808080" stroke-width="1.5"/>
  <rect x="0.752037" y="0.747944" width="11.1078" height="11.1156" transform="matrix(0.999996 -0.00273721 0.00272013 0.999996 3.99797 0.0367292)" stroke="#808080" stroke-width="1.5"/>
  <rect x="1.25977" y="4.79004" width="10.91" height="10.9474" fill="#272727"/>
</svg>`;

let closeSettingsModal: () => void;

export function initUIEvents(
  settingsModalCloseFn: () => void
): void {
  closeSettingsModal = settingsModalCloseFn;
  
  // Function to update title bar visibility
  function updateTitleBarVisibility(fullscreenMode: boolean): void {
    if (fullscreenMode) {
      customTitleBar.style.display = 'none';
      document.body.classList.remove('has-title-bar');
    } else {
      customTitleBar.style.display = 'flex';
      document.body.classList.add('has-title-bar');
    }
  }
  
  // Listen for window mode changes
  electronAPI.onWindowModeChanged((data) => {
    updateTitleBarVisibility(data.fullscreenMode);
  });
  
  // Initialize title bar visibility on load
  electronAPI.getSettings().then(settings => {
    updateTitleBarVisibility(settings.fullscreenMode === true);
  });
  
  // Title bar button handlers
  titleBarMinimize.addEventListener('click', () => {
    electronAPI.minimizeWindow();
  });
  
  titleBarMaximize.addEventListener('click', () => {
    electronAPI.maximizeWindow();
  });
  
  titleBarClose.addEventListener('click', () => {
    electronAPI.closeWindow();
  });
  
  // Update maximize button icon based on window state
  function updateMaximizeIcon(isMaximized: boolean): void {
    titleBarMaximize.innerHTML = isMaximized ? restoreIcon : maximizeIcon;
    titleBarMaximize.title = isMaximized ? 'Restore' : 'Maximize';
  }
  
  // Listen for maximize state changes
  electronAPI.onMaximizeStateChanged((isMaximized) => {
    updateMaximizeIcon(isMaximized);
  });
  
  // Initialize maximize button icon on load
  electronAPI.getMaximizeState().then((isMaximized) => {
    updateMaximizeIcon(isMaximized);
  });
  
  // Listen for close settings modal request (when window mode changes)
  electronAPI.onCloseSettingsModal(() => {
    closeSettingsModal();
  });
  
  // SPA Navigation handlers
  const navItems = document.querySelectorAll('.nav-item');
  const pages = document.querySelectorAll('.page');
  
  function navigateToPage(pageId: string): void {
    // Update nav active state
    navItems.forEach(item => item.classList.remove('active'));
    const activeNav = document.getElementById(`nav-${pageId}`);
    if (activeNav) activeNav.classList.add('active');
    
    // Update page visibility
    pages.forEach(page => page.classList.remove('active'));
    const activePage = document.getElementById(`page-${pageId}`);
    if (activePage) activePage.classList.add('active');
  }
  
  // Add click handlers to nav items
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const pageId = item.id.replace('nav-', '');
      navigateToPage(pageId);
    });
  });
}
