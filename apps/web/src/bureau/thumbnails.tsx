/**
 * Desk thumbnails: each document, workbook or deck lies on the desk as a
 * picture of its first page, sheet or slide, drawn by its own editor's
 * renderer (fonts, pictures, layout) and then frozen as an image. Papers keep
 * one cheap <img> however many there are; a thumbnail is redrawn when the
 * file is imported and each time its editor closes.
 *
 * Drawing happens off screen, one file at a time, when the browser is idle.
 */
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { toSvg } from 'html-to-image';
import { DocFirstPage } from '@oel/docs';
import '@oel/docs/styles.css';
import { ScaledSlide } from '@oel/slides';
import '@oel/slides/styles.css';
import { renderSheetThumbnail } from '@oel/sheets';
import { fontFaceCss, loadFonts, type FontSpec } from '@oel/fonts';
import { sessionFor } from './docs';
import { createCalcWorker, sheetSessionFor } from './sheets';
import { slideSessionFor } from './slides';
import type { Bureau, Paper } from './model';

/** Device pixels per CSS pixel of the paper: sharp up to about 150 % zoom on a 2× screen. */
const SCALE = 3;
/** Papers drawn as pictures. */
const KINDS = new Set(['document', 'slides', 'spreadsheet']);
/** Longest a single thumbnail may take before it is given up (the paper keeps its sketch). */
const TIMEOUT_MS = 20_000;

let queue: Promise<void> = Promise.resolve();
const pending = new Set<string>();

const idle = () => new Promise<void>((r) => ('requestIdleCallback' in window ? requestIdleCallback(() => r(), { timeout: 2000 }) : setTimeout(r, 200)));

/** Draw (again) the thumbnail of a paper backed by a file, after the ones already waiting. */
export function queueThumbnail(store: Bureau, paperId: string) {
  const paper = store.node(paperId) as Paper | undefined;
  if (!paper || !KINDS.has(paper.kind) || !paper.data.docId || pending.has(paperId)) return;
  pending.add(paperId);
  queue = queue.then(async () => {
    pending.delete(paperId);
    await idle();
    const cur = store.node(paperId) as Paper | undefined;
    if (!cur?.data.docId) return;
    const progress: Progress = { stage: 'session' };
    try {
      const url = await withTimeout(draw(cur, progress));
      const now = store.node(paperId) as Paper | undefined;
      if (url && now) store.update(paperId, { data: { ...now.data, thumbnail: url } }, { history: false });
      else console.warn('Vignette non créée', cur.title, `(étape : ${progress.stage}, rien à dessiner)`);
    } catch (e) {
      console.warn('Vignette non créée', cur.title, `(étape : ${progress.stage})`, e);
    }
  });
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('délai dépassé')), TIMEOUT_MS))]);
}

/** Where drawing is (for the console when it fails): session, mise en page, capture, image. */
type Progress = { stage: string };

async function draw(paper: Paper, progress: Progress): Promise<string | null> {
  const noop = () => {};
  switch (paper.kind) {
    case 'slides': {
      const s = await slideSessionFor(paper, noop);
      const info = s.slides.info();
      const first = s.slides.slideIds()[0];
      const slide = first ? s.slides.slide(first) : null;
      if (!slide) return null;
      await loadFonts(info.fonts, s.media.url);
      progress.stage = 'mise en page';
      return offscreen(
        (done) => (
          <SnapshotWhenMounted onMounted={done}>
            <ScaledSlide slide={slide} info={info} ctx={{ theme: info.theme, fonts: info.fonts, media: s.media.url, editing: false, slideNumber: 1 }} width={paper.w} />
          </SnapshotWhenMounted>
        ),
        info.fonts,
        s.media.url,
        progress,
      );
    }
    case 'document': {
      const s = await sessionFor(paper, noop);
      progress.stage = 'mise en page';
      return new Promise<string | null>((resolve, reject) => {
        const { host, root } = mount();
        root.render(
          <DocFirstPage
            session={s}
            onError={(e) => {
              unmount(host, root);
              reject(e);
            }}
            onReady={(el, size, fonts) => {
              // The page is drawn at its size in points; scale the picture to the paper.
              const k = (paper.w * SCALE) / size.width;
              snapshot(el, size, k, fonts, s.mediaUrl, progress)
                .then(resolve, reject)
                .finally(() => unmount(host, root));
            }}
          />,
        );
      });
    }
    case 'spreadsheet': {
      const s = await sheetSessionFor(paper, noop);
      progress.stage = 'mise en page';
      // A bit more of the sheet than the paper (cells at about two thirds of their size).
      const canvas = await renderSheetThumbnail(s, createCalcWorker, { width: paper.w * 1.5, height: paper.h * 1.5, scale: SCALE / 1.5 });
      return blobUrl(await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.9)));
    }
    default:
      return null;
  }
}

