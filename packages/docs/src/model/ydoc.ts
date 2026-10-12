/**
 * Layout of a document inside one Y.Doc (what the collab server stores),
 * format version 2:
 *
 *   body                      XmlFragment   the document
 *   story:<storyId>           XmlFragment   a header or footer (one per package part)
 *   note:<footnote|endnote>:<id> XmlFragment note bodies
 *   meta     Y.Map   styles, stylesCss, defaults, numbering, title, settings,
 *                    background, formatVersion, seeded
 *   sections Y.Map   sectionId → Section (page setup, numbering, explicit
 *                    header/footer references). The order is not stored: it is
 *                    the order of `section` attrs in the body, then `body`, so
 *                    two people inserting breaks cannot desynchronise a list.
 *   lists    Y.Map   numId → list kind, for lists created in the editor
 *   notes    Y.Map   "<kind>:<id>" → true   (which notes exist)
 *   stories  Y.Map   storyId → { part, side }   (which headers/footers exist)
 *   media    Y.Map   package path → { mime, url? }   (images; bytes on the server)
 *
 * Pure: no DOM, used by the editor, the server (export) and tests.
 */
import * as Y from 'yjs';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import type { Schema } from '@tiptap/pm/model';
import type { DocSettings, DocxJson, ExportJson, PMDoc, Section, StoryPart, StorySide, SyntheticListKind } from './types';
import { DEFAULT_SETTINGS, defaultSection, sectionBreaks, sectionOrder } from './sections';
import { tr } from '@oel/i18n';

/** Y.Doc layout version; documents of another version are refused on open. */
export const FORMAT_VERSION = 2;

export const BODY = 'body';
export const storyKey = (storyId: string) => `story:${storyId}`;
export const noteKey = (kind: 'footnote' | 'endnote', id: string) => `note:${kind}:${id}`;

export interface StoryEntry {
  /** Package part (`word/footer13.xml`), null for stories made in the editor. */
  part: string | null;
  side: StorySide;
}

export const meta = (d: Y.Doc) => d.getMap<unknown>('meta');
export const sectionsMap = (d: Y.Doc) => d.getMap<Section>('sections');
export const lists = (d: Y.Doc) => d.getMap<SyntheticListKind>('lists');
export const notesIndex = (d: Y.Doc) => d.getMap<boolean>('notes');
export const storiesIndex = (d: Y.Doc) => d.getMap<StoryEntry>('stories');
export const mediaIndex = (d: Y.Doc) => d.getMap<{ mime: string; url?: string }>('media');

/** Thrown when a stored document uses another Y.Doc layout (dev data from an older build). */
export class DocFormatError extends Error {
  constructor(readonly found: unknown) {
    super(tr('Ce document a été enregistré par une version antérieure de l’éditeur et ne peut plus être ouvert. Importez de nouveau le fichier .docx d’origine.', 'This document was saved by an earlier version of the editor and can no longer be opened. Import the original .docx file again.'));
    this.name = 'DocFormatError';
  }
}

/** Refuse a seeded document whose layout version is not this build's. */
export function assertFormat(ydoc: Y.Doc) {
  const m = meta(ydoc);
  if (!m.get('seeded')) return;
  const v = m.get('formatVersion');
  if (v !== FORMAT_VERSION) throw new DocFormatError(v);
}

const emptyDoc = (): PMDoc => ({ type: 'doc', content: [{ type: 'paragraph' }] });

function fill(schema: Schema, frag: Y.XmlFragment, json: PMDoc) {
  if (frag.length) frag.delete(0, frag.length);
  prosemirrorJSONToYXmlFragment(schema, json.content?.length ? json : emptyDoc(), frag);
}

/** Put an imported document into an empty Y.Doc. Returns false if it already has content. */
export function seedYDoc(ydoc: Y.Doc, json: DocxJson, schema: Schema): boolean {
  if (meta(ydoc).get('seeded')) return false;
  ydoc.transact(() => {
    fill(schema, ydoc.getXmlFragment(BODY), json.doc);
    for (const [id, story] of Object.entries(json.stories ?? {})) {
      if (!story) continue;
      fill(schema, ydoc.getXmlFragment(storyKey(id)), story.doc);
      storiesIndex(ydoc).set(id, { part: story.part ?? null, side: story.side });
    }
    const sections = json.sections?.length ? json.sections : [defaultSection()];
    for (const s of sections) sectionsMap(ydoc).set(s.id, s);
    for (const kind of ['footnote', 'endnote'] as const) {
      for (const [id, doc] of Object.entries(json.notes?.[kind] ?? {})) {
        fill(schema, ydoc.getXmlFragment(noteKey(kind, id)), doc);
        notesIndex(ydoc).set(`${kind}:${id}`, true);
      }
    }
    for (const m of json.media ?? []) mediaIndex(ydoc).set(m.path, { mime: m.mime });
    const mm = meta(ydoc);
    mm.set('settings', json.settings ?? DEFAULT_SETTINGS);
    mm.set('background', json.background ?? null);
    mm.set('fonts', json.fonts ?? []);
    mm.set('styles', json.styles ?? []);
    mm.set('stylesCss', json.stylesCss ?? '');
    mm.set('defaults', json.defaults ?? { fontFamily: 'Arial', fontSize: '11pt' });
    mm.set('numbering', json.numbering ?? { nums: {}, maxNumId: 0, maxAbstractId: 0 });
    mm.set('title', json.title ?? null);
    mm.set('formatVersion', FORMAT_VERSION);
    mm.set('seeded', true);
  }, 'seed');
  return true;
}

