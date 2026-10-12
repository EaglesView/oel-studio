/** Bureau ↔ @oel/docs: one collaborative session per document paper. */
import { CollabApi, DocSession, blankDocxJson, defaultIdentity, docFromPreview, docsSchema, loadIdentity, saveIdentity, type DocxJson, type Identity } from '@oel/docs';
import { asDocxPayload } from '@oel/engine';
import { features } from '../edition';
import { engineHost } from './importFiles';
import type { Paper } from './model';

/** The collab server; `null` in the single-user edition, so every document stays local (y-indexeddb). */
export const collabApi: CollabApi | null = features.collab ? new CollabApi(import.meta.env.PUBLIC_COLLAB_URL ?? 'http://localhost:8787') : null;

export function identity(): Identity {
  let id = loadIdentity();
  if (!id) saveIdentity((id = defaultIdentity()));
  return id;
}

const sessions = new Map<string, Promise<DocSession>>();
let schema: ReturnType<typeof docsSchema> | null = null;
const getSchema = () => (schema ??= docsSchema());

/** Create the shared document for an imported .docx; returns its id. */
export async function createDocFromPayload(payload: unknown, title: string): Promise<string> {
  const p = asDocxPayload(payload);
  const s = await DocSession.create({ api: collabApi, identity: identity(), schema: getSchema(), title, seed: { json: JSON.parse(p.json) as DocxJson, original: p.original, media: p.media } });
  sessions.set(s.status.docId, Promise.resolve(s));
  return s.status.docId;
}

/** Session for a paper; papers without a document get one seeded from their preview. */
export function sessionFor(paper: Paper, onCreated: (docId: string) => void): Promise<DocSession> {
  const known = paper.data.docId && sessions.get(paper.data.docId);
  if (known) return known;
  const p = (async () => {
    if (paper.data.docId) return DocSession.open({ docId: paper.data.docId, api: collabApi, identity: identity() });
    const blocks = paper.data.preview.kind === 'document' ? paper.data.preview.blocks : [];
    const s = await DocSession.create({ api: collabApi, identity: identity(), schema: getSchema(), title: paper.title, seed: { json: blankDocxJson(docFromPreview(blocks)) } });
    onCreated(s.status.docId);
    return s;
  })();
  p.then((s) => sessions.set(s.status.docId, p));
  return p;
}

export async function exportDocx(input: { json: unknown; original: Uint8Array | null; media: Array<{ path: string; bytes: Uint8Array }> }) {
  return engineHost().export({ kind: 'document', format: 'docx', data: input });
}
