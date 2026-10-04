/**
 * A presentation session: the shared Y.Doc session of @oel/collab-client
 * (offline copy, sync, links, versions) plus what is particular to .pptx:
 * seeding from the codec JSON, pictures, and the export input.
 */
import * as Y from 'yjs';
import { CollabApi, MediaStore, YSession, createRemoteDoc, type Identity, type MediaEntry } from '@oel/collab-client';
import { SlidesDoc } from '../model/ydoc';
import type { Deck, MediaFile } from '../model/types';

export interface SlideSeed {
  deck: Deck;
  /** The original .pptx (round trips keep what the editor does not model). */
  original?: Uint8Array | null;
  media?: MediaFile[];
  title?: string;
}

export class SlideSession extends YSession {
  readonly slides: SlidesDoc;
  readonly media: MediaStore;

  private constructor(docId: string, token: string | null, api: CollabApi | null, identity: Identity) {
    super('slides', docId, token, api, identity);
    this.slides = new SlidesDoc(this.ydoc);
    this.media = new MediaStore(this.ydoc.getMap<MediaEntry>('media'), () => ({
      docId: this.status.docId,
      token: this.status.token,
      api: this.api,
      canUpload: !this.status.readOnly && this.status.connection !== 'local',
    }));
  }

  /**
   * Open an existing presentation (or a new local one when `docId` is empty).
   * Rejects with a `SlidesFormatError` (fr-CA) for a deck stored by another
   * version of the editor.
   */
  static async open(o: { docId?: string | null; token?: string | null; api?: CollabApi | null; identity: Identity; seed?: SlideSeed | null }): Promise<SlideSession> {
    const { docId, token } = YSession.ids(o.docId, o.token);
    const s = new SlideSession(docId, token, o.api ?? null, o.identity);
    await s.start();
    if (s.provider && !s.isSeeded) await s.waitSynced(4000);
    try {
      s.slides.assertFormat();
    } catch (e) {
      s.destroy();
      throw e;
    }
    if (o.seed) await s.seed(o.seed);
    await s.media.preload();
    return s;
  }

  /** Create a presentation from an import: on the server when reachable (it keeps the .pptx), else locally. */
  static async create(o: { api: CollabApi | null; identity: Identity; seed: SlideSeed }): Promise<SlideSession> {
    const remote = await createRemoteDoc(o.api, o.seed.original ?? null, o.seed.title ?? '', 'slides');
    return SlideSession.open({ docId: remote?.docId ?? null, token: remote?.token ?? null, api: o.api, identity: o.identity, seed: o.seed });
  }

  /** Fill a deck still empty after syncing (created on the server by a client that left early). */
  async seedIfEmpty(make: () => Promise<SlideSeed | null>): Promise<boolean> {
    if (this.status.readOnly) return false;
    if (this.provider) await this.waitSynced(5000);
    if (this.isSeeded) return false;
    const seed = await make();
    if (!seed || this.isSeeded) return false;
    await this.seed(seed);
    return true;
  }

  private async seed(seed: SlideSeed) {
    if (seed.original) await this.storeOriginal(seed.original);
    if (this.provider) await this.waitSynced(4000);
    if (this.slides.seeded) return;
    await this.media.seed(seed.media ?? []);
    this.slides.seed(seed.deck, seed.title);
    void this.media.sync();
  }

  protected override onAuthenticated() {
    void this.media.sync();
  }

  /** Store a picture added in the editor; returns its package path. */
  addPicture(file: Blob): Promise<string> {
    return this.media.add(file, 'ppt/media');
  }

  /** What the codec needs to write the .pptx. */
  async exportInput(): Promise<{ json: Deck; original: Uint8Array | null; media: Array<{ path: string; bytes: Uint8Array }> }> {
    const json = this.slides.toDeck();
    return { json, original: json.source === 'pptx' ? await this.original() : null, media: await this.media.added() };
  }

  /** Restore a version as a new change (a "before restore" version is kept first). */
  async restoreVersion(id: string) {
    const source: Y.Doc = await this.loadVersion(id);
    await this.createVersion('Avant la restauration', true).catch(() => null);
    this.slides.replaceWith(new SlidesDoc(source).toDeck());
  }

  protected override onDestroy() {
    this.media.destroy();
  }
}
