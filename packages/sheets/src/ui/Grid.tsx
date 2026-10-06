import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { MAX_COLS, MAX_ROWS, a1, colName, parseRange, rangeA1, type Range } from '../model/a1';
import { ERROR_HELP, formulaContext, functionInfo, matchFunctions } from '../model/functions';
import { HEADER_H, Layout, conditionalFormats, formulaRefs, paint, readTheme, rowHeaderWidth } from '../grid/render';
import { chartPainter, chartRanges } from '../grid/charts';
import { drawingFrame } from '../grid/drawings';
import { deleteDrawing, duplicateDrawing, frameOf, insertChart, moveDrawing } from './charts';
import { ChartBar } from './ChartTools';
import { PictureBar } from './PictureBar';
import { pxToColWidth } from '../grid/geometry';
import { current, extendTo, single, type Pos } from '../grid/selection';
import type { SheetController } from './controller';

export interface GridProps {
  ctl: SheetController;
  /** Page zoom (1 = 100 %), multiplied by the sheet's own zoom. */
  zoom: number;
  label: string;
  onContextMenu?: (at: { x: number; y: number }, kind: 'cell' | 'row' | 'col') => void;
  onFilterMenu?: (col: number, at: { x: number; y: number }) => void;
  /** Ctrl+F, Ctrl+H, Ctrl+1… handled by the editor around the grid. */
  onCommand?: (id: string) => void;
  /** The active cell has a validation list: show its arrow; open the choices at a screen point. */
  hasList?: boolean;
  onListOpen?: (at: { x: number; y: number }) => void;
  /** Object URLs of drawing images, by package path. */
  media?: ReadonlyMap<string, string>;
  /** The image URL of a retouch preview, drawn whole inside its frame (L3). */
  fitted?: string | null;
}

/** Scrollable height/width is capped (browsers cap element sizes); past it the scrollbar scales. */
const MAX_SCROLL_PX = 12_000_000;

type Drag =
  | { kind: 'select'; add: boolean }
  | { kind: 'rows' | 'cols' }
  | { kind: 'fill'; target: Range | null }
  | { kind: 'resize-col'; index: number; start: number; size: number }
  | { kind: 'resize-row'; index: number; start: number; size: number }
  | { kind: 'point'; anchor: Pos }
  /** Moving (`handle` = move) or resizing a drawing; frames in grid (layout) pixels. */
  | { kind: 'drawing'; index: number; handle: Handle; start: { x: number; y: number }; frame: Box; preview: Box | null };

