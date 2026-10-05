/**
 * Editor state over a `SlideSession`: current slide, selection, text editing,
 * undo, clipboard, and every command the menus, toolbar, canvas and filmstrip
 * call. Components read it through `useController` (a version counter bumped
 * on each change, like the sheets controller).
 */
import * as Y from 'yjs';
import { LOCAL, type SlidesDoc } from '../model/ydoc';
import { applyLayout, copySlide, newId, picture, shape, slideFromLayout, textBox } from '../model/ops';
import { adoptCopy, linkClip, linkHost, linksOf, newLinkId, pictureBytes, pictureValue, rememberCopied, revOf, setLinkClip } from '@oel/links';
import { setLevel, setParaProps, setRunProps } from '../model/text';
import { emu, pt, type Element, type Line, type Paint, type ParaProps, type RunProps, type TextBody } from '../model/types';
import type { SlideSession } from '../collab/session';

/** What the active text editor (ProseMirror) offers the toolbar. */
export interface TextEditorApi {
  elementId: string;
  setRun(patch: Partial<RunProps>): void;
  toggle(key: 'bold' | 'italic'): void;
  toggleDecoration(key: 'underline' | 'strike'): void;
  setPara(patch: Partial<ParaProps>): void;
  indent(delta: number): void;
  /** Run properties at the cursor (resolved), for the toolbar state. */
  current(): { bold: boolean; italic: boolean; underline: boolean; strike: boolean; size: number; font: string; color: string; align: string; bullet: string };
  commit(): void;
}

/** Elements copied, shared by every open presentation of the tab (copy between decks keeps what it can). */
let clipboard: { elements: Element[]; deck: string; at: number } | null = null;

export class SlidesController {
  readonly doc: SlidesDoc;
  readonly undo: Y.UndoManager;
  current = '';
  selection: string[] = [];
  /** Element (or table cell `id:r:c`) whose text is being edited. */
  editing: string | null = null;
  textEditor: TextEditorApi | null = null;
  version = 0;
  private listeners = new Set<() => void>();
  private off: () => void;

  constructor(readonly session: SlideSession) {
    this.doc = session.slides;
    this.undo = new Y.UndoManager([this.doc.order, this.doc.slides], { trackedOrigins: new Set([LOCAL]), captureTimeout: 500 });
    this.undo.on('stack-item-added', (e: { stackItem: { meta: Map<string, unknown> } }) => {
      e.stackItem.meta.set('slide', this.current);
      e.stackItem.meta.set('selection', this.selection);
    });
    this.undo.on('stack-item-popped', (e: { stackItem: { meta: Map<string, unknown> } }) => {
      const s = e.stackItem.meta.get('slide') as string | undefined;
      if (s && this.doc.slides.has(s)) this.current = s;
      this.selection = ((e.stackItem.meta.get('selection') as string[] | undefined) ?? []).filter((id) => this.element(id));
    });
    const onChange = () => this.bump();
    this.session.ydoc.on('afterTransaction', onChange);
    const offMedia = this.session.media.subscribe(onChange);
    this.off = () => {
      this.session.ydoc.off('afterTransaction', onChange);
      offMedia();
    };
    this.current = this.doc.slideIds()[0] ?? '';
  }

