import type { ReactNode } from 'react';
import { Dialog, DialogTrigger, MenuTrigger } from 'react-aria-components';
import { AdaptiveToolbar, Menu, MenuItem, MenuPopover, MenuSeparator, Popover, Select, SelectItem, ToolbarToggle, ToolButton, type ToolGroup } from '@oel/emboss';
import { NUMBER_FORMATS, type SheetController } from './controller';
import { tr } from '@oel/i18n';

export const ZOOMS = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2];
export const FONTS = ['Calibri', 'Arial', 'Aptos', 'Cambria', 'Times New Roman', 'Courier New', 'Verdana', 'Georgia', 'Montserrat'];
export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36];

const TEXT_COLORS = ['#000000', '#434343', '#666666', '#999999', '#C00000', '#E26B0A', '#B7950B', '#1E7B34', '#1F6F5C', '#1F4E79', '#5B3FD6', '#7030A0'];
const FILL_COLORS = ['#F2F2F2', '#D9D9D9', '#FCE4D6', '#FFF2CC', '#E2EFDA', '#DDEBF7', '#E4DFEC', '#FFC7CE', '#FFEB9C', '#C6EFCE', '#BDD7EE', '#1F6F5C'];

function Swatches({ colors, onPick, none }: { colors: string[]; onPick: (c: string | null) => void; none: string }) {
  return (
    <div className="oel-swatches">
      <button type="button" className="oel-swatch oel-swatch--none" onClick={() => onPick(null)}>
        {none}
      </button>
      <div className="oel-swatches__grid" role="group" aria-label={tr('Couleurs', 'Colours')}>
        {colors.map((c) => (
          <button key={c} type="button" className="oel-swatch" style={{ background: c }} aria-label={c} title={c} onClick={() => onPick(c)} />
        ))}
      </div>
      <label className="oel-swatches__custom">
        {tr('Personnalisée', 'Custom')} <input type="color" onChange={(e) => onPick(e.target.value.toUpperCase())} />
      </label>
    </div>
  );
}

