import { useState, type ReactNode } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { Dialog, DialogTrigger, MenuTrigger } from 'react-aria-components';
import { Menu, MenuItem, MenuPopover, Popover, Select, SelectItem, Toolbar, ToolbarSeparator, ToolbarToggle, ToolButton } from '@oel/emboss';
import { FONT_FAMILIES, FONT_SIZES, HIGHLIGHT_COLORS, LINE_SPACINGS, TEXT_COLORS } from '../model/format';
import { listKindOf } from '../model/numbering';
import type { DocStyle } from '../model/types';

export const ROLE_LABELS: Array<[string, string]> = [
  ['normal', 'Texte normal'],
  ['title', 'Titre'],
  ['subtitle', 'Sous-titre'],
  ['heading1', 'Titre 1'],
  ['heading2', 'Titre 2'],
  ['heading3', 'Titre 3'],
  ['heading4', 'Titre 4'],
  ['heading5', 'Titre 5'],
  ['heading6', 'Titre 6'],
];

export const ZOOMS = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2];

export interface ToolbarState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  role: string;
  fontFamily: string | null;
  fontSize: number | null;
  color: string | null;
  highlight: string | null;
  align: string;
  list: 'bullet' | 'numbered' | 'check' | null;
  link: boolean;
  canUndo: boolean;
  canRedo: boolean;
  inTable: boolean;
}

export function useToolbarState(editor: Editor | null, styles: DocStyle[], defaults: { fontFamily: string; fontSize: string }): ToolbarState | null {
  return useEditorState({
    editor,
    selector: ({ editor: e }): ToolbarState | null => {
      if (!e) return null;
      const { $from } = e.state.selection;
      const para = $from.node($from.depth)?.type.name === 'paragraph' ? $from.node($from.depth) : $from.parent;
      const styleId = para.attrs.styleId as string | null;
      const style = styles.find((s) => s.id === styleId);
      const role = style?.role && ROLE_LABELS.some(([r]) => r === style.role) ? style.role : para.attrs.outline != null ? `heading${para.attrs.outline + 1}` : styleId && !style?.isDefault ? `style:${styleId}` : 'normal';
      const ts = e.getAttributes('textStyle');
      const size = typeof ts.fontSize === 'string' ? parseFloat(ts.fontSize) : null;
      return {
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        role,
        fontFamily: (ts.fontFamily as string | null) ?? null,
        fontSize: size ?? (parseFloat(defaults.fontSize) || 11),
        color: (ts.color as string | null) ?? null,
        highlight: (e.getAttributes('highlight').color as string | null) ?? null,
        align: (para.attrs.align as string | null) ?? 'left',
        list: listKindOf(e.storage.docList.defs(), para.attrs.numId, para.attrs.ilvl),
        link: e.isActive('link'),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        inTable: e.isActive('table'),
      };
    },
  });
}

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

