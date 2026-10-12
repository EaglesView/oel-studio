/**
 * Formatting ribbon: slides, insertion, text, paragraphs, shape fill and
 * outline, arrangement, slideshow. Text tools act on the text being typed
 * when there is one, else on every selected shape's whole text.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Dialog, DialogTrigger, MenuTrigger } from 'react-aria-components';
import { AdaptiveToolbar, Menu, MenuItem, MenuPopover, MenuSeparator, Popover, Select, SelectItem, ToolbarToggle, ToolButton, type IconName, type ToolGroup } from '@oel/emboss';
import { SHAPE_CHOICES } from '../model/geometry';
import { commonRun, levelOf, resolvePara, typeface, type TextCtx } from '../model/text';
import { effectiveFill, effectiveLine } from './render';
import { paintColor } from '../model/ops';
import type { SlidesController } from './controller';
import { pickPicture } from './Canvas';
import { tr } from '@oel/i18n';

export const ZOOMS: Array<{ id: string; label: string }> = [
  { id: 'fit', label: tr('Ajuster', 'Fit') },
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
      <p className="oel-swatches__label">{tr('Couleurs du thème', 'Theme colours')}</p>
      <div className="oel-swatches__grid" role="group" aria-label={tr('Couleurs du thème', 'Theme colours')}>
        {theme.map((c) => (
          <button key={c.name} type="button" className="oel-swatch" style={{ background: c.color }} aria-label={c.color} title={c.color} onClick={() => onPick(c.color)} />
        ))}
      </div>
      <p className="oel-swatches__label">{tr('Couleurs standard', 'Standard colours')}</p>
      <div className="oel-swatches__grid" role="group" aria-label={tr('Couleurs standard', 'Standard colours')}>
        {STANDARD.map((c) => (
          <button key={c} type="button" className="oel-swatch" style={{ background: c }} aria-label={c} title={c} onClick={() => onPick(c)} />
        ))}
      </div>
      <label className="oel-swatches__custom">
        {tr('Personnalisée', 'Custom')} <input type="color" onChange={(e) => onPick(e.target.value.toUpperCase())} />
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

export function SlidesToolbar({ ctl, ctx, zoom, setZoom, compact, more, onPresent, dock, storageKey }: { ctl: SlidesController; ctx: TextCtx; zoom: string; setZoom: (z: string) => void; compact?: boolean; more?: ReactNode; onPresent: (mode: PresentMode) => void; dock: { docked: boolean; forced: boolean; setDocked: (d: boolean) => void }; storageKey: string }) {
  const ro = ctl.readOnly ? tr('Lecture seule', 'Read-only') : undefined;
  const info = ctl.info;
  const sel = ctl.selected;
  const t = useTextState(ctl, ctx);
  const noText = ro ?? (t ? undefined : tr('Sélectionnez une zone de texte pour changer la police.', 'Select a text box to change the font.'));
  const noShape = ro ?? (sel.some((e) => e.kind === 'shape' || e.kind === 'connector') ? undefined : tr('Sélectionnez une forme.', 'Select a shape.'));
  const noSel = ro ?? (sel.length ? undefined : tr('Sélectionnez un élément de la diapositive.', 'Select an item on the slide.'));
  const fonts = [...new Set([`${info.theme.major}`, `${info.theme.minor}`, ...info.fonts.map((f) => f.name), ...COMMON_FONTS])];
  const font = t ? typeface(t.font, info.theme) : '';
  const shapeFill = sel.find((e) => e.kind === 'shape');
  const shapeLine = sel.find((e) => e.kind === 'shape' || e.kind === 'connector');
  const layouts = info.layouts.map((l) => ({ id: l.id, label: l.name || tr('Disposition', 'Layout') }));
  const currentLayout = ctl.slide?.layout;

  // Groups and priorities from Figma J4. « Texte » stays in place, greyed, until a text box is selected (J6 §3).
  const groups: ToolGroup[] = [
    {
      id: 'history',
      label: tr('Historique', 'History'),
      priority: 1,
      content: (
        <>
          <ToolButton icon="undo" label={tr('Annuler', 'Undo')} shortcut={['Ctrl', 'Z']} unavailableReason={ro ?? (ctl.undo.canUndo() ? undefined : tr('Rien à annuler.', 'Nothing to undo.'))} onPress={() => ctl.undo.undo()} />
          <ToolButton icon="redo" label={tr('Rétablir', 'Redo')} shortcut={['Ctrl', 'Y']} unavailableReason={ro ?? (ctl.undo.canRedo() ? undefined : tr('Rien à rétablir.', 'Nothing to redo.'))} onPress={() => ctl.undo.redo()} />
        </>
      ),
    },
    { id: 'slide', label: tr('Diapo', 'Slide'), priority: 2, content: <>
      <MenuTool icon="new-page" label={tr('Nouvelle diapositive', 'New slide')} description={tr('Après la diapositive actuelle, sur la disposition choisie (Ctrl+M).', 'After the current slide, on the chosen layout (Ctrl+M).')} ro={ro} items={layouts} onAction={(id) => ctl.newSlide(id)} />
      <MenuTool icon="layout" label={tr('Disposition', 'Layout')} description={tr('Change la disposition de la diapositive.', 'Changes the slide layout.')} ro={ro} items={layouts.map((l) => ({ ...l, label: `${l.id === currentLayout ? '✓ ' : ''}${l.label}` }))} onAction={(id) => ctl.setLayout(id)} />
    </> },
    { id: 'insert', label: tr('Insertion', 'Insert'), priority: 1, content: <>
      <ToolButton icon="text-box" label={tr('Zone de texte', 'Text box')} description={tr('Ajoute une zone de texte au centre.', 'Adds a text box in the middle.')} unavailableReason={ro} onPress={() => ctl.insertTextBox()} />
      <MenuTool icon="shape" label={tr('Formes', 'Shapes')} ro={ro} items={SHAPE_CHOICES.map((s) => ({ id: s.prst, label: s.label }))} onAction={(p) => ctl.insertShape(p)} />
      <ToolButton icon="image" label="Image" description={tr('Insère une image (ou glissez-la sur la diapositive).', 'Inserts an image (or drag it onto the slide).')} unavailableReason={ro} onPress={() => pickPicture(ctl)} />
    </> },
    {
      id: 'text',
      label: tr('Texte', 'Text'),
      priority: 3,
      wide: true,
      content: (
        <div className={`oel-slides-text${t ? '' : ' is-idle'}`}>
      {!compact && (
        <div className="oel-toolbar__select oel-toolbar__select--font">
          <Select aria-label={tr('Police', 'Font')} isDisabled={!!noText} selectedKey={font || null} placeholder={tr('Police', 'Font')} onSelectionChange={(k) => k && ctl.setRun({ font: String(k) })}>
            {fonts.map((f) => (
              <SelectItem key={f} id={f}>
                {f}
              </SelectItem>
            ))}
          </Select>
        </div>
      )}
      <div className="oel-toolbar__select oel-toolbar__select--size">
        <Select aria-label={tr('Taille', 'Size')} isDisabled={!!noText} selectedKey={t && Number.isFinite(t.size) ? String(t.size) : null} placeholder="—" onSelectionChange={(k) => k && ctl.setRun({ size: Number(k) })}>
          {[...new Set([...SIZES, ...(t && Number.isFinite(t.size) ? [t.size] : [])])]
            .sort((a, b) => a - b)
            .map((s) => (
              <SelectItem key={s} id={String(s)}>
                {String(s).replace('.', ',')}
              </SelectItem>
            ))}
        </Select>
      </div>
      <ToolbarToggle icon="bold" label={tr('Gras', 'Bold')} shortcut={['Ctrl', 'B']} isSelected={!!t?.bold} unavailableReason={noText} onChange={() => (ctl.textEditor ? ctl.textEditor.toggle('bold') : ctl.setRun({ bold: !t?.bold }))} />
      <ToolbarToggle icon="italic" label={tr('Italique', 'Italic')} shortcut={['Ctrl', 'I']} isSelected={!!t?.italic} unavailableReason={noText} onChange={() => (ctl.textEditor ? ctl.textEditor.toggle('italic') : ctl.setRun({ italic: !t?.italic }))} />
      <ToolbarToggle icon="underline" label={tr('Souligné', 'Underline')} shortcut={['Ctrl', 'U']} isSelected={!!t?.underline} unavailableReason={noText} onChange={() => ctl.setRun({ underline: t?.underline ? 'none' : 'sng' })} />
      {!compact && <ToolbarToggle icon="strikethrough" label={tr('Barré', 'Strikethrough')} isSelected={!!t?.strike} unavailableReason={noText} onChange={() => ctl.setRun({ strike: t?.strike ? 'noStrike' : 'sngStrike' })} />}
      <ColorTool ctl={ctl} icon="text-color" label={tr('Couleur du texte', 'Text colour')} current={t?.color} ro={noText} onPick={(c) => ctl.setRun({ color: c ?? undefined })} none={tr('Automatique', 'Automatic')} />
      <MenuTool
        icon={t?.align === 'ctr' ? 'align-center' : t?.align === 'r' ? 'align-right' : t?.align === 'just' ? 'align-justify' : 'align-left'}
        label={tr('Alignement', 'Alignment')}
        ro={noText}
        items={[
          { id: 'l', label: tr('Aligner à gauche (Ctrl+L)', 'Align left (Ctrl+L)'), icon: 'align-left' },
          { id: 'ctr', label: tr('Centrer (Ctrl+E)', 'Centre (Ctrl+E)'), icon: 'align-center' },
          { id: 'r', label: tr('Aligner à droite (Ctrl+R)', 'Align right (Ctrl+R)'), icon: 'align-right' },
          { id: 'just', label: tr('Justifier (Ctrl+J)', 'Justify (Ctrl+J)'), icon: 'align-justify' },
          '-',
          { id: 'anchor:t', label: tr('Texte en haut', 'Text at the top'), icon: 'valign-top' },
          { id: 'anchor:ctr', label: tr('Texte au milieu', 'Text in the middle'), icon: 'valign-middle' },
          { id: 'anchor:b', label: tr('Texte en bas', 'Text at the bottom'), icon: 'valign-bottom' },
        ]}
        onAction={(id) => (id.startsWith('anchor:') ? ctl.setAnchor(id.slice(7) as 't' | 'ctr' | 'b') : ctl.setPara({ align: id }))}
      />
      <ToolbarToggle icon="list" label={tr('Puces', 'Bullets')} isSelected={t?.bullet === 'char'} unavailableReason={noText} onChange={() => ctl.setPara({ bullet: t?.bullet === 'char' ? { kind: 'none' } : { kind: 'char', char: '•', font: 'Arial' }, ...(t?.bullet === 'char' ? {} : { marL: 342900, indent: -342900 }) })} />
      <ToolbarToggle icon="list-numbered" label={tr('Numérotation', 'Numbering')} isSelected={t?.bullet === 'auto'} unavailableReason={noText} onChange={() => ctl.setPara({ bullet: t?.bullet === 'auto' ? { kind: 'none' } : { kind: 'auto', scheme: 'arabicPeriod' }, ...(t?.bullet === 'auto' ? {} : { marL: 342900, indent: -342900 }) })} />
      {!compact && (
        <>
          <ToolButton icon="indent-less" label={tr('Diminuer le niveau', 'Decrease level')} shortcut={['Maj', 'Tab']} unavailableReason={noText} onPress={() => ctl.indent(-1)} />
          <ToolButton icon="indent-more" label={tr('Augmenter le niveau', 'Increase level')} shortcut={['Tab']} unavailableReason={noText} onPress={() => ctl.indent(1)} />
        </>
      )}
        </div>
      ),
    },
    { id: 'shape', label: tr('Forme', 'Shape'), priority: 4, content: <>
      <ColorTool ctl={ctl} icon="fill-color" label={tr('Remplissage', 'Fill')} description={tr('Couleur de fond de la forme.', 'The shape’s background colour.')} current={paintColor(shapeFill ? effectiveFill(shapeFill) : undefined)} ro={ro ?? (shapeFill ? undefined : tr('Sélectionnez une forme.', 'Select a shape.'))} none={tr('Aucun remplissage', 'No fill')} onPick={(c) => ctl.setFill(c ? { type: 'solid', color: c } : { type: 'none' })} />
      <ColorTool ctl={ctl} icon="pen" label={tr('Contour', 'Outline')} description={tr('Couleur du contour.', 'Outline colour.')} current={paintColor(shapeLine ? effectiveLine(shapeLine)?.paint : undefined)} ro={noShape} none={tr('Aucun contour', 'No outline')} onPick={(c) => ctl.setLine(c ? { paint: { type: 'solid', color: c }, width: effectiveLine(shapeLine!)?.width ?? 12700 } : null)} />
      {!compact && (
        <MenuTool
          icon="line-spacing"
          label={tr('Épaisseur du contour', 'Outline weight')}
          ro={noShape}
          items={[0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6].map((w) => ({ id: String(w), label: `${String(w).replace('.', ',')} pt` }))}
          onAction={(w) => ctl.setLine({ width: Math.round(Number(w) * 12700), paint: effectiveLine(shapeLine!)?.paint ?? { type: 'solid', color: '#000000' } })}
        />
      )}
    </> },
    { id: 'arrange', label: tr('Organiser', 'Arrange'), priority: 4, content: <>
      <MenuTool
        icon="arrange"
        label={tr('Organiser', 'Arrange')}
        ro={noSel}
        items={[
          { id: 'front', label: tr('Mettre au premier plan', 'Bring to front') },
          { id: 'forward', label: tr('Avancer', 'Bring forward') },
          { id: 'backward', label: tr('Reculer', 'Send backward') },
          { id: 'back', label: tr('Mettre à l’arrière-plan', 'Send to back') },
          '-',
          { id: 'left', label: tr('Aligner à gauche', 'Align left') },
          { id: 'center', label: tr('Centrer horizontalement', 'Centre horizontally') },
          { id: 'right', label: tr('Aligner à droite', 'Align right') },
          { id: 'top', label: tr('Aligner en haut', 'Align top') },
          { id: 'middle', label: tr('Centrer verticalement', 'Centre vertically') },
          { id: 'bottom', label: tr('Aligner en bas', 'Align bottom') },
        ]}
        onAction={(id) => (['front', 'forward', 'backward', 'back'].includes(id) ? ctl.arrange(id as 'front') : ctl.align(id as 'left'))}
      />
    </> },
    ...(compact ? [] : [{ id: 'view', label: tr('Affichage', 'View'), priority: 5 as const, content: <>
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
    </> }]),
  ];
  return (
    <AdaptiveToolbar
      label={tr('Mise en forme de la présentation', 'Presentation formatting')}
      groups={groups}
      trailing={
        <>
          <PresentButton onPresent={onPresent} />
          {more}
        </>
      }
      storageKey={storageKey}
      docked={dock.docked}
      forced={dock.forced}
      onDockedChange={dock.setDocked}
    />
  );
}

export type PresentMode = 'present' | 'presenter';

const readMode = (): PresentMode => {
  try {
    return localStorage.getItem('oel-present-mode') === 'presenter' ? 'presenter' : 'present';
  } catch {
    return 'present';
  }
};

/**
 * « Présenter » (Figma J4): the main part starts the last mode used; the arrow
 * offers Présenter / Mode présentateur, and the choice becomes the default.
 */
