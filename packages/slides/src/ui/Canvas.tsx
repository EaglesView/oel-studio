/**
 * The slide being edited: click to select, drag to move (snapping to the
 * slide and to other shapes), handles to resize and rotate, a marquee for
 * several shapes, double-click (or Entrée) to type. Drags preview locally and
 * commit once, so a move is one undo step and one sync message.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as RKeyboardEvent, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react';
import { MenuItem, MenuPopover, Menu, MenuSeparator } from '@oel/emboss';
import type { RefObject } from 'react';
import { SlideView, textFrameStyle, type RenderCtx } from './render';
import { TextEditor } from './TextEditor';
import type { SlidesController } from './controller';
import { emu, pt, type Element, type TextBody } from '../model/types';
import type { SlideData } from '../model/ydoc';

type Box = { x: number; y: number; cx: number; cy: number; rot: number };
type Drag =
  | { kind: 'move'; ids: string[]; start: { x: number; y: number }; dx: number; dy: number; moved: boolean; guides: Guide[] }
  | { kind: 'resize'; id: string; hx: number; hy: number; start: { x: number; y: number }; box: Box; next: Box; keep: boolean }
  | { kind: 'rotate'; id: string; center: { x: number; y: number }; rot: number }
  | { kind: 'marquee'; start: { x: number; y: number }; end: { x: number; y: number } };
type Guide = { axis: 'x' | 'y'; at: number };

const HANDLES: Array<[number, number, string]> = [
  [-1, -1, 'nwse'],
  [0, -1, 'ns'],
  [1, -1, 'nesw'],
  [1, 0, 'ew'],
  [1, 1, 'nwse'],
  [0, 1, 'ns'],
  [-1, 1, 'nesw'],
  [-1, 0, 'ew'],
];

const rad = (d: number) => (d * Math.PI) / 180;

/** Box in points. */
const boxOf = (e: Element): Box => ({ x: pt(e.x), y: pt(e.y), cx: pt(e.cx), cy: pt(e.cy), rot: e.rot ?? 0 });

function resized(b: Box, hx: number, hy: number, dx: number, dy: number, keep: boolean, line: boolean): Box {
  const r = rad(b.rot);
  const du = dx * Math.cos(r) + dy * Math.sin(r);
  const dv = -dx * Math.sin(r) + dy * Math.cos(r);
  const min = line ? 0 : 1;
  let w = hx ? Math.max(min, b.cx + hx * du) : b.cx;
  let h = hy ? Math.max(min, b.cy + hy * dv) : b.cy;
  if (keep && hx && hy && b.cx > 0 && b.cy > 0) {
    const k = Math.max(w / b.cx, h / b.cy);
    w = b.cx * k;
    h = b.cy * k;
  }
  // The opposite handle stays where it was.
  const c = { x: b.x + b.cx / 2, y: b.y + b.cy / 2 };
  const fx = (-hx * b.cx) / 2;
  const fy = (-hy * b.cy) / 2;
  const F = { x: c.x + fx * Math.cos(r) - fy * Math.sin(r), y: c.y + fx * Math.sin(r) + fy * Math.cos(r) };
  const nfx = (-hx * w) / 2;
  const nfy = (-hy * h) / 2;
  const nc = { x: F.x - (nfx * Math.cos(r) - nfy * Math.sin(r)), y: F.y - (nfx * Math.sin(r) + nfy * Math.cos(r)) };
  return { x: nc.x - w / 2, y: nc.y - h / 2, cx: w, cy: h, rot: b.rot };
}

const SNAP = 6;

