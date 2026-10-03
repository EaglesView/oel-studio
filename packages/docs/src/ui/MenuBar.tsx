import { Fragment } from 'react';
import { MenuTrigger, SubmenuTrigger } from 'react-aria-components';
import { Button, Menu, MenuItem, MenuPopover, MenuSeparator, ToolButton, type IconName } from '@oel/emboss';

export interface MenuEntry {
  id: string;
  label: string;
  icon?: IconName;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  children?: MenuEntry[];
}

export type MenuSpec = Array<{ label: string; items: Array<MenuEntry | '-'> }>;

function renderItems(items: Array<MenuEntry | '-'>, onAction: (id: string) => void) {
  return items.map((it, i) => {
    if (it === '-') return <MenuSeparator key={`sep-${i}`} />;
    const label = it.checked != null ? `${it.checked ? '✓ ' : ' '}${it.label}` : it.label;
    if (it.children) {
      return (
        <SubmenuTrigger key={it.id}>
          <MenuItem id={it.id} icon={it.icon} textValue={it.label} isDisabled={it.disabled}>
            {label}
          </MenuItem>
          <MenuPopover placement="end top">
            <Menu aria-label={it.label} onAction={(k) => onAction(String(k))} disabledKeys={it.children.filter((c) => !!c.disabled).map((c) => c.id)}>
              {renderItems(it.children, onAction)}
            </Menu>
          </MenuPopover>
        </SubmenuTrigger>
      );
    }
    return (
      <MenuItem key={it.id} id={it.id} icon={it.icon} shortcut={it.shortcut} textValue={it.label} isDisabled={it.disabled}>
        {label}
      </MenuItem>
    );
  });
}

/** Docs menu bar: Fichier, Édition, Affichage, Insertion, Format, Outils. */
export function MenuBar({ spec, onAction }: { spec: MenuSpec; onAction: (id: string) => void }) {
  return (
    <nav className="oel-menubar" aria-label="Menus du document">
      {spec.map((menu) => (
        <Fragment key={menu.label}>
          <MenuTrigger>
            <Button variant="ghost" size="sm" className="oel-menubar__trigger">
              {menu.label}
            </Button>
            <MenuPopover placement="bottom start">
              <Menu aria-label={menu.label} onAction={(k) => onAction(String(k))} disabledKeys={menu.items.filter((c): c is MenuEntry => c !== '-' && !!c.disabled).map((c) => c.id)}>
                {renderItems(menu.items, onAction)}
              </Menu>
            </MenuPopover>
          </MenuTrigger>
        </Fragment>
      ))}
    </nav>
  );
}

/**
 * The same menus folded into one « Plus » tool, for the compact sheet
 * (ouvert sur place) where the full menu bar would crowd the ribbon.
 */
export function MoreMenu({ spec, onAction }: { spec: MenuSpec; onAction: (id: string) => void }) {
  return (
    <MenuTrigger>
      <ToolButton icon="more" label="Plus de commandes" description="Fichier, Édition, Affichage, Insertion, Format et Outils." />
      <MenuPopover placement="bottom end">
        <Menu aria-label="Plus de commandes" onAction={(k) => onAction(String(k))}>
          {renderItems(
            spec.map((m) => ({ id: `menu:${m.label}`, label: m.label, children: m.items.filter((i): i is MenuEntry => i !== '-') })),
            onAction,
          )}
        </Menu>
      </MenuPopover>
    </MenuTrigger>
  );
}
