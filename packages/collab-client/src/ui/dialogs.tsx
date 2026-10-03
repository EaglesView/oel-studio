import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge, Button, Checkbox, DialogOverlay, SheetDialog, TextField, toast } from '@oel/emboss';
import { shareUrl, type ShareLink, type VersionInfo } from '../api';
import { IDENTITY_COLORS, saveIdentity, type Identity } from '../identity';
import type { YSession } from '../session';

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
      <SheetDialog title="Votre nom dans les documents partagés" width={420} actions={() => <Button onPress={save}>Enregistrer</Button>}>
        <form className="oel-form" onSubmit={(e) => (e.preventDefault(), save())}>
          <TextField label="Nom affiché" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} autoFocus description="Visible par les personnes qui ont le lien. Aucun compte n’est nécessaire." />
          <div className="oel-swatches__grid" role="radiogroup" aria-label="Couleur">
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
  const noun = session.kind === 'sheet' ? 'classeur' : 'document';
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
      toast({ title: 'Lien copié', tone: 'success' });
    } catch {
      toast({ title: 'Copie automatique impossible', description: 'Sélectionnez le lien affiché et copiez-le.', tone: 'info' });
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
      toast({ title: `${noun[0]!.toUpperCase()}${noun.slice(1)} en ligne`, description: 'Vous pouvez maintenant créer des liens de partage.', tone: 'success' });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetDialog title={`Partager « ${title || (session.kind === 'sheet' ? 'Classeur' : 'Document')} »`} width={560} actions={() => <Button onPress={onClose}>OK</Button>}>
        <div className="oel-share">
          {error && <p className="oel-share__error" role="alert">{error}</p>}
          {isLocal ? (
            <>
              <p>Ce {noun} n’existe que dans ce navigateur. Mettez-le en ligne pour le partager, travailler à plusieurs et garder un historique des versions.</p>
              <Button leadingIcon="cloud" onPress={publish} isDisabled={busy}>Mettre en ligne</Button>
            </>
          ) : !isOwner ? (
            <p>Seule la personne qui a créé le {noun} peut gérer les liens. Vous pouvez transmettre le lien que vous avez reçu.</p>
          ) : (
            <>
              <p>Toute personne qui a le lien peut ouvrir le {noun}, sans compte. Révoquez un lien pour couper l’accès.</p>
              <div className="oel-share__create">
                <Button leadingIcon="pen" onPress={() => create('editor')} isDisabled={busy}>Lien de modification</Button>
                <Button variant="secondary" leadingIcon="eye" onPress={() => create('viewer')} isDisabled={busy}>Lien de lecture seule</Button>
              </div>
              <ul className="oel-share__list" aria-label="Liens actifs">
                {(links ?? []).filter((l) => !l.revoked).map((l) => (
                  <li key={l.id}>
                    <Badge tone={l.role === 'editor' ? 'accent' : 'neutral'}>{l.role === 'editor' ? 'Modification' : 'Lecture'}</Badge>
                    <input
                      className="oel-share__url"
                      readOnly
                      aria-label={`Lien ${l.role === 'editor' ? 'de modification' : 'de lecture'}`}
                      value={url(l.token!)}
                      title={new Date(l.createdAt).toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' })}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <Button size="sm" variant="ghost" leadingIcon="copy" onPress={() => copy(l.token!)}>Copier</Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      leadingIcon="link-off"
                      onPress={async () => {
                        await session.revokeLink(l.id).catch((e: Error) => setError(e.message));
                        await refresh();
                      }}
                    >
                      Révoquer
                    </Button>
                  </li>
                ))}
                {links && !links.some((l) => !l.revoked) && <li className="oel-share__empty">Aucun lien actif.</li>}
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

const fmt = (t: number) => new Date(t).toLocaleString('fr-CA', { dateStyle: 'long', timeStyle: 'short' });

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
    <aside className="oel-panel oel-panel--versions" aria-label="Historique des versions">
      <header className="oel-panel__head">
        <h2>Historique des versions</h2>
        <Button size="icon-sm" variant="ghost" leadingIcon="close" aria-label="Fermer l’historique" onPress={onClose} />
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
            toast({ title: 'Version enregistrée', tone: 'success' });
            await load();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextField aria-label="Nom de la version" placeholder="Nommer la version actuelle" value={name} onChange={setName} />
        <Button type="submit" size="sm" isDisabled={busy}>Enregistrer</Button>
      </form>
      <Checkbox isSelected={namedOnly} onChange={setNamedOnly}>Versions nommées seulement</Checkbox>
      <ol className="oel-versions">
        {shown.map((v) => (
          <li key={v.id}>
            <button type="button" className={`oel-versions__item${selected === v.id ? ' is-selected' : ''}`} onClick={() => setSelected(v.id)} aria-pressed={selected === v.id}>
              <span className="oel-versions__title">{v.name ?? fmt(v.createdAt)}</span>
              {v.name && <span className="oel-versions__date">{fmt(v.createdAt)}</span>}
              <span className="oel-versions__meta">
                {v.auto ? <Badge tone="neutral">Automatique</Badge> : <Badge tone="accent">Manuelle</Badge>}
                {v.author && <span>{v.author}</span>}
              </span>
            </button>
          </li>
        ))}
        {versions && !shown.length && <li className="oel-panel__empty">Aucune version pour l’instant. Les versions automatiques sont créées pendant que vous travaillez.</li>}
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
                  toast({ title: 'Version restaurée', description: 'L’état précédent est conservé dans l’historique.', tone: 'success' });
                  onRestored();
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Restaurer cette version
            </Button>
          </div>
          {preview}
        </div>
      )}
    </aside>
  );
}