/** Snap a moving box to the slide's edges and centre and to other shapes; returns the offset and the guides hit. */
function snap(moving: Box, others: Box[], slide: { w: number; h: number }, tol: number): { dx: number; dy: number; guides: Guide[] } {
  const xs = [0, slide.w / 2, slide.w, ...others.flatMap((o) => [o.x, o.x + o.cx / 2, o.x + o.cx])];
  const ys = [0, slide.h / 2, slide.h, ...others.flatMap((o) => [o.y, o.y + o.cy / 2, o.y + o.cy])];
  const mx = [moving.x, moving.x + moving.cx / 2, moving.x + moving.cx];
  const my = [moving.y, moving.y + moving.cy / 2, moving.y + moving.cy];
  let best = { dx: 0, gx: null as number | null, ex: tol + 1 };
  for (const a of mx) for (const t of xs) if (Math.abs(t - a) < best.ex) best = { dx: t - a, gx: t, ex: Math.abs(t - a) };
  let bestY = { dy: 0, gy: null as number | null, ey: tol + 1 };
  for (const a of my) for (const t of ys) if (Math.abs(t - a) < bestY.ey) bestY = { dy: t - a, gy: t, ey: Math.abs(t - a) };
  const guides: Guide[] = [];
  if (best.gx != null) guides.push({ axis: 'x', at: best.gx });
  if (bestY.gy != null) guides.push({ axis: 'y', at: bestY.gy });
  return { dx: best.gx != null ? best.dx : 0, dy: bestY.gy != null ? bestY.dy : 0, guides };
}

