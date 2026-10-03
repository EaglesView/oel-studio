import { useEffect, useState } from 'react';
import { Button, Icon, Logo } from '@oel/emboss';
import { FormFiller, FormsError, editLinks, type Answers, type PublishedForm } from '@oel/forms';
import '@oel/forms/styles.css';
import { formsBackend } from './backend';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; slug: string; published: PublishedForm; editing?: { responseId: string; editKey: string; answers: Answers; email: string | null } };

/**
 * Public link (`/f?s=<slug>`, short form `/f/<slug>` once the host rewrites it):
 * a simple page from a link or a QR code. No account, no editor. A personal
 * « Modifier ma réponse » link adds `&r=<response>#k=<key>` (the key stays in
 * the fragment and is dropped from the address bar).
 */
export function FormPage() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const url = new URL(location.href);
    const slug = url.searchParams.get('s') ?? url.pathname.match(/^\/f\/([^/]+)/)?.[1] ?? '';
    const responseId = url.searchParams.get('r');
    const editKey = new URLSearchParams(url.hash.slice(1)).get('k');
    if (url.hash) history.replaceState(null, '', url.pathname + url.search);
    if (!slug) {
      setState({ kind: 'error', message: 'Ce lien est incomplet : il manque le nom du formulaire.' });
      return;
    }
    const backend = formsBackend();
    (async () => {
      try {
        const published = await backend.load(slug);
        document.title = `${published.form.title} · OutilsEnLigne`;
        if (responseId) {
          const key = editKey ?? (editLinks.load(slug)?.responseId === responseId ? editLinks.load(slug)!.editKey : null);
          if (!key) throw new FormsError('not-found', 'Ce lien de modification est incomplet.');
          const r = await backend.loadForEdit(slug, responseId, key);
          setState({ kind: 'ready', slug, published, editing: { responseId, editKey: key, answers: r.answers, email: r.email } });
        } else {
          setState({ kind: 'ready', slug, published });
        }
      } catch (e) {
        setState({ kind: 'error', message: e instanceof FormsError ? e.message : 'Le formulaire n’a pas pu être chargé. Vérifiez votre connexion et réessayez.' });
      }
    })();
  }, []);

  if (state.kind === 'loading') {
    return (
      <main id="contenu" className="form-standalone form-standalone--center" aria-busy="true">
        <Logo size={32} />
        <p role="status">Chargement du formulaire…</p>
      </main>
    );
  }
  if (state.kind === 'error') {
    return (
      <main id="contenu" className="form-standalone form-standalone--center">
        <Icon name="alert" size={32} />
        <h1>Formulaire introuvable</h1>
        <p>{state.message}</p>
        <Button onPress={() => location.reload()}>Réessayer</Button>
      </main>
    );
  }
  const remembered = !state.editing && state.published.form.settings.allowEdit ? editLinks.load(state.slug) : null;
  return (
    <main id="contenu" className="form-standalone">
      {remembered && (
        <p className="form-standalone__notice" role="note">
          Vous avez déjà répondu depuis cet appareil.{' '}
          <a href={`?s=${encodeURIComponent(state.slug)}&r=${encodeURIComponent(remembered.responseId)}#k=${encodeURIComponent(remembered.editKey)}`}>Modifier ma réponse</a>
        </p>
      )}
      <FormFiller backend={formsBackend()} slug={state.slug} published={state.published} editing={state.editing} />
    </main>
  );
}
