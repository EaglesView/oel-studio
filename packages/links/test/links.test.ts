import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { LINK_ORIGIN, THREAD_PREFIX, adoptCopy, chipLabel, defaultCarries, withEdit, withoutEdit, rememberCopied, createsCycle, deriveThreads, linkState, linksOf, revOf, type LinkDef } from '../src';

const def = (over: Partial<LinkDef> = {}): LinkDef => ({
  id: 'l1',
  source: { docId: 'budget', kind: 'spreadsheet', ref: { kind: 'chart', sheetId: 's1', chartId: 'c1' }, title: 'Budget 2027', label: 'Dépenses par mois' },
  target: { objectId: 'el-9', label: 'diapo 5' },
  carries: 'chart',
  mode: 'live',
  snapshot: { rev: 'r1', at: Date.UTC(2026, 9, 3, 12), by: 'JB' },
  ...over,
});

const sync = (a: Y.Doc, b: Y.Doc) => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
};

describe('revOf', () => {
  it('ignores key order and undefined fields', () => {
    expect(revOf({ a: 1, b: [1, 2], c: undefined })).toBe(revOf({ b: [1, 2], a: 1 }));
    expect(revOf({ a: 1 })).not.toBe(revOf({ a: 2 }));
  });
});

describe('linkState (mode transitions)', () => {
  it('follows mode, source revision and breakage', () => {
    expect(linkState(def(), { rev: 'r1' })).toBe('fresh');
    expect(linkState(def(), { rev: 'r2' })).toBe('updating');
    expect(linkState(def({ mode: 'manual' }), { rev: 'r2' })).toBe('stale');
    expect(linkState(def({ mode: 'manual' }), { rev: 'r1' })).toBe('fresh');
    expect(linkState(def({ mode: 'frozen' }), { rev: 'r2' })).toBe('frozen');
    expect(linkState(def({ mode: 'frozen' }), { rev: null })).toBe('frozen');
    expect(linkState(def(), { rev: null })).toBe('broken');
    expect(linkState(def({ broken: { reason: 'deleted', at: 1 } }), { rev: 'r1' })).toBe('broken');
    expect(linkState(def(), {})).toBe('waiting');
    expect(linkState(def(), { rev: 'r1', updating: true })).toBe('updating');
  });

  it('labels the chip like Figma G1', () => {
    expect(chipLabel(def(), 'fresh')).toBe('À jour · graphique');
    expect(chipLabel(def(), 'stale')).toBe('En retard · graphique');
    expect(chipLabel(def(), 'broken')).toBe('Source supprimée');
    expect(chipLabel(def({ mode: 'frozen' }), 'frozen')).toMatch(/^Figé · 3 oct/);
  });
});

describe('createsCycle', () => {
  it('refuses a file linked into itself and loops', () => {
    expect(createsCycle([], 'a', 'a')).toBe(true);
    expect(createsCycle([{ from: 'a', to: 'b' }], 'b', 'a')).toBe(true);
    expect(createsCycle([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }], 'c', 'a')).toBe(true);
    expect(createsCycle([{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }], 'b', 'c')).toBe(false);
  });
});

describe('LinksDoc', () => {
  it('round-trips a link and finds it by object', () => {
    const doc = new Y.Doc();
    const l = linksOf(doc);
    l.put(def());
    expect(l.get('l1')).toEqual(def());
    expect(l.byObject('el-9')?.id).toBe('l1');
    l.patch('l1', { broken: { reason: 'deleted', at: 5 } });
    expect(l.get('l1')?.broken).toEqual({ reason: 'deleted', at: 5 });
    l.patch('l1', { broken: null });
    expect(l.get('l1')?.broken).toBeUndefined();
    l.remove('l1');
    expect(l.list()).toEqual([]);
  });

  it('keeps a mode change and a concurrent update (fields merge)', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    linksOf(a).put(def());
    sync(a, b);
    linksOf(a).patch('l1', { mode: 'manual' }, 'person');
    linksOf(b).patch('l1', { snapshot: { rev: 'r2', at: 2, by: 'MC' } });
    sync(a, b);
    for (const d of [a, b]) {
      expect(linksOf(d).get('l1')?.mode).toBe('manual');
      expect(linksOf(d).get('l1')?.snapshot.rev).toBe('r2');
    }
  });

  it('writes an update once when two resolvers compute the same revision', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    linksOf(a).put(def());
    sync(a, b);
    let writes = 0;
    a.on('afterTransaction', (tr: Y.Transaction) => tr.changed.size && tr.origin === LINK_ORIGIN && writes++);
    const snap = { rev: 'r2', at: 9, by: 'JB' };
    linksOf(a).patch('l1', { snapshot: snap });
    linksOf(b).patch('l1', { snapshot: snap });
    sync(a, b);
    linksOf(a).patch('l1', { snapshot: snap }); // already there: no write
    expect(writes).toBe(1);
    expect(linksOf(a).get('l1')).toEqual(linksOf(b).get('l1'));
  });

  it('keeps backlinks in the source', () => {
    const doc = new Y.Doc();
    const l = linksOf(doc);
    l.putBacklink({ linkId: 'l1', ref: def().source.ref, docId: 'deck', kind: 'slides', objectId: 'el-9', title: 'Lancement', label: 'diapo 5' });
    expect(l.usesOf((b) => b.ref.kind === 'chart' && b.ref.chartId === 'c1')).toHaveLength(1);
    l.removeBacklink('l1');
    expect(l.backlinkList()).toEqual([]);
  });
});

