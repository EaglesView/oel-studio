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
      [['+', '−'], 'Zoom avant · arrière (arrière : jusqu’à 25 %)'],
      [['0'], 'Revenir à 100 %'],
      [['Ctrl', 'molette'], 'Zoom au pointeur · molette seule : défiler'],
      [['Espace', 'glisser'], 'Déplacer la vue à la souris'],
    ],
  },
  {
    title: 'Outils',
    rows: [
      [['/'], 'Aller aux outils de la sélection'],
      [['N'], 'Nouvelle note'],
      [['Ctrl', 'O'], 'Importer des fichiers'],
      [['Alt', 'N'], 'Nouveau fichier (menu « + »)'],
      [['Maj', 'F10'], 'Menu contextuel'],
      [['Ctrl', 'Maj', 'Entrée'], 'Ouvrir la sélection en plein écran'],
      [['?'], 'Afficher cette aide'],
    ],
  },
  {
    title: 'Fichier ouvert',
    rows: [
      [['Échap'], 'Un niveau à la fois : termine l’action en cours, puis plein écran → sur place → bureau'],
      [['Ctrl', 'Maj', 'Entrée'], 'Agrandir en plein écran · réduire'],
      [['Retour'], 'Le bouton Retour du navigateur fait comme Échap'],
      [['Ctrl', 'Maj', 'F'], 'Mode concentration (Alt ou bouger la souris : outils visibles)'],
      [['Ctrl', 'Maj', 'P'], 'Plan du document'],
    ],
  },
  {
    title: 'Document',
    rows: [
      [['Ctrl', 'B · I · U'], 'Gras · italique · souligné'],
      [['Ctrl', 'Alt', '1–6'], 'Titres · Ctrl+Alt+0 texte normal'],
      [['Ctrl', 'Maj', '7 · 8 · 9'], 'Liste numérotée · à puces · de contrôle'],
      [['Ctrl', 'K'], 'Lien'],
      [['Ctrl', 'Entrée'], 'Saut de page'],
      [['Ctrl', 'Alt', 'F'], 'Note de bas de page'],
      [['Ctrl', 'F · H'], 'Rechercher · remplacer'],
      [['Ctrl', '\\'], 'Effacer la mise en forme'],
      [['Ctrl', 'Maj', 'C'], 'Nombre de mots'],
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
