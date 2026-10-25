/**
 * Editor actions that span the body, the shared doc and the session:
 * images, footnotes, table of contents, headers/footers, page numbers,
 * downloads (HTML, Markdown, text) and printing.
 */
import { generateHTML, type Editor, type JSONContent } from '@tiptap/core';
import type { DocSession } from '../collab/session';
import { docsExtensions, SHARED_EDIT_ORIGIN } from '../extensions';
import { fragmentJSON, noteKey, notesIndex, plainText, sectionsMap, storiesIndex, storyKey } from '../model/ydoc';
import { effectiveStory, newSectionId, type PageInfo } from '../model/sections';
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap';
import { EMU_PER_PX, type HeaderFooterKind, type PMDoc, type PMNode, type Section, type StorySide } from '../model/types';
import { sanitizeStylesheet } from '../model/format';
import { tr } from '@oel/i18n';
import { toast } from '@oel/emboss';
import { saveFile } from '@oel/platform';

const staticExtensions = docsExtensions({ bare: true });

export function toHTML(doc: PMDoc | JSONContent): string {
  return generateHTML(doc as JSONContent, staticExtensions);
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

function naturalSize(file: Blob): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth || 200, h: img.naturalHeight || 150 });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => resolve({ w: 200, h: 150 });
    img.src = url;
  });
}

/** Insert an image file at the selection, scaled to fit the text width. */
export async function insertImageFile(editor: Editor, session: DocSession, file: Blob, maxWidthPx: number, at?: number) {
  if (!file.type.startsWith('image/')) return;
  const [{ w, h }, path] = await Promise.all([naturalSize(file), session.addImage(file)]);
  const scale = Math.min(1, maxWidthPx / w);
  const node = { type: 'image', attrs: { src: `media:${path}`, path, cx: Math.round(w * scale * EMU_PER_PX), cy: Math.round(h * scale * EMU_PER_PX), alt: '' } };
  if (at != null) editor.chain().focus().insertContentAt(at, node).run();
  else editor.chain().focus().insertContent(node).run();
}

// ---------------------------------------------------------------------------
// Footnotes
// ---------------------------------------------------------------------------

export function insertFootnote(editor: Editor, session: DocSession, kind: 'footnote' | 'endnote' = 'footnote'): string {
  const idx = notesIndex(session.ydoc);
  let max = 0;
  idx.forEach((_, key) => {
    const [k, id] = key.split(':');
    if (k === kind) max = Math.max(max, Number(id) || 0);
  });
  const id = String(Math.max(1, max + 1));
  const styleId = editor.storage.paragraph.styles.idForRole(kind === 'footnote' ? 'footnoteText' : 'endnoteText') ?? (kind === 'footnote' ? 'FootnoteText' : 'EndnoteText');
  session.ydoc.transact(() => {
    const frag = session.ydoc.getXmlFragment(noteKey(kind, id));
    prosemirrorJSONToYXmlFragment(editor.schema, { type: 'doc', content: [{ type: 'paragraph', attrs: { styleId } }] }, frag);
    idx.set(`${kind}:${id}`, true);
  });
  editor.chain().focus().insertContent({ type: 'noteRef', attrs: { kind, id } }).run();
  return id;
}

/** Notes in the order they are referenced in the body (that is their number). */
export function noteOrder(editor: Editor, kind: 'footnote' | 'endnote'): string[] {
  const out: string[] = [];
  editor.state.doc.descendants((n) => {
    if (n.type.name === 'noteRef' && n.attrs.kind === kind && !out.includes(String(n.attrs.id))) out.push(String(n.attrs.id));
  });
  return out;
}

// ---------------------------------------------------------------------------
// Headers, footers, page numbers
// ---------------------------------------------------------------------------

const randomStoryId = () => `hf-${Math.random().toString(36).slice(2, 10)}`;

/** A new header/footer story (one empty paragraph in the Header/Footer style), or a copy of `from`. */
export function createStory(editor: Editor, session: DocSession, side: StorySide, from?: string | null): string {
  const id = randomStoryId();
  const styleId = editor.storage.paragraph.styles.idForRole(side) ?? (side === 'header' ? 'Header' : 'Footer');
  const doc = from ? fragmentJSON(session.ydoc.getXmlFragment(storyKey(from))) : { type: 'doc' as const, content: [{ type: 'paragraph', attrs: { styleId } }] };
  session.ydoc.transact(() => {
    prosemirrorJSONToYXmlFragment(editor.schema, doc.content.length ? doc : { type: 'doc', content: [{ type: 'paragraph', attrs: { styleId } }] }, session.ydoc.getXmlFragment(storyKey(id)));
    storiesIndex(session.ydoc).set(id, { part: null, side });
  });
  return id;
}

