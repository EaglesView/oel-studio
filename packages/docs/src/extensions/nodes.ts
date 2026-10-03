/**
 * Nodes mirroring the oeldocx-rs codec schema. Attribute names and defaults
 * must match `crates/oel-docx/src/read.rs` exactly: the raw XML attributes
 * (`pPr`, `rPr`, `tcPr`, `xml`…) are what make the round trip lossless.
 */
import { Node, mergeAttributes, type Attributes } from '@tiptap/core';
import { Table, TableCell, TableHeader, TableRow, TableView } from '@tiptap/extension-table';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { paragraphCss } from '../model/format';
import type { AnchorAttrs, ParagraphAttrs } from '../model/types';
import { EMU_PER_PX } from '../model/types';

const raw = (def: unknown = null) => ({ default: def, rendered: false });

/** Style ids of the document, by Docs role; set by the editor from the codec styles. */
export interface StyleRegistry {
  idForRole(role: string): string | null;
  outlineOf(styleId: string | null): number | null;
  normalId(): string | null;
}

export const fallbackRegistry: StyleRegistry = {
  idForRole: (role) => ({ normal: 'Normal', title: 'Title', subtitle: 'Subtitle' })[role] ?? (role.startsWith('heading') ? `Heading${role.slice(7)}` : null),
  outlineOf: (id) => (id && /^Heading([1-9])$/.test(id) ? Number(id.slice(7)) - 1 : null),
  normalId: () => 'Normal',
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    docParagraph: {
      /** Apply a paragraph style by Docs role (`normal`, `title`, `heading1`…). */
      setParagraphRole: (role: string) => ReturnType;
      setParagraphStyle: (styleId: string | null, outline: number | null) => ReturnType;
      setAlign: (align: ParagraphAttrs['align']) => ReturnType;
      setLineSpacing: (line: number | null) => ReturnType;
      setParagraphSpacing: (before: number | null, after: number | null) => ReturnType;
      changeIndent: (deltaTwips: number) => ReturnType;
      insertHorizontalLine: () => ReturnType;
    };
    pageBreak: { insertPageBreak: () => ReturnType };
    tab: { insertTab: () => ReturnType };
  }
  interface Storage {
    paragraph: { styles: StyleRegistry };
  }
}

/** Update every paragraph touched by the selection. */
function eachParagraph(
  tr: import('@tiptap/pm/state').Transaction,
  fn: (attrs: Record<string, unknown>, pos: number) => Record<string, unknown> | null,
) {
  const { from, to } = tr.selection;
  let changed = false;
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== 'paragraph') return true;
    const next = fn(node.attrs, pos);
    if (next) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...next });
      changed = true;
    }
    return false;
  });
  return changed;
}

