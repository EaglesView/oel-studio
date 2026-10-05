/** Kinds of files a link can start from or land in. */
export type DocKind = 'spreadsheet' | 'slides' | 'document' | 'image';

/** What a link points at inside its source file. */
export type SourceRef =
  /** A chart drawn on a sheet (`chartId` is the drawing's stable id). */
  | { kind: 'chart'; sheetId: string; chartId: string }
  /** A range, by stable row/column ids: a linked table (Figma I2). */
  | { kind: 'range'; sheetId: string; ids: { r0: string; c0: string; r1: string; c1: string } }
  /** One cell, by stable ids: a value inside text (Figma I4). */
  | { kind: 'cell'; sheetId: string; ids: { r: string; c: string } }
  /** A picture: a slide element, a document image node (`oid`), or a desk image paper (its id) (Figma I1). */
  | { kind: 'image'; objectId: string };

/**
 * What flows along the link: the whole chart, or only its data (the copy keeps
 * its own style); a picture's pixels; a table's values and formats; one value.
 */
export type Carries = 'chart' | 'chart-data' | 'picture' | 'table' | 'value';

/** Theme of a linked table (Figma I2, I6 §2): the source sheet's, or the destination's. */
export type LinkTheme = 'source' | 'target';

/** A table too large for its slide (Figma I2, I6 §3). */
export type Overflow = 'truncate' | 'all' | 'rows';

/**
 * A change made in the copy only (Figma I6 §1): it stays local, is listed in
 * the link, and can be undone or applied to the source. `patch` is
 * kind-specific (a crop, cell styles, chart facets…).
 */
export interface LocalEdit {
  id: string;
  /** In words: « Ligne Total en gras », « Recadrage ». */
  label: string;
  at: number;
  by: string;
  patch: unknown;
}

/** One cell of a linked table, as the source displays it. */
export interface LinkedCell {
  /** Displayed text (formatted like the sheet: « 1 240 000 $ »). */
  text: string;
  num?: number;
  bold?: boolean;
  italic?: boolean;
  /** CSS colours, `#RRGGBB`. */
  color?: string;
  fill?: string;
  align?: 'left' | 'center' | 'right';
  colSpan?: number;
  rowSpan?: number;
  /** Covered by a merge that starts elsewhere. */
  merged?: boolean;
}

/** A linked table: what both hosts need to draw a real table (Figma I2). */
export interface LinkedTable {
  rows: LinkedCell[][];
  /** Column widths in points. */
  widths: number[];
  /** Header rows at the top (repeated on each page in documents). */
  header: number;
  /** The source sheet's look, used when `theme` is `source`. */
  font?: { family: string; size: number };
}

/** What a link carries, by kind; `revOf(value)` is the copy's revision. */
export type LinkedValue =
  | { kind: 'chart'; spec: unknown }
  | { kind: 'picture'; media: { hash: string; mime: string; width: number; height: number } }
  | { kind: 'table'; table: LinkedTable }
  | { kind: 'value'; text: string; num?: number; format?: string };

/** En direct / Manuel / Figé (Figma G3). */
export type LinkMode = 'live' | 'manual' | 'frozen';

/**
 * One linked copy. Stored in the **target** file's Y.Doc: the copy renders
 * from its own last value, so viewers, exports and people without access to
 * the source still see it.
 */
export interface LinkDef {
  id: string;
  source: {
    docId: string;
    kind: DocKind;
    ref: SourceRef;
    /** Title of the source file when the link was last updated (« Budget 2027 »). */
    title: string;
    /** What is linked, in words (« Dépenses par mois », « B1:G7 »). */
    label: string;
  };
  target: {
    /** Element (slide) or node (document) that holds the copy. */
    objectId: string;
    /** Where the copy is, in words (« diapo 5 », « § 2 »). */
    label: string;
  };
  carries: Carries;
  mode: LinkMode;
  /** The source content the copy shows: `rev` is its hash; `at`/`by` say when and who. */
  snapshot: { rev: string; at: number; by: string };
  /** The source is gone (deleted, or no longer accessible). The copy keeps its last value. */
  broken?: { reason: 'deleted' | 'access'; at: number };
  /** Linked tables: whose theme the copy wears (default `source`). */
  theme?: LinkTheme;
  /** Linked tables in slides: what to do when the table is taller than its frame (default `truncate`). */
  view?: { overflow: Overflow };
  /** Changes made in the copy only, newest last (Figma I6 §1). */
  edits?: LocalEdit[];
}

/** Stored in the **source** file's Y.Doc: who uses what (« Utilisé dans 2 fichiers », delete warnings). */
export interface Backlink {
  linkId: string;
  ref: SourceRef;
  /** The target file and the object in it. */
  docId: string;
  kind: DocKind;
  objectId: string;
  title: string;
  label: string;
}

/**
 * What a thread shows (Figma G1). `waiting`: the source has not been read yet
 * (still opening, or offline) — grey, never amber until we know.
 */
export type LinkState = 'fresh' | 'stale' | 'updating' | 'frozen' | 'broken' | 'waiting';
