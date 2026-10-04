/**
 * Formatting ribbon: slides, insertion, text, paragraphs, shape fill and
 * outline, arrangement, slideshow. Text tools act on the text being typed
 * when there is one, else on every selected shape's whole text.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Dialog, DialogTrigger, MenuTrigger } from 'react-aria-components';
import { Menu, MenuItem, MenuPopover, MenuSeparator, Popover, Select, SelectItem, Toolbar, ToolbarSeparator, ToolbarToggle, ToolButton, type IconName } from '@oel/emboss';
import { SHAPE_CHOICES } from '../model/geometry';
import { commonRun, levelOf, resolvePara, typeface, type TextCtx } from '../model/text';
import { effectiveFill, effectiveLine } from './render';
import { paintColor } from '../model/ops';
import type { SlidesController } from './controller';
import { pickPicture } from './Canvas';

export const ZOOMS: Array<{ id: string; label: string }> = [
  { id: 'fit', label: 'Ajuster' },
  { id: '0.5', label: '50 %' },
  { id: '0.75', label: '75 %' },
  { id: '1', label: '100 %' },
  { id: '1.5', label: '150 %' },
  { id: '2', label: '200 %' },
];
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96];
const COMMON_FONTS = ['Aptos', 'Arial', 'Calibri', 'Calibri Light', 'Cambria', 'Century Gothic', 'Georgia', 'Gill Sans MT', 'Segoe UI', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
const STANDARD = ['#C00000', '#FF0000', '#FFC000', '#FFFF00', '#92D050', '#00B050', '#00B0F0', '#0070C0', '#002060', '#7030A0', '#FFFFFF', '#000000'];

function Swatches({ ctl, onPick, none }: { ctl: SlidesController; onPick: (c: string | null) => void; none?: string }) {
  const theme = ctl.info.theme.colors.filter((c) => !['hlink', 'folHlink'].includes(c.name));
  return (
    <div className="oel-swatches">
      {none && (
        <button type="button" className="oel-swatch oel-swatch--none" onClick={() => onPick(null)}>
          {none}
        </button>
      )}
      <p className="oel-swatches__label">Couleurs du thème</p>
      <div className="oel-swatches__grid" role="group" aria-label="Couleurs du thème">
        {theme.map((c) => (
          <button key={c.name} type="button" className="oel-swatch" style={{ background: c.color }} aria-label={c.color} title={c.color} onClick={() => onPick(c.color)} />
        ))}
      </div>
      <p className="oel-swatches__label">Couleurs standard</p>
      <div className="oel-swatches__grid" role="group" aria-label="Couleurs standard">
        {STANDARD.map((c) => (
          <button key={c} type="button" className="oel-swatch" style={{ background: c }} aria-label={c} title={c} onClick={() => onPick(c)} />
        ))}
      </div>
      <label className="oel-swatches__custom">
        Personnalisée <input type="color" onChange={(e) => onPick(e.target.value.toUpperCase())} />
      </label>
    </div>
  );
}

function ColorTool({ ctl, icon, label, current, onPick, none, ro, description }: { ctl: SlidesController; icon: IconName; label: string; current?: string; onPick: (c: string | null) => void; none?: string; ro?: string; description?: string }) {
  return (
    <DialogTrigger>
      <ToolButton icon={icon} label={label} description={description} unavailableReason={ro} value={<span className="oel-colorbar" style={{ background: current ?? 'transparent' }} />} />
      <Popover placement="bottom">
        <Dialog className="oel-popover-dialog" aria-label={label}>
          {({ close }) => <Swatches ctl={ctl} none={none} onPick={(c) => (onPick(c), close())} />}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

export function MenuTool({ icon, label, items, onAction, ro, description, showLabel }: { icon: IconName; label: string; items: Array<{ id: string; label: string; icon?: IconName; disabled?: boolean } | '-'>; onAction: (id: string) => void; ro?: string; description?: string; showLabel?: boolean }) {
  return (
    <MenuTrigger>
      <ToolButton icon={icon} label={label} unavailableReason={ro} description={description} showLabel={showLabel} />
      <MenuPopover placement="bottom start">
        <Menu aria-label={label} onAction={(k) => onAction(String(k))} disabledKeys={items.filter((i): i is { id: string; label: string; disabled?: boolean } => i !== '-' && !!i.disabled).map((i) => i.id)}>
          {items.map((it, i) =>
            it === '-' ? (
              <MenuSeparator key={`s${i}`} />
            ) : (
              <MenuItem key={it.id} id={it.id} icon={it.icon}>
                {it.label}
              </MenuItem>
            ),
          )}
        </Menu>
      </MenuPopover>
    </MenuTrigger>
  );
}

/** What the text tools show: the cursor's run when typing, else the selection's common values. */
function useTextState(ctl: SlidesController, ctx: TextCtx) {
  const [, force] = useState(0);
  useEffect(() => {
    const on = () => force((n) => n + 1);
    document.addEventListener('oel-text-cursor', on);
    return () => document.removeEventListener('oel-text-cursor', on);
  }, []);
  if (ctl.textEditor) return ctl.textEditor.current();
  const withText = ctl.selected.filter((e) => e.text);
  const first = withText[0]?.text;
  if (!first) return null;
  const all = <K extends Parameters<typeof commonRun>[1]>(k: K) => {
    const vals = withText.map((e) => commonRun(e.text!, k, ctx));
    return vals.every((v) => v === vals[0]) ? vals[0] : undefined;
  };
  const p = resolvePara(levelOf(first, first.paras[0]?.lvl ?? 0), first.paras[0]?.props ?? {});
  return { bold: !!all('bold'), italic: !!all('italic'), underline: (all('underline') ?? 'none') !== 'none', strike: (all('strike') ?? 'noStrike') !== 'noStrike', size: all('size') ?? NaN, font: all('font') ?? '', color: all('color') ?? '#000000', align: p.align, bullet: p.bullet.kind };
}

