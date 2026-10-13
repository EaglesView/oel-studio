import { useSyncExternalStore } from 'react';

/** Which side of the context bar the drag grip sits on (Affichage › Main). Kept on this device only. */
export type Hand = 'right' | 'left';

const KEY = 'oel-hand';
const listeners = new Set<() => void>();

function read(): Hand {
  try {
    return localStorage.getItem(KEY) === 'left' ? 'left' : 'right';
  } catch {
    return 'right'; // private mode: right-handed default
  }
}

export function setHand(hand: Hand) {
  try {
    if (hand === 'left') localStorage.setItem(KEY, 'left');
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: the choice lasts until the page closes */
  }
  current = hand;
  listeners.forEach((l) => l());
}

let current: Hand | null = null;

export function useHand(): Hand {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (current ??= read()),
    () => 'right',
  );
}
