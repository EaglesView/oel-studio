/** Bureau ↔ @oel/slides: one collaborative presentation session per slides paper. */
import { SlideSession, slideFromLayout, type Deck, type Element, type ExportRequest } from '@oel/slides';
import { asDeckPayload, type Preview } from '@oel/engine';
import { collabApi, identity } from './docs';
import { engineHost } from './importFiles';
import type { Paper } from './model';

const sessions = new Map<string, Promise<SlideSession>>();

/** Create the shared presentation for an imported .pptx; returns its id. */
export async function createSlidesFromPayload(payload: unknown, title: string): Promise<string> {
  const p = asDeckPayload(payload);
  const s = await SlideSession.create({ api: collabApi, identity: identity(), seed: { deck: JSON.parse(p.json) as Deck, original: p.original, media: p.media, title } });
  sessions.set(s.status.docId, Promise.resolve(s));
  return s.status.docId;
}

const withText = (el: Element, text: string | undefined): Element =>
  !text || !el.text ? el : { ...el, text: { ...el.text, paras: text.split('\n').map((t) => ({ lvl: 0, props: {}, runs: [{ kind: 'text', text: t, props: {} }], end: {} })) } };

/** A new deck (the codec's template) holding the titles of a desk preview, one slide each. */
async function deckFromPreview(preview: Paper['data']['preview']): Promise<{ deck: Deck; media: Array<{ path: string; mime: string; bytes: Uint8Array }> }> {
  const r = await engineHost().create('slides', 'Présentation sans titre');
  const p = asDeckPayload(r.payload);
  const deck = JSON.parse(p.json) as Deck;
  const slides = preview.kind === 'slides' ? (preview as Extract<Preview, { kind: 'slides' }>).slides : [];
  const [titleLayout, contentLayout] = deck.layouts;
  if (slides.length && titleLayout) {
    deck.slides = slides.map((s, i) => {
      const layout = i === 0 || !contentLayout ? titleLayout : contentLayout;
      const slide = slideFromLayout(layout);
      slide.elements = slide.elements.map((e) => (e.ph && /title/i.test(e.ph.type) ? withText(e, s.title) : withText(e, s.body)));
      return slide;
    });
  }
  return { deck, media: p.media };
}

/** Session for a paper; papers without a presentation get one (from their preview, if any). */
export function slideSessionFor(paper: Paper, onCreated: (docId: string) => void): Promise<SlideSession> {
  const known = paper.data.docId && sessions.get(paper.data.docId);
  if (known) return known;
  const p = (async () => {
    if (paper.data.docId) return SlideSession.open({ docId: paper.data.docId, api: collabApi, identity: identity() });
    const { deck, media } = await deckFromPreview(paper.data.preview);
    const s = await SlideSession.create({ api: collabApi, identity: identity(), seed: { deck, media, title: paper.title } });
    onCreated(s.status.docId);
    return s;
  })();
  p.then((s) => sessions.set(s.status.docId, p));
  return p;
}

export async function exportSlides(req: ExportRequest): Promise<Uint8Array> {
  return engineHost().export({ kind: 'slides', format: req.format, data: { json: req.json, original: req.original, media: req.media } });
}

/** Papers whose slideshow should start as soon as their editor opens (« Présenter » on the desk). */
const presentOnOpen = new Set<string>();
export const requestPresent = (paperId: string) => presentOnOpen.add(paperId);
export const takePresent = (paperId: string) => presentOnOpen.delete(paperId);

/** Download a slides paper as .pptx without opening it. */
export async function downloadSlides(paper: Paper, onCreated: (docId: string) => void): Promise<void> {
  const s = await slideSessionFor(paper, onCreated);
  const input = await s.exportInput();
  const bytes = await exportSlides({ format: 'pptx', ...input });
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(paper.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'presentation').slice(0, 120)}.pptx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
