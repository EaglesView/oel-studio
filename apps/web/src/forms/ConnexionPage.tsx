import { useEffect, useState } from 'react';
import { Button, Icon, Logo } from '@oel/emboss';
import '@oel/forms/styles.css';
import { formsBackend } from './backend';

/**
 * Where the sign-in link lands (E6 · 2). It signs in every open tab: the
 * builder tab that asked resumes publishing on its own.
 */
export function ConnexionPage() {
  const [state, setState] = useState<{ kind: 'working' } | { kind: 'done'; email: string } | { kind: 'error'; message: string }>({ kind: 'working' });

  useEffect(() => {
    const url = new URL(location.href);
    const token = url.searchParams.get('jeton');
    history.replaceState(null, '', url.pathname);
    if (!token) return setState({ kind: 'error', message: 'Ce lien de connexion est incomplet.' });
    formsBackend()
      .completeMagicLink(token)
      .then((a) => setState({ kind: 'done', email: a.email }))
      .catch((e: Error) => setState({ kind: 'error', message: e.message }));
  }, []);

  return (
    <main id="contenu" className="form-standalone form-standalone--center">
      <Logo size={32} />
      {state.kind === 'working' && <p role="status">Connexion…</p>}
      {state.kind === 'done' && (
        <>
          <Icon name="check" size={32} />
          <h1>Vous êtes connecté</h1>
          <p>
            {state.email}. Retournez à l’onglet du formulaire : la publication reprend toute seule.
          </p>
          <div className="forms-dialog__row">
            <Button variant="primary" onPress={() => window.close()}>
              Fermer cet onglet
            </Button>
            <Button onPress={() => location.assign('/bureau')}>Aller au bureau</Button>
          </div>
        </>
      )}
      {state.kind === 'error' && (
        <>
          <Icon name="alert" size={32} />
          <h1>Connexion impossible</h1>
          <p role="alert">{state.message}</p>
          <Button onPress={() => location.assign('/bureau')}>Retour au bureau</Button>
        </>
      )}
    </main>
  );
}
