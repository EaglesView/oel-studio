import { useMemo, useState, type ReactNode } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { Dialog, DialogTrigger, MenuTrigger } from 'react-aria-components';
import { AdaptiveToolbar, Menu, MenuItem, MenuPopover, Popover, Select, SelectItem, ToolbarToggle, ToolButton, type ToolGroup } from '@oel/emboss';
import { FONT_FAMILIES, FONT_SIZES, HIGHLIGHT_COLORS, LINE_SPACINGS, TEXT_COLORS } from '../model/format';
import { listKindOf } from '../model/numbering';
import type { DocFont, DocStyle } from '../model/types';
import { fontLabel } from './fonts';

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
  /** Position of the selected chart node, if a chart is selected. */
  chartAt: number | null;
  /** Position of the selected linked picture (it has an `oid`), if any. */
  pictureAt: number | null;
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
        pictureAt: e.state.selection instanceof NodeSelection && e.state.selection.node.type.name === 'image' && e.state.selection.node.attrs.oid ? e.state.selection.from : null,
        chartAt: e.state.selection instanceof NodeSelection && e.state.selection.node.type.name === 'ooxmlInline' && e.state.selection.node.attrs.chart ? e.state.selection.from : null,
      };
    },
  });
}

export function Swatches({ colors, onPick, none }: { colors: string[]; onPick: (c: string | null) => void; none: string }) {
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
  /** The document's fonts, for the font menu (substitutions are named). */
  fonts?: DocFont[];
  editable: boolean;
  onLink: () => void;
  onImage: () => void;
  painterActive: boolean;
  /** Extra tool at the end of the ribbon (the « Plus » menu in the compact sheet). */
  more?: ReactNode;
  /** Where the bar lives (top, or docked at the bottom), per editor (Figma J3). */
  dock: { docked: boolean; forced: boolean; setDocked: (d: boolean) => void };
  storageKey: string;
}