export function Canvas({ ctl, ctx, zoom, onContext, label }: { ctl: SlidesController; ctx: RenderCtx; zoom: number; onContext?: (ids: string[]) => void; label: string }) {
  const slide = ctl.slide;
  const info = ctl.info;
  const stage = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; onEl: boolean } | null>(null);
  const [dropping, setDropping] = useState(false);
  const k = zoom;
  const W = pt(info.width);
  const H = pt(info.height);
  const ro = ctl.readOnly;

  /** Pointer position in slide points. */
  const at = (e: { clientX: number; clientY: number }) => {
    const r = plane.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  };

  // Elements shown: the slide's, with the drag applied.
  const shown: SlideData | null = useMemo(() => {
    if (!slide || !drag || drag.kind === 'marquee') return slide;
    const patch = (e: Element): Element => {
      if (drag.kind === 'move' && drag.ids.includes(e.id)) return { ...e, x: e.x + emu(drag.dx), y: e.y + emu(drag.dy) };
      if (drag.kind === 'resize' && drag.id === e.id) return { ...e, x: emu(drag.next.x), y: emu(drag.next.y), cx: emu(drag.next.cx), cy: emu(drag.next.cy) };
      if (drag.kind === 'rotate' && drag.id === e.id) return { ...e, rot: drag.rot };
      return e;
    };
    return { ...slide, elements: slide.elements.map(patch) };
  }, [slide, drag]);

  const editingEl = ctl.editing ? ctl.element(ctl.editing.split(':')[0]!) : undefined;

  const begin = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    stage.current?.focus({ preventScroll: true });
    const p = at(e);
    const hit = (e.target as HTMLElement).closest<HTMLElement>('[data-el]');
    const id = hit?.dataset.el;
    const el = id ? slide?.elements.find((x) => x.id === id) : undefined;
    if (ctl.editing && el?.id === ctl.editing.split(':')[0]) return;
    if (!el) {
      ctl.select([]);
      setDrag({ kind: 'marquee', start: p, end: p });
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      return;
    }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!ctl.selection.includes(el.id) || additive) ctl.select([el.id], additive);
    const ids = additive ? ctl.selection : ctl.selection.includes(el.id) ? ctl.selection : [el.id];
    if (ro || ids.some((i) => slide?.elements.find((x) => x.id === i)?.locked)) return;
    setDrag({ kind: 'move', ids, start: p, dx: 0, dy: 0, moved: false, guides: [] });
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const move = (e: RPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const p = at(e);
    if (drag.kind === 'marquee') return setDrag({ ...drag, end: p });
    if (drag.kind === 'move') {
      let dx = p.x - drag.start.x;
      let dy = p.y - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) * k < 3) return;
      if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      const moving = slide!.elements.filter((x) => drag.ids.includes(x.id)).map(boxOf);
      const bounds = moving.reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), cx: Math.max(a.x + a.cx, b.x + b.cx) - Math.min(a.x, b.x), cy: Math.max(a.y + a.cy, b.y + b.cy) - Math.min(a.y, b.y), rot: 0 }));
      const others = slide!.elements.filter((x) => !drag.ids.includes(x.id) && !x.hidden).map(boxOf);
      const s = e.altKey ? { dx: 0, dy: 0, guides: [] } : snap({ ...bounds, x: bounds.x + dx, y: bounds.y + dy }, others, { w: W, h: H }, SNAP / k);
      return setDrag({ ...drag, dx: dx + s.dx, dy: dy + s.dy, moved: true, guides: s.guides });
    }
    if (drag.kind === 'resize') {
      const el = slide!.elements.find((x) => x.id === drag.id);
      const line = el?.kind === 'connector';
      return setDrag({ ...drag, next: resized(drag.box, drag.hx, drag.hy, p.x - drag.start.x, p.y - drag.start.y, drag.keep !== e.shiftKey, line) });
    }
    if (drag.kind === 'rotate') {
      let a = (Math.atan2(p.y - drag.center.y, p.x - drag.center.x) * 180) / Math.PI + 90;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      return setDrag({ ...drag, rot: ((a % 360) + 360) % 360 });
    }
  };

  const end = () => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (d.kind === 'marquee') {
      const x0 = Math.min(d.start.x, d.end.x);
      const y0 = Math.min(d.start.y, d.end.y);
      const x1 = Math.max(d.start.x, d.end.x);
      const y1 = Math.max(d.start.y, d.end.y);
      if (x1 - x0 < 2 && y1 - y0 < 2) return;
      ctl.select((slide?.elements ?? []).filter((e) => !e.hidden && pt(e.x) < x1 && pt(e.x + e.cx) > x0 && pt(e.y) < y1 && pt(e.y + e.cy) > y0).map((e) => e.id));
      return;
    }
    if (d.kind === 'move' && d.moved) ctl.nudge(d.dx, d.dy);
    if (d.kind === 'resize') ctl.update(d.id, { x: emu(d.next.x), y: emu(d.next.y), cx: emu(d.next.cx), cy: emu(d.next.cy) });
    if (d.kind === 'rotate') ctl.update(d.id, { rot: Math.round(d.rot * 100) / 100 || undefined });
  };

  const startResize = (e: RPointerEvent, el: Element, hx: number, hy: number) => {
    e.stopPropagation();
    if (e.button !== 0 || ro) return;
    plane.current?.setPointerCapture?.(e.pointerId);
    const box = boxOf(el);
    setDrag({ kind: 'resize', id: el.id, hx, hy, start: at(e), box, next: box, keep: el.kind === 'picture' });
  };

  const startRotate = (e: RPointerEvent, el: Element) => {
    e.stopPropagation();
    if (e.button !== 0 || ro) return;
    plane.current?.setPointerCapture?.(e.pointerId);
    const b = boxOf(el);
    setDrag({ kind: 'rotate', id: el.id, center: { x: b.x + b.cx / 2, y: b.y + b.cy / 2 }, rot: b.rot });
  };

  const openFor = (el: Element, cell?: string) => {
    if (el.locked) return;
    if (el.kind === 'picture' && !el.image?.media) return pickPicture(ctl);
    if (el.kind === 'table' && cell) return ctl.beginText(`${el.id}:${cell}`);
    if (el.kind === 'shape') ctl.beginText(el.id);
  };

  const onDouble = (e: RMouseEvent) => {
    const hit = (e.target as HTMLElement).closest<HTMLElement>('[data-el]');
    const el = hit?.dataset.el ? slide?.elements.find((x) => x.id === hit.dataset.el) : undefined;
    if (!el || ro) return;
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]')?.dataset.cell;
    openFor(el, cell);
  };

  const onKey = (e: RKeyboardEvent) => {
    if (ctl.editing) return;
    const mod = e.ctrlKey || e.metaKey;
    const step = e.shiftKey ? 10 : 1;
    const sel = ctl.selected;
    const consume = () => (e.preventDefault(), e.stopPropagation());
    if (e.key === 'Escape') {
      if (sel.length) consume(), ctl.select([]);
      return;
    }
    if (ro) return;
    if (e.key.startsWith('Arrow') && sel.length && !mod) {
      consume();
      ctl.nudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) {
      consume();
      ctl.deleteSelection();
    } else if ((e.key === 'Enter' || e.key === 'F2') && sel.length === 1 && !mod) {
      consume();
      openFor(sel[0]!);
    } else if (e.key === 'Tab' && slide?.elements.length) {
      consume();
      const ids = slide.elements.map((x) => x.id);
      const i = sel.length ? ids.indexOf(sel[sel.length - 1]!.id) : -1;
      ctl.select([ids[(i + (e.shiftKey ? -1 : 1) + ids.length) % ids.length]!]);
    } else if (mod && e.key.toLowerCase() === 'a') {
      consume();
      ctl.selectAll();
    } else if (mod && e.key.toLowerCase() === 'c' && sel.length) {
      consume();
      ctl.copy();
    } else if (mod && e.key.toLowerCase() === 'x' && sel.length) {
      consume();
      ctl.cut();
    } else if (mod && e.key.toLowerCase() === 'd' && sel.length) {
      consume();
      ctl.duplicateSelection();
    } else if (!mod && e.key.length === 1 && sel.length === 1 && sel[0]!.kind === 'shape' && !sel[0]!.locked) {
      // Typing on a selected shape starts editing its text.
      ctl.beginText(sel[0]!.id);
    }
  };

  // Paste: pictures from the system clipboard, else shapes copied here.
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const onPaste = (e: ClipboardEvent) => {
      if (ctl.editing || ro) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      e.preventDefault();
      if (file) void ctl.insertPicture(file);
      else ctl.paste();
    };
    node.addEventListener('paste', onPaste);
    return () => node.removeEventListener('paste', onPaste);
  }, [ctl, ro]);

  // Keep the canvas focused for shortcuts when nothing else took focus.
  useLayoutEffect(() => {
    if (!ctl.editing && document.activeElement === document.body) stage.current?.focus({ preventScroll: true });
  });

  if (!slide || !shown) return <div className="oel-canvas oel-canvas--empty">Aucune diapositive.</div>;

  const selected = ctl.selection.map((id) => shown.elements.find((e) => e.id === id)).filter((e): e is Element => !!e);
  const single = selected.length === 1 ? selected[0] : undefined;

  return (
    <div
      ref={stage}
      className={`oel-canvas${dropping ? ' is-dropping' : ''}`}
      tabIndex={0}
      role="application"
      aria-roledescription="diapositive modifiable"
      aria-label={label}
      onKeyDown={onKey}
      onDragOver={(e) => {
        if (ro || ![...e.dataTransfer.items].some((i) => i.kind === 'file')) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        setDropping(false);
        const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
        if (!files.length || ro) return;
        e.preventDefault();
        e.stopPropagation();
        const p = at(e);
        files.forEach((f, i) => void ctl.insertPicture(f, { x: emu(p.x + i * 12), y: emu(p.y + i * 12) }));
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        const hit = (e.target as HTMLElement).closest<HTMLElement>('[data-el]');
        const id = hit?.dataset.el;
        const onEl = !!id && slide.elements.some((x) => x.id === id);
        if (onEl && !ctl.selection.includes(id!)) ctl.select([id!]);
        setMenu({ x: e.clientX, y: e.clientY, onEl });
        onContext?.(ctl.selection);
      }}
    >
      <div className="oel-canvas__frame" style={{ width: W * k, height: H * k }}>
        <div
          ref={plane}
          className="oel-canvas__plane"
          style={{ width: W, height: H, transform: `scale(${k})` }}
          onPointerDown={begin}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={() => setDrag(null)}
          onDoubleClick={onDouble}
        >
          <SlideView slide={shown} info={info} ctx={ctx}>
            {editingEl && ctl.editing && <EditingFrame ctl={ctl} el={editingEl} ctx={ctx} cell={ctl.editing.split(':').slice(1).join(':') || null} plane={plane} />}
          </SlideView>
          <div className="oel-canvas__overlay" aria-hidden>
            {selected.map((el) => (
              <Selection key={el.id} el={el} k={k} handles={!!single && !ro && !el.locked && !ctl.editing} onResize={startResize} onRotate={startRotate} editing={ctl.editing?.split(':')[0] === el.id} />
            ))}
            {drag?.kind === 'move' &&
              drag.guides.map((g, i) => <div key={i} className={`oel-guide oel-guide--${g.axis}`} style={g.axis === 'x' ? { left: g.at, height: H } : { top: g.at, width: W }} />)}
            {drag?.kind === 'marquee' && (
              <div className="oel-marquee" style={{ left: Math.min(drag.start.x, drag.end.x), top: Math.min(drag.start.y, drag.end.y), width: Math.abs(drag.end.x - drag.start.x), height: Math.abs(drag.end.y - drag.start.y) }} />
            )}
          </div>
        </div>
      </div>
      {menu && <ContextMenu ctl={ctl} at={menu} onClose={() => (setMenu(null), stage.current?.focus())} />}
    </div>
  );
}

