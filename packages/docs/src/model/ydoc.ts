/**
 * Layout of a document inside one Y.Doc (what the collab server stores):
 *
 *   body                      XmlFragment   the document
 *   story:header:<kind>       XmlFragment   headers / footers (default, first, even)
 *   story:footer:<kind>
 *   note:<footnote|endnote>:<id> XmlFragment note bodies
 *   meta     Y.Map   page, styles, stylesCss, defaults, numbering, title, seeded, parts
 *   lists    Y.Map   numId → list kind, for lists created in the editor
 *   notes    Y.Map   "<kind>:<id>" → true   (which notes exist)
 *   stories  Y.Map   "header:<kind>" → part name or ""   (which headers/footers exist)
 *   media    Y.Map   package path → { mime, url? }   (images; bytes on the server)
 *
 * Pure: no DOM, used by the editor, the server (export) and tests.
 */
import * as Y from 'yjs';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import type { Schema } from '@tiptap/pm/model';
import type { DocxJson, ExportJson, HeaderFooterKind, PMDoc, PageSetup, SyntheticListKind } from './types';
import { DEFAULT_PAGE } from './types';

export const BODY = 'body';
export const storyKey = (side: 'header' | 'footer', kind: HeaderFooterKind) => `story:${side}:${kind}`;
export const noteKey = (kind: 'footnote' | 'endnote', id: string) => `note:${kind}:${id}`;

export const meta = (d: Y.Doc) => d.getMap<unknown>('meta');
export const lists = (d: Y.Doc) => d.getMap<SyntheticListKind>('lists');
export const notesIndex = (d: Y.Doc) => d.getMap<boolean>('notes');
export const storiesIndex = (d: Y.Doc) => d.getMap<string>('stories');
export const mediaIndex = (d: Y.Doc) => d.getMap<{ mime: string; url?: string }>('media');

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
    for (const side of ['header', 'footer'] as const) {
      const map = side === 'header' ? json.headers : json.footers;
      for (const [kind, story] of Object.entries(map ?? {})) {
        if (!story) continue;
        fill(schema, ydoc.getXmlFragment(storyKey(side, kind as HeaderFooterKind)), story.doc);
        storiesIndex(ydoc).set(`${side}:${kind}`, story.part ?? '');
      }
    }
    for (const kind of ['footnote', 'endnote'] as const) {
      for (const [id, doc] of Object.entries(json.notes?.[kind] ?? {})) {
        fill(schema, ydoc.getXmlFragment(noteKey(kind, id)), doc);
        notesIndex(ydoc).set(`${kind}:${id}`, true);
      }
    }
    for (const m of json.media ?? []) mediaIndex(ydoc).set(m.path, { mime: m.mime });
    const mm = meta(ydoc);
    mm.set('page', json.page ?? DEFAULT_PAGE);
    mm.set('styles', json.styles ?? []);
    mm.set('stylesCss', json.stylesCss ?? '');
    mm.set('defaults', json.defaults ?? { fontFamily: 'Arial', fontSize: '11pt' });
    mm.set('numbering', json.numbering ?? { nums: {}, maxNumId: 0, maxAbstractId: 0 });
    mm.set('title', json.title ?? null);
    mm.set('formatVersion', json.version ?? 1);
    mm.set('seeded', true);
  }, 'seed');
  return true;
}

export function fragmentJSON(frag: Y.XmlFragment): PMDoc {
  const json = yXmlFragmentToProsemirrorJSON(frag) as PMDoc;
  return { type: 'doc', content: json.content ?? [] };
}

/** Everything `pm_to_docx` needs, read from the shared document. */
export function exportJsonFromYDoc(ydoc: Y.Doc): ExportJson {
  const headers: ExportJson['headers'] = {};
  const footers: ExportJson['footers'] = {};
  storiesIndex(ydoc).forEach((part, key) => {
    const [side, kind] = key.split(':') as ['header' | 'footer', HeaderFooterKind];
    const doc = fragmentJSON(ydoc.getXmlFragment(storyKey(side, kind)));
    (side === 'header' ? headers : footers)[kind] = { ...(part ? { part } : {}), doc };
  });
  const notes: ExportJson['notes'] = { footnote: {}, endnote: {} };
  notesIndex(ydoc).forEach((exists, key) => {
    if (!exists) return;
    const [kind, id] = key.split(':') as ['footnote' | 'endnote', string];
    notes[kind][id] = fragmentJSON(ydoc.getXmlFragment(noteKey(kind, id)));
  });
  const synthetic: ExportJson['numbering']['synthetic'] = [];
  lists(ydoc).forEach((kind, numId) => synthetic.push({ numId: Number(numId), kind }));
  return {
    doc: fragmentJSON(ydoc.getXmlFragment(BODY)),
    notes,
    headers,
    footers,
    page: (meta(ydoc).get('page') as PageSetup | undefined) ?? DEFAULT_PAGE,
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
    const page = meta(source).get('page');
    if (page) meta(target).set('page', page);
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