export const DocParagraph = Node.create({
  name: 'paragraph',
  priority: 1000,
  group: 'block',
  content: 'inline*',

  addStorage() {
    return { styles: fallbackRegistry };
  },

  addAttributes(): Attributes {
    return {
      pPr: raw(),
      styleId: raw(),
      align: raw(),
      spacing: raw(),
      ind: raw(),
      numId: raw(),
      ilvl: raw(0),
      outline: raw(),
      css: raw(),
      section: { default: null, rendered: false, keepOnSplit: false },
      frame: raw(),
      checked: raw(),
    };
  },

  parseHTML() {
    const styles = () => this.storage.styles;
    const heading = (level: number) => ({
      tag: `h${level}`,
      getAttrs: (el: HTMLElement) => {
        const role = `heading${level}`;
        const align = el.style.textAlign;
        return { styleId: styles().idForRole(role), outline: level - 1, align: ['center', 'right', 'justify'].includes(align) ? align : null };
      },
    });
    return [
      {
        tag: 'p',
        getAttrs: (el: HTMLElement) => {
          const align = el.style.textAlign;
          return { align: ['center', 'right', 'justify'].includes(align) ? align : null };
        },
      },
      ...[1, 2, 3, 4, 5, 6].map(heading),
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as ParagraphAttrs;
    const tag = a.outline != null && a.outline < 6 ? `h${a.outline + 1}` : 'p';
    return [
      tag,
      mergeAttributes(HTMLAttributes, {
        class: 'oel-p',
        'data-style': a.styleId ?? undefined,
        'data-section': a.section ?? undefined,
        style: paragraphCss(a) || undefined,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setParagraphStyle:
        (styleId, outline) =>
        ({ tr, dispatch }) => {
          const ok = eachParagraph(tr, () => ({ styleId, outline }));
          if (ok && dispatch) dispatch(tr);
          return ok;
        },
      setParagraphRole:
        (role) =>
        ({ commands }) => {
          const reg = this.storage.styles;
          const id = role === 'normal' ? reg.normalId() : reg.idForRole(role) ?? fallbackRegistry.idForRole(role);
          const outline = role.startsWith('heading') ? Number(role.slice(7)) - 1 : null;
          return commands.setParagraphStyle(id, outline);
        },
      setAlign:
        (align) =>
        ({ tr, dispatch }) => {
          const ok = eachParagraph(tr, () => ({ align }));
          if (ok && dispatch) dispatch(tr);
          return ok;
        },
      setLineSpacing:
        (line) =>
        ({ tr, dispatch }) => {
          const ok = eachParagraph(tr, (a) => {
            const s = { ...((a.spacing as object) ?? {}) } as Record<string, unknown>;
            if (line == null) {
              delete s.line;
              delete s.lineRule;
            } else {
              s.line = line;
              s.lineRule = 'auto';
            }
            return { spacing: Object.keys(s).length ? s : null };
          });
          if (ok && dispatch) dispatch(tr);
          return ok;
        },
      setParagraphSpacing:
        (before, after) =>
        ({ tr, dispatch }) => {
          const ok = eachParagraph(tr, (a) => {
            const s = { ...((a.spacing as object) ?? {}) } as Record<string, unknown>;
            if (before == null) delete s.before;
            else s.before = before;
            if (after == null) delete s.after;
            else s.after = after;
            return { spacing: Object.keys(s).length ? s : null };
          });
          if (ok && dispatch) dispatch(tr);
          return ok;
        },
      changeIndent:
        (delta) =>
        ({ tr, dispatch }) => {
          const ok = eachParagraph(tr, (a) => {
            if (a.numId != null && a.numId !== 0) {
              const ilvl = Math.max(0, Math.min(8, Number(a.ilvl ?? 0) + Math.sign(delta)));
              return { ilvl };
            }
            const ind = { ...((a.ind as object) ?? {}) } as Record<string, number>;
            const left = Math.max(0, (ind.left ?? 0) + delta);
            if (left) ind.left = left;
            else delete ind.left;
            return { ind: Object.keys(ind).length ? ind : null };
          });
          if (ok && dispatch) dispatch(tr);
          return ok;
        },
      insertHorizontalLine:
        () =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: 'paragraph',
              attrs: {
                pPr: '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>',
                css: 'border-bottom:0.75pt solid currentColor;padding-bottom:1pt',
              },
            })
            .run(),
    };
  },

  addKeyboardShortcuts() {
    const editor = this.editor;
    const normal = () => ({ styleId: this.storage.styles.normalId(), outline: null, pPr: null, spacing: null, ind: null, align: null, css: null });
    return {
      // Enter at the end of a heading continues in normal text (style's "next").
      Enter: () => {
        const { $from, empty } = editor.state.selection;
        const p = $from.parent;
        if (!empty || p.type.name !== 'paragraph') return false;
        if (p.content.size === 0 && p.attrs.numId != null && p.attrs.numId !== 0) {
          // Empty list item: leave the list (Docs/Word behaviour).
          return editor.commands.updateAttributes('paragraph', { numId: null, ilvl: 0 });
        }
        if (p.attrs.outline != null && $from.parentOffset === p.content.size) {
          return editor.chain().splitBlock().updateAttributes('paragraph', normal()).run();
        }
        return false;
      },
      Backspace: () => {
        const { $from, empty } = editor.state.selection;
        const p = $from.parent;
        if (!empty || $from.parentOffset !== 0 || p.type.name !== 'paragraph') return false;
        if (p.attrs.numId != null && p.attrs.numId !== 0) {
          return editor.commands.updateAttributes('paragraph', { numId: null, ilvl: 0 });
        }
        return false;
      },
      Tab: () => {
        if (editor.isActive('tableCell') || editor.isActive('tableHeader')) return false;
        const p = editor.state.selection.$from.parent;
        if (p.attrs.numId != null && p.attrs.numId !== 0) return editor.commands.changeIndent(720);
        return editor.commands.insertTab();
      },
      'Shift-Tab': () => {
        if (editor.isActive('tableCell') || editor.isActive('tableHeader')) return false;
        return editor.commands.changeIndent(-720);
      },
      'Mod-Alt-0': () => editor.commands.setParagraphRole('normal'),
      'Mod-Alt-1': () => editor.commands.setParagraphRole('heading1'),
      'Mod-Alt-2': () => editor.commands.setParagraphRole('heading2'),
      'Mod-Alt-3': () => editor.commands.setParagraphRole('heading3'),
      'Mod-Alt-4': () => editor.commands.setParagraphRole('heading4'),
      'Mod-Alt-5': () => editor.commands.setParagraphRole('heading5'),
      'Mod-Alt-6': () => editor.commands.setParagraphRole('heading6'),
      'Mod-Shift-l': () => editor.commands.setAlign('left'),
      'Mod-Shift-e': () => editor.commands.setAlign('center'),
      'Mod-Shift-r': () => editor.commands.setAlign('right'),
      'Mod-Shift-j': () => editor.commands.setAlign('justify'),
      'Mod-]': () => editor.commands.changeIndent(720),
      'Mod-[': () => editor.commands.changeIndent(-720),
    };
  },
});

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'span[data-page-break]' }, { tag: 'br[data-page-break]' }],
  renderHTML: () => ['span', { class: 'oel-pagebreak', 'data-page-break': '', contenteditable: 'false' }],
  renderText: () => '\n',
  addCommands() {
    return {
      insertPageBreak:
        () =>
        ({ chain }) =>
          chain().insertContent({ type: 'pageBreak' }).splitBlock().run(),
    };
  },
  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.insertPageBreak() };
  },
});

