import type { MenuEntry } from './MenuBar';

/**
 * The entries a menu actually shows: `hidden` ones (features this edition doesn't ship) are
 * left out, in submenus too, along with submenus left empty and the separators they leave at
 * the ends or side by side.
 */
export function visibleItems(items: Array<MenuEntry | '-'>): Array<MenuEntry | '-'> {
  const out: Array<MenuEntry | '-'> = [];
  for (const it of items) {
    if (it === '-') {
      if (out.length && out[out.length - 1] !== '-') out.push(it);
      continue;
    }
    if (it.hidden) continue;
    if (!it.children) {
      out.push(it);
      continue;
    }
    const children = visibleItems(it.children).filter((c): c is MenuEntry => c !== '-');
    if (children.length) out.push({ ...it, children });
  }
  if (out[out.length - 1] === '-') out.pop();
  return out;
}
