/**
 * Editing one text body (a shape's, or a table cell's) with ProseMirror.
 *
 * The document mirrors the codec's paragraphs and runs: a paragraph node
 * carries `lvl`, its explicit properties and its end-of-paragraph run
 * properties; text carries one `run` mark holding the run's explicit
 * properties (unknown XML included, so splitting a run keeps it). Styling
 * comes from decorations computed with the same functions as the static
 * renderer, so the text does not move when editing starts.
 */
import { useEffect, useRef } from 'react';
import { Schema, type Mark, type Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, EditorView } from '@tiptap/pm/view';
import { keymap } from '@tiptap/pm/keymap';
import { history, redo, undo } from '@tiptap/pm/history';
import { baseKeymap } from '@tiptap/pm/commands';
import { Plugin } from '@tiptap/pm/state';
import { autoNumber, clean, fieldText, levelOf, numbering, paraCss, resolvePara, resolveRun, runCss, fontStack, hasText, type TextCtx } from '../model/text';
import type { Para, ParaProps, Run, RunProps, TextBody } from '../model/types';
import type { TextEditorApi } from './controller';
import { tr } from '@oel/i18n';

export const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: {
      content: 'inline*',
      attrs: { lvl: { default: 0 }, props: { default: {} }, end: { default: {} } },
      parseDOM: [{ tag: 'p' }, { tag: 'div' }, { tag: 'li' }],
      toDOM: () => ['p', { class: 'oel-para' }, 0],
    },
    text: { group: 'inline' },
    br: {
      group: 'inline',
      inline: true,
      selectable: false,
      attrs: { props: { default: {} } },
      parseDOM: [{ tag: 'br' }],
      toDOM: () => ['br'],
    },
    field: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: { field: { default: null }, fieldId: { default: null }, text: { default: '' }, props: { default: {} } },
      toDOM: (n) => ['span', { class: 'oel-field', contenteditable: 'false' }, n.attrs.text as string],
    },
  },
  marks: {
    run: {
      attrs: { props: { default: {} } },
      parseDOM: [{ tag: 'span' }],
      toDOM: () => ['span', 0],
    },
  },
});

const json = (o: unknown) => JSON.stringify(o ?? {});

/** Text body → ProseMirror document. */
export function toDoc(body: TextBody): PMNode {
  const paras = body.paras.length ? body.paras : [{ lvl: 0, props: {}, runs: [], end: {} } as Para];
  return schema.node(
    'doc',
    null,
    paras.map((p) =>
      schema.node(
        'paragraph',
        { lvl: p.lvl ?? 0, props: p.props ?? {}, end: p.end ?? {} },
        p.runs.flatMap((r) => {
          if (r.kind === 'br') return [schema.node('br', { props: r.props ?? {} })];
          if (r.kind === 'field') return [schema.node('field', { field: r.field ?? null, fieldId: r.fieldId ?? null, text: r.text, props: r.props ?? {} })];
          return r.text ? [schema.text(r.text, [schema.mark('run', { props: r.props ?? {} })])] : [];
        }),
      ),
    ),
  );
}

/** ProseMirror document → paragraphs (new text takes the paragraph end's properties). */
export function fromDoc(doc: PMNode): Para[] {
  const out: Para[] = [];
  doc.forEach((p) => {
    const runs: Run[] = [];
    const end = p.attrs.end as RunProps;
    p.forEach((n) => {
      if (n.type.name === 'br') runs.push({ kind: 'br', props: n.attrs.props as RunProps });
      else if (n.type.name === 'field') runs.push(clean({ kind: 'field', text: n.attrs.text as string, field: (n.attrs.field as string) ?? undefined, fieldId: (n.attrs.fieldId as string) ?? undefined, props: n.attrs.props as RunProps }));
      else if (n.isText) {
        const props = (n.marks.find((m) => m.type.name === 'run')?.attrs.props as RunProps | undefined) ?? end;
        const prev = runs[runs.length - 1];
        if (prev && prev.kind === 'text' && json(prev.props) === json(props)) prev.text += n.text ?? '';
        else runs.push({ kind: 'text', text: n.text ?? '', props });
      }
    });
    out.push({ lvl: p.attrs.lvl as number, props: p.attrs.props as ParaProps, runs, end });
  });
  return out;
}