export const Tab = Node.create({
  name: 'tab',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  parseHTML: () => [{ tag: 'span.oel-tab' }, { tag: 'span.Apple-tab-span' }],
  renderHTML: () => ['span', { class: 'oel-tab', contenteditable: 'false' }, '\t'],
  renderText: () => '\t',
  addCommands() {
    return {
      insertTab:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: 'tab' }),
    };
  },
});

/** Inline picture. `src` is `media:<package path>`, resolved by the editor's media store. */
export interface ImageResolver {
  url(path: string): string | null;
}

export const DocImage = Node.create<{ resolver: ImageResolver }>({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,
  selectable: true,
  addOptions() {
    return { resolver: { url: () => null } };
  },
  addAttributes() {
    return {
      src: { default: null },
      path: raw(),
      rid: raw(),
      cx: raw(),
      cy: raw(),
      alt: { default: '' },
      title: { default: '' },
      floating: raw(false),
      xml: raw(),
    };
  },
  parseHTML: () => [{ tag: 'img[src]' }],
  renderHTML({ node }) {
    const a = node.attrs;
    const w = a.cx ? Math.round(a.cx / EMU_PER_PX) : undefined;
    const h = a.cy ? Math.round(a.cy / EMU_PER_PX) : undefined;
    return ['img', { src: a.src, alt: a.alt, title: a.title || undefined, width: w, height: h, 'data-path': a.path ?? undefined, class: 'oel-img' }];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const dom = document.createElement('span');
      dom.className = 'oel-img-wrap';
      dom.contentEditable = 'false';
      const img = document.createElement('img');
      img.className = 'oel-img';
      img.draggable = false;
      const handle = document.createElement('span');
      handle.className = 'oel-img-handle';
      handle.setAttribute('aria-hidden', 'true');
      dom.append(img, handle);
      const apply = (n: typeof node) => {
        const a = n.attrs;
        const path = a.path ?? (typeof a.src === 'string' && a.src.startsWith('media:') ? a.src.slice(6) : null);
        const url = path ? this.options.resolver.url(path) : a.src;
        if (url && img.src !== url) img.src = url;
        img.alt = a.alt ?? '';
        if (a.cx) img.style.width = `${a.cx / EMU_PER_PX}px`;
        if (a.cy) img.style.height = `${a.cy / EMU_PER_PX}px`;
        dom.classList.toggle('is-floating', !!a.floating);
        dom.title = a.floating ? 'Image flottante (position conservée à l’export)' : '';
      };
      apply(node);
      // Corner handle: proportional resize, committed as one step on release.
      handle.addEventListener('pointerdown', (e) => {
        if (!editor.isEditable) return;
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const w0 = img.getBoundingClientRect().width / (editor.view.dom.getBoundingClientRect().width / editor.view.dom.offsetWidth || 1);
        const ratio = (current.attrs.cy || 1) / (current.attrs.cx || 1);
        const move = (ev: PointerEvent) => {
          const w = Math.max(24, w0 + (ev.clientX - startX));
          img.style.width = `${w}px`;
          img.style.height = `${w * ratio}px`;
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          const w = parseFloat(img.style.width);
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos == null) return;
          editor.view.dispatch(
            editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, cx: Math.round(w * EMU_PER_PX), cy: Math.round(w * ratio * EMU_PER_PX) }),
          );
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
      return {
        dom,
        update(n) {
          if (n.type !== current.type) return false;
          current = n;
          apply(n);
          return true;
        },
        selectNode() {
          dom.classList.add('is-selected');
        },
        deselectNode() {
          dom.classList.remove('is-selected');
        },
        ignoreMutation: () => true,
      };
    };
  },
});

