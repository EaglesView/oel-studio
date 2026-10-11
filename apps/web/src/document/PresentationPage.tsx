import { useEffect, useRef, useState } from 'react';
import { Button, Logo, ToastRegion, toast } from '@oel/emboss';
import { IdentityDialog, decodeToken, defaultIdentity, loadIdentity, tokenStore, type Identity } from '@oel/collab-client';
import { SlideSession, SlidesEditor, type Deck } from '@oel/slides';
import '@oel/slides/styles.css';
import '@oel/img/styles.css';
import { createImageWorker } from '../bureau/images';
import { asDeckPayload, type DeckPayload } from '@oel/engine';
import { collabApi } from '../bureau/docs';
import { features } from '../edition';
import { engineHost } from '../bureau/importFiles';
import { exportSlides } from '../bureau/slides';
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
const ACCEPT = '.pptx,.pptm,.ppsx,.potx';

/**
 * /presentation — the presentation editor on its own: share links land here
 * (no desk), and it doubles as a "new presentation / open a .pptx" page.
 */
export function PresentationPage() {
  const [docId, setDocId] = useState<string | null>(() => readLocation().docId);
  const [session, setSession] = useState<SlideSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<Identity>(() => loadIdentity() ?? defaultIdentity());
  const [askName, setAskName] = useState(() => !loadIdentity());
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const created = useRef<SlideSession | null>(null);

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
    let opened: SlideSession | null = null;
    setSession(null);
    setError(null);
    SlideSession.open({ docId, api: collabApi, identity })
      .then(async (s) => {
        opened = s;
        if (!alive) return s.destroy();
        // A server presentation nobody filled yet: import its original .pptx.
        await s.seedIfEmpty(async () => {
          const pkg = await s.originalPackage();
          if (!pkg) return null;
          const r = await engineHost().import(new File([pkg as Uint8Array<ArrayBuffer>], 'presentation.pptx'));
          const p = r.payload ? asDeckPayload(r.payload) : undefined;
          return p ? { deck: JSON.parse(p.json) as Deck, original: pkg, media: p.media } : null;
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
      setError('Cette présentation n’est pas disponible ici. Demandez un nouveau lien de partage.');
    }
  }, [session]);

  const start = async (payload: DeckPayload, name: string) => {
    const s = await SlideSession.create({ api: collabApi, identity, seed: { deck: JSON.parse(payload.json) as Deck, original: payload.original, media: payload.media, title: name } });
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
      const r = await engineHost().create('slides', 'Présentation sans titre');
      await start(asDeckPayload(r.payload), r.title);
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
        if (r.kind !== 'slides' || !r.payload) throw new Error('Seuls les fichiers PowerPoint (.pptx) peuvent être modifiés ici.');
        await start(asDeckPayload(r.payload), r.title);
      } catch (e) {
        toast({ title: 'Ouverture impossible', description: (e as Error).message, tone: 'danger' });
      } finally {
        setBusy(false);
      }
    };
    if (file) return void run(file);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT;
    input.onchange = () => input.files?.[0] && run(input.files[0]);
    input.click();
  };

  let body;
  if (error) {
    body = (
      <div className="docpage__center">
        <h1>Présentation inaccessible</h1>
        <p>{error}</p>
        <Button onPress={() => (history.pushState(null, '', location.pathname), setDocId(null), setError(null))}>Nouvelle présentation</Button>
      </div>
    );
  } else if (docId && session) {
    body = (
      <SlidesEditor
        createImageWorker={createImageWorker}
        key={session.status.docId}
        session={session}
        title={title || 'Présentation'}
        onTitleChange={setTitle}
        identity={identity}
        collab={features.collab}
        onIdentityChange={setIdentity}
        exportFile={exportSlides}
        onNewPresentation={create}
        onOpenFile={(f) => open(f)}
        variant="standalone"
        onBureau={() => (location.href = '/bureau')}
      />
    );
  } else if (docId) {
    body = <p className="docpage__center" aria-busy>Ouverture de la présentation…</p>;
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
        <h1>Présentations</h1>
        <p>Créez et présentez à plusieurs, hors ligne ou en ligne, et gardez vos fichiers PowerPoint intacts : dispositions, thèmes, animations.</p>
        <div className="docpage__actions">
          <Button variant="primary" leadingIcon="plus" onPress={create} isDisabled={busy}>Nouvelle présentation</Button>
          <Button leadingIcon="upload" onPress={() => open()} isDisabled={busy}>Ouvrir un fichier .pptx</Button>
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
