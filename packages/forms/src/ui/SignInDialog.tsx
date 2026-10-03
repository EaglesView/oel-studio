import { useEffect, useState } from 'react';
import { Button, DialogOverlay, SheetDialog, TextField } from '@oel/emboss';
import type { Account, FormsBackend, MagicLinkSent, Provider } from '../api/backend';
import { emailProblem } from '../model/validate';

/**
 * E6 · 1–2 « Publier demande un compte ». Opens over the builder: nothing is
 * lost. A sign-in link by email (or Google / Microsoft); the link signs in
 * this tab and publishing resumes on its own.
 */
export function SignInDialog({
  backend,
  isOpen,
  onOpenChange,
  onSignedIn,
}: {
  backend: FormsBackend;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSignedIn: (a: Account) => void;
}) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<MagicLinkSent | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!isOpen) return;
    return backend.onAccountChange((a) => {
      if (a) {
        setSent(null);
        onSignedIn(a);
      }
    });
  }, [backend, isOpen, onSignedIn]);

  useEffect(() => {
    if (!sent) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [sent]);

  const send = async () => {
    const p = emailProblem(email);
    if (!email.trim() || p) return setError(p ?? 'Entrez votre courriel. Exemple : nom@exemple.ca');
    setBusy(true);
    setError(null);
    try {
      setSent(await backend.requestMagicLink(email.trim(), `${location.origin}/connexion`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const provider = async (p: Provider) => {
    setError(null);
    try {
      onSignedIn(await backend.signInWithProvider(p));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const wait = sent ? Math.max(0, Math.ceil((sent.resendAt - now) / 1000)) : 0;

  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={onOpenChange}>
      <SheetDialog title={sent ? 'Vérifiez votre boîte de réception' : 'Connectez-vous pour publier'} width={460}>
        {sent ? (
          <div className="forms-dialog">
            <p>
              Lien envoyé à <strong>{sent.email}</strong>. Il expire dans 15 minutes. Gardez cet onglet ouvert : la publication reprend toute seule après la connexion.
            </p>
            {sent.devLink && (
              // TODO(backend): remove — the local stub has no mail server, so it shows the link.
              <p className="form-dev-note">
                Mode local : <a href={sent.devLink} target="_blank" rel="noopener">ouvrir le lien de connexion</a> (nouvel onglet).
              </p>
            )}
            <div className="forms-dialog__row">
              <Button variant="ghost" isDisabled={wait > 0 || busy} onPress={() => void send()}>
                {wait > 0 ? `Renvoyer (${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, '0')})` : 'Renvoyer'}
              </Button>
              <Button variant="ghost" onPress={() => setSent(null)}>
                Changer d’adresse
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="forms-dialog"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <p>Vous pouvez créer et modifier sans compte. Publier un lien en demande un : les réponses ont ainsi un propriétaire.</p>
            <TextField
              label="Courriel"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="nom@exemple.ca"
              description="Pas de mot de passe : un lien de connexion vous est envoyé."
              value={email}
              onChange={setEmail}
              isInvalid={!!error}
              errorMessage={error ?? undefined}
              validationBehavior="aria"
              autoFocus
            />
            <Button variant="primary" type="submit" isDisabled={busy} leadingIcon="mail">
              Recevoir un lien de connexion
            </Button>
            <p className="forms-dialog__or">
              <span>ou</span>
            </p>
            <Button leadingIcon="user" onPress={() => void provider('google')}>
              Continuer avec Google
            </Button>
            <Button leadingIcon="user" onPress={() => void provider('microsoft')}>
              Continuer avec Microsoft
            </Button>
          </form>
        )}
      </SheetDialog>
    </DialogOverlay>
  );
}