/** EMU → CSS px. */
const emuPx = (emu: number) => Math.round((emu / EMU_PER_PX) * 100) / 100;

/** How Word's text wrap is approximated in the flow (null: no effect on the text). */
export function anchorWrapStyle(a: AnchorAttrs): { style: string; note: string | null } | null {
  if (a.wrap === 'none') return null;
  const flowRelative = ['column', 'margin', 'character'].includes(a.position.relH) && ['paragraph', 'line'].includes(a.position.relV);
  if (!flowRelative) return { style: '', note: 'Habillage du texte non appliqué : l’objet est positionné par rapport à la page.' };
  const d = a.dist;
  const h = emuPx(a.cy + d.t + d.b);
  const top = a.position.v != null ? Math.max(0, emuPx(a.position.v)) : 0;
  if (a.wrap === 'topAndBottom') return { style: `float:left;clear:both;width:100%;height:${h}px;margin-top:${top}px`, note: null };
  const right = a.position.alignH === 'right' || a.position.alignH === 'outside';
  const w = emuPx(a.cx + d.l + d.r);
  const offset = !right && a.position.h != null && a.position.h > 0 ? emuPx(a.position.h) : 0;
  const shape = a.wrap !== 'square' && a.shape.geometry === 'ellipse' ? ';shape-outside:ellipse(50% 50%)' : '';
  return { style: `float:${right ? 'right' : 'left'};width:${w}px;height:${h}px;margin-top:${top}px;margin-left:${offset}px${shape}`, note: null };
}

/**
 * A floating object (Word's `wp:anchor`). In the text it is only a marker
 * (or a float that makes room for wrapped text); the object itself is drawn on
 * the page's anchor layer by the page view, from the attrs below.
 */
export const DocAnchor = Node.create({
  name: 'anchor',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes(): Attributes {
    return {
      kind: raw('shape'),
      position: raw(),
      cx: raw(0),
      cy: raw(0),
      behindDoc: raw(false),
      wrap: raw('none'),
      wrapSide: raw(),
      dist: raw(),
      z: raw(0),
      shape: raw(),
      children: raw([]),
      xml: raw(''),
      alt: raw(''),
      title: raw(''),
    };
  },

  parseHTML() {
    return [];
  },

  renderHTML({ node }) {
    const a = node.attrs as AnchorAttrs;
    const wrap = a.position && a.dist && a.shape ? anchorWrapStyle(a) : null;
    const label = a.alt || { picture: 'Image flottante', shape: 'Forme', textbox: 'Zone de texte', group: 'Groupe d’objets' }[a.kind];
    return [
      'span',
      {
        class: `oel-anchor${wrap?.style ? ' oel-anchor--wrap' : ''}`,
        'data-kind': a.kind,
        contenteditable: 'false',
        title: wrap?.note ? `${label} · ${wrap.note}` : label,
        style: wrap?.style || undefined,
      },
    ];
  },
});

export const NoteRef = Node.create({
  name: 'noteRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { kind: { default: 'footnote' }, id: { default: '0' }, rPr: raw() };
  },
  parseHTML: () => [{ tag: 'sup.oel-noteref', getAttrs: (el: HTMLElement) => ({ kind: el.dataset.kind, id: el.dataset.id }) }],
  renderHTML: ({ node }) => ['sup', { class: 'oel-noteref', 'data-kind': node.attrs.kind, 'data-id': node.attrs.id, contenteditable: 'false' }],
});

/** Anything the editor does not model, kept verbatim (bookmarks, fields, equations…). */
export const OoxmlInline = Node.create({
  name: 'ooxmlInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { xml: raw(''), label: raw(''), hidden: raw(false), field: raw() };
  },
  parseHTML: () => [{ tag: 'span[data-ooxml]', getAttrs: (el: HTMLElement) => ({ xml: el.dataset.ooxml, label: el.textContent ?? '' }) }],
  renderHTML: ({ node }) => {
    const a = node.attrs;
    const field = a.field as string | null;
    const text = a.hidden || field === 'NOTENUM' ? '' : field === 'PAGE' || field === 'NUMPAGES' ? (a.label || '#') : a.label;
    return [
      'span',
      {
        class: 'oel-ooxml',
        'data-ooxml': a.xml,
        'data-hidden': a.hidden ? '' : undefined,
        'data-field': field ?? undefined,
        title: a.hidden || !a.label ? undefined : `${a.label} (conservé tel quel)`,
        contenteditable: 'false',
      },
      text,
    ];
  },
  renderText: ({ node }) => (node.attrs.hidden ? '' : node.attrs.label ?? ''),
});

