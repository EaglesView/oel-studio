/**
 * The image engine of one atelier: a fresh canvas (a canvas can be transferred to a worker
 * only once, and React may mount twice), the source, and draws fitted to the stage.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { ImageEngine, type Histogram } from '../engine';
import type { Recipe } from '../recipe';

export interface EngineState {
  engine: ImageEngine | null;
  /** Original size, once decoded. */
  source: { width: number; height: number } | null;
  error: string | null;
}

export function useImageEngine(host: RefObject<HTMLDivElement | null>, createWorker: () => Worker, original: Blob | null): EngineState & { canvas: RefObject<HTMLCanvasElement | null> } {
  const [engine, setEngine] = useState<ImageEngine | null>(null);
  const [source, setSource] = useState<{ width: number; height: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const ready = original !== null;

  // One engine per atelier (a worker and its GPU context), created once a picture is known.
  useEffect(() => {
    const el = host.current;
    if (!el || !ready) return;
    let alive = true;
    let made: ImageEngine | null = null;
    const c = document.createElement('canvas');
    c.className = 'atelier__canvas';
    el.append(c);
    canvas.current = c;
    ImageEngine.create({ createWorker, canvas: c })
      .then((e) => {
        made = e;
        if (alive) setEngine(e);
        else e.dispose();
      })
      .catch((err: Error) => alive && setError(err.message));
    return () => {
      alive = false;
      made?.dispose();
      c.remove();
      canvas.current = null;
      setEngine(null);
      setSource(null);
    };
  }, [host, createWorker, ready]);

  // Switching pictures (a gallery's filmstrip) keeps the engine and changes its source.
  useEffect(() => {
    if (!engine || !original) return;
    let alive = true;
    engine
      .setSource(original)
      .then((s) => alive && setSource(s))
      .catch((err: Error) => alive && setError(err.message));
    return () => void (alive = false);
  }, [engine, original]);

  return { engine, source, error, canvas };
}

/** CSS box of the canvas: the output's shape, as large as the stage allows. */
export function fitBox(out: { width: number; height: number }, box: { width: number; height: number }, pad = 48) {
  const k = Math.min((box.width - pad * 2) / out.width, (box.height - pad * 2) / out.height);
  return { width: Math.max(1, Math.floor(out.width * k)), height: Math.max(1, Math.floor(out.height * k)) };
}

/** Content size of an element, kept up to date. */
export function useBox(el: RefObject<HTMLElement | null>) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const ro = new ResizeObserver(([e]) => e && setBox({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(node);
    return () => ro.disconnect();
  }, [el]);
  return box;
}

/**
 * Draws `recipe` at `css` (device pixels) whenever it or `interactive` changes (one frame at a
 * time; the worker drops draws a newer one replaced), then refreshes the histogram once idle.
 */
export function useDraw(
  st: EngineState,
  css: { width: number; height: number } | null,
  recipe: Recipe,
  interactive: boolean,
  onHistogram: (h: Histogram) => void,
  onSettled?: () => void,
) {
  const json = JSON.stringify(recipe);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hist = useRef(onHistogram);
  hist.current = onHistogram;
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const { engine, source } = st;
  const w = css?.width ?? 0;
  const h = css?.height ?? 0;

  useEffect(() => {
    if (!engine || !source || !w || !h) return;
    engine.setRecipe(JSON.parse(json) as Recipe);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const frame = requestAnimationFrame(() => {
      void engine.draw(w * dpr, h * dpr, { interactive }).then((drawn) => {
        if (!drawn || interactive) return;
        if (settle.current) clearTimeout(settle.current);
        settle.current = setTimeout(() => {
          void engine.histogram().then((b) => hist.current(b)).catch(() => {});
          settled.current?.();
        }, 120);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [engine, source, w, h, json, interactive]);

  useEffect(() => () => void (settle.current && clearTimeout(settle.current)), []);
}
