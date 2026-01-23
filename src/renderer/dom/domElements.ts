// DOM element references

export const wealthValueEl = document.getElementById('wealthValue')!;
export const wealthHourlyEl = document.getElementById('wealthHourly')!;
export const realtimeBtn = document.getElementById('realtimeBtn') as HTMLButtonElement;
export const hourlyBtn = document.getElementById('hourlyBtn') as HTMLButtonElement;
export const hourlyControls = document.getElementById('hourlyControls')!;
export const startHourlyBtn = document.getElementById('startHourly') as HTMLButtonElement;
export const stopHourlyBtn = document.getElementById('stopHourly') as HTMLButtonElement;
export const pauseHourlyBtn = document.getElementById('pauseHourly') as HTMLButtonElement;
export const resumeHourlyBtn = document.getElementById('resumeHourly') as HTMLButtonElement;
export const hourlyTimerEl = document.getElementById('hourlyTimer')!;
export const timerEl = document.getElementById('timer')!;
export const resetRealtimeBtn = document.getElementById('resetRealtimeBtn') as HTMLButtonElement;
export const overlayWidgetBtn = document.getElementById('overlayWidgetBtn');
export const minPriceInput = document.getElementById('minPriceInput') as HTMLInputElement;
export const maxPriceInput = document.getElementById('maxPriceInput') as HTMLInputElement;
export const searchInput = document.getElementById('searchInput') as HTMLInputElement;
export const clearSearch = document.getElementById('clearSearch') as HTMLButtonElement;
export const customTitleBar = document.getElementById('custom-title-bar')!;
export const titleBarMinimize = document.getElementById('title-bar-minimize') as HTMLButtonElement;
export const titleBarMaximize = document.getElementById('title-bar-maximize') as HTMLButtonElement;
export const titleBarClose = document.getElementById('title-bar-close') as HTMLButtonElement;
export const setupModal = document.getElementById('setupModal')!;
export const setupBtnSelect = document.getElementById('setupBtnSelect') as HTMLButtonElement;

/**
 * Initialize initial UI state
 */
export function initUIState(): void {
  startHourlyBtn.style.display = 'inline-block';
  stopHourlyBtn.style.display = 'none';
  pauseHourlyBtn.style.display = 'none';
  resumeHourlyBtn.style.display = 'none';
  hourlyControls.classList.remove('active');
  realtimeBtn.classList.add('active');
  hourlyBtn.classList.remove('active');
  resetRealtimeBtn.style.display = 'block'; // Show reset button in realtime mode
}
