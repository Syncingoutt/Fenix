// Style 1 graph header layout manager

type MovableKey = 'timer' | 'resetRealtimeBtn' | 'hourlyControls' | 'wealthHourly' | 'wealthValue';

type MovableConfig = {
  key: MovableKey;
  targetId: string;
};

const MOVABLES: MovableConfig[] = [
  { key: 'timer', targetId: 'style1TimeValueWrap' },
  { key: 'resetRealtimeBtn', targetId: 'style1TimeValueWrap' },
  { key: 'hourlyControls', targetId: 'style1TimeControlsSlot' },
  { key: 'wealthHourly', targetId: 'style1PerHourValue' },
  { key: 'wealthValue', targetId: 'style1TotalValue' }
];

let initialized = false;
let observer: MutationObserver | null = null;
const elements = new Map<MovableKey, HTMLElement>();
const anchors = new Map<MovableKey, Comment>();

function applyStyle1HeaderLayout(): void {
  const useStyle1 = document.body.classList.contains('layout-style-1');

  for (const movable of MOVABLES) {
    const element = elements.get(movable.key);
    const anchor = anchors.get(movable.key);
    if (!element || !anchor) continue;

    if (useStyle1) {
      const target = document.getElementById(movable.targetId);
      if (!target) continue;
      if (element.parentElement !== target) {
        target.appendChild(element);
      }
      continue;
    }

    const parent = anchor.parentNode;
    if (!parent) continue;
    if (element.parentNode === parent && element.previousSibling === anchor) continue;
    parent.insertBefore(element, anchor.nextSibling);
  }
}

export function initStyle1GraphHeaderLayout(): void {
  if (initialized) {
    applyStyle1HeaderLayout();
    return;
  }

  for (const movable of MOVABLES) {
    const element = document.getElementById(movable.key);
    if (!element || !element.parentNode) {
      continue;
    }

    const anchor = document.createComment(`style1-anchor-${movable.key}`);
    element.parentNode.insertBefore(anchor, element);
    elements.set(movable.key, element);
    anchors.set(movable.key, anchor);
  }

  applyStyle1HeaderLayout();

  observer = new MutationObserver(() => {
    applyStyle1HeaderLayout();
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  initialized = true;
}

export function disposeStyle1GraphHeaderLayout(): void {
  observer?.disconnect();
  observer = null;
}