function Selection({ el, k, handles, onResize, onRotate, editing }: { el: Element; k: number; handles: boolean; onResize: (e: RPointerEvent, el: Element, hx: number, hy: number) => void; onRotate: (e: RPointerEvent, el: Element) => void; editing: boolean }) {
  const b = boxOf(el);
  const hs = 8 / k;
  const style: CSSProperties = { left: b.x, top: b.y, width: b.cx, height: b.cy, transform: b.rot ? `rotate(${b.rot}deg)` : undefined, borderWidth: 1.5 / k };
  return (
    <div className={`oel-sel${el.locked ? ' is-locked' : ''}${editing ? ' is-editing' : ''}`} style={style}>
      {handles &&
        HANDLES.filter(([hx, hy]) => !(el.kind === 'connector' && (hx === 0 || hy === 0))).map(([hx, hy, cur]) => (
          <span
            key={`${hx}${hy}`}
            className="oel-sel__handle"
            style={{ width: hs, height: hs, left: `calc(${(hx + 1) * 50}% - ${hs / 2}px)`, top: `calc(${(hy + 1) * 50}% - ${hs / 2}px)`, cursor: `${cur}-resize`, borderWidth: 1 / k }}
            onPointerDown={(e) => onResize(e, el, hx, hy)}
          />
        ))}
      {handles && el.kind !== 'connector' && (
        <span className="oel-sel__rotate" style={{ width: hs * 1.4, height: hs * 1.4, top: -24 / k, left: `calc(50% - ${(hs * 1.4) / 2}px)`, borderWidth: 1 / k }} onPointerDown={(e) => onRotate(e, el)} />
      )}
    </div>
  );
}