function ColorTool({ icon, label, colors, none, current, onPick, ro }: { icon: 'text-color' | 'fill-color'; label: string; colors: string[]; none: string; current?: string; onPick: (c: string | null) => void; ro?: string }) {
  return (
    <DialogTrigger>
      <ToolButton icon={icon} label={label} unavailableReason={ro} value={<span className="oel-colorbar" style={{ background: current ?? (icon === 'text-color' ? '#000' : 'transparent') }} />} />
      <Popover placement="bottom">
        <Dialog className="oel-popover-dialog" aria-label={label}>
          {({ close }) => <Swatches colors={colors} none={none} onPick={(c) => (onPick(c), close())} />}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

function MenuTool({ icon, label, items, onAction, ro, description }: { icon: Parameters<typeof ToolButton>[0]['icon']; label: string; items: Array<{ id: string; label: string } | '-'>; onAction: (id: string) => void; ro?: string; description?: string }) {
  return (
    <MenuTrigger>
      <ToolButton icon={icon} label={label} unavailableReason={ro} description={description} />
      <MenuPopover placement="bottom start">
        <Menu aria-label={label} onAction={(k) => onAction(String(k))}>
          {items.map((it, i) => (it === '-' ? <MenuSeparator key={`s${i}`} /> : <MenuItem key={it.id} id={it.id}>{it.label}</MenuItem>))}
        </Menu>
      </MenuPopover>
    </MenuTrigger>
  );
}

export function SheetsToolbar({ ctl, onCommand, more, dock, storageKey }: { ctl: SheetController; onCommand: (id: string) => void; more?: ReactNode; dock: { docked: boolean; forced: boolean; setDocked: (d: boolean) => void }; storageKey: string }) {
  const st = ctl.activeStyle;
  const ro = ctl.readOnlyFlag ? tr('Lecture seule', 'Read-only') : undefined;
  const fmtId = NUMBER_FORMATS.find((f) => f.code === st.numFmt)?.id ?? 'custom';
  // Groups and priorities from Figma J4: 1 never folds, 5 folds first. Zoom is in the sheet bar, printing in Fichier.
  const groups: ToolGroup[] = [
    {
      id: 'history',
      label: tr('Historique', 'History'),
      priority: 1,
      content: (
        <>
          <ToolButton icon="undo" label={tr('Annuler', 'Undo')} shortcut={['Ctrl', 'Z']} unavailableReason={ro} onPress={() => ctl.undo.undo()} />
          <ToolButton icon="redo" label={tr('Rétablir', 'Redo')} shortcut={['Ctrl', 'Y']} unavailableReason={ro} onPress={() => ctl.undo.redo()} />
        </>
      ),
    },
    {
      id: 'number',
      label: tr('Nombre', 'Number'),
      priority: 2,
      content: (
        <>
      <div className="oel-toolbar__select oel-toolbar__select--numfmt">
        <Select aria-label={tr('Format des nombres', 'Number format')} isDisabled={!!ro} selectedKey={fmtId} onSelectionChange={(k) => (k === 'custom' ? onCommand('format-cells') : ctl.setNumFmt(NUMBER_FORMATS.find((f) => f.id === k)!.code))}>
          {[
            ...NUMBER_FORMATS.map((f) => (
              <SelectItem key={f.id} id={f.id} textValue={f.label}>
                <span className="oel-numfmt">
                  <span>{f.label}</span>
                  <span className="oel-numfmt__ex">{f.example}</span>
                </span>
              </SelectItem>
            )),
            <SelectItem key="custom" id="custom" textValue={tr('Personnalisé', 'Custom')}>
              {tr('Personnalisé…', 'Custom…')}
            </SelectItem>,
          ]}
        </Select>
      </div>
          <ToolButton icon="currency" label={tr('Format monétaire', 'Currency format')} description="1 234,50 $" unavailableReason={ro} onPress={() => ctl.setNumFmt('#,##0.00 "$"')} />
          <ToolButton icon="percent" label={tr('Pourcentage', 'Percent')} unavailableReason={ro} onPress={() => ctl.setNumFmt('0%')} />
          <ToolButton icon="minus" label={tr('Réduire les décimales', 'Fewer decimals')} unavailableReason={ro} onPress={() => ctl.stepDecimals(-1)} />
          <ToolButton icon="plus" label={tr('Ajouter une décimale', 'More decimals')} unavailableReason={ro} onPress={() => ctl.stepDecimals(1)} />
        </>
      ),
    },
    { id: 'font', label: tr('Police', 'Font'), priority: 3, content: <>
      <div className="oel-toolbar__select oel-toolbar__select--font">
        <Select aria-label={tr('Police', 'Font')} isDisabled={!!ro} selectedKey={st.font.name ?? 'Calibri'} onSelectionChange={(k) => ctl.setFont({ name: String(k) })}>
          {[...new Set([...(st.font.name ? [st.font.name] : []), ...FONTS])].map((f) => (
            <SelectItem key={f} id={f}>
              <span style={{ fontFamily: `"${f}"` }}>{f}</span>
            </SelectItem>
          ))}
        </Select>
      </div>
      <div className="oel-toolbar__select oel-toolbar__select--size">
        <Select aria-label={tr('Taille de police', 'Font size')} isDisabled={!!ro} selectedKey={String(st.font.size ?? 11)} onSelectionChange={(k) => ctl.setFont({ size: Number(k) })}>
          {[...new Set([st.font.size ?? 11, ...FONT_SIZES])].sort((a, b) => a - b).map((s) => (
            <SelectItem key={s} id={String(s)}>
              {String(s)}
            </SelectItem>
          ))}
        </Select>
      </div>
    </> },
    { id: 'text', label: tr('Texte', 'Text'), priority: 1, content: <>
      <ToolbarToggle icon="bold" label={tr('Gras', 'Bold')} shortcut={['Ctrl', 'B']} isSelected={!!st.font.bold} unavailableReason={ro} onChange={() => ctl.toggleFont('bold')} />
      <ToolbarToggle icon="italic" label={tr('Italique', 'Italic')} shortcut={['Ctrl', 'I']} isSelected={!!st.font.italic} unavailableReason={ro} onChange={() => ctl.toggleFont('italic')} />
      <ToolbarToggle icon="strikethrough" label={tr('Barré', 'Strikethrough')} shortcut={['Ctrl', '5']} isSelected={!!st.font.strike} unavailableReason={ro} onChange={() => ctl.toggleFont('strike')} />
      <ToolbarToggle icon="underline" label={tr('Souligné', 'Underline')} shortcut={['Ctrl', 'U']} isSelected={!!st.font.underline} unavailableReason={ro} onChange={() => ctl.toggleUnderline()} />
      <ColorTool icon="text-color" label={tr('Couleur du texte', 'Text colour')} colors={TEXT_COLORS} none={tr('Automatique', 'Automatic')} current={st.font.color?.css} onPick={(c) => ctl.setTextColor(c)} ro={ro} />
      <ColorTool icon="fill-color" label={tr('Couleur de remplissage', 'Fill colour')} colors={FILL_COLORS} none={tr('Aucun remplissage', 'No fill')} current={st.fill?.css} onPick={(c) => ctl.setFill(c)} ro={ro} />
    </> },
    { id: 'cells', label: tr('Cellules', 'Cells'), priority: 2, wide: true, content: <>
      <MenuTool
        icon="borders"
        label={tr('Bordures', 'Borders')}
        ro={ro}
        onAction={(id) => ctl.setBorders(id as Parameters<SheetController['setBorders']>[0], id.endsWith('-thick') ? 'medium' : 'thin')}
        items={[
          { id: 'all', label: tr('Toutes les bordures', 'All borders') },
          { id: 'outer', label: tr('Bordures extérieures', 'Outside borders') },
          { id: 'bottom', label: tr('Bordure inférieure', 'Bottom border') },
          { id: 'top', label: tr('Bordure supérieure', 'Top border') },
          { id: 'left', label: tr('Bordure gauche', 'Left border') },
          { id: 'right', label: tr('Bordure droite', 'Right border') },
          '-',
          { id: 'none', label: tr('Aucune bordure', 'No border') },
        ]}
      />
      <MenuTool
        icon="merge"
        label={tr('Fusionner les cellules', 'Merge cells')}
        ro={ro}
        onAction={(id) => (id === 'merge' ? ctl.merge(false) : id === 'center' ? ctl.merge(true) : ctl.unmerge())}
        items={[
          { id: 'center', label: tr('Fusionner et centrer', 'Merge and centre') },
          { id: 'merge', label: tr('Fusionner', 'Merge') },
          { id: 'unmerge', label: tr('Annuler la fusion', 'Unmerge') },
        ]}
      />
      <MenuTool
        icon={st.align.h === 'center' ? 'align-center' : st.align.h === 'right' ? 'align-right' : 'align-left'}
        label={tr('Alignement horizontal', 'Horizontal alignment')}
        ro={ro}
        onAction={(id) => ctl.setAlign({ h: id === 'general' ? undefined : id })}
        items={[
          { id: 'general', label: tr('Automatique (texte à gauche, nombres à droite)', 'Automatic (text left, numbers right)') },
          { id: 'left', label: tr('Gauche', 'Left') },
          { id: 'center', label: tr('Centré', 'Centre') },
          { id: 'right', label: tr('Droite', 'Right') },
          { id: 'justify', label: tr('Justifié', 'Justified') },
        ]}
      />
      <MenuTool
        icon={st.align.v === 'top' ? 'valign-top' : st.align.v === 'center' ? 'valign-middle' : 'valign-bottom'}
        label={tr('Alignement vertical', 'Vertical alignment')}
        ro={ro}
        onAction={(id) => ctl.setAlign({ v: id === 'bottom' ? undefined : id })}
        items={[
          { id: 'top', label: tr('Haut', 'Top') },
          { id: 'center', label: tr('Milieu', 'Middle') },
          { id: 'bottom', label: tr('Bas', 'Bottom') },
        ]}
      />
      <ToolbarToggle icon="wrap-text" label={tr('Renvoyer à la ligne', 'Wrap text')} description={tr('Le texte passe à la ligne dans la cellule.', 'The text wraps inside the cell.')} isSelected={!!st.align.wrap} unavailableReason={ro} onChange={() => ctl.setAlign({ wrap: !st.align.wrap || undefined })} />
    </> },
    {
      id: 'data',
      label: tr('Données', 'Data'),
      priority: 3,
      content: (
        <>
          <MenuTool
            icon="sort-asc"
            label={tr('Trier', 'Sort')}
            ro={ro}
            onAction={(id) => onCommand(id)}
            items={[
              { id: 'sort-asc', label: tr('Trier de A à Z', 'Sort A to Z') },
              { id: 'sort-desc', label: tr('Trier de Z à A', 'Sort Z to A') },
              '-',
              { id: 'sort', label: tr('Tri personnalisé…', 'Custom sort…') },
            ]}
          />
      <ToolbarToggle icon="filter" label={tr('Filtrer', 'Filter')} shortcut={['Ctrl', 'Maj', 'L']} isSelected={!!ctl.doc.filter(ctl.sheetId)} unavailableReason={ro} onChange={() => ctl.toggleFilter()} />
      <MenuTool
        icon="sum"
        label={tr('Fonctions', 'Functions')}
        description={tr('Somme automatique (Alt+=) et fonctions courantes.', 'AutoSum (Alt+=) and common functions.')}
        ro={ro}
        onAction={(id) => ((ctl.editSheet = ctl.sheetId), ctl.autoSum(id))}
        items={[
          { id: 'SUM', label: tr('SUM — Somme', 'SUM — Sum') },
          { id: 'AVERAGE', label: tr('AVERAGE — Moyenne', 'AVERAGE — Average') },
          { id: 'COUNT', label: tr('COUNT — Nombre', 'COUNT — Count') },
          { id: 'MAX', label: 'MAX — Maximum' },
          { id: 'MIN', label: 'MIN — Minimum' },
        ]}
      />
        </>
      ),
    },
    {
      id: 'insert',
      label: tr('Insertion', 'Insert'),
      priority: 4,
      content: (
        <>
          <ToolButton icon="chart" label={tr('Graphique', 'Chart')} shortcut={['Alt', 'F1']} description={tr('Graphique recommandé à partir de la sélection', 'Recommended chart from the selection')} unavailableReason={ro} onPress={() => onCommand('chart')} />
          <ToolButton icon="link" label={tr('Insérer un lien', 'Insert a link')} shortcut={['Ctrl', 'K']} unavailableReason={ro} onPress={() => onCommand('link')} />
          <ToolButton icon="comment" label={tr('Insérer une note', 'Insert a note')} unavailableReason={tr('Les notes du fichier sont affichées et conservées ; leur création arrive bientôt.', 'The file’s notes are shown and kept; creating them comes soon.')} />
        </>
      ),
    },
    {
      id: 'tools',
      label: tr('Outils', 'Tools'),
      priority: 5,
      content: (
        <ToolbarToggle icon="format-painter" label={tr('Reproduire la mise en forme', 'Format painter')} description={tr('Copie la mise en forme de la cellule active vers la prochaine sélection.', 'Copies the active cell’s formatting to the next selection.')} isSelected={!!ctl.painter} unavailableReason={ro} onChange={() => ctl.togglePainter()} />
      ),
    },
  ];
  return <AdaptiveToolbar label={tr('Mise en forme', 'Formatting')} groups={groups} trailing={more} storageKey={storageKey} docked={dock.docked} forced={dock.forced} onDockedChange={dock.setDocked} />;
}