/** Point one section's slot at a story (`null` = no reference of its own: inherit). */
export function setSectionStory(session: DocSession, sectionId: string, side: StorySide, kind: HeaderFooterKind, storyId: string | null) {
  const map = sectionsMap(session.ydoc);
  const s = map.get(sectionId);
  if (!s) return;
  const key = side === 'header' ? 'headers' : 'footers';
  const refs = { ...s[key] };
  if (storyId) refs[kind] = storyId;
  else delete refs[kind];
  session.ydoc.transact(() => map.set(sectionId, { ...s, [key]: refs }), SHARED_EDIT_ORIGIN);
}

/** The story a section's slot shows, created on that section when there is none. */
export function ensureStory(editor: Editor, session: DocSession, sections: Section[], index: number, side: StorySide, kind: HeaderFooterKind = 'default'): string {
  const found = effectiveStory(sections, index, side, kind);
  if (found && storiesIndex(session.ydoc).has(found)) return found;
  const id = createStory(editor, session, side);
  setSectionStory(session, sections[index]!.id, side, kind, id);
  return id;
}

/**
 * « Lier au précédent » (Word's Link to previous). On: the section drops its
 * own reference and shows the previous section's story. Off: it gets its own
 * copy of what it was showing.
 */
export function linkToPrevious(editor: Editor, session: DocSession, sections: Section[], index: number, side: StorySide, kind: HeaderFooterKind, link: boolean): string | null {
  const id = sections[index]!.id;
  if (link) {
    setSectionStory(session, id, side, kind, null);
    return effectiveStory(sections, index - 1, side, kind);
  }
  const inherited = effectiveStory(sections, index, side, kind);
  const copy = createStory(editor, session, side, inherited);
  setSectionStory(session, id, side, kind, copy);
  return copy;
}

/** Remove a story: every section referencing it stops doing so. */
export function removeStory(session: DocSession, storyId: string) {
  session.ydoc.transact(() => {
    const map = sectionsMap(session.ydoc);
    for (const [id, s] of [...map.entries()]) {
      const strip = (refs: Section['headers']) => Object.fromEntries(Object.entries(refs).filter(([, v]) => v !== storyId));
      const headers = strip(s.headers);
      const footers = strip(s.footers);
      if (Object.keys(headers).length !== Object.keys(s.headers).length || Object.keys(footers).length !== Object.keys(s.footers).length) map.set(id, { ...s, headers, footers });
    }
    storiesIndex(session.ydoc).delete(storyId);
    const f = session.ydoc.getXmlFragment(storyKey(storyId));
    f.delete(0, f.length);
  });
}

/** Index of the section that contains document position `pos`. */
export function sectionIndexAt(editor: Editor, pos: number): number {
  const { blockSection } = editor.storage.pagination.layout;
  const doc = editor.state.doc;
  const index = doc.resolve(Math.max(0, Math.min(pos, doc.content.size))).index(0);
  return blockSection[index] ?? blockSection[blockSection.length - 1] ?? 0;
}

/**
 * Insert a section break at the selection (« Saut de section »): the text
 * before it becomes a new section with the current one's setup; the current
 * section continues after it and starts as `kind`.
 */
export function insertSectionBreak(editor: Editor, session: DocSession, kind: 'nextPage' | 'continuous') {
  const { sections } = editor.storage.pagination.layout;
  const current = sections[sectionIndexAt(editor, editor.state.selection.from)];
  if (!current) return false;
  const id = newSectionId();
  const map = sectionsMap(session.ydoc);
  const record = map.get(current.id) ?? current;
  // Split at the cursor (or after the current paragraph when it is at its end), then mark the first half.
  const ok = editor
    .chain()
    .focus()
    .command(({ tr, state }) => {
      const { $from } = state.selection;
      if ($from.depth < 1 || $from.node(1).type.name !== 'paragraph' || $from.depth > 1) return false;
      const para = $from.node(1);
      const start = $from.before(1);
      const atEnd = $from.parentOffset === para.content.size;
      if (atEnd) tr.insert(start + para.nodeSize, state.schema.nodes.paragraph!.create({ ...para.attrs, section: null, numId: null, pPr: null }));
      else tr.split($from.pos);
      // The first half ends the new section; a break the paragraph already had stays at its end (second half).
      tr.setNodeAttribute(start, 'section', id);
      const second = start + tr.doc.nodeAt(start)!.nodeSize;
      tr.setNodeAttribute(second, 'section', para.attrs.section ?? null);
      return true;
    })
    .run();
  if (!ok) return false;
  session.ydoc.transact(() => {
    map.set(id, { ...record, id });
    map.set(current.id, { ...record, kind });
  }, SHARED_EDIT_ORIGIN);
  return true;
}