/** The text editor laid over the element (or table cell) being typed in. */
function EditingFrame({ ctl, el, ctx, cell, plane }: { ctl: SlidesController; el: Element; ctx: RenderCtx; cell: string | null; plane: RefObject<HTMLDivElement | null> }) {
  const [cellBox, setCellBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    if (!cell) return;
    const td = plane.current?.querySelector<HTMLElement>(`[data-el="${CSS.escape(el.id)}"] [data-cell="${cell}"]`);
    if (!td) return;
    // Table cells: offsets within the (unrotated) table, in points.
    setCellBox({ x: pt(el.x) + td.offsetLeft, y: pt(el.y) + td.offsetTop, w: td.offsetWidth, h: td.offsetHeight });
  }, [cell, el, plane]);

  if (cell) {
    const [r, c] = cell.split(':').map(Number);
    const body = el.table?.rows[r!]?.cells[c!]?.text;
    if (!body || !cellBox) return null;
    return (
      <div className="oel-editing oel-editing--cell" style={{ left: cellBox.x, top: cellBox.y, width: cellBox.w, minHeight: cellBox.h }}>
        <div className="oel-el__text" style={{ ...textFrameStyle(body, el), position: 'relative', minHeight: cellBox.h, justifyContent: body.body.anchor === 'ctr' ? 'center' : body.body.anchor === 'b' ? 'flex-end' : 'flex-start' }}>
          <TextEditor
            body={body}
            ctx={ctx}
            register={(api) => (ctl.textEditor = api && { ...api, elementId: el.id })}
            onExit={() => ctl.endText()}
            onChange={(paras) => {
              const table = structuredClone(el.table!);
              table.rows[r!]!.cells[c!]!.text = { ...body, paras };
              ctl.update(el.id, { table });
            }}
          />
        </div>
      </div>
    );
  }
  const body: TextBody | undefined = el.text;
  if (!body) return null;
  const style: CSSProperties = { left: pt(el.x), top: pt(el.y), width: pt(el.cx), height: body.body.autofit === 'shape' ? undefined : pt(el.cy), minHeight: pt(el.cy), transform: el.rot ? `rotate(${el.rot}deg)` : undefined };
  return (
    <div className="oel-editing" style={style}>
      <div className="oel-el__text" style={textFrameStyle(body, el)}>
        <TextEditor
          body={body}
          ctx={ctx}
          register={(api) => (ctl.textEditor = api && { ...api, elementId: el.id })}
          onExit={() => ctl.endText()}
          onChange={(paras, height) => {
            const patch: Partial<Element> = { text: { ...body, paras } };
            // A text box that grows with its text (PowerPoint's « Ajuster la forme au texte »).
            const need = height + pt(body.body.t + body.body.b);
            if (body.body.autofit === 'shape' && Math.abs(emu(need) - el.cy) > emu(1)) patch.cy = emu(need);
            ctl.update(el.id, patch);
          }}
        />
      </div>
    </div>
  );
}

