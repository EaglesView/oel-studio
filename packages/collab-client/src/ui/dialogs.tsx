import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge, Button, Checkbox, DialogOverlay, SheetDialog, TextField, toast } from '@oel/emboss';
import { shareUrl, type ShareLink, type VersionInfo } from '../api';
import { IDENTITY_COLORS, saveIdentity, type Identity } from '../identity';
import type { YSession } from '../session';
import { locale, tr } from '@oel/i18n';

interface Controlled {
  isOpen: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export function IdentityDialog({ identity, isOpen, onClose, onSave }: Controlled & { identity: Identity; onSave: (i: Identity) => void }) {
  const [draft, setDraft] = useState(identity);
  useEffect(() => void (isOpen && setDraft(identity)), [isOpen, identity]);
  const save = () => {
    const next = { ...draft, name: draft.name.trim() || identity.name };
    saveIdentity(next);
    onSave(next);
    onClose();
  };
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetDialog title={tr('Votre nom dans les documents partagés', 'Your name in shared documents')} width={420} actions={() => <Button onPress={save}>{tr('Enregistrer', 'Save')}</Button>}>
        <form className="oel-form" onSubmit={(e) => (e.preventDefault(), save())}>
          <TextField label={tr('Nom affiché', 'Display name')} value={draft.name} onChange={(name) => setDraft({ ...draft, name })} autoFocus description={tr('Visible par les personnes qui ont le lien. Aucun compte n’est nécessaire.', 'Visible to the people who have the link. No account needed.')} />
          <div className="oel-swatches__grid" role="radiogroup" aria-label={tr('Couleur', 'Colour')}>
            {IDENTITY_COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={draft.color === c} className={`oel-swatch${draft.color === c ? ' is-on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => setDraft({ ...draft, color: c })} />
            ))}
          </div>
          <button type="submit" hidden />
        </form>
      </SheetDialog>
    </DialogOverlay>
  );
}

// ---------------------------------------------------------------------------
// Share
// ---------------------------------------------------------------------------

export function ShareDialog({ session, title, origin, isOpen, onClose }: Controlled & { session: YSession; title: string; origin: string }) {
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = session.status;
  const isLocal = status.connection === 'local';
  const isOwner = status.role === 'owner';
  const noun = session.kind === 'sheet' ? tr('classeur', 'workbook') : 'document';
  const url = (token: string) => shareUrl(origin, status.docId, token, session.kind);

  const refresh = async () => {
    if (isLocal || !isOwner) return;
    try {
      setLinks(await session.links());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    if (isOpen) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isLocal, isOwner]);

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(url(token));
      toast({ title: tr('Lien copié', 'Link copied'), tone: 'success' });
    } catch {
      toast({ title: tr('Copie automatique impossible', 'Automatic copy failed'), description: tr('Sélectionnez le lien affiché et copiez-le.', 'Select the link shown and copy it.'), tone: 'info' });
    }
  };
  const create = async (role: ShareLink['role']) => {
    setBusy(true);
    try {
      const l = await session.createLink(role);
      await copy(l.token!);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    setBusy(true);
    try {
      await session.publish(title);
      toast({ title: tr(`${noun[0]!.toUpperCase()}${noun.slice(1)} en ligne`, `${noun[0]!.toUpperCase()}${noun.slice(1)} online`), description: tr('Vous pouvez maintenant créer des liens de partage.', 'You can now create share links.'), tone: 'success' });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetDialog title={tr(`Partager « ${title || (session.kind === 'sheet' ? 'Classeur' : 'Document')} »`, `Share “${title || (session.kind === 'sheet' ? 'Workbook' : 'Document')}”`)} width={560} actions={() => <Button onPress={onClose}>OK</Button>}>
        <div className="oel-share">
          {error && <p className="oel-share__error" role="alert">{error}</p>}
          {isLocal ? (
            <>
              <p>{tr(`Ce ${noun} n’existe que dans ce navigateur. Mettez-le en ligne pour le partager, travailler à plusieurs et garder un historique des versions.`, `This ${noun} only exists in this browser. Put it online to share it, work together and keep a version history.`)}</p>
              <Button leadingIcon="cloud" onPress={publish} isDisabled={busy}>{tr('Mettre en ligne', 'Put online')}</Button>
            </>
          ) : !isOwner ? (
            <p>{tr(`Seule la personne qui a créé le ${noun} peut gérer les liens. Vous pouvez transmettre le lien que vous avez reçu.`, `Only the person who created the ${noun} can manage links. You can pass on the link you received.`)}</p>
          ) : (
            <>
              <p>{tr(`Toute personne qui a le lien peut ouvrir le ${noun}, sans compte. Révoquez un lien pour couper l’accès.`, `Anyone with the link can open the ${noun}, without an account. Revoke a link to cut access.`)}</p>
              <div className="oel-share__create">
                <Button leadingIcon="pen" onPress={() => create('editor')} isDisabled={busy}>{tr('Lien de modification', 'Edit link')}</Button>
                <Button variant="secondary" leadingIcon="eye" onPress={() => create('viewer')} isDisabled={busy}>{tr('Lien de lecture seule', 'Read-only link')}</Button>
              </div>
              <ul className="oel-share__list" aria-label={tr('Liens actifs', 'Active links')}>
                {(links ?? []).filter((l) => !l.revoked).map((l) => (
                  <li key={l.id}>
                    <Badge tone={l.role === 'editor' ? 'accent' : 'neutral'}>{l.role === 'editor' ? tr('Modification', 'Edit') : tr('Lecture', 'View')}</Badge>
                    <input
                      className="oel-share__url"
                      readOnly
                      aria-label={l.role === 'editor' ? tr('Lien de modification', 'Edit link') : tr('Lien de lecture', 'View link')}
                      value={url(l.token!)}
                      title={new Date(l.createdAt).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <Button size="sm" variant="ghost" leadingIcon="copy" onPress={() => copy(l.token!)}>{tr('Copier', 'Copy')}</Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      leadingIcon="link-off"
                      onPress={async () => {
                        await session.revokeLink(l.id).catch((e: Error) => setError(e.message));
                        await refresh();
                      }}
                    >
                      {tr('Révoquer', 'Revoke')}
                    </Button>
                  </li>
                ))}
                {links && !links.some((l) => !l.revoked) && <li className="oel-share__empty">{tr('Aucun lien actif.', 'No active links.')}</li>}
              </ul>
            </>
          )}
        </div>
      </SheetDialog>
    </DialogOverlay>
  );
}

// ---------------------------------------------------------------------------
// Version history
// ---------------------------------------------------------------------------

const fmt = (t: number) => new Date(t).toLocaleString(locale(), { dateStyle: 'long', timeStyle: 'short' });

/**
 * Version history side panel. The editor supplies the preview of a version
 * (`renderPreview`, given the version's Y.Doc) and how to restore it.
 */
export function VersionPanel({
  session,
  onClose,
  onRestored,
  restore,
  renderPreview,
}: {
  session: YSession;
  onClose: () => void;
  onRestored: () => void;
  restore: (versionId: string) => Promise<void>;
  renderPreview: (doc: import('yjs').Doc) => ReactNode;
}) {
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReactNode>(null);
  const [name, setName] = useState('');
  const [namedOnly, setNamedOnly] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setVersions(await session.versions());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [session]);
  useEffect(() => void load(), [load]);

  useEffect(() => {
    if (!selected) return setPreview(null);
    let cancelled = false;
    session
      .loadVersion(selected)
      .then((d) => !cancelled && setPreview(renderPreview(d)))
      .catch((e: Error) => setError(e.message));
    return () => void (cancelled = true);
  }, [selected, session, renderPreview]);

  const shown = useMemo(() => (versions ?? []).filter((v) => !namedOnly || v.name), [versions, namedOnly]);

  return (
    <aside className="oel-panel oel-panel--versions" aria-label={tr('Historique des versions', 'Version history')}>
      <header className="oel-panel__head">
        <h2>{tr('Historique des versions', 'Version history')}</h2>
        <Button size="icon-sm" variant="ghost" leadingIcon="close" aria-label={tr('Fermer l’historique', 'Close the history')} onPress={onClose} />
      </header>
      {error && <p className="oel-share__error" role="alert">{error}</p>}
      <form
        className="oel-versions__name"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await session.createVersion(name.trim() || null);
            setName('');
            toast({ title: tr('Version enregistrée', 'Version saved'), tone: 'success' });
            await load();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextField aria-label={tr('Nom de la version', 'Version name')} placeholder={tr('Nommer la version actuelle', 'Name the current version')} value={name} onChange={setName} />
        <Button type="submit" size="sm" isDisabled={busy}>{tr('Enregistrer', 'Save')}</Button>
      </form>
      <Checkbox isSelected={namedOnly} onChange={setNamedOnly}>{tr('Versions nommées seulement', 'Named versions only')}</Checkbox>
      <ol className="oel-versions">
        {shown.map((v) => (
          <li key={v.id}>
            <button type="button" className={`oel-versions__item${selected === v.id ? ' is-selected' : ''}`} onClick={() => setSelected(v.id)} aria-pressed={selected === v.id}>
              <span className="oel-versions__title">{v.name ?? fmt(v.createdAt)}</span>
              {v.name && <span className="oel-versions__date">{fmt(v.createdAt)}</span>}
              <span className="oel-versions__meta">
                {v.auto ? <Badge tone="neutral">{tr('Automatique', 'Automatic')}</Badge> : <Badge tone="accent">{tr('Manuelle', 'Manual')}</Badge>}
                {v.author && <span>{v.author}</span>}
              </span>
            </button>
          </li>
        ))}
        {versions && !shown.length && <li className="oel-panel__empty">{tr('Aucune version pour l’instant. Les versions automatiques sont créées pendant que vous travaillez.', 'No versions yet. Automatic versions are made while you work.')}</li>}
      </ol>
      {selected && (
        <div className="oel-versions__preview">
          <div className="oel-versions__actions">
            <Button
              leadingIcon="history"
              isDisabled={busy || session.status.readOnly}
              onPress={async () => {
                setBusy(true);
                try {
                  await restore(selected);
                  toast({ title: tr('Version restaurée', 'Version restored'), description: tr('L’état précédent est conservé dans l’historique.', 'The previous state is kept in the history.'), tone: 'success' });
                  onRestored();
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {tr('Restaurer cette version', 'Restore this version')}
            </Button>
          </div>
          {preview}
        </div>
      )}
    </aside>
  );
}