function TableGrid({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const [hover, setHover] = useState({ r: 0, c: 0 });
  return (
    <div className="oel-tablegrid">
      <div className="oel-tablegrid__cells" onMouseLeave={() => setHover({ r: 0, c: 0 })}>
        {Array.from({ length: 8 }, (_, r) =>
          Array.from({ length: 10 }, (_, c) => (
            <button
              key={`${r}-${c}`}
              type="button"
              className={`oel-tablegrid__cell${r < hover.r && c < hover.c ? ' is-on' : ''}`}
              aria-label={`${r + 1} × ${c + 1}`}
              onMouseEnter={() => setHover({ r: r + 1, c: c + 1 })}
              onFocus={() => setHover({ r: r + 1, c: c + 1 })}
              onClick={() => onPick(r + 1, c + 1)}
            />
          )),
        )}
      </div>
      <p className="oel-tablegrid__label">{hover.r ? `${hover.r} × ${hover.c}` : 'Choisissez la taille'}</p>
    </div>
  );
}

export interface DocsToolbarProps {
  editor: Editor;
  state: ToolbarState;
  styles: DocStyle[];
  editable: boolean;
  zoom: number;
  setZoom: (z: number) => void;
  onPrint: () => void;
  onLink: () => void;
  onImage: () => void;
  painterActive: boolean;
  /** Extra tool at the end of the ribbon (the « Plus » menu in the compact sheet). */
  more?: ReactNode;
}

export function DocsToolbar({ editor, state, styles, editable, zoom, setZoom, onPrint, onLink, onImage, painterActive, more }: DocsToolbarProps) {
  const chain = () => editor.chain().focus();
  const ro = editable ? undefined : 'Document en lecture seule.';
  const otherStyles = styles.filter((s) => s.kind === 'paragraph' && !s.hidden && s.quick && !ROLE_LABELS.some(([r]) => r === s.role));
  const families = Array.from(new Set([...(state.fontFamily ? [state.fontFamily] : []), ...FONT_FAMILIES]));
  const setSize = (pt: number) => chain().setFontSize(`${Math.max(1, Math.min(400, pt))}pt`).run();
  const nextSize = (dir: 1 | -1) => {
    const cur = state.fontSize ?? 11;
    const n = dir > 0 ? FONT_SIZES.find((s) => s > cur) ?? cur + 1 : [...FONT_SIZES].reverse().find((s) => s < cur) ?? Math.max(1, cur - 1);
    setSize(n);
  };

  return (
    <Toolbar aria-label="Mise en forme" className="oel-toolbar" appearance="ribbon">
      <ToolButton icon="undo" label="Annuler" shortcut={['Ctrl', 'Z']} unavailableReason={ro ?? (state.canUndo ? undefined : 'Rien à annuler.')} onPress={() => chain().undo().run()} />
      <ToolButton icon="redo" label="Rétablir" shortcut={['Ctrl', 'Maj', 'Z']} unavailableReason={ro ?? (state.canRedo ? undefined : 'Rien à rétablir.')} onPress={() => chain().redo().run()} />
      <ToolButton icon="print" label="Imprimer" shortcut={['Ctrl', 'P']} onPress={onPrint} />
      <ToolbarToggle
        icon="format-painter"
        label="Reproduire la mise en forme"
        description="Copie la mise en forme du texte au curseur ; sélectionnez ensuite le texte à mettre en forme."
        isSelected={painterActive}
        unavailableReason={ro}
        onChange={(on) => (on ? editor.commands.startFormatPainter() : editor.commands.cancelFormatPainter())}
      />
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
      <div className="oel-toolbar__select oel-toolbar__select--style">
        <Select
          aria-label="Style de paragraphe"
          isDisabled={!editable}
          selectedKey={state.role}
          onSelectionChange={(k) => {
            const key = String(k);
            if (key.startsWith('style:')) {
              const id = key.slice(6);
              chain().setParagraphStyle(id, styles.find((s) => s.id === id)?.outline ?? null).run();
            } else chain().setParagraphRole(key).run();
          }}
        >
          {[
            ...ROLE_LABELS.map(([id, label]) => (
              <SelectItem key={id} id={id} className={`emb-menu-item oel-style-preview oel-style-preview--${id}`}>
                {label}
              </SelectItem>
            )),
            ...(state.role.startsWith('style:') && !otherStyles.some((s) => `style:${s.id}` === state.role)
              ? [<SelectItem key={state.role} id={state.role}>{styles.find((s) => `style:${s.id}` === state.role)?.name ?? state.role.slice(6)}</SelectItem>]
              : []),
            ...otherStyles.map((s) => (
              <SelectItem key={s.id} id={`style:${s.id}`}>
                {s.name}
              </SelectItem>
            )),
          ]}
        </Select>
      </div>
      <div className="oel-toolbar__select oel-toolbar__select--font">
        <Select aria-label="Police" isDisabled={!editable} selectedKey={state.fontFamily ?? '__default'} onSelectionChange={(k) => (k === '__default' ? chain().unsetFontFamily().run() : chain().setFontFamily(String(k)).run())}>
          {[
            <SelectItem key="__default" id="__default">
              Police du style
            </SelectItem>,
            ...families.map((f) => (
              <SelectItem key={f} id={f}>
                <span style={{ fontFamily: `"${f}"` }}>{f}</span>
              </SelectItem>
            )),
          ]}
        </Select>
      </div>
      <div className="oel-fontsize" role="group" aria-label="Taille de police">
        <ToolButton icon="minus" label="Diminuer la taille de police" shortcut={['Ctrl', 'Maj', ',']} unavailableReason={ro} onPress={() => nextSize(-1)} />
        <input
          className="oel-fontsize__input"
          aria-label="Taille de police (pt)"
          disabled={!editable}
          key={state.fontSize ?? 0}
          defaultValue={state.fontSize ?? ''}
          inputMode="decimal"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const v = parseFloat((e.target as HTMLInputElement).value.replace(',', '.'));
              if (v > 0) setSize(v);
            }
          }}
        />
        <ToolButton icon="plus" label="Augmenter la taille de police" shortcut={['Ctrl', 'Maj', '.']} unavailableReason={ro} onPress={() => nextSize(1)} />
      </div>
      <ToolbarSeparator />
      <ToolbarToggle icon="bold" label="Gras" shortcut={['Ctrl', 'B']} isSelected={state.bold} unavailableReason={ro} onChange={() => chain().toggleBold().run()} />
      <ToolbarToggle icon="italic" label="Italique" shortcut={['Ctrl', 'I']} isSelected={state.italic} unavailableReason={ro} onChange={() => chain().toggleItalic().run()} />
      <ToolbarToggle icon="underline" label="Souligné" shortcut={['Ctrl', 'U']} isSelected={state.underline} unavailableReason={ro} onChange={() => chain().toggleUnderline().run()} />
      <ToolbarToggle icon="strikethrough" label="Barré" shortcut={['Alt', 'Maj', '5']} isSelected={state.strike} unavailableReason={ro} onChange={() => chain().toggleStrike().run()} />
      <DialogTrigger>
        <ToolButton icon="text-color" label="Couleur du texte" value={<span className="oel-colorbar" style={{ background: state.color ?? 'currentColor' }} />} unavailableReason={ro} />
        <Popover placement="bottom">
          <Dialog aria-label="Couleur du texte" className="oel-popover-dialog">
            {({ close }) => <Swatches colors={TEXT_COLORS} none="Couleur automatique" onPick={(c) => (c ? chain().setColor(c).run() : chain().unsetColor().run(), close())} />}
          </Dialog>
        </Popover>
      </DialogTrigger>
      <DialogTrigger>
        <ToolButton icon="fill-color" label="Couleur de surlignage" value={<span className="oel-colorbar" style={{ background: state.highlight ?? 'transparent' }} />} unavailableReason={ro} />
        <Popover placement="bottom">
          <Dialog aria-label="Couleur de surlignage" className="oel-popover-dialog">
            {({ close }) => <Swatches colors={HIGHLIGHT_COLORS} none="Aucun surlignage" onPick={(c) => (c ? chain().setHighlight({ color: c }).run() : chain().unsetHighlight().run(), close())} />}
          </Dialog>
        </Popover>
      </DialogTrigger>
      <ToolbarSeparator />
      <ToolbarToggle icon="link" label="Insérer un lien" shortcut={['Ctrl', 'K']} isSelected={state.link} unavailableReason={ro} onChange={onLink} />
      <ToolButton icon="image" label="Insérer une image" unavailableReason={ro} onPress={onImage} />
      <DialogTrigger>
        <ToolButton icon="table" label="Insérer un tableau" unavailableReason={ro} />
        <Popover placement="bottom">
          <Dialog aria-label="Taille du tableau" className="oel-popover-dialog">
            {({ close }) => <TableGrid onPick={(rows, cols) => (chain().insertTable({ rows, cols, withHeaderRow: false }).run(), close())} />}
          </Dialog>
        </Popover>
      </DialogTrigger>
      <ToolbarSeparator />
      <ToolbarToggle icon="align-left" label="Aligner à gauche" shortcut={['Ctrl', 'Maj', 'L']} isSelected={state.align === 'left'} unavailableReason={ro} onChange={() => chain().setAlign('left').run()} />
      <ToolbarToggle icon="align-center" label="Centrer" shortcut={['Ctrl', 'Maj', 'E']} isSelected={state.align === 'center'} unavailableReason={ro} onChange={() => chain().setAlign('center').run()} />
      <ToolbarToggle icon="align-right" label="Aligner à droite" shortcut={['Ctrl', 'Maj', 'R']} isSelected={state.align === 'right'} unavailableReason={ro} onChange={() => chain().setAlign('right').run()} />
      <ToolbarToggle icon="align-justify" label="Justifier" shortcut={['Ctrl', 'Maj', 'J']} isSelected={state.align === 'justify'} unavailableReason={ro} onChange={() => chain().setAlign('justify').run()} />
      <MenuTrigger>
        <ToolButton icon="line-spacing" label="Interligne et espacement" unavailableReason={ro} />
        <MenuPopover>
          <Menu
            aria-label="Interligne"
            onAction={(k) => {
              const key = String(k);
              if (key === 'before') chain().setParagraphSpacing(240, null).run();
              else if (key === 'after') chain().setParagraphSpacing(null, 240).run();
              else if (key === 'none') chain().setParagraphSpacing(0, 0).run();
              else chain().setLineSpacing(Number(key)).run();
            }}
          >
            {[
              ...LINE_SPACINGS.map((l) => (
                <MenuItem key={l.line} id={String(l.line)}>
                  {l.label}
                </MenuItem>
              )),
              <MenuItem key="before" id="before">Ajouter un espace avant le paragraphe</MenuItem>,
              <MenuItem key="after" id="after">Ajouter un espace après le paragraphe</MenuItem>,
              <MenuItem key="none" id="none">Supprimer l’espace avant et après</MenuItem>,
            ]}
          </Menu>
        </MenuPopover>
      </MenuTrigger>
      <ToolbarToggle icon="checklist" label="Liste de contrôle" shortcut={['Ctrl', 'Maj', '9']} isSelected={state.list === 'check'} unavailableReason={ro} onChange={() => chain().toggleList('check').run()} />
      <ToolbarToggle icon="list" label="Liste à puces" shortcut={['Ctrl', 'Maj', '8']} isSelected={state.list === 'bullet'} unavailableReason={ro} onChange={() => chain().toggleList('bullet').run()} />
      <ToolbarToggle icon="list-numbered" label="Liste numérotée" shortcut={['Ctrl', 'Maj', '7']} isSelected={state.list === 'numbered'} unavailableReason={ro} onChange={() => chain().toggleList('numbered').run()} />
      <ToolButton icon="indent-less" label="Diminuer le retrait" shortcut={['Ctrl', '[']} unavailableReason={ro} onPress={() => chain().changeIndent(-720).run()} />
      <ToolButton icon="indent-more" label="Augmenter le retrait" shortcut={['Ctrl', ']']} unavailableReason={ro} onPress={() => chain().changeIndent(720).run()} />
      <ToolButton icon="clear-format" label="Effacer la mise en forme" shortcut={['Ctrl', '\\']} unavailableReason={ro} onPress={() => chain().clearFormatting().run()} />
      {more && <ToolbarSeparator />}
      {more}
    </Toolbar>
  );
}

