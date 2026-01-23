// Important notice modal management
// Shows a notice about the upcoming installer switch on every app launch

const importantNoticeModal = document.getElementById('importantNoticeModal')!;
const importantNoticeBtn = document.getElementById('importantNoticeBtn') as HTMLButtonElement;

/**
 * Show the important notice modal
 */
export function showImportantNotice(): void {
  importantNoticeModal.classList.add('active');
}

/**
 * Hide the important notice modal
 */
export function hideImportantNotice(): void {
  importantNoticeModal.classList.remove('active');
}

/**
 * Initialize important notice modal event listeners
 */
export function initImportantNoticeModal(): void {
  // Close modal when button is clicked
  importantNoticeBtn.addEventListener('click', () => {
    hideImportantNotice();
  });
  
  // Show modal on every app launch
  // This will be called from renderer.ts after initialization
  showImportantNotice();
}
