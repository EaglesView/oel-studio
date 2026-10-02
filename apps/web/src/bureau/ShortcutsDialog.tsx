import { DialogOverlay, Kbd, SheetDialog } from '@oel/emboss';

const GROUPS: Array<{ title: string; rows: Array<[string[], string]> }> = [
  {
    title: 'Sur le bureau',
    rows: [
      [['←', '↑', '→', '↓'], 'Passer au fichier voisin'],
      [['Espace'], 'Ajouter ou retirer de la sélection'],
      [['Ctrl', 'A'], 'Tout sélectionner'],
      [['Entrée'], 'Ouvrir sur place'],
      [['Échap'], 'Désélectionner · reposer le fichier ouvert'],
      [['Alt', '← ↑ → ↓'], 'Déplacer la sélection (Maj : plus loin)'],
      [['Maj', '← ↑ → ↓'], 'Faire défiler le bureau'],
      [['Suppr'], 'Retirer du bureau (annulable)'],
      [['Ctrl', 'Z'], 'Annuler · Ctrl+Maj+Z rétablir'],
    ],
  },
  {
    title: 'Vue',
    rows: [
      [['+', '−'], 'Zoom avant · arrière'],
      [['0'], 'Tout voir'],
      [['1', '2', '3'], 'Ensemble · Repérage · Travail'],
      [['Ctrl', 'molette'], 'Zoom au pointeur · molette seule : défiler'],
      [['Espace', 'glisser'], 'Déplacer la vue à la souris'],
    ],
  },
  {
    title: 'Outils',
    rows: [
      [['/'], 'Aller aux outils de la sélection'],
      [['C'], 'Commenter le fichier sélectionné'],
      [['N'], 'Nouvelle note'],
      [['Ctrl', 'O'], 'Importer des fichiers'],
      [['Maj', 'F10'], 'Menu contextuel'],
      [['Ctrl', 'Entrée'], 'Plein écran (fichier ouvert)'],
      [['?'], 'Afficher cette aide'],
    ],
  },
];

/** B3 · "Clavier d'abord": every shortcut, grouped. */
export function ShortcutsDialog({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={onOpenChange}>
      <SheetDialog title="Raccourcis clavier" width={640}>
        <div className="shortcuts">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="emb-t-overline">{g.title}</h3>
              <dl>
                {g.rows.map(([keys, what]) => (
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
      </SheetDialog>
    </DialogOverlay>
  );
}
