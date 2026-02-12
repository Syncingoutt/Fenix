// Cloud sync disable confirmation modal

const syncDisableConfirmModal = document.getElementById('syncDisableConfirmModal')!;
const syncDisableCancelBtn = document.getElementById('syncDisableCancelBtn') as HTMLButtonElement | null;
const syncDisableConfirmBtn = document.getElementById('syncDisableConfirmBtn') as HTMLButtonElement | null;

let resolvePromise: ((value: boolean) => void) | null = null;
let currentPromise: Promise<boolean> | null = null;

function showSyncDisableConfirmModal(): Promise<boolean> {
  if (currentPromise) {
    return currentPromise;
  }

  currentPromise = new Promise<boolean>((resolve) => {
    resolvePromise = resolve;
    syncDisableConfirmModal.classList.add('active');
  });

  return currentPromise;
}

function hideSyncDisableConfirmModal(): void {
  syncDisableConfirmModal.classList.remove('active');
  currentPromise = null;
  resolvePromise = null;
}

export function initSyncDisableConfirmModal(): void {
  if (syncDisableCancelBtn) {
    syncDisableCancelBtn.addEventListener('click', () => {
      if (resolvePromise) {
        resolvePromise(false);
      }
      hideSyncDisableConfirmModal();
    });
  }

  if (syncDisableConfirmBtn) {
    syncDisableConfirmBtn.addEventListener('click', async () => {
      if (resolvePromise) {
        resolvePromise(true);
      }
      hideSyncDisableConfirmModal();
    });
  }

  // Close on backdrop click
  syncDisableConfirmModal.addEventListener('click', (e) => {
    if (e.target === syncDisableConfirmModal) {
      if (resolvePromise) {
        resolvePromise(false);
      }
      hideSyncDisableConfirmModal();
    }
  });
}

export { showSyncDisableConfirmModal };
