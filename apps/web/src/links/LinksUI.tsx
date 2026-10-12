/**
 * The faces of links on the desk (Figma G): « Lier dans… » (G2 step 2), the
 * thread popover (G3), « Couper le lien ? », and the « Fils du bureau » panel
 * (G6) — also the screen-reader route, since drawn threads are decorative.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Dialog, Heading } from 'react-aria-components';
import { Badge, Button, DialogOverlay, Icon, Popover, Radio, RadioGroup, Select, SelectItem, SheetDialog, Switch, Tab, TabList, Tabs, TextField, toast, type IconName, type Tone } from '@oel/emboss';
import { CARRIES_LABEL, MODE_HINT, MODE_LABEL, STATE_LABEL, THEME_LABEL, ago, fullLabel, shortDate, type Carries, type LinkMode, type LinkState, type LinkTheme } from '@oel/links';
import { useDeskState } from '@oel/desk/react';
import { KIND_ICON, kindLabel, type Bureau, type Paper } from '../bureau/model';
import { TARGET_KINDS, type LinkResolver, type Placement, type SendChoice } from './resolver';
import { features } from '../edition';
import './links.css';
import { messages, plural } from '@oel/i18n';

const t = messages(
  {
    cutTitle: 'Couper le lien ?',
    cancel: 'Annuler',
    cut: 'Couper le lien',
    cutBody: 'La copie garde sa dernière image et ne suivra plus la source. Vous pourrez la relier plus tard en la liant de nouveau.',
    fresh: (ago: string, by: string | null) => `À jour · mis à jour ${ago}${by ? ` (${by})` : ''}`,
    updating: 'Mise à jour…',
    stale: (ago: string) => `En retard · la source a changé depuis la dernière mise à jour (${ago})`,
    frozen: (date: string) => `Figé le ${date} · la copie ne changera plus`,
    broken: 'Rompu · la source a été supprimée ; la copie garde sa dernière valeur',
    frozenShort: 'Figé',
    waiting: 'En attente de la source (pas encore lue, ou hors du bureau)',
    kindWord: { chart: 'graphique', range: 'tableau', cell: 'valeur', image: 'image' } as Record<string, string>,
    thread: 'Fil de liaison',
    close: 'Fermer',
    copy: 'Copie',
    to: 'vers',
    mode: 'Mode du lien',
    carries: 'Transporte',
    formatting: 'Mise en forme',
    localEdits: (n: number) => `Modifications locales (${n})`,
    applyToSource: 'Appliquer à la source',
    undoEdit: (label: string) => `Annuler : ${label}`,
    editsHint: 'Restent propres à cette copie ; les valeurs, elles, viennent toujours de la source.',
    update: 'Mettre à jour',
    openSource: 'Ouvrir la source',
    openCopy: 'Ouvrir la copie',
    upToDate: '« Mettre à jour » est grisé : déjà à jour. ',
    sourceAway: 'La source n’est pas sur ce bureau. ',
    cutKeeps: '« Couper le lien » garde la copie telle quelle.',
    theImage: 'l’image',
    theSheet: 'le tableur',
    linked: (name: string, target: string, where: string) => `« ${name} » lié dans « ${target} » · ${where}`,
    followsImage: 'La copie suit l’image du bureau. Vous pourrez la figer ensuite.',
    followsSheet: 'La copie suit le tableur. Vous pourrez la figer ensuite.',
    linkFailed: 'Lien impossible',
    linkInto: (name: string) => `Lier « ${name} » dans…`,
    link: 'Lier',
    willFollow: (source: string) => `La copie suivra « ${source} ». Vous pourrez la figer ensuite.`,
    search: 'Rechercher un fichier du bureau',
    deskFiles: 'Fichiers du bureau',
    placeIn: (title: string) => `Emplacement dans « ${title} »`,
    newSlide: 'Nouvelle diapositive à la fin',
    lastSlide: 'Sur la dernière diapositive',
    atEnd: 'À la fin',
    atStart: 'Au début',
    sheetTheme: 'Thème du tableur (polices, couleurs, remplissages)',
    targetTheme: (slides: boolean) => `Thème du ${slides ? 'diaporama' : 'document'}`,
    style: 'Style',
    keepSheetStyle: 'Garder le style du tableur (suit la source)',
    keepCopyStyle: 'Garder le style de la copie (seules les données suivent)',
    filters: { all: 'Tous', stale: 'En retard', frozen: 'Figés', broken: 'Rompus' },
    deskThreads: 'Fils du bureau',
    updateAll: 'Tout mettre à jour',
    closePanel: 'Fermer le panneau Fils',
    filter: 'Filtrer les fils',
    none: 'Aucun fil pour l’instant. Sélectionnez un graphique dans un tableur, puis « Lier dans… ».',
    noneInFilter: 'Aucun fil dans ce filtre.',
    file: 'Fichier',
    chart: 'graphique',
    sourceChanged: ' · source modifiée',
    on: (date: string) => ` · le ${date}`,
    showThreads: 'Afficher les fils sur le bureau',
    keys: 'Clavier : ↑↓ parcourt, Entrée ouvre le fil, Ctrl + Entrée « Mettre à jour », Suppr « Couper le lien ». Ctrl + Maj + L ouvre ou ferme ce panneau.',
    sent: (title: string) => `Tableau envoyé vers « ${title} »`,
    sentLinked: 'Le document suit maintenant le tableur.',
    sentCopy: 'Copie simple : le tableau et la plage vivent chacun de leur côté.',
    sendFailed: 'Envoi impossible',
    sendTitle: 'Envoyer le tableau vers un tableur',
    send: 'Envoyer',
    size: (rows: number, cols: number, from: string | null) =>
      `${rows} ${plural(rows, 'ligne', 'lignes')} × ${cols} ${plural(cols, 'colonne', 'colonnes')}${from ? ` depuis « ${from} »` : ''}. Les nombres écrits à la québécoise (« 1 240 000 $ ») deviennent de vrais nombres.`,
    workbook: 'Classeur',
    newWorkbook: 'Nouveau classeur, posé sur le bureau à côté du fichier',
    newSheet: 'Nouvelle feuille dans un classeur du bureau',
    then: 'Ensuite',
    sheetLeads: 'Le tableur commande (recommandé) : ce tableau devient une copie liée de la plage',
    plainCopy: 'Copie simple : aucun lien',
    lossy: (n: number) => `${n} ${plural(n, 'cellule contient', 'cellules contiennent')} une image ou une liste : seul leur texte partira.`,
  },
  {
    cutTitle: 'Cut the link?',
    cancel: 'Cancel',
    cut: 'Cut the link',
    cutBody: 'The copy keeps its last picture and will no longer follow the source. You can link it again later.',
    fresh: (ago, by) => `Up to date · updated ${ago}${by ? ` (${by})` : ''}`,
    updating: 'Updating…',
    stale: (ago) => `Out of date · the source changed since the last update (${ago})`,
    frozen: (date) => `Frozen on ${date} · the copy won’t change any more`,
    broken: 'Broken · the source was deleted; the copy keeps its last value',
    frozenShort: 'Frozen',
    waiting: 'Waiting for the source (not read yet, or not on the desk)',
    kindWord: { chart: 'chart', range: 'table', cell: 'value', image: 'image' },
    thread: 'Link thread',
    close: 'Close',
    copy: 'Copy',
    to: 'to',
    mode: 'Link mode',
    carries: 'Carries',
    formatting: 'Formatting',
    localEdits: (n) => `Local edits (${n})`,
    applyToSource: 'Apply to the source',
    undoEdit: (label) => `Undo: ${label}`,
    editsHint: 'They stay with this copy; the values always come from the source.',
    update: 'Update',
    openSource: 'Open the source',
    openCopy: 'Open the copy',
    upToDate: '“Update” is greyed out: already up to date. ',
    sourceAway: 'The source is not on this desk. ',
    cutKeeps: '“Cut the link” keeps the copy as it is.',
    theImage: 'the image',
    theSheet: 'the spreadsheet',
    linked: (name, target, where) => `“${name}” linked into “${target}” · ${where}`,
    followsImage: 'The copy follows the image on the desk. You can freeze it later.',
    followsSheet: 'The copy follows the spreadsheet. You can freeze it later.',
    linkFailed: 'Could not link',
    linkInto: (name) => `Link “${name}” into…`,
    link: 'Link',
    willFollow: (source) => `The copy will follow “${source}”. You can freeze it later.`,
    search: 'Search for a file on the desk',
    deskFiles: 'Files on the desk',
    placeIn: (title) => `Place in “${title}”`,
    newSlide: 'New slide at the end',
    lastSlide: 'On the last slide',
    atEnd: 'At the end',
    atStart: 'At the start',
    sheetTheme: 'Spreadsheet theme (fonts, colours, fills)',
    targetTheme: (slides) => `${slides ? 'Slideshow' : 'Document'} theme`,
    style: 'Style',
    keepSheetStyle: 'Keep the spreadsheet’s style (follows the source)',
    keepCopyStyle: 'Keep the copy’s style (only the data follows)',
    filters: { all: 'All', stale: 'Out of date', frozen: 'Frozen', broken: 'Broken' },
    deskThreads: 'Desk threads',
    updateAll: 'Update all',
    closePanel: 'Close the Threads panel',
    filter: 'Filter the threads',
    none: 'No threads yet. Select a chart in a spreadsheet, then “Link into…”.',
    noneInFilter: 'No threads in this filter.',
    file: 'File',
    chart: 'chart',
    sourceChanged: ' · source changed',
    on: (date) => ` · on ${date}`,
    showThreads: 'Show threads on the desk',
    keys: 'Keyboard: ↑↓ browses, Enter opens the thread, Ctrl + Enter “Update”, Delete “Cut the link”. Ctrl + Shift + L opens or closes this panel.',
    sent: (title) => `Table sent to “${title}”`,
    sentLinked: 'The document now follows the spreadsheet.',
    sentCopy: 'Plain copy: the table and the range each live their own life.',
    sendFailed: 'Could not send',
    sendTitle: 'Send the table to a spreadsheet',
    send: 'Send',
    size: (rows, cols, from) =>
      `${rows} ${plural(rows, 'row', 'rows')} × ${cols} ${plural(cols, 'column', 'columns')}${from ? ` from “${from}”` : ''}. Numbers written the Québec way (“1 240 000 $”) become real numbers.`,
    workbook: 'Workbook',
    newWorkbook: 'New workbook, laid on the desk next to the file',
    newSheet: 'New sheet in a workbook on the desk',
    then: 'Then',
    sheetLeads: 'The spreadsheet leads (recommended): this table becomes a linked copy of the range',
    plainCopy: 'Plain copy: no link',
    lossy: (n) => `${n} ${plural(n, 'cell holds', 'cells hold')} an image or a list: only their text will go.`,
  },
);

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
      {ui.send && <SendDialog resolver={resolver} store={store} />}
      {ui.panel && <LinksPanel resolver={resolver} store={store} onCut={setConfirm} />}
      <DialogOverlay isOpen={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <SheetDialog
          title={t.cutTitle}
          tone="destructive"
          actions={(close) => (
            <>
              <Button variant="ghost" onPress={close}>
                {t.cancel}
              </Button>
              <Button
                variant="destructive"
                leadingIcon="link-off"
                onPress={() => {
                  if (confirm) resolver.unlink(confirm);
                  close();
                }}
              >
                {t.cut}
              </Button>
            </>
          )}
        >
          <p>{t.cutBody}</p>
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
      // Single user: no one else to name.
      return t.fresh(ago(at), features.collab ? by : null);
    case 'updating':
      return t.updating;
    case 'stale':
      return t.stale(ago(at));
    case 'frozen':
      return t.frozen(shortDate(at));
    case 'broken':
      return t.broken;
    default:
      return mode === 'frozen' ? t.frozenShort : t.waiting;
  }
}

/** What a link points at, in words (route card). */
const KIND_WORD: Record<string, string> = t.kindWord;

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
                {t.thread}
              </Heading>
              <Button size="icon-sm" variant="ghost" leadingIcon="close" aria-label={t.close} onPress={close} />
            </header>
            <p className="oel-links__flow">{fullLabel(def, l.targetPaper?.title ?? t.copy)}</p>
            <div className="oel-links__route">
              <FileCard paper={l.sourcePaper} fallback={def.source.title} sub={`${def.source.label} · ${KIND_WORD[def.source.ref.kind]}`} />
              <Icon name="arrow-right" size={16} aria-label={t.to} />
              <FileCard paper={l.targetPaper} fallback={t.copy} sub={def.target.label} />
            </div>
            <Tabs selectedKey={def.mode} onSelectionChange={(k) => resolver.setMode(linkId, k as LinkMode)}>
              <TabList aria-label={t.mode} className="oel-links__modes">
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
            {(def.carries === 'chart' || def.carries === 'chart-data') && (
              <div className="oel-links__row">
                <span className="oel-links__label" id={`${linkId}-c`}>
                  {t.carries}
                </span>
                <Select aria-labelledby={`${linkId}-c`} selectedKey={def.carries} onSelectionChange={(k) => resolver.setCarries(linkId, k as Carries)}>
                  {(['chart', 'chart-data'] as const).map((c) => (
                    <SelectItem key={c} id={c}>
                      {CARRIES_LABEL[c]}
                    </SelectItem>
                  ))}
                </Select>
              </div>
            )}
            {def.carries === 'table' && (
              <div className="oel-links__row">
                <span className="oel-links__label" id={`${linkId}-t`}>
                  {t.formatting}
                </span>
                <Select aria-labelledby={`${linkId}-t`} selectedKey={def.theme ?? 'source'} onSelectionChange={(k) => resolver.setLinkOptions(linkId, { theme: k as LinkTheme })}>
                  {(['source', 'target'] as const).map((th) => (
                    <SelectItem key={th} id={th}>
                      {THEME_LABEL[th]}
                    </SelectItem>
                  ))}
                </Select>
              </div>
            )}
            {!!def.edits?.length && (
              <section className="oel-links__edits" aria-labelledby={`${linkId}-e`}>
                <p className="oel-links__label" id={`${linkId}-e`}>
                  {t.localEdits(def.edits.length)}
                </p>
                <ul>
                  {def.edits.map((e) => (
                    <li key={e.id} className="oel-links__edit">
                      <Icon name="pen" size={14} aria-hidden />
                      <span>
                        <strong>{e.label}</strong>
                        <small>
                          {features.collab ? `${e.by} · ${ago(e.at)}` : ago(e.at)}
                        </small>
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        isDisabled={!resolver.canApplyToSource(linkId)}
                        onPress={() => resolver.applyEditToSource(linkId, e.id)}
                      >
                        {t.applyToSource}
                      </Button>
                      <Button size="icon-sm" variant="ghost" leadingIcon="undo" aria-label={t.undoEdit(e.label)} onPress={() => resolver.removeEdit(linkId, e.id)} />
                    </li>
                  ))}
                </ul>
                <p className="oel-links__hint">{t.editsHint}</p>
              </section>
            )}
            <div className="oel-links__actions">
              <Button variant="secondary" size="sm" leadingIcon="refresh" isDisabled={!canUpdate} onPress={() => resolver.update(linkId)}>
                {t.update}
              </Button>
              <Button variant="ghost" size="sm" leadingIcon="table" isDisabled={!l.sourcePaper} onPress={() => (close(), resolver.openSource(linkId))}>
                {t.openSource}
              </Button>
              <Button variant="ghost" size="sm" leadingIcon={l.targetPaper?.kind === 'slides' ? 'slide' : 'file'} isDisabled={!l.targetPaper} onPress={() => (close(), resolver.openTarget(linkId))}>
                {t.openCopy}
              </Button>
            </div>
            <div className="oel-links__actions oel-links__actions--end">
              <Button variant="ghost" size="sm" leadingIcon="link-off" className="oel-links__cut" onPress={() => (close(), onCut(linkId))}>
                {t.cut}
              </Button>
            </div>
            <p className="oel-links__foot">
              {!canUpdate && def.mode !== 'frozen' ? t.upToDate : ''}
              {!l.sourcePaper ? t.sourceAway : ''}
              {t.cutKeeps}
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
  const sourceTitle = (store.node(req.sourcePaperId) as Paper | undefined)?.title ?? (req.kind === 'image' ? t.theImage : t.theSheet);

  const submit = async () => {
    if (!target || busy) return;
    const placement: Placement = target.kind === 'slides' ? { kind: 'slides', where: slidesWhere } : { kind: 'document', where: docWhere };
    setBusy(true);
    try {
      const made = await resolver.createLink(req, target.id, placement, carries);
      close();
      if (made)
        toast({
          title: t.linked(req.name, target.title, made.where),
          description: req.kind === 'image' ? t.followsImage : t.followsSheet,
          tone: 'success',
          action: { label: t.cancel, onAction: () => resolver.undoCreate(made.linkId) },
        });
    } catch (e) {
      toast({ title: t.linkFailed, description: (e as Error).message, tone: 'warning' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogOverlay isOpen onOpenChange={(o) => !o && close()}>
      <SheetDialog
        title={t.linkInto(req.name)}
        width={520}
        actions={(c) => (
          <>
            <Button variant="ghost" onPress={c}>
              {t.cancel}
            </Button>
            <Button leadingIcon="link" isDisabled={!target || !!resolver.refusal(req, target) || busy} onPress={() => void submit()}>
              {t.link}
            </Button>
          </>
        )}
      >
        <p className="oel-links__hint">{t.willFollow(sourceTitle)}</p>
        <TextField aria-label={t.search} placeholder={t.search} value={query} onChange={setQuery} />
        <ul className="oel-links__pick" role="listbox" aria-label={t.deskFiles}>
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
              <RadioGroup label={t.placeIn(target.title)} value={slidesWhere} onChange={(v) => setSlidesWhere(v as typeof slidesWhere)} orientation="horizontal">
                <Radio value="new-slide">{t.newSlide}</Radio>
                <Radio value="last-slide">{t.lastSlide}</Radio>
              </RadioGroup>
            ) : (
              <RadioGroup label={t.placeIn(target.title)} value={docWhere} onChange={(v) => setDocWhere(v as typeof docWhere)} orientation="horizontal">
                <Radio value="end">{t.atEnd}</Radio>
                <Radio value="start">{t.atStart}</Radio>
              </RadioGroup>
            )}
            {req.kind === 'range' && (
              <RadioGroup label={t.formatting} value={carries} onChange={(v) => setCarries(v as Carries)}>
                <Radio value="chart">{t.sheetTheme}</Radio>
                <Radio value="chart-data">{t.targetTheme(target.kind === 'slides')}</Radio>
              </RadioGroup>
            )}
            {req.kind !== 'image' && req.kind !== 'range' && (
              <RadioGroup label={t.style} value={carries} onChange={(v) => setCarries(v as Carries)}>
                <Radio value="chart">{t.keepSheetStyle}</Radio>
                <Radio value="chart-data">{t.keepCopyStyle}</Radio>
              </RadioGroup>
            )}
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
  { id: 'all', label: t.filters.all, match: () => true },
  { id: 'stale', label: t.filters.stale, match: (s) => s === 'stale' },
  { id: 'frozen', label: t.filters.frozen, match: (s) => s === 'frozen' },
  { id: 'broken', label: t.filters.broken, match: (s) => s === 'broken' },
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
        <h2 id="oel-links-panel-h">{t.deskThreads}</h2>
        <Button size="sm" variant="secondary" leadingIcon="refresh" isDisabled={!stale} onPress={() => resolver.updateAll()}>
          {t.updateAll}
        </Button>
        <Button size="icon-sm" variant="ghost" leadingIcon="close" aria-label={t.closePanel} onPress={close} />
      </header>
      <Tabs selectedKey={filter} onSelectionChange={(k) => setFilter(k as Filter)}>
        <TabList aria-label={t.filter}>
          {FILTERS.map((f) => (
            <Tab key={f.id} id={f.id}>
              {`${f.label} · ${all.filter((l) => f.match(l.state)).length}`}
            </Tab>
          ))}
        </TabList>
      </Tabs>
      {shown.length === 0 ? (
        <p className="oel-links__empty">
          {all.length === 0 ? t.none : t.noneInFilter}
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
                  <Icon name="arrow-right" size={14} aria-label={t.to} /> <Icon name={l.targetPaper ? KIND_ICON[l.targetPaper.kind] : 'file'} size={14} aria-hidden /> {l.targetPaper?.title ?? t.file} · {l.def.target.label} · {t.chart}
                </span>
                <span className="oel-links__item-state">
                  <Badge tone={TONE[l.state]} appearance="tinted">
                    {STATE_LABEL[l.state]}
                  </Badge>
                  <small>
                    {MODE_LABEL[l.def.mode]}
                    {l.state === 'stale' ? t.sourceChanged : l.state === 'frozen' ? t.on(shortDate(l.def.snapshot.at)) : ''}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Switch isSelected={showLinks} onChange={(v) => store.toggleLinks(v)}>
        {t.showThreads}
      </Switch>
      <p className="oel-links__foot">{t.keys}</p>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// I3 · « Envoyer vers un tableur… »
// ---------------------------------------------------------------------------

function SendDialog({ resolver, store }: { resolver: LinkResolver; store: Bureau }) {
  const req = resolver.ui.send!;
  const order = useDeskState(store, (s) => s.order);
  const nodeMap = useDeskState(store, (s) => s.nodes);
  const workbooks = useMemo(() => order.map((id) => nodeMap[id] as Paper | undefined).filter((p): p is Paper => p?.kind === 'spreadsheet'), [order, nodeMap]);
  const [where, setWhere] = useState<'new' | 'existing'>('new');
  const [paperId, setPaperId] = useState<string | null>(workbooks[0]?.id ?? null);
  const [linked, setLinked] = useState(true);
  const [busy, setBusy] = useState(false);
  const close = () => resolver.setUi({ send: null });
  const from = useMemo(() => order.map((id) => nodeMap[id] as Paper | undefined).find((p) => p?.data.docId === req.docId), [order, nodeMap, req.docId]);
  const rows = req.table.rows.length;
  const cols = req.table.rows[0]?.length ?? 0;
  const submit = async () => {
    if (busy) return;
    const choice: SendChoice = { workbook: where === 'existing' && paperId ? { kind: 'existing', paperId } : { kind: 'new' }, linked };
    setBusy(true);
    try {
      const done = await resolver.sendTable(req, choice);
      close();
      toast({
        title: t.sent(done.title),
        description: linked ? t.sentLinked : t.sentCopy,
        tone: 'success',
        action: { label: t.cancel, onAction: done.undo },
      });
    } catch (e) {
      toast({ title: t.sendFailed, description: (e as Error).message, tone: 'warning' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogOverlay isOpen onOpenChange={(o) => !o && close()}>
      <SheetDialog
        title={t.sendTitle}
        width={480}
        actions={(c) => (
          <>
            <Button variant="ghost" onPress={c}>
              {t.cancel}
            </Button>
            <Button leadingIcon="table" isDisabled={busy || (where === 'existing' && !paperId)} onPress={() => void submit()}>
              {t.send}
            </Button>
          </>
        )}
      >
        <p className="oel-links__hint">
          {t.size(rows, cols, from?.title ?? null)}
        </p>
        <RadioGroup label={t.workbook} value={where} onChange={(v) => setWhere(v as typeof where)}>
          <Radio value="new">{t.newWorkbook}</Radio>
          <Radio value="existing" isDisabled={!workbooks.length}>
            {t.newSheet}
          </Radio>
        </RadioGroup>
        {where === 'existing' && (
          <Select label={t.workbook} selectedKey={paperId} onSelectionChange={(k) => setPaperId(String(k))}>
            {workbooks.map((w) => (
              <SelectItem key={w.id} id={w.id}>
                {w.title}
              </SelectItem>
            ))}
          </Select>
        )}
        <RadioGroup label={t.then} value={linked ? 'linked' : 'copy'} onChange={(v) => setLinked(v === 'linked')}>
          <Radio value="linked">{t.sheetLeads}</Radio>
          <Radio value="copy">{t.plainCopy}</Radio>
        </RadioGroup>
        {req.lossy > 0 && (
          <p className="oel-links__warn" role="note">
            <Icon name="alert" size={14} aria-hidden /> {t.lossy(req.lossy)}
          </p>
        )}
      </SheetDialog>
    </DialogOverlay>
  );
}