export function SlidesToolbar({ ctl, ctx, zoom, setZoom, compact, more, onPresent }: { ctl: SlidesController; ctx: TextCtx; zoom: string; setZoom: (z: string) => void; compact?: boolean; more?: ReactNode; onPresent: () => void }) {
  const ro = ctl.readOnly ? 'Lecture seule' : undefined;
  const info = ctl.info;
  const sel = ctl.selected;
  const t = useTextState(ctl, ctx);
  const noText = ro ?? (t ? undefined : 'Sélectionnez une forme ou une zone de texte.');
  const noShape = ro ?? (sel.some((e) => e.kind === 'shape' || e.kind === 'connector') ? undefined : 'Sélectionnez une forme.');
  const noSel = ro ?? (sel.length ? undefined : 'Sélectionnez un élément de la diapositive.');
  const fonts = [...new Set([`${info.theme.major}`, `${info.theme.minor}`, ...info.fonts.map((f) => f.name), ...COMMON_FONTS])];
  const font = t ? typeface(t.font, info.theme) : '';
  const shapeFill = sel.find((e) => e.kind === 'shape');
  const shapeLine = sel.find((e) => e.kind === 'shape' || e.kind === 'connector');
  const layouts = info.layouts.map((l) => ({ id: l.id, label: l.name || 'Disposition' }));
  const currentLayout = ctl.slide?.layout;

  return (
    <Toolbar aria-label="Mise en forme de la présentation">
      <ToolButton icon="undo" label="Annuler" shortcut={['Ctrl', 'Z']} unavailableReason={ro ?? (ctl.undo.canUndo() ? undefined : 'Rien à annuler.')} onPress={() => ctl.undo.undo()} />
      <ToolButton icon="redo" label="Rétablir" shortcut={['Ctrl', 'Y']} unavailableReason={ro ?? (ctl.undo.canRedo() ? undefined : 'Rien à rétablir.')} onPress={() => ctl.undo.redo()} />
      <ToolbarSeparator />
      <MenuTool icon="new-page" label="Nouvelle diapositive" description="Après la diapositive actuelle, sur la disposition choisie (Ctrl+M)." ro={ro} items={layouts} onAction={(id) => ctl.newSlide(id)} />
      <MenuTool icon="layout" label="Disposition" description="Change la disposition de la diapositive." ro={ro} items={layouts.map((l) => ({ ...l, label: `${l.id === currentLayout ? '✓ ' : ''}${l.label}` }))} onAction={(id) => ctl.setLayout(id)} />
      <ToolbarSeparator />
      <ToolButton icon="text-box" label="Zone de texte" description="Ajoute une zone de texte au centre." unavailableReason={ro} onPress={() => ctl.insertTextBox()} />
      <MenuTool icon="shape" label="Formes" ro={ro} items={SHAPE_CHOICES.map((s) => ({ id: s.prst, label: s.label }))} onAction={(p) => ctl.insertShape(p)} />
      <ToolButton icon="image" label="Image" description="Insère une image (ou glissez-la sur la diapositive)." unavailableReason={ro} onPress={() => pickPicture(ctl)} />
      <ToolbarSeparator />
      {!compact && (
        <div className="oel-toolbar__select oel-toolbar__select--font">
          <Select aria-label="Police" isDisabled={!!noText} selectedKey={font || null} placeholder="Police" onSelectionChange={(k) => k && ctl.setRun({ font: String(k) })}>
            {fonts.map((f) => (
              <SelectItem key={f} id={f}>
                {f}
              </SelectItem>
            ))}
          </Select>
        </div>
      )}
      <div className="oel-toolbar__select oel-toolbar__select--size">
        <Select aria-label="Taille" isDisabled={!!noText} selectedKey={t && Number.isFinite(t.size) ? String(t.size) : null} placeholder="—" onSelectionChange={(k) => k && ctl.setRun({ size: Number(k) })}>
          {[...new Set([...SIZES, ...(t && Number.isFinite(t.size) ? [t.size] : [])])]
            .sort((a, b) => a - b)
            .map((s) => (
              <SelectItem key={s} id={String(s)}>
                {String(s).replace('.', ',')}
              </SelectItem>
            ))}
        </Select>
      </div>
      <ToolbarToggle icon="bold" label="Gras" shortcut={['Ctrl', 'B']} isSelected={!!t?.bold} unavailableReason={noText} onChange={() => (ctl.textEditor ? ctl.textEditor.toggle('bold') : ctl.setRun({ bold: !t?.bold }))} />
      <ToolbarToggle icon="italic" label="Italique" shortcut={['Ctrl', 'I']} isSelected={!!t?.italic} unavailableReason={noText} onChange={() => (ctl.textEditor ? ctl.textEditor.toggle('italic') : ctl.setRun({ italic: !t?.italic }))} />
      <ToolbarToggle icon="underline" label="Souligné" shortcut={['Ctrl', 'U']} isSelected={!!t?.underline} unavailableReason={noText} onChange={() => ctl.setRun({ underline: t?.underline ? 'none' : 'sng' })} />
      {!compact && <ToolbarToggle icon="strikethrough" label="Barré" isSelected={!!t?.strike} unavailableReason={noText} onChange={() => ctl.setRun({ strike: t?.strike ? 'noStrike' : 'sngStrike' })} />}
      <ColorTool ctl={ctl} icon="text-color" label="Couleur du texte" current={t?.color} ro={noText} onPick={(c) => ctl.setRun({ color: c ?? undefined })} none="Automatique" />
      <ToolbarSeparator />
      <MenuTool
        icon={t?.align === 'ctr' ? 'align-center' : t?.align === 'r' ? 'align-right' : t?.align === 'just' ? 'align-justify' : 'align-left'}
        label="Alignement"
        ro={noText}
        items={[
          { id: 'l', label: 'Aligner à gauche (Ctrl+L)', icon: 'align-left' },
          { id: 'ctr', label: 'Centrer (Ctrl+E)', icon: 'align-center' },
          { id: 'r', label: 'Aligner à droite (Ctrl+R)', icon: 'align-right' },
          { id: 'just', label: 'Justifier (Ctrl+J)', icon: 'align-justify' },
          '-',
          { id: 'anchor:t', label: 'Texte en haut', icon: 'valign-top' },
          { id: 'anchor:ctr', label: 'Texte au milieu', icon: 'valign-middle' },
          { id: 'anchor:b', label: 'Texte en bas', icon: 'valign-bottom' },
        ]}
        onAction={(id) => (id.startsWith('anchor:') ? ctl.setAnchor(id.slice(7) as 't' | 'ctr' | 'b') : ctl.setPara({ align: id }))}
      />
      <ToolbarToggle icon="list" label="Puces" isSelected={t?.bullet === 'char'} unavailableReason={noText} onChange={() => ctl.setPara({ bullet: t?.bullet === 'char' ? { kind: 'none' } : { kind: 'char', char: '•', font: 'Arial' }, ...(t?.bullet === 'char' ? {} : { marL: 342900, indent: -342900 }) })} />
      <ToolbarToggle icon="list-numbered" label="Numérotation" isSelected={t?.bullet === 'auto'} unavailableReason={noText} onChange={() => ctl.setPara({ bullet: t?.bullet === 'auto' ? { kind: 'none' } : { kind: 'auto', scheme: 'arabicPeriod' }, ...(t?.bullet === 'auto' ? {} : { marL: 342900, indent: -342900 }) })} />
      {!compact && (
        <>
          <ToolButton icon="indent-less" label="Diminuer le niveau" shortcut={['Maj', 'Tab']} unavailableReason={noText} onPress={() => ctl.indent(-1)} />
          <ToolButton icon="indent-more" label="Augmenter le niveau" shortcut={['Tab']} unavailableReason={noText} onPress={() => ctl.indent(1)} />
        </>
      )}
      <ToolbarSeparator />
      <ColorTool ctl={ctl} icon="fill-color" label="Remplissage" description="Couleur de fond de la forme." current={paintColor(shapeFill ? effectiveFill(shapeFill) : undefined)} ro={ro ?? (shapeFill ? undefined : 'Sélectionnez une forme.')} none="Aucun remplissage" onPick={(c) => ctl.setFill(c ? { type: 'solid', color: c } : { type: 'none' })} />
      <ColorTool ctl={ctl} icon="pen" label="Contour" description="Couleur du contour." current={paintColor(shapeLine ? effectiveLine(shapeLine)?.paint : undefined)} ro={noShape} none="Aucun contour" onPick={(c) => ctl.setLine(c ? { paint: { type: 'solid', color: c }, width: effectiveLine(shapeLine!)?.width ?? 12700 } : null)} />
      {!compact && (
        <MenuTool
          icon="line-spacing"
          label="Épaisseur du contour"
          ro={noShape}
          items={[0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6].map((w) => ({ id: String(w), label: `${String(w).replace('.', ',')} pt` }))}
          onAction={(w) => ctl.setLine({ width: Math.round(Number(w) * 12700), paint: effectiveLine(shapeLine!)?.paint ?? { type: 'solid', color: '#000000' } })}
        />
      )}
      <MenuTool
        icon="arrange"
        label="Organiser"
        ro={noSel}
        items={[
          { id: 'front', label: 'Mettre au premier plan' },
          { id: 'forward', label: 'Avancer' },
          { id: 'backward', label: 'Reculer' },
          { id: 'back', label: 'Mettre à l’arrière-plan' },
          '-',
          { id: 'left', label: 'Aligner à gauche' },
          { id: 'center', label: 'Centrer horizontalement' },
          { id: 'right', label: 'Aligner à droite' },
          { id: 'top', label: 'Aligner en haut' },
          { id: 'middle', label: 'Centrer verticalement' },
          { id: 'bottom', label: 'Aligner en bas' },
        ]}
        onAction={(id) => (['front', 'forward', 'backward', 'back'].includes(id) ? ctl.arrange(id as 'front') : ctl.align(id as 'left'))}
      />
      <ToolbarSeparator />
      {!compact && (
        <div className="oel-toolbar__select oel-toolbar__select--zoom">
          <Select aria-label="Zoom" selectedKey={zoom} onSelectionChange={(k) => setZoom(String(k))}>
            {ZOOMS.map((z) => (
              <SelectItem key={z.id} id={z.id}>
                {z.label}
              </SelectItem>
            ))}
          </Select>
        </div>
      )}
      <ToolButton icon="play" label="Présenter" showLabel shortcut={['F5']} description="Plein écran à partir du début (Maj+F5 : diapositive actuelle)." onPress={onPresent} />
      {more}
    </Toolbar>
  );
}
