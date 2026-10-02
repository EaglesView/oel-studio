export interface Vec {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One object on the desk (a "paper"). The desk does not know what a document
 * or a slide is: `kind` and `data` belong to the host app.
 */
export interface DeskNode<D = unknown> {
  id: string;
  kind: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees. Papers lie slightly crooked on the desk; selection outlines ignore it. */
  rotation: number;
  data: D;
  locked?: boolean;
}

export type LinkState = 'fresh' | 'stale' | 'frozen';

/** A data thread between two papers (Figma B6). */
export interface DeskLink {
  id: string;
  from: string;
  to: string;
  label?: string;
  state: LinkState;
}

/** Camera: a world point `p` is drawn at screen `(p - {x,y}) * zoom`. */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** Level of detail, tied to zoom (Figma B5). */
export type Lod = 'far' | 'mid' | 'near';

export interface DeskState<D = unknown> {
  nodes: Record<string, DeskNode<D>>;
  /** Paint order, back to front. */
  order: string[];
  links: DeskLink[];
  selection: string[];
  /** The roving-focus target for keyboard users. */
  focusedId: string | null;
  viewport: Viewport;
  /** Size of the on-screen desk element in px. */
  screen: { w: number; h: number };
  /** A paper opened in place (Figma B4), or null. */
  openId: string | null;
  showLinks: boolean;
}

export interface HistoryEntry<D> {
  label: string;
  nodes: Record<string, DeskNode<D>>;
  order: string[];
  links: DeskLink[];
}
