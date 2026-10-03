import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { Badge, Button, Checkbox, TextField, toast } from '@oel/emboss';
import type { DocSession } from '../collab/session';
import type { VersionInfo } from '../collab/api';
import { fragmentJSON, BODY } from '../model/ydoc';
import { toHTML } from './actions';

// ---------------------------------------------------------------------------
// Outline (Docs "Plan du document")
// ---------------------------------------------------------------------------

export function OutlinePanel({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const headings = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const out: Array<{ pos: number; level: number; text: string }> = [];
      e.state.doc.descendants((n, pos) => {
        if (n.type.name === 'paragraph') {
          if (n.attrs.outline != null && n.textContent.trim()) out.push({ pos, level: n.attrs.outline, text: n.textContent.trim() });
          return false;
        }
        return true;
      });
      return out;
    },
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  return (
    <aside className="oel-panel oel-panel--outline" aria-label="Plan du document">
      <header className="oel-panel__head">
        <h2>Plan</h2>
        <Button size="icon-sm" variant="ghost" leadingIcon="close" aria-label="Fermer le plan" onPress={onClose} />
      </header>
      {headings.length ? (
        <nav>
          <ul className="oel-outline">
            {headings.map((h) => (
              <li key={h.pos} style={{ paddingLeft: `${Math.min(h.level, 5) * 12}px` }}>
                <button type="button" className={`oel-outline__item oel-outline__item--${h.level}`} onClick={() => editor.chain().focus().setTextSelection(h.pos + 1).scrollIntoView().run()}>
                  {h.text}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      ) : (
        <p className="oel-panel__empty">Les titres ajoutés au document apparaîtront ici.</p>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Version history
// ---------------------------------------------------------------------------

const fmt = (t: number) => new Date(t).toLocaleString('fr-CA', { dateStyle: 'long', timeStyle: 'short' });

export function VersionPanel({ session, onClose, onRestored }: { session: DocSession; onClose: () => void; onRestored: () => void }) {
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [name, setName] = useState('');
  const [namedOnly, setNamedOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

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
    if (!selected) return setPreview('');
    let cancelled = false;
    session
      .loadVersion(selected)
      .then((d) => !cancelled && setPreview(toHTML(fragmentJSON(d.getXmlFragment(BODY)))))
      .catch((e: Error) => setError(e.message));
    return () => void (cancelled = true);
  }, [selected, session]);

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
                  const { docsSchema } = await import('../extensions');
                  await session.restoreVersion(selected, docsSchema());
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
          <div ref={previewRef} className="oel-doc oel-versions__doc" dangerouslySetInnerHTML={{ __html: preview }} />
        </div>
      )}
    </aside>
  );
}