/** Extra row shown while the caret is in a table. */
export function TableBar({ editor }: { editor: Editor }) {
  const chain = () => editor.chain().focus();
  return (
    <Toolbar aria-label="Tableau" className="oel-tablebar" appearance="pill">
      <ToolButton icon="table-rows" label="Insérer une ligne au-dessus" showLabel onPress={() => chain().addRowBefore().run()} />
      <ToolButton icon="table-rows" label="Insérer une ligne en dessous" showLabel onPress={() => chain().addRowAfter().run()} />
      <ToolButton icon="layout" label="Colonne à gauche" showLabel onPress={() => chain().addColumnBefore().run()} />
      <ToolButton icon="layout" label="Colonne à droite" showLabel onPress={() => chain().addColumnAfter().run()} />
      <ToolbarSeparator />
      <ToolButton icon="merge" label="Fusionner / scinder les cellules" showLabel onPress={() => chain().mergeOrSplit().run()} />
      <DialogTrigger>
        <ToolButton icon="fill-color" label="Fond de cellule" showLabel />
        <Popover placement="bottom">
          <Dialog aria-label="Fond de cellule" className="oel-popover-dialog">
            {({ close }) => <Swatches colors={TEXT_COLORS} none="Aucun fond" onPick={(c) => (chain().setCellAttribute('background', c).run(), close())} />}
          </Dialog>
        </Popover>
      </DialogTrigger>
      <ToolbarSeparator />
      <ToolButton icon="trash" label="Supprimer la ligne" showLabel onPress={() => chain().deleteRow().run()} />
      <ToolButton icon="trash" label="Supprimer la colonne" showLabel onPress={() => chain().deleteColumn().run()} />
      <ToolButton icon="trash" label="Supprimer le tableau" showLabel onPress={() => chain().deleteTable().run()} />
    </Toolbar>
  );
}
