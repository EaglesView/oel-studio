import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, DialogOverlay, Icon, NumberField, Radio, RadioGroup, SheetDialog, Switch, toast } from '@oel/emboss';
import type { Account } from '../api/backend';
import type { FormDef, FormSettings, IdentityMode } from '../model/types';
import { download, qrPng, qrSvg } from './qr';
import { tr } from '@oel/i18n';

export async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast({ title: tr('Lien copié', 'Link copied'), description: url, tone: 'success' });
  } catch {
    toast({ title: tr('Copie impossible', 'Copy failed'), description: tr('Sélectionnez le lien et copiez-le avec Ctrl+C.', 'Select the link and copy it with Ctrl+C.'), tone: 'warning' });
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
        title={tr('Publier le formulaire', 'Publish the form')}
        width={620}
        actions={(close) => (
          <>
            <Button variant="ghost" onPress={close}>
              {tr('Fermer', 'Close')}
            </Button>
            <Button variant="primary" leadingIcon="share" isDisabled={busy || (!!pub && !pub.dirty)} onPress={() => void publish()}>
              {busy ? tr('Publication…', 'Publishing…') : !pub ? tr('Publier', 'Publish') : pub.dirty ? tr('Republier les modifications', 'Republish the changes') : tr('Publié', 'Published')}
            </Button>
          </>
        )}
      >
        <div className="forms-dialog forms-publish">
          <p className="forms-publish__account">
            <Badge tone="success">{tr('Connecté', 'Connected')} · {account.email}</Badge>
            <Button variant="ghost" size="sm" onPress={onSignOut}>
              {tr('Se déconnecter', 'Sign out')}
            </Button>
          </p>

          {pub ? (
            <section className="forms-publish__link" aria-label={tr('Lien public', 'Public link')}>
              <div className="forms-publish__url">
                <p className="emb-field__label">{tr('Lien public', 'Public link')}</p>
                <div className="emb-well-input">
                  <input className="emb-well-input__control" readOnly value={pub.url} aria-label={tr('Lien public', 'Public link')} onFocus={(e) => e.target.select()} />
                </div>
                <p className="emb-field__helper">
                  {pub.dirty ? tr('Modifications non publiées : republiez pour les mettre en ligne (même lien).', 'Unpublished changes: republish to put them online (same link).') : tr(`Version ${pub.version} en ligne · republier garde le même lien.`, `Version ${pub.version} online · republishing keeps the same link.`)}
                </p>
                <div className="forms-dialog__row">
                  <Button leadingIcon="copy" onPress={() => void copyLink(pub.url)} aria-keyshortcuts="Control+Shift+C">
                    {tr('Copier', 'Copy')}
                  </Button>
                  <Button variant="ghost" leadingIcon="eye" onPress={() => window.open(pub.url, '_blank', 'noopener')}>
                    {tr('Ouvrir', 'Open')}
                  </Button>
                </div>
              </div>
              <figure className="forms-publish__qr">
                <span className="forms-publish__qr-img" dangerouslySetInnerHTML={{ __html: svg }} role="img" aria-label={tr(`Code QR vers ${pub.url}`, `QR code to ${pub.url}`)} />
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
              <Icon name="link" size={16} /> {tr('Un lien court et un code QR seront créés. Les réponses vont dans', 'A short link and a QR code will be created. The responses go to')}{' '}
              <strong>{form.link ? `${form.link.sheetTitle} › ${form.link.tab}` : tr('le tableur lié', 'the linked spreadsheet')}</strong>.
            </p>
          )}

          <fieldset className="forms-fieldset">
            <legend className="emb-t-overline">{tr('Identité des répondants', 'Respondent identity')}</legend>
            <RadioGroup
              aria-label={tr('Identité des répondants', 'Respondent identity')}
              value={s.identity}
              onChange={(v) => set({ identity: v as IdentityMode, onePerEmail: v === 'verified-email' ? s.onePerEmail : false })}
            >
              <Radio value="anonymous">{tr('Anonyme : aucune information demandée', 'Anonymous: no information asked')}</Radio>
              <Radio value="optional-email">{tr('Courriel facultatif', 'Optional email')}</Radio>
              <Radio value="verified-email">{tr('Courriel obligatoire, vérifié par un code', 'Required email, verified with a code')}</Radio>
            </RadioGroup>
            <Switch isSelected={s.onePerEmail} isDisabled={s.identity !== 'verified-email'} onChange={(v) => set({ onePerEmail: v })}>
              {tr('Une seule réponse par courriel', 'One response per email')}
            </Switch>
            {s.identity !== 'verified-email' && <p className="emb-field__helper">{tr('« Une seule réponse par courriel » demande la vérification du courriel.', '“One response per email” needs email verification.')}</p>}
          </fieldset>

          <fieldset className="forms-fieldset">
            <legend className="emb-t-overline">{tr('Règles', 'Rules')}</legend>
            <Switch isSelected={s.acceptResponses} onChange={(v) => set({ acceptResponses: v })}>
              {tr('Accepter les réponses', 'Accept responses')}
            </Switch>
            <div className="emb-field">
              <label className="emb-field__label" htmlFor="forms-closes">
                {tr('Fermer automatiquement le', 'Close automatically on')}
              </label>
              <div className="emb-well-input">
                <input id="forms-closes" type="date" className="emb-well-input__control" value={s.closesOn ?? ''} onChange={(e) => set({ closesOn: e.target.value || null })} />
              </div>
              <span className="emb-field__helper">{tr('Vide = pas de date de fermeture.', 'Empty = no closing date.')}</span>
            </div>
            <NumberField
              label={tr('Réponses au plus', 'Responses at most')}
              description="Vide = sans limite."
              minValue={1}
              value={s.maxResponses ?? Number.NaN}
              onChange={(v) => set({ maxResponses: Number.isFinite(v) ? v : null })}
            />
            <Switch isSelected={s.sendCopy} onChange={(v) => set({ sendCopy: v })}>
              {tr('Envoyer une copie au répondant', 'Send a copy to the respondent')}
            </Switch>
            <Switch isSelected={s.allowEdit} onChange={(v) => set({ allowEdit: v })}>
              {tr('Permettre de modifier sa réponse (lien personnel)', 'Allow editing one’s response (personal link)')}
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
