import { useEffect, useState } from 'react';
import { Button, Icon, Logo } from '@oel/emboss';
import '@oel/forms/styles.css';
import { formsBackend } from './backend';
import { messages, tr } from '@oel/i18n';
import { LocaleRoot } from '../LocaleRoot';

/**
 * Where the sign-in link lands (E6 · 2). It signs in every open tab: the
 * builder tab that asked resumes publishing on its own.
 */
export function ConnexionPage() {
  return (
    <LocaleRoot>
      <ConnexionPageContent />
    </LocaleRoot>
  );
}

function ConnexionPageContent() {
  const [state, setState] = useState<{ kind: 'working' } | { kind: 'done'; email: string } | { kind: 'error'; message: string }>({ kind: 'working' });

  useEffect(() => {
    const url = new URL(location.href);
    const token = url.searchParams.get('jeton');
    history.replaceState(null, '', url.pathname);
    if (!token) return setState({ kind: 'error', message: tr('Ce lien de connexion est incomplet.', 'This sign-in link is incomplete.') });
    formsBackend()
      .completeMagicLink(token)
      .then((a) => setState({ kind: 'done', email: a.email }))
      .catch((e: Error) => setState({ kind: 'error', message: e.message }));
  }, []);

  return (
    <main id="contenu" className="form-standalone form-standalone--center">
      <Logo size={32} />
      {state.kind === 'working' && <p role="status">{tr('Connexion…', 'Signing in…')}</p>}
      {state.kind === 'done' && (
        <>
          <Icon name="check" size={32} />
          <h1>{tr('Vous êtes connecté', 'You are signed in')}</h1>
          <p>
            {state.email}. {tr('Retournez à l’onglet du formulaire : la publication reprend toute seule.', 'Go back to the form’s tab: publishing resumes on its own.')}
          </p>
          <div className="forms-dialog__row">
            <Button variant="primary" onPress={() => window.close()}>
              {tr('Fermer cet onglet', 'Close this tab')}
            </Button>
            <Button onPress={() => location.assign('/bureau')}>{tr('Aller au bureau', 'Go to the desk')}</Button>
          </div>
        </>
      )}
      {state.kind === 'error' && (
        <>
          <Icon name="alert" size={32} />
          <h1>{tr('Connexion impossible', 'Could not sign in')}</h1>
          <p role="alert">{state.message}</p>
          <Button onPress={() => location.assign('/bureau')}>{tr('Retour au bureau', 'Back to the desk')}</Button>
        </>
      )}
    </main>
  );
}
