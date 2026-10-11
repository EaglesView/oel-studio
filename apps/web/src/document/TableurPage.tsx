import { useEffect, useRef, useState } from 'react';
import { Button, Logo, ToastRegion, toast } from '@oel/emboss';
import { IdentityDialog, decodeToken, defaultIdentity, loadIdentity, tokenStore, type Identity } from '@oel/collab-client';
import { SheetSession, SheetsEditor, type Workbook } from '@oel/sheets';
import '@oel/sheets/styles.css';
import '@oel/img/styles.css';
import { createImageWorker } from '../bureau/images';
import { asWorkbookPayload, type WorkbookPayload } from '@oel/engine';
import { collabApi } from '../bureau/docs';
import { features } from '../edition';
import { engineHost } from '../bureau/importFiles';
import { createCalcWorker, exportSheet } from '../bureau/sheets';
import './document.css';
import { ErrorBoundary } from './ErrorBoundary';

/** Read `?d=<id>#t=<token>`, keep the token locally and drop it from the address bar. */
function readLocation(): { docId: string | null } {
  const url = new URL(location.href);
  const docId = url.searchParams.get('d');
  const token = new URLSearchParams(url.hash.slice(1)).get('t');
  if (docId && token && decodeToken(token)?.docId === docId) tokenStore.set(docId, token);
  if (url.hash) history.replaceState(null, '', url.pathname + url.search);
  return { docId };
}

const go = (docId: string) => history.pushState(null, '', `?d=${encodeURIComponent(docId)}`);

/**
 * /tableur — the spreadsheet editor on its own: share links land here (no
 * desk), and it doubles as a "new workbook / open a .xlsx or .csv" page.
 */
export function TableurPage() {
  const [docId, setDocId] = useState<string | null>(() => readLocation().docId);
  const [session, setSession] = useState<SheetSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<Identity>(() => loadIdentity() ?? defaultIdentity());
  const [askName, setAskName] = useState(() => !loadIdentity());
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const created = useRef<SheetSession | null>(null);

  useEffect(() => {
    const onPop = () => setDocId(new URL(location.href).searchParams.get('d'));
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
    let opened: SheetSession | null = null;
    setSession(null);
    setError(null);
    SheetSession.open({ docId, api: collabApi, identity })
      .then(async (s) => {
        opened = s;
        if (!alive) return s.destroy();
        // A server workbook nobody filled yet: import its original .xlsx.
        await s.seedIfEmpty(async () => {
          const pkg = await s.originalPackage();
          if (!pkg) return null;
          const r = await engineHost().import(new File([pkg as Uint8Array<ArrayBuffer>], 'classeur.xlsx'));
          const p = r.payload ? asWorkbookPayload(r.payload) : undefined;
          return p ? { workbook: JSON.parse(p.json) as Workbook, original: pkg } : null;
        });
        if (s.status.token) collabApi?.info(s.status.docId, s.status.token).then((i) => alive && setTitle(i.title)).catch(() => {});
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
      setError('Ce classeur n’est pas disponible ici. Demandez un nouveau lien de partage.');
    }
  }, [session]);

  const start = async (payload: WorkbookPayload, name: string) => {
    const s = await SheetSession.create({ api: collabApi, identity, seed: { workbook: JSON.parse(payload.json) as Workbook, original: payload.original, title: name } });
    session?.destroy();
    created.current = s;
    setTitle(name);
    setSession(s);
    go(s.status.docId);
    setDocId(s.status.docId);
  };

  const create = async () => {
    setBusy(true);
    try {
      const r = await engineHost().create('spreadsheet', 'Tableur sans titre');
      await start(asWorkbookPayload(r.payload), r.title);
    } catch (e) {
      toast({ title: 'Création impossible', description: (e as Error).message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const open = (file?: File) => {
    const run = async (f: File) => {
      setBusy(true);
      try {
        const r = await engineHost().import(f);
        if (r.kind !== 'spreadsheet' || !r.payload) throw new Error('Seuls les fichiers .xlsx, .xlsm, .csv et .tsv peuvent être modifiés ici.');
        await start(asWorkbookPayload(r.payload), r.title);
      } catch (e) {
        toast({ title: 'Ouverture impossible', description: (e as Error).message, tone: 'danger' });
      } finally {
        setBusy(false);
      }
    };
    if (file) return void run(file);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xlsm,.csv,.tsv';
    input.onchange = () => input.files?.[0] && run(input.files[0]);
    input.click();
  };

  let body;
  if (error) {
    body = (
      <div className="docpage__center">
        <h1>Classeur inaccessible</h1>
        <p>{error}</p>
        <Button onPress={() => (history.pushState(null, '', location.pathname), setDocId(null), setError(null))}>Nouveau classeur</Button>
      </div>
    );
  } else if (docId && session) {
    body = (
      <SheetsEditor
        key={session.status.docId}
        session={session}
        title={title || 'Classeur'}
        onTitleChange={setTitle}
        identity={identity}
        collab={features.collab}
        onIdentityChange={setIdentity}
        createCalcWorker={createCalcWorker}
        createImageWorker={createImageWorker}
        exportFile={exportSheet}
        onNewWorkbook={create}
        onOpenFile={(f) => open(f)}
        variant="standalone"
        onBureau={() => (location.href = '/bureau')}
      />
    );
  } else if (docId) {
    body = <p className="docpage__center" aria-busy>Ouverture du classeur…</p>;
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
        <h1>Tableurs</h1>
        <p>Calculez à plusieurs, hors ligne ou en ligne, et gardez vos classeurs Excel intacts : formules, mise en forme, graphiques.</p>
        <div className="docpage__actions">
          <Button variant="primary" leadingIcon="plus" onPress={create} isDisabled={busy}>Nouveau classeur</Button>
          <Button leadingIcon="upload" onPress={() => open()} isDisabled={busy}>Ouvrir un fichier .xlsx ou .csv</Button>
        </div>
        <p className="docpage__hint">ou déposez un fichier ici</p>
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
