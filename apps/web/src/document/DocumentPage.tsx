import { useEffect, useRef, useState } from 'react';
import { Button, Logo, ToastRegion, toast } from '@oel/emboss';
import { DocSession, DocsEditor, IdentityDialog, decodeToken, defaultIdentity, docsSchema, loadIdentity, tokenStore, type DocxJson, type Identity } from '@oel/docs';
import '@oel/docs/styles.css';
import '@oel/img/styles.css';
import { createImageWorker } from '../bureau/images';
import { asDocxPayload, type DocxPayload } from '@oel/engine';
import { collabApi, exportDocx } from '../bureau/docs';
import { features } from '../edition';
import { engineHost } from '../bureau/importFiles';
import './document.css';
import { ErrorBoundary } from './ErrorBoundary';
import { tr } from '@oel/i18n';
import { LocaleRoot } from '../LocaleRoot';

/** Read `?d=<id>#t=<token>`, keep the token locally and drop it from the address bar. */
function readLocation(): { docId: string | null } {
  const url = new URL(location.href);
  const docId = url.searchParams.get('d');
  const token = new URLSearchParams(url.hash.slice(1)).get('t');
  if (docId && token && decodeToken(token)?.docId === docId) tokenStore.set(docId, token);
  if (url.hash) history.replaceState(null, '', url.pathname + url.search);
  return { docId };
}

function go(docId: string) {
  history.pushState(null, '', `?d=${encodeURIComponent(docId)}`);
}

/**
 * /document — the editor on its own: share links land here (no desk), and it
 * doubles as a standalone "new document / open a .docx" page.
 */
export function DocumentPage() {
  return (
    <LocaleRoot>
      <DocumentPageContent />
    </LocaleRoot>
  );
}

function DocumentPageContent() {
  const [docId, setDocId] = useState<string | null>(() => readLocation().docId);
  const [session, setSession] = useState<DocSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<Identity>(() => loadIdentity() ?? defaultIdentity());
  const [askName, setAskName] = useState(() => !loadIdentity());
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  /** Session created on this page (new / opened file): reused, not reopened. */
  const created = useRef<DocSession | null>(null);

  useEffect(() => {
    const onPop = () => setDocId(new URL(location.href).searchParams.get('d'));
    // A share link pasted into a tab already on this page only changes the hash.
    const onHash = () => location.hash.includes('t=') && location.reload();
    addEventListener('popstate', onPop);
    addEventListener('hashchange', onHash);
    return () => {
      removeEventListener('popstate', onPop);
      removeEventListener('hashchange', onHash);
    };
  }, []);

  useEffect(() => {
    if (!docId) return;
    if (created.current?.status.docId === docId) {
      setSession(created.current);
      return;
    }
    let alive = true;
    let opened: DocSession | null = null;
    setSession(null);
    setError(null);
    DocSession.open({ docId, api: collabApi, identity })
      .then(async (s) => {
        opened = s;
        if (!alive) return s.destroy();
        // A server document that nobody filled yet: import its original .docx.
        await s.seedIfEmpty(async () => {
          const pkg = await s.originalPackage();
          if (!pkg) return null;
          const r = await engineHost().import(new File([pkg as Uint8Array<ArrayBuffer>], 'document.docx'));
          const p = r.payload ? asDocxPayload(r.payload) : undefined;
          return p ? { json: JSON.parse(p.json) as DocxJson, original: pkg, media: p.media } : null;
        }, docsSchema());
        if (alive) setSession(s);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
      opened?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  useEffect(() => {
    if (session && !session.isSeeded && (session.status.connection === 'local' || session.status.readOnly)) {
      setError(tr('Ce document n’est pas disponible ici. Demandez un nouveau lien de partage.', 'This document is not available here. Ask for a new share link.'));
    }
  }, [session]);

  const start = async (payload: DocxPayload, docTitle: string) => {
    const s = await DocSession.create({
      api: collabApi,
      identity,
      schema: docsSchema(),
      title: docTitle,
      seed: { json: JSON.parse(payload.json) as DocxJson, original: payload.original, media: payload.media },
    });
    session?.destroy();
    created.current = s;
    setTitle(docTitle);
    setSession(s);
    go(s.status.docId);
    setDocId(s.status.docId);
  };

  const create = async () => {
    setBusy(true);
    try {
      const r = await engineHost().create('document', tr('Document sans titre', 'Untitled document'));
      await start(asDocxPayload(r.payload), r.title);
    } catch (e) {
      toast({ title: tr('Création impossible', 'Could not create'), description: (e as Error).message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const open = (file?: File) => {
    const run = async (f: File) => {
      setBusy(true);
      try {
        const r = await engineHost().import(f);
        if (r.kind !== 'document' || !r.payload) throw new Error(tr('Seuls les fichiers .docx peuvent être modifiés ici.', 'Only .docx files can be edited here.'));
        await start(asDocxPayload(r.payload), r.title);
      } catch (e) {
        toast({ title: tr('Ouverture impossible', 'Could not open'), description: (e as Error).message, tone: 'danger' });
      } finally {
        setBusy(false);
      }
    };
    if (file) return void run(file);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    input.onchange = () => input.files?.[0] && run(input.files[0]);
    input.click();
  };

  let body;
  if (error) {
    body = (
      <div className="docpage__center">
        <h1>{tr('Document inaccessible', 'Document unavailable')}</h1>
        <p>{error}</p>
        <Button onPress={() => (history.pushState(null, '', location.pathname), setDocId(null), setError(null))}>{tr('Nouveau document', 'New document')}</Button>
      </div>
    );
  } else if (docId && session) {
    body = (
      <DocsEditor
        createImageWorker={createImageWorker}
        key={session.status.docId}
        session={session}
        title={title}
        identity={identity}
        collab={features.collab}
        onIdentityChange={setIdentity}
        exportDocx={exportDocx}
        onNewDocument={create}
        onOpenFile={(f) => open(f)}
        variant="standalone"
        onBureau={() => (location.href = '/bureau')}
      />
    );
  } else if (docId) {
    body = <p className="docpage__center" aria-busy>{tr('Ouverture du document…', 'Opening the document…')}</p>;
  } else {
    body = (
      <div
        className="docpage__center docpage__landing"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) open(f);
        }}
      >
        <Logo />
        <h1>Documents</h1>
        <p>{tr('Écrivez à plusieurs, hors ligne ou en ligne, et gardez la mise en forme de vos fichiers Word.', 'Write together, offline or online, and keep the formatting of your Word files.')}</p>
        <div className="docpage__actions">
          <Button variant="primary" leadingIcon="plus" onPress={create} isDisabled={busy}>{tr('Nouveau document', 'New document')}</Button>
          <Button leadingIcon="upload" onPress={() => open()} isDisabled={busy}>{tr('Ouvrir un fichier .docx', 'Open a .docx file')}</Button>
        </div>
        <p className="docpage__hint">{tr('ou déposez un fichier .docx ici', 'or drop a .docx file here')}</p>
      </div>
    );
  }

  return (
    <main id="contenu" className="docpage">
      <ErrorBoundary>{body}</ErrorBoundary>
      <IdentityDialog
        identity={identity}
        isOpen={askName && !!docId}
        onClose={() => setAskName(false)}
        onSave={(i) => {
          setIdentity(i);
          session?.setIdentity(i);
        }}
      />
      <ToastRegion />
    </main>
  );
}