type Box = { x: number; y: number; w: number; h: number };
type Handle = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: Array<[Handle, number, number]> = [['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0], ['e', 1, 0.5], ['se', 1, 1], ['s', 0.5, 1], ['sw', 0, 1], ['w', 0, 0.5]];
const HANDLE_CURSOR: Record<Handle, string> = { move: 'move', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

/** A frame dragged by one of its handles. */
function dragged(f: Box, h: Handle, dx: number, dy: number): Box {
  if (h === 'move') return { ...f, x: f.x + dx, y: f.y + dy };
  let { x, y, w, h: hh } = f;
  if (h.includes('w')) [x, w] = [x + dx, w - dx];
  if (h.includes('e')) w += dx;
  if (h.includes('n')) [y, hh] = [y + dy, hh - dy];
  if (h.includes('s')) hh += dy;
  if (w < 24) [x, w] = [h.includes('w') ? x - (24 - w) : x, 24];
  if (hh < 24) [y, hh] = [h.includes('n') ? y - (24 - hh) : y, 24];
  return { x, y, w, h: hh };
}

const NO_MEDIA: ReadonlyMap<string, string> = new Map();

export function Grid({ ctl, zoom: pageZoom, label, onContextMenu, onFilterMenu, onCommand, hasList, onListOpen, media = NO_MEDIA, fitted = null }: GridProps) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion, ctl.getVersion);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [suggest, setSuggest] = useState(0);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  const props = ctl.props;
  const zoom = pageZoom * (props.zoom / 100);
  const { rows, cols } = ctl.geometry();
  const edit = ctl.edit;

  // How far the sheet extends for scrolling: used area plus room, growing as you go.
  const used = useMemo(() => ctl.doc.usedRange(ctl.sheetId), [ctl, ctl.sheetId, ctl.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const extentRows = Math.min(MAX_ROWS, Math.max(1000, (used?.r1 ?? 0) + 200, ctl.sel.active.r + 100, current(ctl.sel).r1 < MAX_ROWS - 1 ? current(ctl.sel).r1 + 50 : 0));
  const extentCols = Math.min(MAX_COLS, Math.max(52, (used?.c1 ?? 0) + 26, ctl.sel.active.c + 20, current(ctl.sel).c1 < MAX_COLS - 1 ? current(ctl.sel).c1 + 10 : 0));
  const headerW = rowHeaderWidth(Math.max(extentRows, ctl.sel.active.r + 1000));
  const contentW = (headerW + cols.offset(extentCols)) * zoom;
  const contentH = (HEADER_H + rows.offset(extentRows)) * zoom;
  const kx = Math.min(1, MAX_SCROLL_PX / contentW);
  const ky = Math.min(1, MAX_SCROLL_PX / contentH);

  const layout = useMemo(
    () => new Layout(rows, cols, props.frozenRows, props.frozenCols, scroll.x / kx / zoom, scroll.y / ky / zoom, size.w / zoom, size.h / zoom, headerW),
    [rows, cols, props.frozenRows, props.frozenCols, scroll.x, scroll.y, kx, ky, zoom, size.w, size.h, headerW],
  );

  const drawings = useMemo(() => ctl.doc.drawings(ctl.sheetId), [ctl, ctl.sheetId, ctl.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const charts = useMemo(() => chartPainter(ctl), [ctl, ctl.sheetId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Decoded images for the canvas; each one repaints the grid when it is ready. Images whose URL
  // did not change are reused (a retouch preview swaps one URL at a time).
  const decoded = useRef(new Map<string, HTMLImageElement>());
  const images = useMemo(() => {
    const out = new Map<string, HTMLImageElement>();
    const keep = new Map<string, HTMLImageElement>();
    for (const [path, url] of media) {
      const ready = decoded.current.get(url);
      if (ready) {
        out.set(path, ready);
        keep.set(url, ready);
        continue;
      }
      const img = new Image();
      img.decoding = 'async';
      if (url === fitted) img.dataset.fit = 'contain';
      img.onload = () => {
        out.set(path, img);
        decoded.current.set(url, img);
        ctl.bump();
      };
      img.src = url;
    }
    decoded.current = keep;
    return out;
  }, [media, ctl]); // eslint-disable-line react-hooks/exhaustive-deps -- `fitted` is one of `media`'s URLs

  // ----- painting --------------------------------------------------------------

  const theme = useRef<ReturnType<typeof readTheme> | null>(null);
  const editSheetName = ctl.editSheet ? ctl.doc.props(ctl.editSheet).name : props.name;
  const selectedSpec = ctl.selectedDrawing != null ? drawings[ctl.selectedDrawing]?.chart : undefined;
  const refHighlights = useMemo(
    () =>
      edit?.text.startsWith('=') && (!ctl.editSheet || ctl.editSheet === ctl.sheetId || ctl.pointSheet === ctl.sheetId)
        ? formulaRefs(edit.text, editSheetName, (n) => ctl.doc.sheetIdByName(n), ctl.sheetId)
        : selectedSpec
          ? chartRanges(selectedSpec, props.name)
          : [],
    [edit?.text, ctl, editSheetName, selectedSpec, props.name],
  );
  const cf = useMemo(() => {
    const si = ctl.sheetIndex;
    return conditionalFormats(ctl.doc.condFormats(ctl.sheetId), ctl.doc.toWorkbook().dxfs ?? [], (r, c) => ctl.numberAt(r, c), (r, c) => ctl.calc.get(si, r, c)?.text ?? '');
  }, [ctl, ctl.sheetId, ctl.version]); // eslint-disable-line react-hooks/exhaustive-deps

  // Conditional formats scale over their whole range: fetch it.
  useEffect(() => {
    for (const f of ctl.doc.condFormats(ctl.sheetId)) for (const rg of f.sqref.split(/\s+/)) {
      const r = parseRange(rg);
      if (r) ctl.calc.prefetch(ctl.sheetIndex, r);
    }
  }, [ctl, ctl.sheetId]);

  const raf = useRef(0);
  useLayoutEffect(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(function frame() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(size.w * dpr) || canvas.height !== Math.round(size.h * dpr)) {
        canvas.width = Math.round(size.w * dpr);
        canvas.height = Math.round(size.h * dpr);
      }
      theme.current ??= readTheme(rootRef.current!);
      const ctx = canvas.getContext('2d')!;
      paint({ ctx, ctl, layout, theme: theme.current, dpr, zoom, drawings, images, charts, editing: edit && edit.where === 'cell' && ctl.editSheet === ctl.sheetId ? ctl.sel.active : null, cf, refHighlights, focused: true });
      // The selected drawing: outline and handles (or the frame being dragged).
      const dd = dragRef.current?.kind === 'drawing' ? dragRef.current : null;
      const selD = ctl.selectedDrawing != null ? drawings[ctl.selectedDrawing] : undefined;
      const box = dd?.preview ?? (selD ? drawingFrame(selD, layout) : null);
      if (box) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(layout.headerW, HEADER_H, layout.w - layout.headerW, layout.h - HEADER_H);
        ctx.clip();
        ctx.strokeStyle = theme.current.accent;
        ctx.lineWidth = 1.5;
        ctx.setLineDash(dd?.preview ? [5, 3] : []);
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        ctx.setLineDash([]);
        if (!dd?.preview) {
          for (const [, fx, fy] of HANDLES) {
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(box.x + fx * box.w, box.y + fy * box.h, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
        ctx.restore();
      }
      if (dragRef.current?.kind === 'fill' && dragRef.current.target) {
        const r = layout.rect(dragRef.current.target);
        ctx.strokeStyle = theme.current.accent;
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
        ctx.setLineDash([]);
      }
      // The copy marquee marches.
      if (ctl.copyMark) raf.current = requestAnimationFrame(frame);
    });
    // Ask the engine for what is now on screen.
    const [r0, r1] = layout.rowsShown;
    const [c0, c1] = layout.colsShown;
    ctl.calc.setViewport(ctl.sheetIndex, { r0: 0, c0: 0, r1: Math.max(r1, layout.fr), c1: Math.max(c1, layout.fc) });
    if (r0 > 200 || c0 > 60) ctl.calc.setViewport(ctl.sheetIndex, { r0, c0, r1, c1 });
    return () => cancelAnimationFrame(raf.current);
  });

  // Theme changes (dark mode): re-read tokens.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const reset = () => {
      theme.current = null;
      ctl.bump();
    };
    mq.addEventListener('change', reset);
    const mo = new MutationObserver(reset);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    return () => {
      mq.removeEventListener('change', reset);
      mo.disconnect();
    };
  }, [ctl]);

  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ----- keeping the active cell on screen ---------------------------------------

  const reveal = useCallback(
    (p: Pos) => {
      const el = scrollRef.current;
      if (!el) return;
      const L = layout;
      const viewW = L.w - L.headerW - L.frozenW;
      const viewH = L.h - L.headerH - L.frozenH;
      if (p.c >= L.fc) {
        const left = cols.offset(p.c) - L.frozenW;
        const right = left + cols.size(p.c);
        if (left < L.sx) el.scrollLeft = left * zoom * kx;
        else if (right > L.sx + viewW) el.scrollLeft = (right - viewW) * zoom * kx;
      }
      if (p.r >= L.fr) {
        const top = rows.offset(p.r) - L.frozenH;
        const bottom = top + rows.size(p.r);
        if (top < L.sy) el.scrollTop = top * zoom * ky;
        else if (bottom > L.sy + viewH) el.scrollTop = (bottom - viewH) * zoom * ky;
      }
    },
    [layout, cols, rows, zoom, kx, ky],
  );
  const activeKey = `${ctl.sheetId}:${ctl.sel.active.r}:${ctl.sel.active.c}:${edit?.point?.at.r ?? ''}:${edit?.point?.at.c ?? ''}`;
  useEffect(() => {
    reveal(edit?.point ? edit.point.at : ctl.sel.active);
  }, [activeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus follows editing: the cell editor while editing in the cell, the grid otherwise.
  useEffect(() => {
    if (edit?.where === 'cell') {
      const ta = editorRef.current;
      if (ta && document.activeElement !== ta) {
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(edit.cursor, edit.cursor);
      }
    } else if (!edit && rootRef.current && rootRef.current.contains(document.activeElement) && document.activeElement !== rootRef.current) {
      rootRef.current.focus({ preventScroll: true });
    }
  }, [edit?.where, !!edit]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const ta = editorRef.current;
    if (ta && edit && ta.selectionStart !== edit.cursor && document.activeElement === ta) ta.setSelectionRange(edit.cursor, edit.cursor);
  });

  // ----- pointer ---------------------------------------------------------------

  const local = (e: { clientX: number; clientY: number }) => {
    const r = rootRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };

  const borderNear = (p: { x: number; y: number }): { kind: 'col' | 'row'; index: number } | null => {
    if (p.y < HEADER_H && p.x > headerW) {
      const { c } = layout.hit(p.x, HEADER_H + 1);
      const right = layout.x(c + 1);
      if (Math.abs(p.x - right) <= 4) return { kind: 'col', index: c };
      const left = layout.x(c);
      if (c > 0 && Math.abs(p.x - left) <= 4) return { kind: 'col', index: c - 1 };
    }
    if (p.x < headerW && p.y > HEADER_H) {
      const { r } = layout.hit(headerW + 1, p.y);
      if (Math.abs(p.y - layout.y(r + 1)) <= 3) return { kind: 'row', index: r };
      if (r > 0 && Math.abs(p.y - layout.y(r)) <= 3) return { kind: 'row', index: r - 1 };
    }
    return null;
  };

  const nearFillHandle = (p: { x: number; y: number }) => {
    if (ctl.readOnlyFlag || edit) return false;
    const rr = layout.rect(current(ctl.sel));
    return Math.abs(p.x - (rr.x + rr.w)) <= 5 && Math.abs(p.y - (rr.y + rr.h)) <= 5;
  };

  const cellAt = (p: { x: number; y: number }): Pos => {
    const h = layout.hit(Math.max(p.x, headerW + 1), Math.max(p.y, HEADER_H + 1));
    return { r: Math.max(0, h.r), c: Math.max(0, h.c) };
  };

  /** The drawing (and handle) under a grid point, top-most first. */
  const drawingAt = (p: { x: number; y: number }): { index: number; handle: Handle; frame: Box } | null => {
    if (p.x < headerW || p.y < HEADER_H) return null;
    const sel = ctl.selectedDrawing;
    if (sel != null && drawings[sel]) {
      const f = drawingFrame(drawings[sel], layout);
      if (f) for (const [h, fx, fy] of HANDLES) if (Math.abs(p.x - (f.x + fx * f.w)) <= 6 && Math.abs(p.y - (f.y + fy * f.h)) <= 6) return { index: sel, handle: h, frame: f };
    }
    for (let i = drawings.length - 1; i >= 0; i--) {
      const f = drawingFrame(drawings[i]!, layout);
      if (f && p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h) return { index: i, handle: 'move', frame: f };
    }
    return null;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button === 2) return;
    if ((e.target as HTMLElement).closest('.oel-sheet-editor, .oel-sheet-suggest')) return;
    const p = local(e);
    // Scrollbars: leave them to the browser.
    const el = scrollRef.current!;
    if (e.clientX - el.getBoundingClientRect().left > el.clientWidth || e.clientY - el.getBoundingClientRect().top > el.clientHeight) return;
    e.preventDefault();
    rootRef.current?.focus({ preventScroll: true });
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const b = borderNear(p);
    if (b && !ctl.readOnlyFlag) {
      if (e.detail === 2) {
        autofit(b.kind, b.index);
        return;
      }
      setDrag(b.kind === 'col' ? { kind: 'resize-col', index: b.index, start: p.x, size: cols.size(b.index) } : { kind: 'resize-row', index: b.index, start: p.y, size: rows.size(b.index) });
      return;
    }
    if (p.x < headerW && p.y < HEADER_H) return ctl.selectAll();
    // Charts, pictures and shapes sit over the cells.
    const hitD = !(edit && ctl.canPoint()) ? drawingAt(p) : null;
    if (hitD) {
      if (edit) ctl.commitEdit(null);
      ctl.selectDrawing(hitD.index);
      if (!ctl.readOnlyFlag) setDrag({ kind: 'drawing', index: hitD.index, handle: hitD.handle, start: p, frame: hitD.frame, preview: null });
      return;
    }
    if (nearFillHandle(p)) return setDrag({ kind: 'fill', target: null });
    // Filter buttons.
    const f = ctl.doc.filter(ctl.sheetId);
    const fr = f ? parseRange(f.ref) : null;
    if (fr && p.y > HEADER_H && p.x > headerW) {
      const { r, c } = cellAt(p);
      if (r === fr.r0 && c >= fr.c0 && c <= fr.c1 && p.x >= layout.x(c + 1) - 18) {
        const box = rootRef.current!.getBoundingClientRect();
        onFilterMenu?.(c - fr.c0, { x: box.left + layout.x(c + 1) * zoom - 18 * zoom, y: box.top + layout.y(r + 1) * zoom });
        return;
      }
    }
    // Pointing at references while typing a formula.
    if (edit && ctl.canPoint() && p.x > headerW && p.y > HEADER_H) {
      const at = cellAt(p);
      ctl.pointSheet = ctl.sheetId;
      ctl.pointTo(at, e.shiftKey);
      setDrag({ kind: 'point', anchor: e.shiftKey && edit.point ? edit.point.anchor : at });
      return;
    }
    if (edit) ctl.commitEdit(null);
    if (p.y < HEADER_H) {
      const { c } = layout.hit(p.x, HEADER_H + 1);
      const anchor = e.shiftKey ? ctl.sel.anchor : { r: 0, c };
      const r: Range = { r0: 0, c0: Math.min(anchor.c, c), r1: MAX_ROWS - 1, c1: Math.max(anchor.c, c) };
      ctl.select({ ranges: e.ctrlKey || e.metaKey ? [...ctl.sel.ranges, r] : [r], active: { r: 0, c: e.shiftKey ? ctl.sel.active.c : c }, anchor: e.shiftKey ? anchor : { r: 0, c } });
      setDrag({ kind: 'cols' });
      return;
    }
    if (p.x < headerW) {
      const { r } = layout.hit(headerW + 1, p.y);
      const anchor = e.shiftKey ? ctl.sel.anchor : { r, c: 0 };
      const rg: Range = { r0: Math.min(anchor.r, r), c0: 0, r1: Math.max(anchor.r, r), c1: MAX_COLS - 1 };
      ctl.select({ ranges: e.ctrlKey || e.metaKey ? [...ctl.sel.ranges, rg] : [rg], active: { r: e.shiftKey ? ctl.sel.active.r : r, c: 0 }, anchor: e.shiftKey ? anchor : { r, c: 0 } });
      setDrag({ kind: 'rows' });
      return;
    }
    const at = cellAt(p);
    if (e.detail === 2) {
      ctl.select(single(at));
      ctl.editSheet = ctl.sheetId;
      ctl.startEdit();
      return;
    }
    if (e.shiftKey) ctl.select(extendTo(ctl.sel, at));
    else if (e.ctrlKey || e.metaKey) ctl.select({ ranges: [...ctl.sel.ranges, { r0: at.r, c0: at.c, r1: at.r, c1: at.c }], active: at, anchor: at });
    else {
      const m = ctl.mergeAt(at.r, at.c);
      ctl.select(m ? { ranges: [m], active: { r: m.r0, c: m.c0 }, anchor: { r: m.r0, c: m.c0 } } : single(at));
      // A hyperlink opens with Ctrl+click (a plain click selects, as in Excel).
    }
    setDrag({ kind: 'select', add: e.ctrlKey || e.metaKey });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = local(e);
    const d = dragRef.current;
    const root = rootRef.current!;
    if (!d) {
      const b = borderNear(p);
      const over = b ? null : drawingAt(p);
      root.style.cursor = b ? (b.kind === 'col' ? 'col-resize' : 'row-resize') : over ? (ctl.selectedDrawing === over.index || over.handle !== 'move' ? HANDLE_CURSOR[over.handle] : 'pointer') : nearFillHandle(p) ? 'crosshair' : p.x > headerW && p.y > HEADER_H ? 'cell' : 'default';
      if (over) return setTip(null);
      // Error explanations on hover.
      if (p.x > headerW && p.y > HEADER_H) {
        const at = cellAt(p);
        const out = ctl.calc.get(ctl.sheetIndex, at.r, at.c);
        const note = ctl.doc.notes(ctl.sheetId).find((n) => n.r === at.r && n.c === at.c);
        const text = out?.t === 'e' ? ERROR_HELP[String(out.v)] : note ? `${note.author ? `${note.author} : ` : ''}${note.text}` : null;
        setTip(text ? { x: layout.x(at.c + 1) * zoom + 4, y: layout.y(at.r) * zoom, text } : null);
      } else setTip(null);
      return;
    }
    if (d.kind === 'drawing') {
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      if (!d.preview && Math.abs(dx) + Math.abs(dy) < 3) return;
      setDrag({ ...d, preview: dragged(d.frame, d.handle, dx, dy) });
      return;
    }
    const at = cellAt(p);
    if (d.kind === 'select') ctl.select(extendTo(ctl.sel, at));
    else if (d.kind === 'cols') ctl.select(extendTo(ctl.sel, { r: MAX_ROWS - 1, c: at.c }));
    else if (d.kind === 'rows') ctl.select(extendTo(ctl.sel, { r: at.r, c: MAX_COLS - 1 }));
    else if (d.kind === 'point') ctl.pointTo(at, true);
    else if (d.kind === 'resize-col') {
      const w = Math.max(0, d.size + (p.x - d.start));
      root.style.cursor = 'col-resize';
      setDrag({ ...d });
      ctl.setColWidth(pxToColWidth(w), selectedOr('col', d.index));
    } else if (d.kind === 'resize-row') {
      const h = Math.max(0, d.size + (p.y - d.start));
      setDrag({ ...d });
      ctl.setRowHeight(Math.round(((h * 3) / 4) * 100) / 100, selectedOr('row', d.index));
    } else if (d.kind === 'fill') {
      const src = current(ctl.sel);
      // Extend along the axis the pointer moved most.
      const dr = at.r > src.r1 ? at.r - src.r1 : at.r < src.r0 ? at.r - src.r0 : 0;
      const dc = at.c > src.c1 ? at.c - src.c1 : at.c < src.c0 ? at.c - src.c0 : 0;
      let target: Range | null = null;
      if (Math.abs(dr) >= Math.abs(dc) && dr) target = dr > 0 ? { ...src, r1: at.r } : { ...src, r0: at.r };
      else if (dc) target = dc > 0 ? { ...src, c1: at.c } : { ...src, c0: at.c };
      setDrag({ kind: 'fill', target });
    }
  };

  /** Resizing a selected column/row resizes every selected one (Excel). */
  const selectedOr = (kind: 'col' | 'row', index: number): [number, number] => {
    const rg = current(ctl.sel);
    if (kind === 'col' && rg.r0 === 0 && rg.r1 >= MAX_ROWS - 1 && index >= rg.c0 && index <= rg.c1) return [rg.c0, Math.min(rg.c1, rg.c0 + 200)];
    if (kind === 'row' && rg.c0 === 0 && rg.c1 >= MAX_COLS - 1 && index >= rg.r0 && index <= rg.r1) return [rg.r0, Math.min(rg.r1, rg.r0 + 2000)];
    return [index, index];
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    if (d?.kind === 'drawing' && d.preview) {
      // Grid pixels → sheet pixels: the same offset as the frame had when the drag began.
      const drawing = drawings[d.index];
      if (drawing) {
        const s0 = frameOf(ctl, drawing);
        moveDrawing(ctl, d.index, { x: d.preview.x - d.frame.x + s0.x, y: d.preview.y - d.frame.y + s0.y, w: d.preview.w, h: d.preview.h });
        ctl.selectDrawing(d.index);
      }
    }
    if (d?.kind === 'fill' && d.target) ctl.fillTo(d.target);
    if (d?.kind === 'select' || d?.kind === 'rows' || d?.kind === 'cols') ctl.applyPainter();
    setDrag(null);
  };

  /** Double-click a header border: fit the content (Excel). */
  const autofit = (kind: 'col' | 'row', index: number) => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    if (kind === 'col') {
      let max = 0;
      for (const { r, c } of ctl.doc.cells(ctl.sheetId)) {
        if (c !== index) continue;
        const v = ctl.view(r, c);
        if (!v.text) continue;
        ctx.font = `${v.style.font.bold ? '700 ' : ''}${((v.style.font.size ?? 11) * 4) / 3}px Carlito, Calibri, sans-serif`;
        max = Math.max(max, ctx.measureText(v.text.split('\n')[0]!).width + 10);
      }
      ctl.setColWidth(max ? pxToColWidth(max) : ctl.props.defaultColWidth, selectedOr('col', index));
    } else {
      ctl.doc.setRowMeta(ctl.sheetId, index, index, { size: undefined });
    }
  };

  // ----- keyboard ------------------------------------------------------------------

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== rootRef.current) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const run = (fn: () => void) => {
      e.preventDefault();
      fn();
    };
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    // A selected chart or picture: Suppr deletes, Échap goes back to the cells, arrows nudge, Ctrl+D duplicates.
    const di = ctl.selectedDrawing;
    if (di != null && drawings[di]) {
      if (k === 'Delete' || k === 'Backspace') return run(() => deleteDrawing(ctl, di));
      if (k === 'Escape') {
        e.stopPropagation();
        return run(() => ctl.selectDrawing(null));
      }
      if (mod && k.toLowerCase() === 'd') return run(() => duplicateDrawing(ctl, di));
      if (arrows[k] && !ctl.readOnlyFlag) {
        const f = frameOf(ctl, drawings[di]);
        const step = e.shiftKey ? 10 : 1;
        return run(() => moveDrawing(ctl, di, { ...f, x: f.x + arrows[k]![1] * step, y: f.y + arrows[k]![0] * step }));
      }
      if (k === 'Tab') return run(() => ctl.selectDrawing((di + (e.shiftKey ? drawings.length - 1 : 1)) % drawings.length));
    }
    if (arrows[k]) return run(() => ctl.move(arrows[k]![0], arrows[k]![1], { extend: e.shiftKey, jump: mod }));
    if (k === 'F1' && e.altKey) return run(() => void (insertChart(ctl) || onCommand?.('chart-empty')));
    if (k === 'Enter') return run(() => ctl.advance(e.shiftKey ? 'up' : 'down'));
    if (k === 'Tab') return run(() => ctl.advance(e.shiftKey ? 'left' : 'right'));
    // Échap: the editor around the grid ends what is in progress (copy marquee,
    // format painter) or lets the level change; nothing to do here.
    if (k === 'Escape') return;
    const page = Math.max(1, Math.floor((layout.h - HEADER_H - layout.frozenH) / (props.defaultRowHeight * 1.33)) - 1);
    if (k === 'PageDown' || k === 'PageUp') {
      if (mod) return run(() => ctl.stepSheet(k === 'PageDown' ? 1 : -1));
      if (e.altKey) return run(() => ctl.move(0, (k === 'PageDown' ? 1 : -1) * 10, { extend: e.shiftKey }));
      return run(() => ctl.move((k === 'PageDown' ? 1 : -1) * page, 0, { extend: e.shiftKey }));
    }
    if (k === 'Home') {
      return run(() => {
        const to = mod ? { r: layout.fr, c: layout.fc } : { r: ctl.sel.active.r, c: 0 };
        if (e.shiftKey) ctl.select(extendTo(ctl.sel, to));
        else ctl.select(single(mod ? { r: 0, c: 0 } : to));
      });
    }
    if (k === 'End' && mod) {
      return run(() => {
        const u = ctl.doc.usedRange(ctl.sheetId);
        const to = u ? { r: u.r1, c: u.c1 } : { r: 0, c: 0 };
        if (e.shiftKey) ctl.select(extendTo(ctl.sel, to));
        else ctl.select(single(to));
      });
    }
    if (k === 'F2') return run(() => ((ctl.editSheet = ctl.sheetId), ctl.startEdit()));
    if (k === 'Delete' || k === 'Backspace') {
      if (k === 'Backspace' && !ctl.readOnlyFlag) return run(() => ((ctl.editSheet = ctl.sheetId), ctl.startEdit('')));
      return run(() => ctl.clearValues());
    }
    if (k === ' ' && mod && !e.shiftKey) return run(() => ctl.selectCols());
    if (k === ' ' && e.shiftKey && !mod) return run(() => ctl.selectRows());
    if (mod && !e.altKey) {
      const key = k.toLowerCase();
      const map: Record<string, () => void> = {
        a: () => {
          const rg = ctl.currentRegion();
          const isRegion = current(ctl.sel).r0 === rg.r0 && current(ctl.sel).r1 === rg.r1 && current(ctl.sel).c0 === rg.c0 && current(ctl.sel).c1 === rg.c1;
          if (ctl.filled(ctl.sel.active.r, ctl.sel.active.c) && !isRegion) ctl.select({ ranges: [rg], active: ctl.sel.active, anchor: { r: rg.r0, c: rg.c0 } });
          else ctl.selectAll();
        },
        b: () => ctl.toggleFont('bold'),
        i: () => ctl.toggleFont('italic'),
        u: () => ctl.toggleUnderline(),
        '5': () => ctl.toggleFont('strike'),
        z: () => (e.shiftKey ? ctl.undo.redo() : ctl.undo.undo()),
        y: () => ctl.undo.redo(),
        d: () => ctl.fillDown(false),
        r: () => ctl.fillDown(true),
        ';': () => ctl.insertNow(e.shiftKey ? 'time' : 'date'),
        ':': () => ctl.insertNow('time'),
        '`': () => ((ctl.showFormulas = !ctl.showFormulas), ctl.bump()),
        f: () => onCommand?.('find'),
        h: () => onCommand?.('replace'),
        k: () => onCommand?.('link'),
        '1': () => onCommand?.('format-cells'),
        p: () => onCommand?.('print'),
        s: () => onCommand?.('save'),
        '-': () => onCommand?.('delete-cells'),
        '+': () => onCommand?.('insert-cells'),
        '=': () => e.shiftKey && onCommand?.('insert-cells'),
      };
      if (e.shiftKey && key === 'l') return run(() => ctl.toggleFilter());
      if (e.shiftKey && key === 'f') return; // focus mode belongs to the shell
      if (map[key]) return run(map[key]!);
      return;
    }
    if (e.altKey && (k === '=' || k === '+')) return run(() => ((ctl.editSheet = ctl.sheetId), ctl.autoSum()));
    if (e.altKey && k === 'ArrowDown') return run(() => openList());
    if (k.length === 1 && !mod && !e.altKey && !ctl.readOnlyFlag) {
      e.preventDefault();
      ctl.editSheet = ctl.sheetId;
      ctl.startEdit(k);
    }
  };

  const activeRect = layout.rect(ctl.mergeAt(ctl.sel.active.r, ctl.sel.active.c) ?? { r0: ctl.sel.active.r, c0: ctl.sel.active.c, r1: ctl.sel.active.r, c1: ctl.sel.active.c });
  const openList = () => {
    if (!hasList || ctl.readOnlyFlag) return;
    const box = rootRef.current!.getBoundingClientRect();
    onListOpen?.({ x: box.left + activeRect.x * zoom, y: box.top + (activeRect.y + activeRect.h) * zoom });
  };

  // ----- clipboard -------------------------------------------------------------------

  useEffect(() => {
    const root = rootRef.current!;
    const onCopy = (e: ClipboardEvent) => {
      if (e.target !== root) return;
      const { text, html } = ctl.copy(e.type === 'cut');
      e.clipboardData?.setData('text/plain', text);
      e.clipboardData?.setData('text/html', html);
      e.preventDefault();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (e.target !== root) return;
      e.preventDefault();
      ctl.paste({ text: e.clipboardData?.getData('text/plain') ?? '', html: e.clipboardData?.getData('text/html') ?? '' });
    };
    root.addEventListener('copy', onCopy);
    root.addEventListener('cut', onCopy);
    root.addEventListener('paste', onPaste);
    return () => {
      root.removeEventListener('copy', onCopy);
      root.removeEventListener('cut', onCopy);
      root.removeEventListener('paste', onPaste);
    };
  }, [ctl]);

  // ----- in-cell editor ----------------------------------------------------------------

  const editing = edit && edit.where === 'cell' && (!ctl.editSheet || ctl.editSheet === ctl.sheetId);
  const ctx = edit ? formulaContext(edit.text, edit.cursor) : { typing: null, call: null };
  const suggestions = edit && ctx.typing ? matchFunctions(ctx.typing) : [];
  const callInfo = ctx.call ? functionInfo(ctx.call.name) : undefined;
  useEffect(() => setSuggest(0), [ctx.typing]);

  const acceptSuggestion = (name: string) => {
    if (!edit || !ctx.typing) return;
    const start = edit.cursor - ctx.typing.length;
    const text = `${edit.text.slice(0, start)}${name}(${edit.text.slice(edit.cursor)}`;
    ctl.setEditText(text, start + name.length + 1);
  };

  const onEditorKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const ed = ctl.edit;
    if (!ed) return;
    const mod = e.ctrlKey || e.metaKey;
    if (suggestions.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !ctl.canPoint()) {
      e.preventDefault();
      setSuggest((s) => (s + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
      return;
    }
    if (suggestions.length && e.key === 'Tab') {
      e.preventDefault();
      acceptSuggestion(suggestions[suggest]!.name);
      return;
    }
    if (e.key === 'Enter') {
      if (e.altKey) {
        e.preventDefault();
        const t = ed.text.slice(0, ed.cursor) + '\n' + ed.text.slice(ed.cursor);
        ctl.setEditText(t, ed.cursor + 1);
        return;
      }
      e.preventDefault();
      // Ctrl+Maj+Entrée is an array formula here, not the shell's full screen.
      e.stopPropagation();
      if (mod && e.shiftKey) ctl.commitEdit(null, { array: true });
      else if (mod) ctl.commitEdit(null, { all: true });
      else ctl.commitEdit(e.shiftKey ? 'up' : 'down');
      rootRef.current?.focus({ preventScroll: true });
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      ctl.commitEdit(e.shiftKey ? 'left' : 'right');
      rootRef.current?.focus({ preventScroll: true });
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      ctl.cancelEdit();
      if (ctl.editSheet && ctl.editSheet !== ctl.sheetId) ctl.setSheet(ctl.editSheet);
      rootRef.current?.focus({ preventScroll: true });
      return;
    }
    if (e.key === 'F2') {
      e.preventDefault();
      ctl.edit = { ...ed, mode: ed.mode === 'edit' ? 'enter' : 'edit', point: null };
      ctl.bump();
      return;
    }
    if (e.key === 'F4') {
      e.preventDefault();
      ctl.cycleRef();
      return;
    }
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[e.key]) {
      const [dr, dc] = arrows[e.key]!;
      if (ctl.canPoint()) {
        e.preventDefault();
        const from = ed.point ? ed.point.at : ctl.sel.active;
        const to = { r: Math.max(0, Math.min(MAX_ROWS - 1, from.r + dr)), c: Math.max(0, Math.min(MAX_COLS - 1, from.c + dc)) };
        ctl.pointSheet ??= ctl.sheetId;
        ctl.pointTo(to, e.shiftKey);
        return;
      }
      if (ed.mode === 'enter' && !e.shiftKey) {
        // « Entrer » mode: arrows validate and move, as in Excel.
        e.preventDefault();
        ctl.commitEdit(null);
        ctl.move(dr, dc);
        rootRef.current?.focus({ preventScroll: true });
      }
    }
  };

  const editorBox = useMemo(() => {
    if (!editing) return null;
    const m = ctl.mergeAt(ctl.sel.active.r, ctl.sel.active.c);
    const rect = layout.rect(m ?? { r0: ctl.sel.active.r, c0: ctl.sel.active.c, r1: ctl.sel.active.r, c1: ctl.sel.active.c });
    return rect;
  }, [editing, layout, ctl, ctl.sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeStyle = ctl.activeStyle;
  const activeView = ctl.view(ctl.sel.active.r, ctl.sel.active.c);
  const activeFormula = ctl.doc.inputText(ctl.sheetId, ctl.sel.active.r, ctl.sel.active.c);
  const announce = `${a1(ctl.sel.active.r, ctl.sel.active.c)}${activeView.text ? `, ${activeView.text}` : ', vide'}${activeFormula.startsWith('=') ? `, formule ${activeFormula}` : ''}${current(ctl.sel).r0 !== current(ctl.sel).r1 || current(ctl.sel).c0 !== current(ctl.sel).c1 ? `, sélection ${rangeA1(current(ctl.sel))}` : ''}`;

  return (
    <div
      ref={rootRef}
      className="oel-grid"
      role="grid"
      aria-label={label}
      aria-rowcount={MAX_ROWS}
      aria-colcount={MAX_COLS}
      aria-multiselectable
      aria-readonly={ctl.readOnlyFlag || undefined}
      aria-activedescendant="oel-grid-active"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setTip(null)}
      onContextMenu={(e) => {
        e.preventDefault();
        const p = local(e);
        if (p.x > headerW && p.y > HEADER_H) {
          const at = cellAt(p);
          if (!ctl.sel.ranges.some((rg) => at.r >= rg.r0 && at.r <= rg.r1 && at.c >= rg.c0 && at.c <= rg.c1)) ctl.select(single(at));
        }
        onContextMenu?.({ x: e.clientX, y: e.clientY }, p.y < HEADER_H ? 'col' : p.x < headerW ? 'row' : 'cell');
      }}
    >
      <div ref={scrollRef} className="oel-grid__scroll" onScroll={(e) => setScroll({ x: e.currentTarget.scrollLeft, y: e.currentTarget.scrollTop })}>
        <div style={{ width: contentW * kx, height: contentH * ky }} aria-hidden />
      </div>
      <canvas ref={canvasRef} className="oel-grid__canvas" style={{ width: size.w, height: size.h }} aria-hidden />
      {/* The one cell assistive technology sees: the active one. */}
      <div role="row" aria-rowindex={ctl.sel.active.r + 1} className="emb-visually-hidden">
        <div id="oel-grid-active" role="gridcell" aria-colindex={ctl.sel.active.c + 1} aria-selected aria-label={announce}>
          {activeView.text}
        </div>
      </div>
      <div className="emb-visually-hidden" role="status" aria-live="polite">
        {announce}
      </div>
      {editing && editorBox && edit && (
        <>
          <textarea
            ref={editorRef}
            className="oel-sheet-editor"
            aria-label={`Modifier ${a1(ctl.sel.active.r, ctl.sel.active.c)}`}
            spellCheck={!edit.text.startsWith('=')}
            value={edit.text}
            style={{
              left: editorBox.x * zoom,
              top: editorBox.y * zoom,
              minWidth: editorBox.w * zoom,
              minHeight: editorBox.h * zoom,
              font: `${activeStyle.font.italic ? 'italic ' : ''}${activeStyle.font.bold ? '700 ' : ''}${(((activeStyle.font.size ?? 11) * 4) / 3) * zoom}px "${activeStyle.font.name ?? 'Calibri'}", Carlito, Calibri, sans-serif`,
              textAlign: edit.text.startsWith('=') ? 'left' : ((activeStyle.align.h as 'left' | 'right' | 'center' | undefined) ?? 'left'),
            }}
            onChange={(e) => ctl.setEditText(e.target.value, e.target.selectionStart)}
            onSelect={(e) => {
              const t = e.currentTarget;
              if (ctl.edit && t.selectionStart !== ctl.edit.cursor) {
                ctl.edit = { ...ctl.edit, cursor: t.selectionStart, point: null };
                ctl.bump();
              }
            }}
            onKeyDown={onEditorKey}
            rows={Math.max(1, edit.text.split('\n').length)}
          />
          {(suggestions.length > 0 || callInfo) && (
            <div className="oel-sheet-suggest" style={{ left: editorBox.x * zoom, top: (editorBox.y + editorBox.h) * zoom + 2 }} role="listbox" aria-label="Fonctions">
              {suggestions.map((f, i) => (
                <button
                  key={f.name}
                  type="button"
                  role="option"
                  aria-selected={i === suggest}
                  className={`oel-sheet-suggest__item${i === suggest ? ' is-on' : ''}`}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    acceptSuggestion(f.name);
                  }}
                >
                  <strong>{f.name}</strong>
                  <span>{f.desc}</span>
                </button>
              ))}
              {!suggestions.length && callInfo && (
                <div className="oel-sheet-suggest__sig">
                  <code>
                    {callInfo.name}(
                    {callInfo.args.split(', ').map((a, i, all) => (
                      <span key={i} className={i === Math.min(ctx.call!.arg, all.length - 1) ? 'is-arg' : undefined}>
                        {a}
                        {i < all.length - 1 ? ', ' : ''}
                      </span>
                    ))}
                    )
                  </code>
                  <span>{callInfo.desc}</span>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {hasList && !edit && !ctl.readOnlyFlag && (
        <button
          type="button"
          className="oel-grid__listarrow"
          aria-label="Choisir dans la liste (Alt+↓)"
          style={{ left: (activeRect.x + activeRect.w) * zoom + 2, top: activeRect.y * zoom, height: activeRect.h * zoom }}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            openList();
          }}
        >
          ▾
        </button>
      )}
      {(() => {
        const di = ctl.selectedDrawing;
        const d = di != null ? drawings[di] : undefined;
        if (!d || drag?.kind === 'drawing') return null;
        if (d.kind === 'picture' && d.media && !ctl.pictures?.open) {
          const f = drawingFrame(d, layout);
          if (!f) return null;
          const top = Math.max(HEADER_H * zoom + 4, f.y * zoom - 50);
          return <PictureBar ctl={ctl} index={di!} drawing={d} style={{ top, left: Math.max(8, Math.min(f.x * zoom, size.w - 360)) }} />;
        }
        if (!d.chart) return null;
        const f = drawingFrame(d, layout);
        if (!f) return null;
        const top = Math.max(HEADER_H * zoom + 4, f.y * zoom - 50);
        const right = Math.max(8, size.w - (f.x + f.w) * zoom);
        return <ChartBar ctl={ctl} index={di!} spec={d.chart} style={{ top, right: Math.min(right, size.w - 560) }} />;
      })()}
      {tip && (
        <div className="oel-grid__tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      )}
      {drag?.kind === 'resize-col' && (
        <div className="oel-grid__tip" style={{ left: layout.x(drag.index + 1) * zoom + 6, top: 2 }}>
          Largeur : {pxToColWidth(cols.size(drag.index)).toFixed(2)} ({Math.round(cols.size(drag.index))} px) · {colName(drag.index)}
        </div>
      )}
    </div>
  );
}

