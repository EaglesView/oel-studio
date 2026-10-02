import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { rectToScreen, union, rectOf } from '../core/geometry';
import type { DeskStore } from '../core/store';
import type { DeskState, Rect } from '../core/types';

export function useDeskState<D, T>(store: DeskStore<D>, selector: (s: DeskState<D>) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}

export interface DeskContextValue {
  store: DeskStore<any>;
  /** Polite screen-reader announcement. */
  announce: (message: string) => void;
}

export const DeskContext = createContext<DeskContextValue | null>(null);

export function useDesk(): DeskContextValue {
  const ctx = useContext(DeskContext);
  if (!ctx) throw new Error('useDesk must be used inside <DeskCanvas>');
  return ctx;
}

/** Screen-space rect of the current selection (for anchoring contextual toolbars). */
export function useSelectionScreenRect<D>(store: DeskStore<D>): Rect | null {
  const nodes = useDeskState(store, (s) => s.nodes);
  const selection = useDeskState(store, (s) => s.selection);
  const viewport = useDeskState(store, (s) => s.viewport);
  return useMemo(() => {
    const rects = selection.map((id) => nodes[id]).filter(Boolean).map((n) => rectOf(n!));
    const u = union(rects);
    return u ? rectToScreen(u, viewport) : null;
  }, [nodes, selection, viewport]);
}
