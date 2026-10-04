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
import { toBlob } from 'html-to-image';
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
    try {
      const url = await withTimeout(draw(cur));
      const now = store.node(paperId) as Paper | undefined;
      if (url && now) store.update(paperId, { data: { ...now.data, thumbnail: url } }, { history: false });
    } catch (e) {
      console.warn('Vignette non créée', cur.title, e);
    }
  });
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('délai dépassé')), TIMEOUT_MS))]);
}

async function draw(paper: Paper): Promise<string | null> {
  const noop = () => {};
  switch (paper.kind) {
    case 'slides': {
      const s = await slideSessionFor(paper, noop);
      const info = s.slides.info();
      const first = s.slides.slideIds()[0];
      const slide = first ? s.slides.slide(first) : null;
      if (!slide) return null;
      await loadFonts(info.fonts, s.media.url);
      return offscreen(
        (done) => (
          <SnapshotWhenMounted onMounted={done}>
            <ScaledSlide slide={slide} info={info} ctx={{ theme: info.theme, fonts: info.fonts, media: s.media.url, editing: false, slideNumber: 1 }} width={paper.w} />
          </SnapshotWhenMounted>
        ),
        info.fonts,
        s.media.url,
      );
    }
    case 'document': {
      const s = await sessionFor(paper, noop);
      return new Promise<string | null>((resolve, reject) => {
        const { host, root } = mount();
        root.render(
          <DocFirstPage
            session={s}
            onReady={(el, size, fonts) => {
              // The page is drawn at its size in points; scale the picture to the paper.
              const k = (paper.w * SCALE) / size.width;
              snapshot(el, size, k, fonts, s.mediaUrl)
                .then(resolve, reject)
                .finally(() => unmount(host, root));
            }}
          />,
        );
      });
    }
    case 'spreadsheet': {
      const s = await sheetSessionFor(paper, noop);
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
function offscreen(make: (done: () => void) => React.ReactNode, fonts: FontSpec[], mediaUrl: (path: string) => string | null): Promise<string | null> {
  const { host, root } = mount();
  return new Promise<void>((resolve) => flushSync(() => root.render(make(resolve))))
    .then(async () => {
      const el = host.firstElementChild as HTMLElement | null;
      if (!el) return null;
      await Promise.all([...el.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)));
      const { width, height } = el.getBoundingClientRect();
      return snapshot(el, { width, height }, SCALE, fonts, mediaUrl);
    })
    .finally(() => unmount(host, root));
}

function SnapshotWhenMounted({ onMounted, children }: { onMounted: () => void; children: React.ReactNode }) {
  // Called once the subtree is committed (ref callbacks run after layout).
  return <div ref={(el) => void (el && requestAnimationFrame(() => onMounted()))}>{children}</div>;
}

async function snapshot(el: HTMLElement, size: { width: number; height: number }, pixelRatio: number, fonts: FontSpec[], mediaUrl: (path: string) => string | null): Promise<string | null> {
  const fontEmbedCSS = await fontFaceCss(fonts, mediaUrl);
  // Only what shows: a document's editor holds every page, and copying the styles of all of them takes far too long.
  const box = el.getBoundingClientRect();
  const bottom = box.top + size.height;
  const right = box.left + size.width;
  const filter = (node: HTMLElement) => {
    if (node === el || !(node instanceof Element)) return true;
    const r = node.getBoundingClientRect();
    return !(r.top > bottom || r.left > right);
  };
  const blob = await toBlob(el, { width: Math.ceil(size.width), height: Math.ceil(size.height), pixelRatio, fontEmbedCSS, filter, type: 'image/webp', quality: 0.9, cacheBust: false });
  return blobUrl(blob);
}

const blobUrl = (b: Blob | null) => (b ? URL.createObjectURL(b) : null);