/** Number of pages per section index (for SECTIONPAGES). */
export function pagesPerSection(pages: PageInfo[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const p of pages) m.set(p.section, (m.get(p.section) ?? 0) + 1);
  return m;
}

export const PAGE_FIELD = { type: 'ooxmlInline', attrs: { xml: '<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>', label: '1', hidden: false, field: 'PAGE' } };

/** Page numbers at the bottom right, as Docs' "Numéros de page" (the first section's footer, inherited by the next ones). */
export function insertPageNumbers(editor: Editor, session: DocSession) {
  const { sections } = editor.storage.pagination.layout;
  const id = ensureStory(editor, session, sections, 0, 'footer');
  const frag = session.ydoc.getXmlFragment(storyKey(id));
  const styleId = editor.storage.paragraph.styles.idForRole('footer') ?? 'Footer';
  session.ydoc.transact(() => {
    frag.delete(0, frag.length);
    prosemirrorJSONToYXmlFragment(editor.schema, { type: 'doc', content: [{ type: 'paragraph', attrs: { styleId, align: 'right' }, content: [PAGE_FIELD] }] }, frag);
  });
}

// ---------------------------------------------------------------------------
// Table of contents
// ---------------------------------------------------------------------------

const TOC_PR = '<w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj>';
const fld = (xml: string, field: string | null = null) => ({ type: 'ooxmlInline', attrs: { xml, label: '', hidden: true, field } });

/** Build (or rebuild) a Word-compatible TOC from the headings; Word can refresh it (it is a TOC field). */
export function tocNode(editor: Editor, pageOf: (pos: number) => number | string | null): PMNode {
  const entries: Array<{ text: string; level: number; page: number | string | null }> = [];
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === 'sdtBlock' && n.attrs.gallery === 'Table of Contents') return false;
    if (n.type.name === 'paragraph' && n.attrs.outline != null && n.attrs.outline < 3 && n.textContent.trim()) {
      entries.push({ text: n.textContent.trim(), level: n.attrs.outline, page: pageOf(pos) });
    }
    return n.type.name !== 'paragraph';
  });
  const tabs = '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9350"/></w:tabs>';
  const paras: PMNode[] = [{ type: 'paragraph', attrs: { styleId: null, css: 'font-weight:700' }, content: [{ type: 'text', text: tr('Table des matières', 'Table of contents') }] }];
  const begin = [
    fld('<w:r><w:fldChar w:fldCharType="begin"/></w:r>'),
    fld('<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>', 'TOC'),
    fld('<w:r><w:fldChar w:fldCharType="separate"/></w:r>'),
  ];
  const end = fld('<w:r><w:fldChar w:fldCharType="end"/></w:r>');
  if (!entries.length) entries.push({ text: tr('Ajoutez des titres (Titre 1 à 3) puis mettez la table à jour.', 'Add headings (Heading 1 to 3), then update the table.'), level: 0, page: null });
  entries.forEach((e, i) => {
    const content: PMNode[] = [...(i === 0 ? begin : []), { type: 'text', text: e.text }];
    if (e.page != null) content.push({ type: 'tab' }, { type: 'text', text: String(e.page) });
    if (i === entries.length - 1) content.push(end);
    paras.push({ type: 'paragraph', attrs: { pPr: tabs, ind: e.level ? { left: e.level * 360 } : null, css: e.page != null ? 'tab-size:5in' : null }, content });
  });
  return { type: 'sdtBlock', attrs: { sdtPr: TOC_PR, gallery: 'Table of Contents' }, content: paras };
}

export function insertOrUpdateToc(editor: Editor, pageOf: (pos: number) => number | string | null) {
  const node = tocNode(editor, pageOf);
  let existing: { pos: number; size: number } | null = null;
  editor.state.doc.descendants((n, pos) => {
    if (!existing && n.type.name === 'sdtBlock' && n.attrs.gallery === 'Table of Contents') existing = { pos, size: n.nodeSize };
    return !existing;
  });
  if (existing) {
    const { pos, size } = existing as { pos: number; size: number };
    editor.chain().focus().insertContentAt({ from: pos, to: pos + size }, node).run();
  } else {
    editor.chain().focus().insertContent(node).run();
  }
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

/** Save a copy (a download on the web, a save dialog in the app); says so when it fails. */
export function download(name: string, data: BlobPart, type: string) {
  saveFile(data, name, type).catch((e: Error) => toast({ title: tr('Export impossible', 'Export failed'), description: e.message, tone: 'danger' }));
}

export const safeFileName = (title: string) => (title.trim() || 'document').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120);