export const OoxmlBlock = Node.create({
  name: 'ooxmlBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return { xml: raw(''), label: raw('') };
  },
  parseHTML: () => [{ tag: 'div[data-ooxml-block]', getAttrs: (el: HTMLElement) => ({ xml: el.dataset.ooxmlBlock, label: el.textContent ?? '' }) }],
  renderHTML: ({ node }) => ['div', { class: 'oel-ooxml-block', 'data-ooxml-block': node.attrs.xml, contenteditable: 'false' }, node.attrs.label || 'Élément Word'],
});

/** Content control (w:sdt), e.g. a table of contents. */
export const SdtBlock = Node.create({
  name: 'sdtBlock',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return { sdtPr: raw(), sdtEndPr: raw(), gallery: raw() };
  },
  parseHTML: () => [{ tag: 'div.oel-sdt' }],
  renderHTML: ({ node }) => ['div', { class: 'oel-sdt', 'data-gallery': node.attrs.gallery ?? undefined }, 0],
});

/** Declarations of a `a:b;c:d` CSS string. */
function cssDecls(css: unknown): Array<[string, string]> {
  if (typeof css !== 'string') return [];
  return css
    .split(';')
    .map((d) => d.split(':'))
    .filter((d) => d.length >= 2)
    .map(([k, ...v]) => [k!.trim(), v.join(':').trim()] as [string, string]);
}

/**
 * Word's look of a table on top of Tiptap's view: the codec's display-only
 * CSS (width, alignment, indent), the table style (for its paragraph rules)
 * and a marker for tables made in the editor, which are drawn with a grid.
 */
export class DocTableView extends TableView {
  constructor(node: PMNode, cellMinWidth: number) {
    super(node, cellMinWidth);
    this.decorate(node);
  }

  override update(node: PMNode) {
    if (!super.update(node)) return false;
    this.decorate(node);
    return true;
  }

  private decorate(node: PMNode) {
    const t = this.table;
    for (const [k, v] of cssDecls(node.attrs.css)) t.style.setProperty(k, v);
    if (node.attrs.styleId) t.dataset.tstyle = node.attrs.styleId as string;
    else delete t.dataset.tstyle;
    // No Word properties at all: a table created here (exported with Table Grid).
    if (node.attrs.tblPr == null) t.dataset.newTable = '';
    else delete t.dataset.newTable;
  }
}

export const DocTable = Table.extend({
  addOptions() {
    return { ...this.parent!(), View: DocTableView };
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      tblPr: raw(),
      grid: raw(),
      styleId: { default: null, rendered: false },
      css: raw(),
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    // Static rendering (export, headers/footers): same look as the view.
    const out = this.parent!({ node, HTMLAttributes }) as unknown as [string, Record<string, unknown>, ...unknown[]];
    const attrs = { ...out[1] };
    if (node.attrs.css) attrs.style = [attrs.style, node.attrs.css].filter(Boolean).join(';');
    if (node.attrs.styleId) attrs['data-tstyle'] = node.attrs.styleId;
    if (node.attrs.tblPr == null) attrs['data-new-table'] = '';
    return [out[0], attrs, ...out.slice(2)] as never;
  },
});

export const DocTableRow = TableRow.extend({
  addAttributes() {
    return { ...this.parent?.(), trPr: raw(), tblPrEx: raw(), header: raw(false) };
  },
});

const cellAttrs = {
  background: {
    default: null,
    parseHTML: (el: HTMLElement) => el.style.backgroundColor || null,
    renderHTML: (a: Record<string, unknown>) => (a.background ? { style: `background-color:${a.background}` } : {}),
  },
  valign: {
    default: null,
    parseHTML: (el: HTMLElement) => el.style.verticalAlign || null,
    renderHTML: (a: Record<string, unknown>) => (a.valign ? { style: `vertical-align:${a.valign === 'center' ? 'middle' : a.valign}` } : {}),
  },
  tcPr: raw(),
  /** Display-only Word look (borders, conditional shading, margins), from the codec. */
  css: {
    default: null,
    parseHTML: () => null,
    renderHTML: (a: Record<string, unknown>) => (a.css ? { style: a.css as string } : {}),
  },
};

export const DocTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttrs };
  },
});

export const DocTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttrs };
  },
});

/** Put the caret in the first text position of a node (used after inserting blocks). */
export function caretInto(tr: import('@tiptap/pm/state').Transaction, pos: number) {
  return tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
}
