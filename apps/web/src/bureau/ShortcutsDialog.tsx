import { DialogOverlay, Kbd, SheetDialog } from '@oel/emboss';
import { shortcutGroups } from './shortcuts';
import { lang, tr } from '@oel/i18n';

/** B3 · "Clavier d'abord": every shortcut, grouped (the dialog, and the menu's « Raccourcis clavier »), in the interface language. */
export function ShortcutsList() {
  return (
    <div className="shortcuts">
      {shortcutGroups(lang()).map((g) => (
        <section key={g.title}>
          <h3 className="emb-t-overline">{g.title}</h3>
          <dl>
            {g.rows.map(({ keys, what }) => (
              <div key={what} className="shortcuts__row">
                <dt>
                  {keys.map((k, i) => (
                    <Kbd key={i}>{k}</Kbd>
                  ))}
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

export function ShortcutsDialog({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={onOpenChange}>
      <SheetDialog title={tr('Raccourcis clavier', 'Keyboard shortcuts')} width={640}>
        <ShortcutsList />
      </SheetDialog>
    </DialogOverlay>
  );
}
