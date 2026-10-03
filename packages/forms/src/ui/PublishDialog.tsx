import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, DialogOverlay, Icon, NumberField, Radio, RadioGroup, SheetDialog, Switch, toast } from '@oel/emboss';
import type { Account } from '../api/backend';
import type { FormDef, FormSettings, IdentityMode } from '../model/types';
import { download, qrPng, qrSvg } from './qr';

export async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast({ title: 'Lien copié', description: url, tone: 'success' });
  } catch {
    toast({ title: 'Copie impossible', description: 'Sélectionnez le lien et copiez-le avec Ctrl+C.', tone: 'warning' });
  }
}

/**
 * E2 · 5 Publier + E6 · 3 identité des répondants. A short link, a QR code and
 * the rules: accept responses, closing date, limit, one response per verified
 * email. Republishing after a change keeps the same link.
 */
export function PublishDialog({
  form,
  account,
  isOpen,
  onOpenChange,
  onSettings,
  onPublish,
  onSignOut,
}: {
  form: FormDef;
  account: Account;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSettings: (s: FormSettings) => void;
  onPublish: () => Promise<void>;
  onSignOut: () => void;
}) {
  const s = form.settings;
  const pub = form.publication;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<FormSettings>) => onSettings({ ...s, ...patch });
  const svg = useMemo(() => (pub ? qrSvg(pub.url, 160) : ''), [pub]);

  useEffect(() => {
    if (!isOpen || !pub) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        void copyLink(pub.url);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, pub]);

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      await onPublish();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={onOpenChange}>
      <SheetDialog
        title="Publier le formulaire"
        width={620}
        actions={(close) => (
          <>
            <Button variant="ghost" onPress={close}>
              Fermer
            </Button>
            <Button variant="primary" leadingIcon="share" isDisabled={busy || (!!pub && !pub.dirty)} onPress={() => void publish()}>
              {busy ? 'Publication…' : !pub ? 'Publier' : pub.dirty ? 'Republier les modifications' : 'Publié'}
            </Button>
          </>
        )}
      >
        <div className="forms-dialog forms-publish">
          <p className="forms-publish__account">
            <Badge tone="success">Connecté · {account.email}</Badge>
            <Button variant="ghost" size="sm" onPress={onSignOut}>
              Se déconnecter
            </Button>
          </p>

          {pub ? (
            <section className="forms-publish__link" aria-label="Lien public">
              <div className="forms-publish__url">
                <p className="emb-field__label">Lien public</p>
                <div className="emb-well-input">
                  <input className="emb-well-input__control" readOnly value={pub.url} aria-label="Lien public" onFocus={(e) => e.target.select()} />
                </div>
                <p className="emb-field__helper">
                  {pub.dirty ? 'Modifications non publiées : republiez pour les mettre en ligne (même lien).' : `Version ${pub.version} en ligne · republier garde le même lien.`}
                </p>
                <div className="forms-dialog__row">
                  <Button leadingIcon="copy" onPress={() => void copyLink(pub.url)} aria-keyshortcuts="Control+Shift+C">
                    Copier
                  </Button>
                  <Button variant="ghost" leadingIcon="eye" onPress={() => window.open(pub.url, '_blank', 'noopener')}>
                    Ouvrir
                  </Button>
                </div>
              </div>
              <figure className="forms-publish__qr">
                <span className="forms-publish__qr-img" dangerouslySetInnerHTML={{ __html: svg }} role="img" aria-label={`Code QR vers ${pub.url}`} />
                <figcaption>
                  Code QR ·{' '}
                  <button type="button" className="forms-link" onClick={() => void qrPng(pub.url).then((b) => download(`${pub.slug}-qr.png`, b))}>
                    PNG
                  </button>{' '}
                  /{' '}
                  <button type="button" className="forms-link" onClick={() => download(`${pub.slug}-qr.svg`, qrSvg(pub.url, 1024), 'image/svg+xml')}>
                    SVG
                  </button>
                </figcaption>
              </figure>
            </section>
          ) : (
            <p className="forms-publish__intro">
              <Icon name="link" size={16} /> Un lien court et un code QR seront créés. Les réponses vont dans{' '}
              <strong>{form.link ? `${form.link.sheetTitle} › ${form.link.tab}` : 'le tableur lié'}</strong>.
            </p>
          )}

          <fieldset className="forms-fieldset">
            <legend className="emb-t-overline">Identité des répondants</legend>
            <RadioGroup
              aria-label="Identité des répondants"
              value={s.identity}
              onChange={(v) => set({ identity: v as IdentityMode, onePerEmail: v === 'verified-email' ? s.onePerEmail : false })}
            >
              <Radio value="anonymous">Anonyme : aucune information demandée</Radio>
              <Radio value="optional-email">Courriel facultatif</Radio>
              <Radio value="verified-email">Courriel obligatoire, vérifié par un code</Radio>
            </RadioGroup>
            <Switch isSelected={s.onePerEmail} isDisabled={s.identity !== 'verified-email'} onChange={(v) => set({ onePerEmail: v })}>
              Une seule réponse par courriel
            </Switch>
            {s.identity !== 'verified-email' && <p className="emb-field__helper">« Une seule réponse par courriel » demande la vérification du courriel.</p>}
          </fieldset>

          <fieldset className="forms-fieldset">
            <legend className="emb-t-overline">Règles</legend>
            <Switch isSelected={s.acceptResponses} onChange={(v) => set({ acceptResponses: v })}>
              Accepter les réponses
            </Switch>
            <div className="emb-field">
              <label className="emb-field__label" htmlFor="forms-closes">
                Fermer automatiquement le
              </label>
              <div className="emb-well-input">
                <input id="forms-closes" type="date" className="emb-well-input__control" value={s.closesOn ?? ''} onChange={(e) => set({ closesOn: e.target.value || null })} />
              </div>
              <span className="emb-field__helper">Vide = pas de date de fermeture.</span>
            </div>
            <NumberField
              label="Réponses au plus"
              description="Vide = sans limite."
              minValue={1}
              value={s.maxResponses ?? Number.NaN}
              onChange={(v) => set({ maxResponses: Number.isFinite(v) ? v : null })}
            />
            <Switch isSelected={s.sendCopy} onChange={(v) => set({ sendCopy: v })}>
              Envoyer une copie au répondant
            </Switch>
            <Switch isSelected={s.allowEdit} onChange={(v) => set({ allowEdit: v })}>
              Permettre de modifier sa réponse (lien personnel)
            </Switch>
          </fieldset>

          {error && (
            <p className="emb-field__error" role="alert">
              {error}
            </p>
          )}
        </div>
      </SheetDialog>
    </DialogOverlay>
  );
}