const cssText = (o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${v}`)
    .join(';');

function decorations(doc: PMNode, body: TextBody, ctx: TextCtx): DecorationSet {
  const b = body.body;
  const fit = { fontScale: b.autofit === 'norm' ? b.fontScale : 1, lineReduction: b.autofit === 'norm' ? b.lineReduction : 0 };
  const decos: Decoration[] = [];
  const paras = fromDoc(doc);
  const nums = numbering({ ...body, paras });
  let i = 0;
  doc.forEach((p, offset) => {
    const para = paras[i]!;
    const level = levelOf(body, para.lvl ?? 0);
    const rp = resolvePara(level, para.props ?? {});
    const first = para.runs.find((r) => r.kind !== 'br');
    const firstRun = resolveRun(level, first?.props ?? para.end ?? {}, ctx);
    const pcss = { ...paraCss(rp, firstRun.size, fit), ...runCss(firstRun, ctx, fit) };
    decos.push(Decoration.node(offset, offset + p.nodeSize, { style: cssText(pcss) }));
    if (hasText(para) && rp.bullet.kind !== 'none') {
      const text = rp.bullet.kind === 'auto' ? autoNumber(rp.bullet.scheme, nums.get(i) ?? 1) : (rp.bullet.char ?? '•');
      const indent = rp.indent / 12700;
      const style = cssText({
        display: 'inline-block',
        minWidth: indent < 0 ? `${-indent}px` : '0',
        textIndent: '0',
        fontFamily: rp.bullet.font ? fontStack(rp.bullet.font, ctx) : fontStack(firstRun.font, ctx),
        color: rp.bullet.color ?? firstRun.color,
        fontSize: `${firstRun.size * fit.fontScale * (rp.bullet.size ?? 1)}px`,
        fontWeight: '400',
        fontStyle: 'normal',
        textDecoration: 'none',
      });
      decos.push(
        Decoration.widget(
          offset + 1,
          () => {
            const s = document.createElement('span');
            s.className = 'oel-bullet';
            s.setAttribute('style', style);
            s.textContent = text;
            return s;
          },
          { side: -1, ignoreSelection: true, key: `b${i}:${text}:${style}` },
        ),
      );
    }
    p.forEach((n, o) => {
      const from = offset + 1 + o;
      if (n.isText) {
        const props = (n.marks.find((m) => m.type.name === 'run')?.attrs.props as RunProps | undefined) ?? para.end ?? {};
        decos.push(Decoration.inline(from, from + n.nodeSize, { style: cssText(runCss(resolveRun(level, props, ctx), ctx, fit)) }));
      } else if (n.type.name === 'field') {
        const r = { kind: 'field', text: n.attrs.text as string, field: n.attrs.field as string } as Run;
        decos.push(Decoration.node(from, from + n.nodeSize, { style: cssText(runCss(resolveRun(level, n.attrs.props as RunProps, ctx), ctx, fit)), 'data-text': fieldText(r, ctx) }));
      }
    });
    i++;
  });
  return DecorationSet.create(doc, decos);
}

/** Paragraph positions touched by the selection. */
function paragraphsIn(state: EditorState): Array<{ pos: number; node: PMNode }> {
  const { from, to } = state.selection;
  const out: Array<{ pos: number; node: PMNode }> = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'paragraph') {
      out.push({ pos, node });
      return false;
    }
    return true;
  });
  return out;
}

const runMark = (marks: readonly Mark[] | null | undefined) => marks?.find((m) => m.type.name === 'run');

export function TextEditor({
  body,
  ctx,
  onChange,
  onExit,
  register,
  autoFocus = true,
  selectAll,
}: {
  body: TextBody;
  ctx: TextCtx;
  /** Called (debounced) with the new paragraphs and the content height in points. */
  onChange: (paras: Para[], height: number) => void;
  onExit: () => void;
  register: (api: TextEditorApi | null) => void;
  autoFocus?: boolean;
  selectAll?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef({ body, ctx, onChange, onExit });
  latest.current = { body, ctx, onChange, onExit };

  useEffect(() => {
    const el = host.current!;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      clearTimeout(timer);
      timer = undefined;
      latest.current.onChange(fromDoc(view.state.doc), el.offsetHeight);
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(flush, 350);
    };
    const enter = (state: EditorState, dispatch?: (tr: Transaction) => void) => {
      const { $from } = state.selection;
      const para = $from.parent;
      if (para.type.name !== 'paragraph') return false;
      if (dispatch) {
        const tr = state.tr.deleteSelection();
        const stored = runMark(state.storedMarks) ?? runMark(state.selection.$from.marks());
        tr.split(tr.selection.from, 1, [{ type: schema.nodes.paragraph!, attrs: { ...para.attrs } }]);
        if (stored) tr.setStoredMarks([stored]);
        dispatch(tr.scrollIntoView());
      }
      return true;
    };
    const lineBreak = (state: EditorState, dispatch?: (tr: Transaction) => void) => {
      dispatch?.(state.tr.replaceSelectionWith(schema.nodes.br!.create()).scrollIntoView());
      return true;
    };

    const api: TextEditorApi = {
      elementId: '',
      setRun(patch) {
        const { state } = view;
        const { from, to, empty } = state.selection;
        const tr = state.tr;
        if (empty) {
          const cur = (runMark(state.storedMarks ?? state.selection.$from.marks())?.attrs.props as RunProps | undefined) ?? (state.selection.$from.parent.attrs.end as RunProps);
          // An empty paragraph also keeps it as its end properties (its height follows).
          const p = state.selection.$from.parent;
          if (p.content.size === 0) tr.setNodeMarkup(state.selection.$from.before(), null, { ...p.attrs, end: clean({ ...(p.attrs.end as RunProps), ...patch }) });
          // After any step: steps clear stored marks.
          tr.setStoredMarks([schema.mark('run', { props: clean({ ...cur, ...patch }) })]);
        } else {
          state.doc.nodesBetween(from, to, (node, pos, parent) => {
            if (node.isText) {
              const a = Math.max(from, pos);
              const b = Math.min(to, pos + node.nodeSize);
              const props = (runMark(node.marks)?.attrs.props as RunProps | undefined) ?? (parent?.attrs.end as RunProps) ?? {};
              tr.addMark(a, b, schema.mark('run', { props: clean({ ...props, ...patch }) }));
            } else if (node.type.name === 'br' || node.type.name === 'field') {
              tr.setNodeMarkup(pos, null, { ...node.attrs, props: clean({ ...(node.attrs.props as RunProps), ...patch }) });
            } else if (node.type.name === 'paragraph' && from <= pos + 1 && to >= pos + node.nodeSize - 1) {
              tr.setNodeMarkup(pos, null, { ...node.attrs, end: clean({ ...(node.attrs.end as RunProps), ...patch }) });
            }
            return true;
          });
        }
        view.dispatch(tr);
        view.focus();
      },
      toggle(key) {
        const cur = api.current();
        api.setRun({ [key]: !cur[key] });
      },
      toggleDecoration(key) {
        const cur = api.current();
        api.setRun(key === 'underline' ? { underline: cur.underline ? 'none' : 'sng' } : { strike: cur.strike ? 'noStrike' : 'sngStrike' });
      },
      setPara(patch) {
        const tr = view.state.tr;
        for (const { pos, node } of paragraphsIn(view.state)) tr.setNodeMarkup(pos, null, { ...node.attrs, props: clean({ ...(node.attrs.props as ParaProps), ...patch }) });
        view.dispatch(tr);
        view.focus();
      },
      indent(delta) {
        const tr = view.state.tr;
        for (const { pos, node } of paragraphsIn(view.state)) tr.setNodeMarkup(pos, null, { ...node.attrs, lvl: Math.max(0, Math.min(8, (node.attrs.lvl as number) + delta)) });
        view.dispatch(tr);
        view.focus();
      },
      current() {
        const { state } = view;
        const $from = state.selection.$from;
        const para = $from.parent;
        const { body: b, ctx: c } = latest.current;
        const level = levelOf(b, (para.attrs.lvl as number) ?? 0);
        const props = (runMark(state.storedMarks ?? $from.marks())?.attrs.props as RunProps | undefined) ?? (para.attrs.end as RunProps) ?? {};
        const r = resolveRun(level, props, c);
        const p = resolvePara(level, (para.attrs.props as ParaProps) ?? {});
        return { bold: r.bold, italic: r.italic, underline: r.underline !== 'none', strike: r.strike !== 'noStrike', size: r.size, font: r.font, color: r.color, align: p.align, bullet: p.bullet.kind };
      },
      commit: flush,
    };

    const decoPlugin = new Plugin({
      props: { decorations: (state) => decorations(state.doc, latest.current.body, latest.current.ctx) },
    });
    const state = EditorState.create({
      doc: toDoc(latest.current.body),
      plugins: [
        history(),
        keymap({
          'Mod-z': undo,
          'Mod-y': redo,
          'Shift-Mod-z': redo,
          Enter: enter,
          'Shift-Enter': lineBreak,
          'Mod-b': () => (api.toggle('bold'), true),
          'Mod-i': () => (api.toggle('italic'), true),
          'Mod-u': () => (api.toggleDecoration('underline'), true),
          Tab: () => (api.indent(1), true),
          'Shift-Tab': () => (api.indent(-1), true),
          'Mod-e': () => (api.setPara({ align: 'ctr' }), true),
          'Mod-l': () => (api.setPara({ align: 'l' }), true),
          'Mod-r': () => (api.setPara({ align: 'r' }), true),
          'Mod-j': () => (api.setPara({ align: 'just' }), true),
        }),
        keymap(baseKeymap),
        decoPlugin,
      ],
    });
    const view: EditorView = new EditorView(el, {
      state,
      attributes: { class: 'oel-text-editor', role: 'textbox', 'aria-multiline': 'true', 'aria-label': tr('Texte de la forme', 'Shape text') },
      dispatchTransaction(tr) {
        view.updateState(view.state.apply(tr));
        if (tr.docChanged) schedule();
        // The toolbar reflects the cursor.
        el.dispatchEvent(new CustomEvent('oel-text-cursor', { bubbles: true }));
      },
    });
    if (autoFocus) {
      view.focus();
      const sel = selectAll ? TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1) : TextSelection.atEnd(view.state.doc);
      view.dispatch(view.state.tr.setSelection(sel));
    }
    register(api);
    return () => {
      if (timer) flush();
      register(null);
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={host}
      className="oel-text-host"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          latest.current.onExit();
        }
        // Keys typed here are text, not canvas shortcuts (the level shortcut and F5 still bubble).
        const level = e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.shiftKey;
        if (!level && e.key !== 'F5') e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
