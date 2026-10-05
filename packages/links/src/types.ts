/** Kinds of files a link can start from or land in. */
export type DocKind = 'spreadsheet' | 'slides' | 'document';

/** What a link points at inside its source file. */
export type SourceRef =
  /** A chart drawn on a sheet (`chartId` is the drawing's stable id). */
  | { kind: 'chart'; sheetId: string; chartId: string }
  /** A range, by stable row/column ids (later: tables and single values, Figma G2b d). */
  | { kind: 'range'; sheetId: string; ids: { r0: string; c0: string; r1: string; c1: string } };

/** What flows along the link: the whole chart, or only its data (the copy keeps its own style). */
export type Carries = 'chart' | 'chart-data';

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