  destroy() {
    this.off();
    this.undo.destroy();
    this.listeners.clear();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;

  bump() {
    const ids = this.doc.slideIds();
    if (!ids.includes(this.current)) {
      this.current = ids[0] ?? '';
      this.selection = [];
      this.editing = null;
    } else {
      const s = this.doc.slide(this.current);
      this.selection = this.selection.filter((id) => s?.elements.some((e) => e.id === id));
    }
    this.version++;
    for (const l of this.listeners) l();
  }

  get readOnly() {
    return this.session.status.readOnly;
  }

  get info() {
    return this.doc.info();
  }

  get slide() {
    return this.doc.slide(this.current);
  }

  get index() {
    return this.doc.slideIds().indexOf(this.current);
  }

  element(id: string): Element | undefined {
    return this.slide?.elements.find((e) => e.id === id);
  }

  get selected(): Element[] {
    return this.selection.map((id) => this.element(id)).filter((e): e is Element => !!e);
  }

  private edit(fn: () => void) {
    if (this.readOnly) return;
    this.doc.edit(fn);
  }

  // -------------------------------------------------------------------------
  // Navigation and selection
  // -------------------------------------------------------------------------

  goTo(target: string | number) {
    const ids = this.doc.slideIds();
    const id = typeof target === 'number' ? ids[Math.max(0, Math.min(ids.length - 1, target))] : target;
    if (!id || id === this.current) return;
    this.endText();
    this.current = id;
    this.selection = [];
    this.bump();
  }

  select(ids: string[], additive = false) {
    if (this.editing && !ids.includes(this.editing.split(':')[0]!)) this.endText();
    if (additive) {
      const all = ids.every((i) => this.selection.includes(i));
      this.selection = all ? this.selection.filter((i) => !ids.includes(i)) : [...new Set([...this.selection, ...ids])];
    } else {
      this.selection = ids;
    }
    this.bump();
  }

  selectAll() {
    this.select((this.slide?.elements ?? []).filter((e) => !e.locked || e.kind === 'graphic').map((e) => e.id));
  }

  /** Start typing in an element (or a table cell). */
  beginText(id: string) {
    if (this.readOnly) return;
    const [elId] = id.split(':');
    const el = this.element(elId!);
    if (!el || el.locked) return;
    if (!el.text && !el.table) {
      if (el.kind !== 'shape') return;
      this.edit(() => this.doc.updateElement(this.current, el.id, { text: { body: { anchor: 'ctr', l: 91440, t: 45720, r: 91440, b: 45720, wrap: true, autofit: 'none', fontScale: 1, lineReduction: 0, vert: 'horz' }, levels: this.info.textDefaults, paras: [] } }));
    }
    this.selection = [elId!];
    this.editing = id;
    this.bump();
  }

  endText() {
    if (!this.editing) return;
    this.textEditor?.commit();
    this.editing = null;
    this.textEditor = null;
    this.bump();
  }

  // -------------------------------------------------------------------------
  // Slides
  // -------------------------------------------------------------------------

  /** A new slide after the current one, on the given layout (else the current slide's, or the first). */
  newSlide(layoutId?: string): string | null {
    const info = this.info;
    const current = this.slide;
    // After a title slide, PowerPoint offers « Titre et contenu ».
    const preferred = layoutId ?? (current && /title|titre/i.test(info.layouts.find((l) => l.id === current.layout)?.name ?? '') && info.layouts[1] ? info.layouts[1].id : current?.layout);
    const layout = info.layouts.find((l) => l.id === preferred) ?? info.layouts[0];
    if (!layout) return null;
    const s = slideFromLayout(layout);
    this.edit(() => this.doc.insertSlide(this.index + 1, s));
    this.goTo(s.id);
    return s.id;
  }

  duplicateSlide(id = this.current) {
    const s = this.doc.slide(id);
    if (!s) return;
    const copy = copySlide(s, this.doc.notes(id)?.toString() ?? '');
    const at = this.doc.slideIds().indexOf(id) + 1;
    // Linked copies on the slide get ids of their own and links of their own.
    const links = linksOf(this.session.ydoc);
    const linked = new Map(copy.elements.filter((e) => links.byObject(e.id)).map((e) => [e.id, newId('c')]));
    copy.elements = copy.elements.map((e) => (linked.has(e.id) ? { ...e, id: linked.get(e.id)! } : e));
    this.edit(() => {
      this.doc.insertSlide(at, copy);
      for (const [from, to] of linked) adoptCopy(links, from, to, `diapo ${at + 1}`);
    });
    this.goTo(copy.id);
  }

  deleteSlide(id = this.current) {
    const ids = this.doc.slideIds();
    if (ids.length <= 1) return;
    const i = ids.indexOf(id);
    this.edit(() => this.doc.removeSlide(id));
    if (id === this.current) this.goTo(Math.min(i, ids.length - 2));
  }

  moveSlide(id: string, to: number) {
    this.edit(() => this.doc.moveSlide(id, to));
  }

  toggleHidden(id = this.current) {
    const s = this.doc.slide(id);
    if (s) this.edit(() => this.doc.setSlide(id, { hidden: !s.hidden }));
  }

  setLayout(layoutId: string) {
    const s = this.slide;
    const layout = this.info.layouts.find((l) => l.id === layoutId);
    if (!s || !layout || s.layout === layoutId) return;
    const next = applyLayout(s.elements, layout);
    this.edit(() => {
      this.doc.setSlide(s.id, { layout: layoutId });
      for (const el of next) {
        if (!s.elements.some((e) => e.id === el.id)) this.doc.addElement(s.id, el);
        else this.doc.updateElement(s.id, el.id, el);
      }
    });
  }

  setBackground(paint: Paint | null, all = false) {
    const ids = all ? this.doc.slideIds() : [this.current];
    this.edit(() => {
      for (const id of ids) this.doc.setSlide(id, { background: paint });
    });
  }

  // -------------------------------------------------------------------------
  // Elements
  // -------------------------------------------------------------------------

  private center(cx: number, cy: number) {
    return { x: Math.round((this.info.width - cx) / 2), y: Math.round((this.info.height - cy) / 2), cx, cy };
  }

  private add(el: Element, edit = false) {
    this.edit(() => this.doc.addElement(this.current, el));
    this.selection = [el.id];
    if (edit) this.beginText(el.id);
    else this.bump();
  }

  insertTextBox(at?: { x: number; y: number; cx?: number; cy?: number }) {
    const cx = at?.cx ?? Math.round(this.info.width * 0.4);
    const box = at ? { x: at.x, y: at.y, cx, cy: at.cy ?? emu(40) } : this.center(cx, emu(40));
    this.add(textBox(this.info, box), true);
  }

  insertShape(prst: string, at?: { x: number; y: number; cx: number; cy: number }) {
    const side = Math.round(Math.min(this.info.width, this.info.height) * 0.3);
    this.add(shape(this.info, prst, at ?? this.center(prst === 'line' ? side * 1.5 : side * (prst === 'rightArrow' ? 1.6 : 1), side)));
  }

  async insertPicture(file: File, at?: { x: number; y: number }) {
    if (this.readOnly) return;
    const path = await this.session.addPicture(file);
    const size = await imageSize(file).catch(() => ({ w: 640, h: 480 }));
    // Fit within 60 % of the slide, keeping the picture's shape.
    const k = Math.min((this.info.width * 0.6) / emu(size.w * 0.75), (this.info.height * 0.6) / emu(size.h * 0.75), 1);
    const cx = Math.round(emu(size.w * 0.75) * k);
    const cy = Math.round(emu(size.h * 0.75) * k);
    // An empty picture placeholder takes it.
    const ph = this.selected.find((e) => e.kind === 'picture' && !e.image?.media);
    if (ph) {
      this.edit(() => this.doc.updateElement(this.current, ph.id, { image: { media: path, mime: file.type } }));
      return;
    }
    this.add(picture(path, file.type, at ? { ...at, cx, cy } : this.center(cx, cy), file.name.replace(/\.[^.]+$/, '')));
  }

  deleteSelection() {
    const ids = this.selection.filter((id) => this.element(id));
    if (!ids.length) return;
    this.endText();
    this.edit(() => this.doc.removeElements(this.current, ids));
    this.selection = [];
    this.bump();
  }

  copy() {
    const els = this.selected;
    if (!els.length) return;
    clipboard = { elements: structuredClone(els), deck: this.session.status.docId, at: Date.now() };
    // A linked copy keeps its link when copied or cut (pasting makes a new link to the same source).
    const links = linksOf(this.session.ydoc);
    rememberCopied(els.map((e) => links.byObject(e.id)));
    // A picture copied here pastes linked in another file of the desk (Figma I1 d).
    setLinkClip(null);
    const pic = els.length === 1 && els[0]!.kind === 'picture' && els[0]!.image?.media ? els[0]! : null;
    const url = pic ? this.session.media.url(pic.image!.media) : null;
    if (pic && url) {
      const docId = this.session.status.docId;
      void fetch(url)
        .then((r) => r.blob())
        .then(pictureValue)
        .then((value) =>
          setLinkClip({ source: { docId, kind: 'slides', ref: { kind: 'image', objectId: pic.id }, title: linkHost().fileTitle(docId) ?? 'Présentation', label: pic.name || 'Image' }, value, at: Date.now() }),
        )
        .catch(() => {});
    }
  }

  /**
   * Paste a picture copied in another desk file as a linked copy (Figma I1 d,
   * I6 §5). Returns the new link id, or null when there is nothing to paste
   * linked (then the usual paste runs).
   */
  async pasteLinkedPicture(): Promise<{ linkId: string; source: string } | null> {
    if (this.readOnly) return null;
    const c = linkClip(this.session.status.docId);
    // The deck's own clipboard is newer: that is what the person means to paste.
    if (!c || (clipboard && clipboard.at > c.at)) return null;
    const blob = pictureBytes(c.value.media.hash);
    if (!blob) return null;
    const path = await this.session.addPicture(blob);
    const { width, height } = c.value.media;
    const k = Math.min((this.info.width * 0.6) / emu(width * 0.75), (this.info.height * 0.6) / emu(height * 0.75), 1);
    const cx = Math.round(emu(width * 0.75) * k);
    const cy = Math.round(emu(height * 0.75) * k);
    const el = picture(path, c.value.media.mime, this.center(cx, cy), c.source.label);
    const linkId = newLinkId();
    const where = `diapo ${this.index + 1}`;
    this.edit(() => {
      this.doc.addElement(this.current, el);
      linksOf(this.session.ydoc).put(
        { id: linkId, source: c.source, target: { objectId: el.id, label: where }, carries: 'picture', mode: 'live', snapshot: { rev: revOf(c.value), at: Date.now(), by: this.session.author } },
        'person',
      );
    });
    this.selection = [el.id];
    this.bump();
    return { linkId, source: c.source.title };
  }

  cut() {
    this.copy();
    this.deleteSelection();
  }

  get canPaste() {
    return !!clipboard?.elements.length;
  }

  paste() {
    if (!clipboard) return;
    const sameDeck = clipboard.deck === this.session.status.docId;
    const existing = new Set(this.slide?.elements.map((e) => e.id));
    const offset = existing.size && clipboard.elements.some((e) => existing.has(e.id)) ? emu(12) : 0;
    const pairs = clipboard.elements
      // Another deck's pictures and tables cannot be written from here (charts made in the editor can).
      .filter((e) => sameDeck || (e.kind !== 'picture' && e.kind !== 'table' && e.kind !== 'group' && (e.kind !== 'graphic' || (!!e.chart && !e.src))))
      .map((e) => [e.id, { ...e, id: newId('c'), x: e.x + offset, y: e.y + offset, src: sameDeck ? e.src : undefined, ph: undefined }] as const);
    const els = pairs.map(([, e]) => e);
    if (!els.length) return;
    const where = `diapo ${this.index + 1}`;
    this.edit(() => {
      for (const el of els) this.doc.addElement(this.current, el);
      for (const [from, el] of pairs) adoptCopy(linksOf(this.session.ydoc), from, el.id, where);
    });
    this.selection = els.map((e) => e.id);
    this.bump();
  }

  duplicateSelection() {
    this.copy();
    this.paste();
  }

  /** Z-order: `front`, `back`, `forward`, `backward`. */
  arrange(how: 'front' | 'back' | 'forward' | 'backward') {
    const s = this.slide;
    if (!s) return;
    const ids = s.elements.map((e) => e.id);
    this.edit(() => {
      for (const id of this.selection) {
        const i = ids.indexOf(id);
        const to = how === 'front' ? ids.length - 1 : how === 'back' ? 0 : how === 'forward' ? Math.min(ids.length - 1, i + 1) : Math.max(0, i - 1);
        this.doc.reorderElement(s.id, id, to);
      }
    });
  }

  update(id: string, patch: Partial<Element>) {
    this.edit(() => this.doc.updateElement(this.current, id, patch));
  }

  /** Move the selection by points. */
  nudge(dx: number, dy: number) {
    this.edit(() => {
      for (const e of this.selected) if (!e.locked) this.doc.updateElement(this.current, e.id, { x: e.x + emu(dx), y: e.y + emu(dy) });
    });
  }

  /** Align the selection (one element: to the slide). */
  align(how: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') {
    const els = this.selected.filter((e) => !e.locked);
    if (!els.length) return;
    const one = els.length === 1;
    const x0 = one ? 0 : Math.min(...els.map((e) => e.x));
    const y0 = one ? 0 : Math.min(...els.map((e) => e.y));
    const x1 = one ? this.info.width : Math.max(...els.map((e) => e.x + e.cx));
    const y1 = one ? this.info.height : Math.max(...els.map((e) => e.y + e.cy));
    this.edit(() => {
      for (const e of els) {
        const patch: Partial<Element> = {};
        if (how === 'left') patch.x = x0;
        if (how === 'center') patch.x = Math.round((x0 + x1 - e.cx) / 2);
        if (how === 'right') patch.x = x1 - e.cx;
        if (how === 'top') patch.y = y0;
        if (how === 'middle') patch.y = Math.round((y0 + y1 - e.cy) / 2);
        if (how === 'bottom') patch.y = y1 - e.cy;
        this.doc.updateElement(this.current, e.id, patch);
      }
    });
  }

  setFill(paint: Paint | null) {
    this.edit(() => {
      for (const e of this.selected) if (e.kind !== 'picture' && !e.locked) this.doc.updateElement(this.current, e.id, { fill: paint ?? { type: 'none' } });
    });
  }

  setLine(patch: Partial<Line> | null) {
    this.edit(() => {
      for (const e of this.selected) {
        if (e.locked) continue;
        this.doc.updateElement(this.current, e.id, { line: patch === null ? { ...e.line, paint: { type: 'none' } } : { ...e.line, ...patch } });
      }
    });
  }

  setText(id: string, body: TextBody) {
    this.update(id, { text: body });
  }

  /** Run properties: inside the text editor on the selection, else on whole selected shapes. */
  setRun(patch: Partial<RunProps>) {
    if (this.textEditor) return this.textEditor.setRun(patch);
    this.edit(() => {
      for (const e of this.selected) if (e.text && !e.locked) this.doc.updateElement(this.current, e.id, { text: setRunProps(e.text, patch) });
    });
  }

  setPara(patch: Partial<ParaProps>) {
    if (this.textEditor) return this.textEditor.setPara(patch);
    this.edit(() => {
      for (const e of this.selected) if (e.text && !e.locked) this.doc.updateElement(this.current, e.id, { text: setParaProps(e.text, patch) });
    });
  }

  indent(delta: number) {
    if (this.textEditor) return this.textEditor.indent(delta);
    this.edit(() => {
      for (const e of this.selected) if (e.text && !e.locked) this.doc.updateElement(this.current, e.id, { text: setLevel(e.text, delta) });
    });
  }

  setAnchor(anchor: 't' | 'ctr' | 'b') {
    this.edit(() => {
      for (const e of this.selected) if (e.text && !e.locked) this.doc.updateElement(this.current, e.id, { text: { ...e.text, body: { ...e.text.body, anchor } } });
    });
  }

  setNotes(text: string) {
    const t = this.doc.notes(this.current);
    if (!t || t.toString() === text) return;
    this.edit(() => {
      t.delete(0, t.length);
      t.insert(0, text);
    });
  }
}

/** Natural size of a picture file, in CSS pixels. */
export async function imageSize(file: Blob): Promise<{ w: number; h: number }> {
  if (file.type === 'image/svg+xml') {
    const text = await file.text();
    const vb = /viewBox\s*=\s*["']([^"']+)["']/i.exec(text)?.[1]?.trim().split(/[\s,]+/).map(Number);
    if (vb?.length === 4) return { w: vb[2]!, h: vb[3]! };
  }
  const bmp = await createImageBitmap(file);
  const out = { w: bmp.width, h: bmp.height };
  bmp.close();
  return out;
}

export { pt, emu };