export function fragmentJSON(frag: Y.XmlFragment): PMDoc {
  const json = yXmlFragmentToProsemirrorJSON(frag) as PMDoc;
  return { type: 'doc', content: json.content ?? [] };
}

/** Every section record, by id. */
export function sectionsById(ydoc: Y.Doc): Map<string, Section> {
  return new Map(sectionsMap(ydoc).entries());
}

/** Document settings (header/footer parity…). */
export const settingsOf = (ydoc: Y.Doc): DocSettings => ({ ...DEFAULT_SETTINGS, ...((meta(ydoc).get('settings') as DocSettings | undefined) ?? {}) });

/** Everything `pm_to_docx` needs, read from the shared document. */
export function exportJsonFromYDoc(ydoc: Y.Doc): ExportJson {
  const doc = fragmentJSON(ydoc.getXmlFragment(BODY));
  const sections = sectionOrder(sectionBreaks(doc), sectionsById(ydoc));
  // Breaks whose section record is missing (should not happen) are dropped by the codec.
  const stories: Record<string, StoryPart> = {};
  storiesIndex(ydoc).forEach((entry, id) => {
    stories[id] = { ...(entry.part ? { part: entry.part } : {}), side: entry.side, doc: fragmentJSON(ydoc.getXmlFragment(storyKey(id))) };
  });
  const notes: ExportJson['notes'] = { footnote: {}, endnote: {} };
  notesIndex(ydoc).forEach((exists, key) => {
    if (!exists) return;
    const [kind, id] = key.split(':') as ['footnote' | 'endnote', string];
    notes[kind][id] = fragmentJSON(ydoc.getXmlFragment(noteKey(kind, id)));
  });
  const synthetic: ExportJson['numbering']['synthetic'] = [];
  lists(ydoc).forEach((kind, numId) => synthetic.push({ numId: Number(numId), kind }));
  // A section must reference only stories that exist.
  const known = (refs: Section['headers']) => Object.fromEntries(Object.entries(refs).filter(([, id]) => id && stories[id]));
  return {
    doc,
    notes,
    stories,
    sections: sections.map((s) => ({ ...s, headers: known(s.headers), footers: known(s.footers) })),
    background: (meta(ydoc).get('background') as string | null | undefined) ?? null,
    numbering: { synthetic },
  };
}

/**
 * Replace the content of `target` with `source` (version restore). Runs as one
 * transaction, so collaborators see a single change and it can be undone.
 */
export function replaceYDocContent(target: Y.Doc, source: Y.Doc, schema: Schema) {
  target.transact(() => {
    fill(schema, target.getXmlFragment(BODY), fragmentJSON(source.getXmlFragment(BODY)));
    for (const [idx, prefix] of [
      [storiesIndex, 'story:'],
      [notesIndex, 'note:'],
    ] as const) {
      const src = idx(source) as Y.Map<unknown>;
      const dst = idx(target) as Y.Map<unknown>;
      for (const key of [...dst.keys()]) if (!src.has(key)) dst.delete(key);
      src.forEach((v, key) => {
        dst.set(key, v);
        fill(schema, target.getXmlFragment(prefix + key), fragmentJSON(source.getXmlFragment(prefix + key)));
      });
    }
    lists(source).forEach((v, k) => lists(target).set(k, v));
    const src = sectionsMap(source);
    const dst = sectionsMap(target);
    for (const key of [...dst.keys()]) if (!src.has(key)) dst.delete(key);
    src.forEach((v, key) => dst.set(key, v));
    for (const key of ['settings', 'background', 'fonts'] as const) meta(target).set(key, meta(source).get(key) ?? null);
  }, 'restore');
}

/** Plain text of a PM JSON tree (word counts, previews, tests). */
export function plainText(node: { text?: string; type?: string; content?: unknown[] }): string {
  if (typeof node.text === 'string') return node.text;
  const inner = (node.content ?? []).map((c) => plainText(c as typeof node)).join(node.type === 'doc' || node.type === 'tableRow' || node.type === 'sdtBlock' ? '\n' : '');
  if (node.type === 'tab') return '\t';
  if (node.type === 'hardBreak') return '\n';
  return inner;
}

export function countWords(text: string): number {
  return text.split(/[\s  ]+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
