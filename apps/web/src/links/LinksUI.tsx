/**
 * The faces of links on the desk (Figma G): « Lier dans… » (G2 step 2), the
 * thread popover (G3), « Couper le lien ? », and the « Fils du bureau » panel
 * (G6) — also the screen-reader route, since drawn threads are decorative.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Dialog, Heading } from 'react-aria-components';
import { Badge, Button, DialogOverlay, Icon, Popover, Radio, RadioGroup, Select, SelectItem, SheetDialog, Switch, Tab, TabList, Tabs, TextField, toast, type IconName, type Tone } from '@oel/emboss';
import { CARRIES_LABEL, MODE_HINT, MODE_LABEL, STATE_LABEL, ago, fullLabel, shortDate, type Carries, type LinkMode, type LinkState } from '@oel/links';
import { useDeskState } from '@oel/desk/react';
import { KIND_ICON, kindLabel, type Bureau, type Paper } from '../bureau/model';
import { TARGET_KINDS, type LinkResolver, type Placement } from './resolver';
import './links.css';

const TONE: Record<LinkState, Tone> = { fresh: 'success', updating: 'accent', stale: 'warning', frozen: 'neutral', broken: 'danger', waiting: 'neutral' };
const STATE_ICON: Record<LinkState, IconName> = { fresh: 'link', updating: 'refresh', stale: 'alert', frozen: 'snow-flake', broken: 'link-off', waiting: 'clock' };

function useResolver(r: LinkResolver) {
  useSyncExternalStore(r.subscribe, () => r.version, () => r.version);
  return useSyncExternalStore(r.subscribeUi, r.getUi, r.getUi);
}

/** Everything links show over the Bureau. */
export function LinksUI({ resolver, store }: { resolver: LinkResolver; store: Bureau }) {
  const ui = useResolver(resolver);
  const confirm = ui.cut;
  const setConfirm = (cut: string | null) => resolver.setUi({ cut });
  return (
    <>
      {ui.popover && <ThreadPopover resolver={resolver} linkId={ui.popover.linkId} anchor={ui.popover.anchor} onCut={setConfirm} />}
      {ui.dialog && <LinkDialog resolver={resolver} store={store} />}
      {ui.panel && <LinksPanel resolver={resolver} store={store} onCut={setConfirm} />}
      <DialogOverlay isOpen={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <SheetDialog
          title="Couper le lien ?"
          tone="destructive"
          actions={(close) => (
            <>
              <Button variant="ghost" onPress={close}>
                Annuler
              </Button>
              <Button
                variant="destructive"
                leadingIcon="link-off"
                onPress={() => {
                  if (confirm) resolver.unlink(confirm);
                  close();
                }}
              >
                Couper le lien
              </Button>
            </>
          )}
        >
          <p>La copie garde sa dernière image et ne suivra plus la source. Vous pourrez la relier plus tard en la liant de nouveau.</p>
        </SheetDialog>
      </DialogOverlay>
    </>
  );
}

// ---------------------------------------------------------------------------
// G3 · Thread popover
// ---------------------------------------------------------------------------

function FileCard({ paper, fallback, sub }: { paper: Paper | undefined; fallback: string; sub: string }) {
  return (
    <div className="oel-links__file">
      <Icon name={paper ? KIND_ICON[paper.kind] : 'file'} size={18} aria-hidden />
      <div>
        <strong>{paper?.title ?? fallback}</strong>
        <small>{sub}</small>
      </div>
    </div>
  );
}

function statusLine(state: LinkState, at: number, by: string, mode: LinkMode): string {
  switch (state) {
    case 'fresh':
      return `À jour · mis à jour ${ago(at)} (${by})`;
    case 'updating':
      return 'Mise à jour…';
    case 'stale':
      return `En retard · la source a changé depuis la dernière mise à jour (${ago(at)})`;
    case 'frozen':
      return `Figé le ${shortDate(at)} · la copie ne changera plus`;
    case 'broken':
      return 'Rompu · la source a été supprimée ; la copie garde sa dernière valeur';
    default:
      return mode === 'frozen' ? 'Figé' : 'En attente de la source (pas encore lue, ou hors du bureau)';
  }
}

function ThreadPopover({ resolver, linkId, anchor, onCut }: { resolver: LinkResolver; linkId: string; anchor: { x: number; y: number; width: number; height: number }; onCut: (id: string) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const l = resolver.find(linkId);
  const close = () => resolver.setUi({ popover: null });
  useEffect(() => {
    if (!l) close();
  });
  if (!l) return null;
  const { def, state } = l;
  const canUpdate = def.mode !== 'frozen' && (state === 'stale' || state === 'waiting');
  return (
    <>
      <span ref={ref} className="oel-links__anchor" style={{ left: anchor.x, top: anchor.y, width: anchor.width, height: anchor.height }} aria-hidden />
      {ready && (
        <Popover triggerRef={ref} isOpen onOpenChange={(o) => !o && close()} placement="bottom" className="oel-links__popover">
          <Dialog aria-labelledby={`${linkId}-h`} className="oel-links__dialog">
            <header className="oel-links__head">
              <Icon name="link" size={16} aria-hidden />
              <Heading id={`${linkId}-h`} className="oel-links__eyebrow">
                Fil de liaison
              </Heading>
              <Button size="icon-sm" variant="ghost" leadingIcon="close" aria-label="Fermer" onPress={close} />
            </header>
            <p className="oel-links__flow">{fullLabel(def, l.targetPaper?.title ?? 'Copie')}</p>
            <div className="oel-links__route">
              <FileCard paper={l.sourcePaper} fallback={def.source.title} sub={`${def.source.label} · graphique`} />
              <Icon name="arrow-right" size={16} aria-label="vers" />
              <FileCard paper={l.targetPaper} fallback="Copie" sub={def.target.label} />
            </div>
            <Tabs selectedKey={def.mode} onSelectionChange={(k) => resolver.setMode(linkId, k as LinkMode)}>
              <TabList aria-label="Mode du lien" className="oel-links__modes">
                {(['live', 'manual', 'frozen'] as const).map((m) => (
                  <Tab key={m} id={m}>
                    {MODE_LABEL[m]}
                  </Tab>
                ))}
              </TabList>
            </Tabs>
            <p className="oel-links__hint">{MODE_HINT[def.mode]}</p>
            <p className={`oel-links__status oel-links__status--${state}`} role="status">
              <Icon name={STATE_ICON[state]} size={14} aria-hidden /> {statusLine(state, def.snapshot.at, def.snapshot.by, def.mode)}
            </p>
            <div className="oel-links__row">
              <span className="oel-links__label" id={`${linkId}-c`}>
                Transporte
              </span>
              <Select aria-labelledby={`${linkId}-c`} selectedKey={def.carries} onSelectionChange={(k) => resolver.setCarries(linkId, k as Carries)}>
                {(['chart', 'chart-data'] as const).map((c) => (
                  <SelectItem key={c} id={c}>
                    {CARRIES_LABEL[c]}
                  </SelectItem>
                ))}
              </Select>
            </div>
            <div className="oel-links__actions">
              <Button variant="secondary" size="sm" leadingIcon="refresh" isDisabled={!canUpdate} onPress={() => resolver.update(linkId)}>
                Mettre à jour
              </Button>
              <Button variant="ghost" size="sm" leadingIcon="table" isDisabled={!l.sourcePaper} onPress={() => (close(), resolver.openSource(linkId))}>
                Ouvrir la source
              </Button>
              <Button variant="ghost" size="sm" leadingIcon={l.targetPaper?.kind === 'slides' ? 'slide' : 'file'} isDisabled={!l.targetPaper} onPress={() => (close(), resolver.openTarget(linkId))}>
                Ouvrir la copie
              </Button>
            </div>
            <div className="oel-links__actions oel-links__actions--end">
              <Button variant="ghost" size="sm" leadingIcon="link-off" className="oel-links__cut" onPress={() => (close(), onCut(linkId))}>
                Couper le lien
              </Button>
            </div>
            <p className="oel-links__foot">
              {!canUpdate && def.mode !== 'frozen' ? '« Mettre à jour » est grisé : déjà à jour. ' : ''}
              {!l.sourcePaper ? 'La source n’est pas sur ce bureau. ' : ''}« Couper le lien » garde la copie telle quelle.
            </p>
          </Dialog>
        </Popover>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// G2 · « Lier dans… »
// ---------------------------------------------------------------------------

function LinkDialog({ resolver, store }: { resolver: LinkResolver; store: Bureau }) {
  const req = resolver.ui.dialog!;
  // Select stable store values (a fresh array per read would loop useSyncExternalStore), then derive.
  const order = useDeskState(store, (s) => s.order);
  const nodeMap = useDeskState(store, (s) => s.nodes);
  const nodes = useMemo(() => order.map((id) => nodeMap[id]).filter(Boolean) as Paper[], [order, nodeMap]);
  const [query, setQuery] = useState('');
  const candidates = useMemo(
    () =>
      nodes
        .map((p) => ({ paper: p, reason: resolver.refusal(req, p) }))
        .sort((a, b) => Number(!!a.reason) - Number(!!b.reason))
        .filter(({ paper }) => paper.title.toLowerCase().includes(query.trim().toLowerCase())),
    [nodes, req, resolver, query],
  );
  const [chosen, setChosen] = useState<string | null>(() => candidates.find((c) => !c.reason)?.paper.id ?? null);
  const target = nodes.find((p) => p.id === chosen);
  const [slidesWhere, setSlidesWhere] = useState<'new-slide' | 'last-slide'>('new-slide');
  const [docWhere, setDocWhere] = useState<'end' | 'start'>('end');
  const [carries, setCarries] = useState<Carries>('chart');
  const [busy, setBusy] = useState(false);
  const close = () => resolver.setUi({ dialog: null });
  const sourceTitle = (store.node(req.sourcePaperId) as Paper | undefined)?.title ?? 'le tableur';

  const submit = async () => {
    if (!target || busy) return;
    const placement: Placement = target.kind === 'slides' ? { kind: 'slides', where: slidesWhere } : { kind: 'document', where: docWhere };
    setBusy(true);
    try {
      const made = await resolver.createLink(req, target.id, placement, carries);
      close();
      if (made)
        toast({
          title: `« ${req.name} » lié dans « ${target.title} » · ${made.where}`,
          description: 'La copie suit le tableur. Vous pourrez la figer ensuite.',
          tone: 'success',
          action: { label: 'Annuler', onAction: () => resolver.undoCreate(made.linkId) },
        });
    } catch (e) {
      toast({ title: 'Lien impossible', description: (e as Error).message, tone: 'warning' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogOverlay isOpen onOpenChange={(o) => !o && close()}>
      <SheetDialog
        title={`Lier « ${req.name} » dans…`}
        width={520}
        actions={(c) => (
          <>
            <Button variant="ghost" onPress={c}>
              Annuler
            </Button>
            <Button leadingIcon="link" isDisabled={!target || !!resolver.refusal(req, target) || busy} onPress={() => void submit()}>
              Lier
            </Button>
          </>
        )}
      >
        <p className="oel-links__hint">La copie suivra « {sourceTitle} ». Vous pourrez la figer ensuite.</p>
        <TextField aria-label="Rechercher un fichier du bureau" placeholder="Rechercher un fichier du bureau" value={query} onChange={setQuery} />
        <ul className="oel-links__pick" role="listbox" aria-label="Fichiers du bureau">
          {candidates.map(({ paper, reason }) => (
            <li
              key={paper.id}
              role="option"
              aria-selected={chosen === paper.id}
              aria-disabled={!!reason}
              tabIndex={chosen === paper.id || (!chosen && !reason) ? 0 : -1}
              className="oel-links__pick-item"
              data-selected={chosen === paper.id || undefined}
              onClick={() => !reason && setChosen(paper.id)}
              onKeyDown={(e) => {
                const items = [...e.currentTarget.parentElement!.querySelectorAll<HTMLElement>('[role=option]:not([aria-disabled=true])')];
                const i = items.indexOf(e.currentTarget);
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  const next = items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
                  next?.focus();
                  next?.click();
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  void submit();
                }
              }}
            >
              <Icon name={KIND_ICON[paper.kind]} size={18} aria-hidden />
              <span>
                <strong>{paper.title}</strong>
                <small>{reason ?? kindLabel(paper.kind)}</small>
              </span>
            </li>
          ))}
        </ul>
        {target && TARGET_KINDS.has(target.kind) && (
          <>
            {target.kind === 'slides' ? (
              <RadioGroup label={`Emplacement dans « ${target.title} »`} value={slidesWhere} onChange={(v) => setSlidesWhere(v as typeof slidesWhere)} orientation="horizontal">
                <Radio value="new-slide">Nouvelle diapositive à la fin</Radio>
                <Radio value="last-slide">Sur la dernière diapositive</Radio>
              </RadioGroup>
            ) : (
              <RadioGroup label={`Emplacement dans « ${target.title} »`} value={docWhere} onChange={(v) => setDocWhere(v as typeof docWhere)} orientation="horizontal">
                <Radio value="end">À la fin</Radio>
                <Radio value="start">Au début</Radio>
              </RadioGroup>
            )}
            <RadioGroup label="Style" value={carries} onChange={(v) => setCarries(v as Carries)}>
              <Radio value="chart">Garder le style du tableur (suit la source)</Radio>
              <Radio value="chart-data">Garder le style de la copie (seules les données suivent)</Radio>
            </RadioGroup>
          </>
        )}
      </SheetDialog>
    </DialogOverlay>
  );
}

// ---------------------------------------------------------------------------
// G6 · « Fils du bureau »
// ---------------------------------------------------------------------------

type Filter = 'all' | 'stale' | 'frozen' | 'broken';
const FILTERS: Array<{ id: Filter; label: string; match: (s: LinkState) => boolean }> = [
  { id: 'all', label: 'Tous', match: () => true },
  { id: 'stale', label: 'En retard', match: (s) => s === 'stale' },
  { id: 'frozen', label: 'Figés', match: (s) => s === 'frozen' },
  { id: 'broken', label: 'Rompus', match: (s) => s === 'broken' },
];

function LinksPanel({ resolver, store, onCut }: { resolver: LinkResolver; store: Bureau; onCut: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const showLinks = useDeskState(store, (s) => s.showLinks);
  const all = resolver.all();
  const shown = all.filter((l) => FILTERS.find((f) => f.id === filter)!.match(l.state));
  const stale = all.filter((l) => l.state === 'stale').length;
  const close = () => resolver.setUi({ panel: false });
  return (
    <aside className="oel-links__panel" aria-labelledby="oel-links-panel-h" data-desk-ui onKeyDown={(e) => e.key === 'Escape' && close()}>
      <header className="oel-links__panel-head">
        <h2 id="oel-links-panel-h">Fils du bureau</h2>
        <Button size="sm" variant="secondary" leadingIcon="refresh" isDisabled={!stale} onPress={() => resolver.updateAll()}>
          Tout mettre à jour
        </Button>
        <Button size="icon-sm" variant="ghost" leadingIcon="close" aria-label="Fermer le panneau Fils" onPress={close} />
      </header>
      <Tabs selectedKey={filter} onSelectionChange={(k) => setFilter(k as Filter)}>
        <TabList aria-label="Filtrer les fils">
          {FILTERS.map((f) => (
            <Tab key={f.id} id={f.id}>
              {`${f.label} · ${all.filter((l) => f.match(l.state)).length}`}
            </Tab>
          ))}
        </TabList>
      </Tabs>
      {shown.length === 0 ? (
        <p className="oel-links__empty">
          {all.length === 0 ? 'Aucun fil pour l’instant. Sélectionnez un graphique dans un tableur, puis « Lier dans… ».' : 'Aucun fil dans ce filtre.'}
        </p>
      ) : (
        <ul className="oel-links__list">
          {shown.map((l) => (
            <li key={l.def.id}>
              <button
                type="button"
                className="oel-links__item"
                onClick={(e) => {
                  if (l.targetPaper) store.zoomToFit([l.targetPaper.id, ...(l.sourcePaper ? [l.sourcePaper.id] : [])]);
                  const r = e.currentTarget.getBoundingClientRect();
                  resolver.manage(l.def.id, { x: r.x, y: r.y, width: r.width, height: r.height });
                }}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    resolver.update(l.def.id);
                  } else if (e.key === 'Delete' || e.key === 'Backspace') {
                    e.preventDefault();
                    onCut(l.def.id);
                  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const items = [...e.currentTarget.closest('ul')!.querySelectorAll<HTMLElement>('.oel-links__item')];
                    const i = items.indexOf(e.currentTarget);
                    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
                  }
                }}
              >
                <span className="oel-links__item-src">
                  <Icon name="table" size={14} aria-hidden /> {l.def.source.title} › {l.def.source.label}
                </span>
                <span className="oel-links__item-dst">
                  <Icon name="arrow-right" size={14} aria-label="vers" /> <Icon name={l.targetPaper ? KIND_ICON[l.targetPaper.kind] : 'file'} size={14} aria-hidden /> {l.targetPaper?.title ?? 'Fichier'} · {l.def.target.label} · graphique
                </span>
                <span className="oel-links__item-state">
                  <Badge tone={TONE[l.state]} appearance="tinted">
                    {STATE_LABEL[l.state]}
                  </Badge>
                  <small>
                    {MODE_LABEL[l.def.mode]}
                    {l.state === 'stale' ? ` · source modifiée` : l.state === 'frozen' ? ` · le ${shortDate(l.def.snapshot.at)}` : ''}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Switch isSelected={showLinks} onChange={(v) => store.toggleLinks(v)}>
        Afficher les fils sur le bureau
      </Switch>
      <p className="oel-links__foot">Clavier : ↑↓ parcourt, Entrée ouvre le fil, Ctrl + Entrée « Mettre à jour », Suppr « Couper le lien ». Ctrl + Maj + L ouvre ou ferme ce panneau.</p>
    </aside>
  );
}
