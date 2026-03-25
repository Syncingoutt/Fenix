import { ElectronAPI } from '../types.js';

declare const electronAPI: ElectronAPI;

const COMPENDIUM_URL = 'https://tlicompendium.com/en/farming-strategies';

/**
 * Open TLI Compendium in the system browser (not Electron's window).
 */
export function initStrategiesCompendiumLink(): void {
  const link = document.querySelector('.strategies-external-link') as HTMLAnchorElement | null;
  if (!link) return;

  link.addEventListener('click', (e) => {
    e.preventDefault();
    electronAPI.openExternal(link.href || COMPENDIUM_URL);
  });
}