function ContextMenu({ ctl, at, onClose }: { ctl: SlidesController; at: { x: number; y: number; onEl: boolean }; onClose: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const ro = ctl.readOnly;
  const items: Array<{ id: string; label: string; disabled?: boolean } | '-'> = at.onEl
    ? [
        { id: 'cut', label: 'Couper', disabled: ro },
        { id: 'copy', label: 'Copier' },
        { id: 'paste', label: 'Coller', disabled: ro || !ctl.canPaste },
        { id: 'duplicate', label: 'Dupliquer', disabled: ro },
        { id: 'delete', label: 'Supprimer', disabled: ro },
        '-',
        { id: 'front', label: 'Mettre au premier plan', disabled: ro },
        { id: 'forward', label: 'Avancer', disabled: ro },
        { id: 'backward', label: 'Reculer', disabled: ro },
        { id: 'back', label: 'Mettre à l’arrière-plan', disabled: ro },
      ]
    : [
        { id: 'paste', label: 'Coller', disabled: ro || !ctl.canPaste },
        { id: 'select-all', label: 'Tout sélectionner' },
        '-',
        { id: 'new-slide', label: 'Nouvelle diapositive', disabled: ro },
        { id: 'text', label: 'Insérer une zone de texte', disabled: ro },
      ];
  const run = (id: string) => {
    const map: Record<string, () => void> = {
      cut: () => ctl.cut(),
      copy: () => ctl.copy(),
      paste: () => ctl.paste(),
      duplicate: () => ctl.duplicateSelection(),
      delete: () => ctl.deleteSelection(),
      front: () => ctl.arrange('front'),
      forward: () => ctl.arrange('forward'),
      backward: () => ctl.arrange('backward'),
      back: () => ctl.arrange('back'),
      'select-all': () => ctl.selectAll(),
      'new-slide': () => ctl.newSlide(),
      text: () => ctl.insertTextBox(),
    };
    map[id]?.();
  };
  return (
    <>
      <span ref={ref} className="oel-anchor" style={{ position: 'fixed', left: at.x, top: at.y }} aria-hidden />
      <MenuPopover triggerRef={ref as RefObject<HTMLSpanElement>} isOpen onOpenChange={(o) => !o && onClose()} placement="bottom start">
        <Menu aria-label="Actions" autoFocus="first" onAction={(k) => (run(String(k)), onClose())} disabledKeys={items.filter((i): i is { id: string; label: string; disabled?: boolean } => i !== '-' && !!i.disabled).map((i) => i.id)}>
          {items.map((it, i) => (it === '-' ? <MenuSeparator key={`s${i}`} /> : <MenuItem key={it.id} id={it.id}>{it.label}</MenuItem>))}
        </Menu>
      </MenuPopover>
    </>
  );
}

/** Ask for a picture file and insert it (into an empty picture placeholder when one is selected). */
export function pickPicture(ctl: SlidesController) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/gif,image/svg+xml,image/webp';
  input.onchange = () => input.files?.[0] && void ctl.insertPicture(input.files[0]);
  input.click();
}

