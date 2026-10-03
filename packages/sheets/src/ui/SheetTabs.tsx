import { useState } from 'react';
import { MenuTrigger } from 'react-aria-components';
import { Button, Menu, MenuItem, MenuPopover, MenuSeparator, toast } from '@oel/emboss';
import type { SheetController } from './controller';

const fmt = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 2 });
const TAB_COLORS = ['#C00000', '#E26B0A', '#B7950B', '#1E7B34', '#1F6F5C', '#1F4E79', '#5B3FD6', '#7030A0'];

/**
 * Sheet tabs and status bar (C3 · 3 and 5): tabs at the bottom like Excel —
 * click to switch, double-click to rename, « + » to add, right-click (or the
 * tab's menu key) to duplicate, delete, hide, colour; drag to reorder.
 * The summary of the selection lives on the right.
 */
export function SheetTabs({ ctl, zoom, setZoom }: { ctl: SheetController; zoom: number; setZoom: (z: number) => void }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const ids = ctl.doc.sheetIds();
  const visible = ids.filter((id) => ctl.doc.props(id).state === 'visible');
  const hidden = ids.filter((id) => ctl.doc.props(id).state === 'hidden');
  const ro = ctl.readOnlyFlag;
  const csv = ctl.doc.source() === 'csv';
  const stats = ctl.stats();

  const commitRename = () => {
    if (!renaming) return;
    if (!ctl.doc.renameSheet(renaming, draft)) toast({ title: 'Nom de feuille invalide', description: 'Un nom unique de 31 caractères au plus, sans : \\ / ? * [ ].', tone: 'warning' });
    setRenaming(null);
  };

  const action = (id: string, key: string) => {
    setMenu(null);
    if (key === 'rename') {
      setDraft(ctl.doc.props(id).name);
      setRenaming(id);
    } else if (key === 'duplicate') ctl.setSheet(ctl.doc.duplicateSheet(id));
    else if (key === 'delete') {
      if (!ctl.doc.deleteSheet(id)) toast({ title: 'Impossible de supprimer la dernière feuille visible', tone: 'warning' });
    } else if (key === 'hide') {
      if (visible.length <= 1) toast({ title: 'Un classeur garde au moins une feuille visible', tone: 'warning' });
      else {
        ctl.doc.setProps(id, { state: 'hidden' });
        if (id === ctl.sheetId) ctl.stepSheet(1);
      }
    } else if (key.startsWith('color:')) ctl.doc.setProps(id, { tabColor: key === 'color:none' ? null : { css: key.slice(6), rgb: `FF${key.slice(7)}` } });
    else if (key.startsWith('unhide:')) {
      ctl.doc.setProps(key.slice(7), { state: 'visible' });
      ctl.setSheet(key.slice(7));
    } else if (key === 'left' || key === 'right') {
      const i = ids.indexOf(id);
      ctl.doc.moveSheet(id, key === 'left' ? i - 1 : i + 1);
    }
  };

  return (
    <footer className="oel-sheetbar" aria-label="Feuilles et barre d’état">
      <Button
        size="icon-sm"
        variant="ghost"
        leadingIcon="plus"
        aria-label="Ajouter une feuille"
        isDisabled={ro || csv}
        onPress={() => ctl.setSheet(ctl.doc.addSheet(undefined, ids.indexOf(ctl.sheetId) + 1))}
      />
      <div className="oel-sheetbar__tabs" role="tablist" aria-label="Feuilles">
        {visible.map((id) => {
          const p = ctl.doc.props(id);
          const on = id === ctl.sheetId;
          return renaming === id ? (
            <input
              key={id}
              className="oel-sheettab oel-sheettab--input"
              aria-label="Nouveau nom de la feuille"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setRenaming(null);
                }
              }}
            />
          ) : (
            <MenuTrigger key={id} isOpen={menu === id} onOpenChange={(o) => setMenu(o ? id : null)} trigger="longPress">
              <button
                type="button"
                role="tab"
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                draggable={!ro}
                className={`oel-sheettab${on ? ' is-on' : ''}${dragging === id ? ' is-dragging' : ''}`}
                style={p.tabColor ? { boxShadow: `inset 0 -3px 0 ${p.tabColor.css}` } : undefined}
                onClick={() => ctl.setSheet(id)}
                onDoubleClick={() => !ro && action(id, 'rename')}
                onContextMenu={(e) => {
                  e.preventDefault();
                  ctl.setSheet(id);
                  if (!ro) setMenu(id);
                }}
                onKeyDown={(e) => {
                  const i = visible.indexOf(id);
                  if (e.key === 'ArrowRight' && visible[i + 1]) ctl.setSheet(visible[i + 1]!);
                  if (e.key === 'ArrowLeft' && visible[i - 1]) ctl.setSheet(visible[i - 1]!);
                  if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
                    e.preventDefault();
                    if (!ro) setMenu(id);
                  }
                  if (e.key === 'F2' && !ro) action(id, 'rename');
                }}
                onDragStart={(e) => {
                  setDragging(id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/x-oel-sheet', id);
                }}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => dragging && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = e.dataTransfer.getData('text/x-oel-sheet');
                  if (from && from !== id) ctl.doc.moveSheet(from, ids.indexOf(id));
                  setDragging(null);
                }}
              >
                {p.name}
              </button>
              <MenuPopover placement="top start">
                <Menu aria-label={`Feuille ${p.name}`} onAction={(k) => action(id, String(k))}>
                  <MenuItem id="rename">Renommer</MenuItem>
                  <MenuItem id="duplicate" isDisabled={csv}>Dupliquer</MenuItem>
                  <MenuItem id="delete">Supprimer</MenuItem>
                  <MenuItem id="hide">Masquer</MenuItem>
                  <MenuSeparator />
                  <MenuItem id="left">Déplacer à gauche</MenuItem>
                  <MenuItem id="right">Déplacer à droite</MenuItem>
                  <MenuSeparator />
                  {[
                    ...TAB_COLORS.map((c) => (
                      <MenuItem key={c} id={`color:${c}`} textValue={`Couleur ${c}`}>
                        <span className="oel-tabcolor" style={{ background: c }} aria-hidden /> Couleur d’onglet
                      </MenuItem>
                    )),
                    <MenuItem key="none" id="color:none">Sans couleur</MenuItem>,
                    ...hidden.map((h) => (
                      <MenuItem key={h} id={`unhide:${h}`}>
                        Afficher « {ctl.doc.props(h).name} »
                      </MenuItem>
                    )),
                  ]}
                </Menu>
              </MenuPopover>
            </MenuTrigger>
          );
        })}
      </div>
      <span className="oel-sheetbar__stats" role="status" aria-live="polite">
        {stats.numbers > 0 ? (
          <>
            Somme : {fmt.format(stats.sum)} · Moyenne : {fmt.format(stats.avg!)} · Nombre : {stats.count}
            {stats.numbers > 1 && ` · Min : ${fmt.format(stats.min!)} · Max : ${fmt.format(stats.max!)}`}
          </>
        ) : stats.count > 1 ? (
          <>Nombre : {stats.count}</>
        ) : null}
      </span>
      <span className="oel-sheetbar__zoom" role="group" aria-label="Zoom">
        <Button size="icon-sm" variant="ghost" leadingIcon="minus" aria-label="Zoom arrière" onPress={() => setZoom(Math.max(0.5, Math.round((zoom - 0.1) * 10) / 10))} />
        <span aria-live="polite">{Math.round(zoom * 100)} %</span>
        <Button size="icon-sm" variant="ghost" leadingIcon="plus" aria-label="Zoom avant" onPress={() => setZoom(Math.min(2, Math.round((zoom + 0.1) * 10) / 10))} />
      </span>
    </footer>
  );
}