function htmlDocument(editor: Editor, title: string, stylesCss: string, pagePx: { width: number; margins: [number, number, number, number] }) {
  const body = editor.getHTML();
  const [t, r, b, l] = pagePx.margins;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title>
<style>@page{size:${pagePx.width}px auto;margin:${t}px ${r}px ${b}px ${l}px}body{margin:0 auto;max-width:${pagePx.width - l - r}px;padding:24px}
.oel-doc .oel-p{margin:0}.oel-tab{white-space:pre;tab-size:48px}.oel-pagebreak{display:block;break-after:page}table{border-collapse:collapse}td,th{padding:0 5.4pt;vertical-align:top}table[data-new-table] td,table[data-new-table] th{border:0.5pt solid #000}
.oel-ooxml[data-hidden]{display:none}.oel-noteref{font-size:.7em}img{max-width:100%}
${sanitizeStylesheet(stylesCss)}</style></head><body class="oel-doc">${body}</body></html>`;
}

export function downloadHTML(editor: Editor, title: string, stylesCss: string, page: { width: number; margins: [number, number, number, number] }) {
  download(`${safeFileName(title)}.html`, htmlDocument(editor, title, stylesCss, page), 'text/html');
}

export function downloadText(editor: Editor, title: string) {
  download(`${safeFileName(title)}.txt`, plainText(editor.getJSON() as PMNode), 'text/plain');
}

function mdInline(nodes: PMNode[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n';
      if (n.type === 'tab') return '\t';
      if (n.type !== 'text') return '';
      let t = (n.text ?? '').replace(/([*_`[\]\\])/g, '\\$1');
      const marks = new Set((n.marks ?? []).map((m) => m.type));
      if (marks.has('bold')) t = `**${t}**`;
      if (marks.has('italic')) t = `*${t}*`;
      if (marks.has('strike')) t = `~~${t}~~`;
      const link = n.marks?.find((m) => m.type === 'link');
      if (link) t = `[${t}](${String(link.attrs?.href ?? '')})`;
      return t;
    })
    .join('');
}

export function toMarkdown(editor: Editor): string {
  const defs = editor.storage.docList.defs();
  const lines: string[] = [];
  const counters = new Map<string, number>();
  const visit = (n: PMNode) => {
    if (n.type === 'paragraph') {
      const a = n.attrs ?? {};
      const text = mdInline(n.content);
      if (a.outline != null) lines.push(`${'#'.repeat(Math.min(6, Number(a.outline) + 1))} ${text}`, '');
      else if (a.numId != null && a.numId !== 0) {
        const lvl = Number(a.ilvl ?? 0);
        const d = defs.get(Number(a.numId));
        const bullet = d?.levels[lvl]?.fmt === 'bullet';
        const key = `${a.numId}:${lvl}`;
        const c = (counters.get(key) ?? 0) + 1;
        counters.set(key, c);
        const marker = d?.kind === 'check' ? '- [ ]' : d?.kind === 'checked' ? '- [x]' : bullet ? '-' : `${c}.`;
        lines.push(`${'   '.repeat(lvl)}${marker} ${text}`);
      } else lines.push(text, '');
      return;
    }
    if (n.type === 'table') {
      const rows = (n.content ?? []).map((r) => (r.content ?? []).map((c) => (c.content ?? []).map((p) => mdInline(p.content)).join(' ').replace(/\|/g, '\\|')));
      rows.forEach((r, i) => {
        lines.push(`| ${r.join(' | ')} |`);
        if (i === 0) lines.push(`|${r.map(() => ' --- ').join('|')}|`);
      });
      lines.push('');
      return;
    }
    for (const c of n.content ?? []) visit(c);
  };
  visit(editor.getJSON() as PMNode);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function downloadMarkdown(editor: Editor, title: string) {
  download(`${safeFileName(title)}.md`, toMarkdown(editor), 'text/markdown');
}

/** Print / save as PDF: the browser paginates a clean copy of the document. */
export function printDocument(editor: Editor, title: string, stylesCss: string, page: { width: number; margins: [number, number, number, number] }) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.append(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(htmlDocument(editor, title, stylesCss, page).replace('padding:24px', 'padding:0'));
  doc.close();
  const go = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  };
  if (doc.readyState === 'complete') setTimeout(go, 50);
  else frame.onload = go;
}

export const SPECIAL_CHARS = '« » “ ” ‘ ’ — – … • · ° € £ ¥ ¢ © ® ™ § ¶ † ‡ ± × ÷ ≠ ≈ ≤ ≥ ∞ √ ∑ π µ Ω α β γ δ λ ← → ↑ ↓ ↔ ⇒ ✓ ✗ ★ ☆ ☐ ☑ ♥ ♦ ♣ ♠ ½ ¼ ¾ ¹ ² ³ É È Ê À Â Ç Œ Æ Ô Û Î é è ê ë à â ç œ æ ô û ù î ï ÿ ñ ß'.split(' ');
