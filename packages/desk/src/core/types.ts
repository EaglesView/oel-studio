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
  /**
   * Stuck to another node (Figma K: a note on a paper). `dx`/`dy` is the offset
   * of this node's top-left from the target's, in the target's unrotated frame;
   * the node follows its target wherever it goes. One level only: a target is
   * never itself attached.
   */
  attach?: { to: string; dx: number; dy: number };
}

/** Figma G1: live and up to date, being updated, late (manual), frozen, broken, or not known yet (grey). */
export type LinkState = 'fresh' | 'updating' | 'stale' | 'frozen' | 'broken' | 'waiting';

/** A data thread between two papers (Figma B6, G1). */
export interface DeskLink {
  id: string;
  from: string;
  to: string;
  /** Chip text (« À jour · graphique »). Without one, the thread has no chip and can't be focused. */
  label?: string;
  /** Full name, read by screen readers (the app shows it in the thread's popover). */
  title?: string;
  state: LinkState;
}

/** Camera: a world point `p` is drawn at screen `(p - {x,y}) * zoom`. */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Level of detail. Zoomed out, papers become small thumbnails of themselves
 * (the host may refresh them on a timer instead of live); up close they are live.
 */
export type Lod = 'thumbnail' | 'live';

export interface ZoomLimits {
  /** Maximum zoom-out. There is no "fit everything" beyond this. */
  min: number;
  max: number;
}

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