function mount() {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.inert = true;
  // Laid out (measured, fonts applied) but off screen.
  Object.assign(host.style, { position: 'fixed', left: '-100000px', top: '0', pointerEvents: 'none' });
  document.body.appendChild(host);
  return { host, root: createRoot(host) };
}

function unmount(host: HTMLElement, root: ReturnType<typeof createRoot>) {
  // Unmount outside React's render phase (onReady may fire from an effect).
  setTimeout(() => {
    root.unmount();
    host.remove();
  });
}

/** Render `make` off screen, snapshot its first element once mounted and its pictures decoded. */
function offscreen(make: (done: () => void) => React.ReactNode, fonts: FontSpec[], mediaUrl: (path: string) => string | null, progress: Progress): Promise<string | null> {
  const { host, root } = mount();
  return new Promise<void>((resolve) => flushSync(() => root.render(make(resolve))))
    .then(async () => {
      const el = host.firstElementChild as HTMLElement | null;
      if (!el) return null;
      await Promise.all([...el.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)));
      const { width, height } = el.getBoundingClientRect();
      return snapshot(el, { width, height }, SCALE, fonts, mediaUrl, progress);
    })
    .finally(() => unmount(host, root));
}

function SnapshotWhenMounted({ onMounted, children }: { onMounted: () => void; children: React.ReactNode }) {
  // Called once the subtree is committed (ref callbacks run after layout).
  return <div ref={(el) => void (el && requestAnimationFrame(() => onMounted()))}>{children}</div>;
}

async function snapshot(el: HTMLElement, size: { width: number; height: number }, pixelRatio: number, fonts: FontSpec[], mediaUrl: (path: string) => string | null, progress: Progress): Promise<string | null> {
  progress.stage = 'capture';
  const fontEmbedCSS = await fontFaceCss(fonts, mediaUrl);
  // Only what shows: a document's editor holds every page, and copying the styles of all of them takes far too long.
  const box = el.getBoundingClientRect();
  const bottom = box.top + size.height;
  const right = box.left + size.width;
  const filter = (node: HTMLElement) => {
    if (node === el || !(node instanceof Element)) return true;
    // An <img> without a source would be fetched as the page itself (HTML), and fail.
    if (node instanceof HTMLImageElement && !node.getAttribute('src')) return false;
    const r = node.getBoundingClientRect();
    return !(r.top > bottom || r.left > right);
  };
  // A picture that cannot be drawn is left out rather than losing the whole thumbnail.
  const onImageErrorHandler = (e: Event | string) => {
    const src = typeof e === 'string' ? e : ((e.target as HTMLImageElement | null)?.src ?? '');
    console.warn('Image absente de la vignette', src.slice(0, 120));
  };
  const svgUrl = await toSvg(el, { width: Math.ceil(size.width), height: Math.ceil(size.height), fontEmbedCSS, filter, onImageErrorHandler, cacheBust: false });
  progress.stage = 'image';
  return blobUrl(await rasterize(svgUrl, size, pixelRatio));
}

/**
 * Draw the SVG picture of a page on a canvas, as WebP. Characters XML forbids
 * (control characters pasted into a file's text) would make the whole
 * picture fail to load: they become spaces first.
 */
async function rasterize(svgUrl: string, size: { width: number; height: number }, pixelRatio: number): Promise<Blob | null> {
  const comma = svgUrl.indexOf(',');
  const svg = decodeURIComponent(svgUrl.slice(comma + 1)).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, ' ');
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(size.width * pixelRatio);
  canvas.height = Math.ceil(size.height * pixelRatio);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((r) => canvas.toBlob(r, 'image/webp', 0.9));
}

const blobUrl = (b: Blob | null) => (b ? URL.createObjectURL(b) : null);