describe('deriveThreads', () => {
  it('maps links onto papers and skips sources off the desk', () => {
    const papers = [
      { id: 'p-budget', title: 'Budget 2027', docId: 'budget' },
      { id: 'p-deck', title: 'Lancement', docId: 'deck' },
    ];
    const threads = deriveThreads(papers, [
      { def: def(), targetDocId: 'deck', state: 'fresh' },
      { def: def({ id: 'l2', source: { ...def().source, docId: 'elsewhere' } }), targetDocId: 'deck', state: 'fresh' },
    ]);
    expect(threads).toEqual([
      { id: THREAD_PREFIX + 'l1', linkId: 'l1', from: 'p-budget', to: 'p-deck', label: 'À jour · graphique', title: 'Budget 2027 › Dépenses par mois → Lancement · diapo 5', state: 'fresh' },
    ]);
  });
});

describe('copying a linked copy', () => {
  it('pastes a new link to the same source, in the same file or another', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    linksOf(a).put(def());
    rememberCopied([linksOf(a).byObject('el-9')]);
    // Copy within the file: the original's link is still there.
    const same = adoptCopy(linksOf(a), 'el-9', 'el-10', 'diapo 6');
    expect(same).toMatchObject({ source: def().source, mode: 'live', target: { objectId: 'el-10', label: 'diapo 6' } });
    expect(same!.id).not.toBe('l1');
    // Cut, then paste elsewhere: the link comes from what was copied.
    linksOf(a).remove('l1');
    const other = adoptCopy(linksOf(b), 'el-9', 'x-1', '§ 3');
    expect(other?.source.ref).toEqual(def().source.ref);
    expect(linksOf(b).byObject('x-1')?.id).toBe(other!.id);
    // An object with no link pastes as a plain copy.
    expect(adoptCopy(linksOf(b), 'nothing', 'x-2', '')).toBeNull();
  });
});

describe('generalised links (Figma I)', () => {
  it('stores the new fields and reads old links unchanged', () => {
    const doc = new Y.Doc();
    const links = linksOf(doc);
    links.put(def());
    expect(links.get('l1')).toEqual(def());
    const table = def({
      id: 'l2',
      source: { docId: 'budget', kind: 'spreadsheet', ref: { kind: 'range', sheetId: 's1', ids: { r0: 'a', c0: 'b', r1: 'c', c1: 'd' } }, title: 'Budget 2027', label: 'B2:F7' },
      carries: 'table',
      theme: 'target',
      view: { overflow: 'all' },
      edits: [{ id: 'e1', label: 'Ligne Total en gras', at: 1, by: 'JB', patch: { row: 5, bold: true } }],
    });
    links.put(table);
    expect(links.get('l2')).toEqual(table);
    links.patch('l2', { theme: null, view: { overflow: 'truncate' } }, 'person');
    expect(links.get('l2')?.theme).toBeUndefined();
    expect(links.get('l2')?.view).toEqual({ overflow: 'truncate' });
  });

  it('defaults what each source kind carries', () => {
    expect(defaultCarries({ kind: 'chart', sheetId: 's', chartId: 'c' })).toBe('chart');
    expect(defaultCarries({ kind: 'image', objectId: 'p1' })).toBe('picture');
    expect(defaultCarries({ kind: 'cell', sheetId: 's', ids: { r: 'r', c: 'c' } })).toBe('value');
    expect(defaultCarries({ kind: 'range', sheetId: 's', ids: { r0: 'a', c0: 'b', r1: 'c', c1: 'd' } })).toBe('table');
  });

  it('keeps one entry per local edit id', () => {
    const a = { id: 'crop', label: 'Recadrage', at: 1, by: 'JB', patch: { l: 0.1 } };
    const b = { ...a, at: 2, patch: { l: 0.2 } };
    const list = withEdit(withEdit(undefined, a), b);
    expect(list).toEqual([b]);
    expect(withoutEdit(list, 'crop')).toEqual([]);
  });

  it('gives each linked value kind its own revision', () => {
    const pic = { kind: 'picture', media: { hash: 'h1', mime: 'image/png', width: 10, height: 10 } };
    expect(revOf(pic)).not.toBe(revOf({ ...pic, media: { ...pic.media, hash: 'h2' } }));
    expect(revOf({ kind: 'value', text: '2,4 M$' })).not.toBe(revOf({ kind: 'value', text: '2,5 M$' }));
  });

  it('labels threads of the new kinds', () => {
    const img = def({ source: { docId: 'img', kind: 'image', ref: { kind: 'image', objectId: 'p1' }, title: 'photo.jpg', label: 'photo.jpg' }, carries: 'picture' });
    expect(chipLabel(img, 'fresh')).toBe('À jour · image');
  });
});