export function DocsToolbar({ editor, state, styles, fonts = [], editable, onLink, onImage, painterActive, more, dock, storageKey }: DocsToolbarProps) {
  const chain = () => editor.chain().focus();
  const ro = editable ? undefined : 'Document en lecture seule.';
  const otherStyles = styles.filter((s) => s.kind === 'paragraph' && !s.hidden && s.quick && !ROLE_LABELS.some(([r]) => r === s.role));
  // The document's own fonts first (symbol fonts aside), then the usual ones.
  const docFamilies = fonts.map((f) => f.name).filter((n) => !/^(symbol|wingdings|webdings)/i.test(n) && !/\(.*\)$/.test(n));
  const families = Array.from(new Set([...(state.fontFamily ? [state.fontFamily] : []), ...docFamilies, ...FONT_FAMILIES]));
  const labels = useMemo(() => new Map(families.map((f) => [f, fontLabel(f, fonts)])), [families.join('|'), fonts]);
  const setSize = (pt: number) => chain().setFontSize(`${Math.max(1, Math.min(400, pt))}pt`).run();
  const nextSize = (dir: 1 | -1) => {
    const cur = state.fontSize ?? 11;
    const n = dir > 0 ? FONT_SIZES.find((s) => s > cur) ?? cur + 1 : [...FONT_SIZES].reverse().find((s) => s < cur) ?? Math.max(1, cur - 1);
    setSize(n);
  };

  const ALIGNS = [
    ['left', 'align-left', 'Aligner à gauche', ['Ctrl', 'Maj', 'L']],
    ['center', 'align-center', 'Centrer', ['Ctrl', 'Maj', 'E']],
    ['right', 'align-right', 'Aligner à droite', ['Ctrl', 'Maj', 'R']],
    ['justify', 'align-justify', 'Justifier', ['Ctrl', 'Maj', 'J']],
  ] as const;
  const align = ALIGNS.find(([a]) => a === state.align) ?? ALIGNS[0];
  const LISTS = [
    ['bullet', 'list', 'Liste à puces', 'Ctrl+Maj+8'],
    ['numbered', 'list-numbered', 'Liste numérotée', 'Ctrl+Maj+7'],
    ['check', 'checklist', 'Liste de contrôle', 'Ctrl+Maj+9'],
  ] as const;
  const list = LISTS.find(([l]) => l === state.list);

  // Groups and priorities from Figma J1/J4: 1 never folds, 5 folds first.
  const groups: ToolGroup[] = [
    {
      id: 'history',
      label: 'Historique',
      priority: 1,
      content: (
        <>
          <ToolButton icon="undo" label="Annuler" shortcut={['Ctrl', 'Z']} unavailableReason={ro ?? (state.canUndo ? undefined : 'Rien à annuler.')} onPress={() => chain().undo().run()} />
          <ToolButton icon="redo" label="Rétablir" shortcut={['Ctrl', 'Maj', 'Z']} unavailableReason={ro ?? (state.canRedo ? undefined : 'Rien à rétablir.')} onPress={() => chain().redo().run()} />
        </>
      ),
    },
    { id: 'style', label: 'Style', priority: 1, content: <>
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
    </> },
    { id: 'font', label: 'Police', priority: 3, content: <>
      <div className="oel-toolbar__select oel-toolbar__select--font">
        <Select aria-label="Police" isDisabled={!editable} selectedKey={state.fontFamily ?? '__default'} onSelectionChange={(k) => (k === '__default' ? chain().unsetFontFamily().run() : chain().setFontFamily(String(k)).run())}>
          {[
            <SelectItem key="__default" id="__default">
              Police du style
            </SelectItem>,
            ...families.map((f) => (
              <SelectItem key={f} id={f}>
                <span style={{ fontFamily: `"${f}"` }}>{labels.get(f) ?? f}</span>
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
    </> },
    {
      id: 'text',
      label: 'Texte',
      priority: 1,
      content: (
        <>
          <ToolbarToggle icon="bold" label="Gras" shortcut={['Ctrl', 'B']} isSelected={state.bold} unavailableReason={ro} onChange={() => chain().toggleBold().run()} />
          <ToolbarToggle icon="italic" label="Italique" shortcut={['Ctrl', 'I']} isSelected={state.italic} unavailableReason={ro} onChange={() => chain().toggleItalic().run()} />
          <ToolbarToggle icon="underline" label="Souligné" shortcut={['Ctrl', 'U']} isSelected={state.underline} unavailableReason={ro} onChange={() => chain().toggleUnderline().run()} />
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
        </>
      ),
    },
    {
      id: 'paragraph',
      label: 'Paragraphe',
      priority: 2,
      wide: true,
      content: (
        <>
          <MenuTrigger>
            <ToolButton icon={align[1]} label={`Alignement : ${align[2].toLocaleLowerCase('fr-CA')}`} unavailableReason={ro} />
            <MenuPopover>
              <Menu aria-label="Alignement" onAction={(k) => chain().setAlign(String(k) as 'left').run()}>
                {ALIGNS.map(([a, icon, label, sc]) => (
                  <MenuItem key={a} id={a} icon={icon} shortcut={sc.join('+')} textValue={label}>
                    {state.align === a ? `✓ ${label}` : label}
                  </MenuItem>
                ))}
              </Menu>
            </MenuPopover>
          </MenuTrigger>
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
          <MenuTrigger>
            <ToolButton icon={list?.[1] ?? 'list'} label={list ? list[2] : 'Listes'} unavailableReason={ro} />
            <MenuPopover>
              <Menu aria-label="Listes" onAction={(k) => chain().toggleList(String(k) as 'bullet').run()}>
                {LISTS.map(([l, icon, label, sc]) => (
                  <MenuItem key={l} id={l} icon={icon} shortcut={sc} textValue={label}>
                    {state.list === l ? `✓ ${label}` : label}
                  </MenuItem>
                ))}
              </Menu>
            </MenuPopover>
          </MenuTrigger>
          <ToolButton icon="indent-less" label="Diminuer le retrait" shortcut={['Ctrl', '[']} unavailableReason={ro} onPress={() => chain().changeIndent(-720).run()} />
          <ToolButton icon="indent-more" label="Augmenter le retrait" shortcut={['Ctrl', ']']} unavailableReason={ro} onPress={() => chain().changeIndent(720).run()} />
        </>
      ),
    },
    {
      id: 'insert',
      label: 'Insertion',
      priority: 4,
      content: (
        <>
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
        </>
      ),
    },
    {
      id: 'tools',
      label: 'Outils',
      priority: 5,
      content: (
        <>
          <ToolbarToggle
            icon="format-painter"
            label="Reproduire la mise en forme"
            description="Copie la mise en forme du texte au curseur ; sélectionnez ensuite le texte à mettre en forme."
            isSelected={painterActive}
            unavailableReason={ro}
            onChange={(on) => (on ? editor.commands.startFormatPainter() : editor.commands.cancelFormatPainter())}
          />
          <ToolButton icon="clear-format" label="Effacer la mise en forme" shortcut={['Ctrl', '\\']} unavailableReason={ro} onPress={() => chain().clearFormatting().run()} />
        </>
      ),
    },
    {
      id: 'more-text',
      label: 'Plus de texte',
      priority: 5,
      content: (
        <>
          <ToolbarToggle icon="strikethrough" label="Barré" shortcut={['Alt', 'Maj', '5']} isSelected={state.strike} unavailableReason={ro} onChange={() => chain().toggleStrike().run()} />
          <ToolbarToggle icon="checklist" label="Liste de contrôle" shortcut={['Ctrl', 'Maj', '9']} isSelected={state.list === 'check'} unavailableReason={ro} onChange={() => chain().toggleList('check').run()} />
        </>
      ),
    },
  ];

  return (
    <AdaptiveToolbar
      label="Mise en forme"
      className="oel-toolbar"
      groups={groups}
      trailing={more}
      storageKey={storageKey}
      docked={dock.docked}
      forced={dock.forced}
      onDockedChange={dock.setDocked}
    />
  );
}