function PresentButton({ onPresent }: { onPresent: (mode: PresentMode) => void }) {
  const [mode, setMode] = useState<PresentMode>(readMode);
  const start = (m: PresentMode) => {
    setMode(m);
    try {
      localStorage.setItem('oel-present-mode', m);
    } catch {
      // Not remembered; fine.
    }
    onPresent(m);
  };
  return (
    <span className="oel-present" role="group" aria-label={tr('Présenter', 'Present')}>
      <ToolButton
        icon={mode === 'presenter' ? 'presenter' : 'play'}
        label={mode === 'presenter' ? tr('Mode présentateur', 'Presenter mode') : tr('Présenter', 'Present')}
        showLabel
        shortcut={mode === 'presenter' ? ['Alt', 'F5'] : ['F5']}
        description={tr('Lance le dernier mode utilisé ; la flèche propose l’autre.', 'Starts the last mode used; the arrow offers the other.')}
        className="oel-present__main"
        onPress={() => start(mode)}
      />
      <MenuTrigger>
        <ToolButton icon="chevron-down" label={tr('Choisir le mode de présentation', 'Choose the presentation mode')} className="oel-present__more" />
        <MenuPopover placement="bottom end">
          <Menu aria-label={tr('Mode de présentation', 'Presentation mode')} onAction={(k) => start(k as PresentMode)}>
            <MenuItem id="present" icon="play" shortcut="F5" textValue={tr('Présenter', 'Present')}>
              {mode === 'present' ? '✓ ' : ''}{tr('Présenter', 'Present')}
            </MenuItem>
            <MenuItem id="presenter" icon="presenter" shortcut="Alt+F5" textValue={tr('Mode présentateur', 'Presenter mode')}>
              {mode === 'presenter' ? '✓ ' : ''}{tr('Mode présentateur', 'Presenter mode')}
            </MenuItem>
          </Menu>
        </MenuPopover>
      </MenuTrigger>
    </span>
  );
}
