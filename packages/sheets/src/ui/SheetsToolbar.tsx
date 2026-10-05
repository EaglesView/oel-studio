import type { ReactNode } from 'react';
import { Dialog, DialogTrigger, MenuTrigger } from 'react-aria-components';
import { Menu, MenuItem, MenuPopover, MenuSeparator, Popover, Select, SelectItem, Toolbar, ToolbarSeparator, ToolbarToggle, ToolButton } from '@oel/emboss';
import { NUMBER_FORMATS, type SheetController } from './controller';

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
      <div className="oel-swatches__grid" role="group" aria-label="Couleurs">
        {colors.map((c) => (
          <button key={c} type="button" className="oel-swatch" style={{ background: c }} aria-label={c} title={c} onClick={() => onPick(c)} />
        ))}
      </div>
      <label className="oel-swatches__custom">
        Personnalisée <input type="color" onChange={(e) => onPick(e.target.value.toUpperCase())} />
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

export function SheetsToolbar({ ctl, zoom, setZoom, onCommand, more }: { ctl: SheetController; zoom: number; setZoom: (z: number) => void; onCommand: (id: string) => void; more?: ReactNode }) {
  const st = ctl.activeStyle;
  const ro = ctl.readOnlyFlag ? 'Lecture seule' : undefined;
  const fmtId = NUMBER_FORMATS.find((f) => f.code === st.numFmt)?.id ?? 'custom';
  return (
    <Toolbar aria-label="Mise en forme">
      <ToolButton icon="undo" label="Annuler" shortcut={['Ctrl', 'Z']} unavailableReason={ro} onPress={() => ctl.undo.undo()} />
      <ToolButton icon="redo" label="Rétablir" shortcut={['Ctrl', 'Y']} unavailableReason={ro} onPress={() => ctl.undo.redo()} />
      <ToolButton icon="print" label="Imprimer" shortcut={['Ctrl', 'P']} onPress={() => onCommand('print')} />
      <ToolbarToggle icon="format-painter" label="Reproduire la mise en forme" description="Copie la mise en forme de la cellule active vers la prochaine sélection." isSelected={!!ctl.painter} unavailableReason={ro} onChange={() => ctl.togglePainter()} />
      <div className="oel-toolbar__select oel-toolbar__select--zoom">
        <Select aria-label="Zoom" selectedKey={String(zoom)} onSelectionChange={(k) => setZoom(Number(k))}>
          {ZOOMS.map((z) => (
            <SelectItem key={z} id={String(z)}>
              {`${Math.round(z * 100)} %`}
            </SelectItem>
          ))}
        </Select>
      </div>
      <ToolbarSeparator />
      <ToolButton icon="currency" label="Format monétaire" description="1 234,50 $" unavailableReason={ro} onPress={() => ctl.setNumFmt('#,##0.00 "$"')} />
      <ToolButton icon="percent" label="Pourcentage" unavailableReason={ro} onPress={() => ctl.setNumFmt('0%')} />
      <ToolButton icon="minus" label="Réduire les décimales" unavailableReason={ro} onPress={() => ctl.stepDecimals(-1)} />
      <ToolButton icon="plus" label="Ajouter une décimale" unavailableReason={ro} onPress={() => ctl.stepDecimals(1)} />
      <div className="oel-toolbar__select oel-toolbar__select--numfmt">
        <Select aria-label="Format des nombres" isDisabled={!!ro} selectedKey={fmtId} onSelectionChange={(k) => (k === 'custom' ? onCommand('format-cells') : ctl.setNumFmt(NUMBER_FORMATS.find((f) => f.id === k)!.code))}>
          {[
            ...NUMBER_FORMATS.map((f) => (
              <SelectItem key={f.id} id={f.id} textValue={f.label}>
                <span className="oel-numfmt">
                  <span>{f.label}</span>
                  <span className="oel-numfmt__ex">{f.example}</span>
                </span>
              </SelectItem>
            )),
            <SelectItem key="custom" id="custom" textValue="Personnalisé">
              Personnalisé…
            </SelectItem>,
          ]}
        </Select>
      </div>
      <ToolbarSeparator />
      <div className="oel-toolbar__select oel-toolbar__select--font">
        <Select aria-label="Police" isDisabled={!!ro} selectedKey={st.font.name ?? 'Calibri'} onSelectionChange={(k) => ctl.setFont({ name: String(k) })}>
          {[...new Set([...(st.font.name ? [st.font.name] : []), ...FONTS])].map((f) => (
            <SelectItem key={f} id={f}>
              <span style={{ fontFamily: `"${f}"` }}>{f}</span>
            </SelectItem>
          ))}
        </Select>
      </div>
      <div className="oel-toolbar__select oel-toolbar__select--size">
        <Select aria-label="Taille de police" isDisabled={!!ro} selectedKey={String(st.font.size ?? 11)} onSelectionChange={(k) => ctl.setFont({ size: Number(k) })}>
          {[...new Set([st.font.size ?? 11, ...FONT_SIZES])].sort((a, b) => a - b).map((s) => (
            <SelectItem key={s} id={String(s)}>
              {String(s)}
            </SelectItem>
          ))}
        </Select>
      </div>
      <ToolbarSeparator />
      <ToolbarToggle icon="bold" label="Gras" shortcut={['Ctrl', 'B']} isSelected={!!st.font.bold} unavailableReason={ro} onChange={() => ctl.toggleFont('bold')} />
      <ToolbarToggle icon="italic" label="Italique" shortcut={['Ctrl', 'I']} isSelected={!!st.font.italic} unavailableReason={ro} onChange={() => ctl.toggleFont('italic')} />
      <ToolbarToggle icon="strikethrough" label="Barré" shortcut={['Ctrl', '5']} isSelected={!!st.font.strike} unavailableReason={ro} onChange={() => ctl.toggleFont('strike')} />
      <ToolbarToggle icon="underline" label="Souligné" shortcut={['Ctrl', 'U']} isSelected={!!st.font.underline} unavailableReason={ro} onChange={() => ctl.toggleUnderline()} />
      <ColorTool icon="text-color" label="Couleur du texte" colors={TEXT_COLORS} none="Automatique" current={st.font.color?.css} onPick={(c) => ctl.setTextColor(c)} ro={ro} />
      <ColorTool icon="fill-color" label="Couleur de remplissage" colors={FILL_COLORS} none="Aucun remplissage" current={st.fill?.css} onPick={(c) => ctl.setFill(c)} ro={ro} />
      <MenuTool
        icon="borders"
        label="Bordures"
        ro={ro}
        onAction={(id) => ctl.setBorders(id as Parameters<SheetController['setBorders']>[0], id.endsWith('-thick') ? 'medium' : 'thin')}
        items={[
          { id: 'all', label: 'Toutes les bordures' },
          { id: 'outer', label: 'Bordures extérieures' },
          { id: 'bottom', label: 'Bordure inférieure' },
          { id: 'top', label: 'Bordure supérieure' },
          { id: 'left', label: 'Bordure gauche' },
          { id: 'right', label: 'Bordure droite' },
          '-',
          { id: 'none', label: 'Aucune bordure' },
        ]}
      />
      <MenuTool
        icon="merge"
        label="Fusionner les cellules"
        ro={ro}
        onAction={(id) => (id === 'merge' ? ctl.merge(false) : id === 'center' ? ctl.merge(true) : ctl.unmerge())}
        items={[
          { id: 'center', label: 'Fusionner et centrer' },
          { id: 'merge', label: 'Fusionner' },
          { id: 'unmerge', label: 'Annuler la fusion' },
        ]}
      />
      <ToolbarSeparator />
      <MenuTool
        icon={st.align.h === 'center' ? 'align-center' : st.align.h === 'right' ? 'align-right' : 'align-left'}
        label="Alignement horizontal"
        ro={ro}
        onAction={(id) => ctl.setAlign({ h: id === 'general' ? undefined : id })}
        items={[
          { id: 'general', label: 'Automatique (texte à gauche, nombres à droite)' },
          { id: 'left', label: 'Gauche' },
          { id: 'center', label: 'Centré' },
          { id: 'right', label: 'Droite' },
          { id: 'justify', label: 'Justifié' },
        ]}
      />
      <MenuTool
        icon={st.align.v === 'top' ? 'valign-top' : st.align.v === 'center' ? 'valign-middle' : 'valign-bottom'}
        label="Alignement vertical"
        ro={ro}
        onAction={(id) => ctl.setAlign({ v: id === 'bottom' ? undefined : id })}
        items={[
          { id: 'top', label: 'Haut' },
          { id: 'center', label: 'Milieu' },
          { id: 'bottom', label: 'Bas' },
        ]}
      />
      <ToolbarToggle icon="wrap-text" label="Renvoyer à la ligne" description="Le texte passe à la ligne dans la cellule." isSelected={!!st.align.wrap} unavailableReason={ro} onChange={() => ctl.setAlign({ wrap: !st.align.wrap || undefined })} />
      <ToolbarSeparator />
      <ToolButton icon="link" label="Insérer un lien" shortcut={['Ctrl', 'K']} unavailableReason={ro} onPress={() => onCommand('link')} />
      <ToolButton icon="comment" label="Insérer une note" unavailableReason="Les notes du fichier sont affichées et conservées ; leur création arrive bientôt." />
      <ToolButton icon="chart" label="Graphique" shortcut={['Alt', 'F1']} description="Graphique recommandé à partir de la sélection" unavailableReason={ro} onPress={() => onCommand('chart')} />
      <ToolbarToggle icon="filter" label="Filtrer" shortcut={['Ctrl', 'Maj', 'L']} isSelected={!!ctl.doc.filter(ctl.sheetId)} unavailableReason={ro} onChange={() => ctl.toggleFilter()} />
      <MenuTool
        icon="sum"
        label="Fonctions"
        description="Somme automatique (Alt+=) et fonctions courantes."
        ro={ro}
        onAction={(id) => ((ctl.editSheet = ctl.sheetId), ctl.autoSum(id))}
        items={[
          { id: 'SUM', label: 'SUM — Somme' },
          { id: 'AVERAGE', label: 'AVERAGE — Moyenne' },
          { id: 'COUNT', label: 'COUNT — Nombre' },
          { id: 'MAX', label: 'MAX — Maximum' },
          { id: 'MIN', label: 'MIN — Minimum' },
        ]}
      />
      {more}
    </Toolbar>
  );
}
