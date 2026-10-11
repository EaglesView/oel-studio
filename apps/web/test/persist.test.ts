/** The desk saved on the device (plan solo MVP, S-2), on a bare Y.Doc. */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createDesk } from '@oel/desk';
import { THREAD_PREFIX } from '@oel/links';
import { bindDesk, initDesk, readDesk, restoredPaper, storedPaper, takeTrash } from '../src/bureau/persist';
import type { Paper, PaperData } from '../src/bureau/model';

const paper = (id: string, extra: Partial<PaperData> = {}, kind: Paper['kind'] = 'document'): Paper => ({
  id, kind, title: id, x: 10, y: 20, w: 420, h: 594, rotation: 1,
  data: { preview: { kind: 'document', blocks: [] }, status: { state: 'ready' }, ...extra } as PaperData,
});

/** A desk bound to a fresh Y.Doc, flushed by hand. */
function setup(nodes: Paper[]) {
  const store = createDesk<PaperData>({ nodes });
  const doc = new Y.Doc();
  initDesk(doc, { demoVersion: 1 });
  const binding = bindDesk(store, doc, null, { delay: 10_000 });
  return { store, doc, binding };
}

/** The same desk as a later visit sees it. */
function reload(doc: Y.Doc) {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return copy;
}

describe('storedPaper', () => {
  it('drops what belongs to this tab: object URLs, flashes, undefined fields', () => {
    const p = paper('a', { thumbnail: 'blob:x', imageUrl: 'blob:y', flash: { label: '+1', at: 1 }, image: { original: 'h', rendered: 'blob:z' }, stamp: undefined });
    const s = storedPaper(p);
    expect(s.data).toEqual({ preview: { kind: 'document', blocks: [] }, status: { state: 'ready' }, image: { original: 'h' } });
    expect(p.data.thumbnail).toBe('blob:x');
  });

  it('turns an import cut short into an error the paper shows', () => {
    const p = paper('a', { status: { state: 'importing', progress: 0.4, stage: 'Lecture' } });
    expect(restoredPaper(p).data.status).toEqual({ state: 'error', reason: 'Import interrompu : déposez le fichier à nouveau.' });
    expect(restoredPaper(paper('b'))).toEqual(paper('b'));
  });
});

describe('bindDesk', () => {
  it('saves a new desk at once and brings it back in paint order, with its view', () => {
    const { store, doc } = setup([paper('a'), paper('b'), paper('c')]);
    store.bringToFront(['a']);
    store.setViewport({ x: 5, y: 6, zoom: 0.5 });
    store.setLinks([{ id: 'l1', from: 'a', to: 'b', state: 'fresh' }, { id: `${THREAD_PREFIX}x`, from: 'b', to: 'c', state: 'fresh' }]);
    bindDesk(store, doc, readDesk(doc)).flush();
    const back = readDesk(reload(doc))!;
    expect(back.papers.map((p) => p.id)).toEqual(['b', 'c', 'a']);
    expect(back.viewport).toEqual({ x: 5, y: 6, zoom: 0.5 });
    expect(back.links.map((l) => l.id)).toEqual(['l1']);
    expect(back.demoVersion).toBe(1);
  });

  it('is empty until the desk is created', () => {
    expect(readDesk(new Y.Doc())).toBeNull();
  });

  it('writes only the papers whose saved form changed', () => {
    const { store, doc, binding } = setup([paper('a'), paper('b')]);
    const touched: string[] = [];
    doc.getMap('papers').observe((e) => touched.push(...e.keysChanged));
    store.update('a', { data: { ...store.node('a')!.data, thumbnail: 'blob:new' } }, { history: false });
    binding.flush();
    expect(touched).toEqual([]);
    store.moveBy(['b'], { x: 5, y: 0 });
    binding.flush();
    expect(touched).toEqual(['b']);
    expect(readDesk(reload(doc))!.papers.find((p) => p.id === 'b')!.x).toBe(15);
  });

  it('keeps removed files in the trash until a later visit, unless an undo brought them back', () => {
    const { store, doc, binding } = setup([paper('a', { docId: 'local-a' }), paper('b', { docId: 'local-b' }, 'spreadsheet'), paper('n', {}, 'note')]);
    store.remove(['a', 'b', 'n']);
    binding.flush();
    store.undo();
    store.remove(['b']);
    binding.flush();
    const later = reload(doc);
    expect(readDesk(later)!.papers.map((p) => p.id).sort()).toEqual(['a', 'n']);
    expect(takeTrash(later)).toEqual([{ docId: 'local-b', kind: 'spreadsheet' }]);
    expect(takeTrash(later)).toEqual([]);
  });

  it('picks up where a saved desk left off', () => {
    const { store, doc, binding } = setup([paper('a')]);
    binding.dispose();
    const later = reload(doc);
    const saved = readDesk(later)!;
    const store2 = createDesk<PaperData>({ nodes: saved.papers });
    const touched: string[] = [];
    later.getMap('papers').observe((e) => touched.push(...e.keysChanged));
    const b2 = bindDesk(store2, later, saved);
    b2.flush();
    expect(touched).toEqual([]);
    store2.add([paper('z')]);
    b2.flush();
    expect(touched).toEqual(['z']);
    expect(store.nodes).toHaveLength(1);
  });
});
