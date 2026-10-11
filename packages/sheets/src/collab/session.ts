/**
 * A spreadsheet session: the shared Y.Doc session of @oel/collab-client
 * (offline copy, sync, links, versions) plus seeding from the codec JSON,
 * the original .xlsx for round trips, pictures made in the editor (retouched ones), export input
 * and version restore.
 */
import type * as Y from 'yjs';
import { CollabApi, MediaStore, YSession, createRemoteDoc, type Identity, type MediaEntry } from '@oel/collab-client';
import { SheetDoc } from '../model/ydoc';
import type { Workbook } from '../model/types';

export interface SheetSeed {
  workbook: Workbook;
  /** The original .xlsx (not for CSV: the dialect lives in the workbook). */
  original?: Uint8Array | null;
  title?: string;
}

export class SheetSession extends YSession {
  readonly sheet: SheetDoc;
  /** Pictures made in the editor (imported ones stay in the original .xlsx). */
  readonly media: MediaStore;

  private constructor(docId: string, token: string | null, api: CollabApi | null, identity: Identity) {
    super('sheet', docId, token, api, identity);
    this.sheet = new SheetDoc(this.ydoc);
    this.media = new MediaStore(this.ydoc.getMap<MediaEntry>('media'), () => ({
      docId: this.status.docId,
      token: this.status.token,
      api: this.api,
      canUpload: !this.status.readOnly && this.status.connection !== 'local',
    }));
  }

  /** Open an existing workbook (or a new local one when `docId` is empty). */
  static async open(o: { docId?: string | null; token?: string | null; api?: CollabApi | null; identity: Identity; seed?: SheetSeed | null }): Promise<SheetSession> {
    const { docId, token } = YSession.ids(o.docId, o.token);
    const s = new SheetSession(docId, token, o.api ?? null, o.identity);
    await s.start();
    if (o.seed) await s.seed(o.seed);
    await s.media.preload();
    return s;
  }

  /** Create a workbook from an import: on the server when reachable (it keeps the .xlsx), else locally. */
  static async create(o: { api: CollabApi | null; identity: Identity; seed: SheetSeed }): Promise<SheetSession> {
    const remote = await createRemoteDoc(o.api, o.seed.original ?? null, o.seed.title ?? '', 'sheet');
    return SheetSession.open({ docId: remote?.docId ?? null, token: remote?.token ?? null, api: o.api, identity: o.identity, seed: o.seed });
  }

  /** Fill a workbook still empty after syncing (created on the server by a client that left early). */
  async seedIfEmpty(make: () => Promise<SheetSeed | null>): Promise<boolean> {
    if (this.status.readOnly) return false;
    if (this.provider) await this.waitSynced(5000);
    if (this.isSeeded) return false;
    const seed = await make();
    if (!seed || this.isSeeded) return false;
    await this.seed(seed);
    return true;
  }

  private async seed(seed: SheetSeed) {
    if (seed.original) await this.storeOriginal(seed.original);
    if (this.provider) await this.waitSynced(4000);
    this.sheet.seed(seed.workbook, seed.title);
  }

  protected override onAuthenticated() {
    void this.media.sync();
  }

  /** Store a picture made in the editor; returns its package path. */
  addPicture(file: Blob): Promise<string> {
    return this.media.add(file, 'xl/media');
  }

  /** What the codec needs to write the file. */
  async exportInput(): Promise<{ json: Workbook; original: Uint8Array | null; media: Array<{ path: string; bytes: Uint8Array }> }> {
    const json = this.sheet.toWorkbook();
    return { json, original: json.source === 'xlsx' ? await this.original() : null, media: await this.media.added() };
  }

  /** Restore a version as a new change (a "before restore" version is kept first). */
  async restoreVersion(id: string) {
    const source: Y.Doc = await this.loadVersion(id);
    await this.createVersion('Avant la restauration', true).catch(() => null);
    this.sheet.replaceWith(new SheetDoc(source).toWorkbook());
  }

  protected override onDestroy() {
    this.media.destroy();
  }
}
