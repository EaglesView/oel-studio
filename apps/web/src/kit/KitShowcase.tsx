import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DialogOverlay,
  DialogTrigger,
  Icon,
  iconNames,
  NumberField,
  Pagination,
  Popover,
  ProgressBar,
  Radio,
  RadioGroup,
  Select,
  SelectItem,
  SheetDialog,
  Slider,
  Switch,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextField,
  NotificationsButton,
  ToastRegion,
  Toolbar,
  ToolbarSeparator,
  ToolbarToggle,
  ToolButton,
  toast,
  type ButtonVariant,
} from '@oel/emboss';
import { ThemeToggle } from '../bureau/ThemeToggle';
import './kit.css';

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'destructive', 'success'];

export function KitShowcase() {
  const [page, setPage] = useState(3);
  const [bold, setBold] = useState(true);

  return (
    <div className="kit">
      <div className="kit__theme">
        <ThemeToggle />
      </div>

      <section aria-labelledby="k-button">
        <h2 id="k-button">Bouton</h2>
        <p className="kit__note">Cinq variantes, quatre tailles. Survol 200 ms, appui 260 ms, focus : anneau de 2 px à 3 px du bord.</p>
        {VARIANTS.map((v) => (
          <div className="kit__row" key={v}>
            <span className="kit__label">{v}</span>
            <Button variant={v} size="sm" leadingIcon="plus">Petit</Button>
            <Button variant={v} leadingIcon="download">Moyen</Button>
            <Button variant={v} size="lg" trailingIcon="arrow-right">Grand</Button>
            <Button variant={v} size="icon" aria-label="Importer" leadingIcon="upload" />
            <Button variant={v} isDisabled>Désactivé</Button>
          </div>
        ))}
      </section>

      <section aria-labelledby="k-ribbon">
        <h2 id="k-ribbon">Ruban</h2>
        <p className="kit__note">Les bascules restent enfoncées quand elles sont actives. Survolez pour voir nom, raccourci et effet.</p>
        <Toolbar aria-label="Mise en forme">
          <ToolbarToggle icon="bold" label="Gras" shortcut={['Ctrl', 'B']} description="Met le texte sélectionné en gras." isSelected={bold} onChange={setBold} />
          <ToolbarToggle icon="italic" label="Italique" shortcut={['Ctrl', 'I']} />
          <ToolbarToggle icon="underline" label="Souligné" shortcut={['Ctrl', 'U']} />
          <ToolbarSeparator />
          <ToolbarToggle icon="align-left" label="Aligner à gauche" />
          <ToolbarSeparator />
          <ToolButton icon="image" label="Insérer une image" unavailableReason="Sélectionnez un paragraphe pour insérer une image." />
          <ToolButton icon="align-left" label="Taille du texte" value="11 pt" />
          <span style={{ flex: 1 }} />
          <ToolButton icon="mail" label="Partager" showLabel />
          <Button variant="primary" size="sm" leadingIcon="download">Exporter</Button>
        </Toolbar>
      </section>

      <section aria-labelledby="k-fields" className="kit__grid">
        <h2 id="k-fields">Champs</h2>
        <TextField label="Nom du fichier" placeholder="Ex. rapport-annuel" description="Lettres, chiffres et tirets." />
        <TextField label="Recherche" placeholder="Rechercher" leadingIcon="search" />
        <Select label="Type de document" placeholder="Choisir un type" description="Modifiable plus tard.">
          <SelectItem id="doc" icon="file">Document</SelectItem>
          <SelectItem id="slides" icon="slide">Présentation</SelectItem>
          <SelectItem id="sheet" icon="table">Tableur</SelectItem>
        </Select>
        <NumberField label="Nombre de copies" defaultValue={3} minValue={1} maxValue={99} description="Entre 1 et 99." />
        <TextField label="Note" multiline placeholder="Écrire une note…" isRequired errorMessage="Une note est requise." />
      </section>

      <section aria-labelledby="k-controls" className="kit__grid">
        <h2 id="k-controls">Sélection</h2>
        <RadioGroup label="Format d’exportation" defaultValue="pdf">
          <Radio value="pdf">PDF</Radio>
          <Radio value="docx">Word (.docx)</Radio>
          <Radio value="txt">Texte brut (.txt)</Radio>
        </RadioGroup>
        <div className="kit__stack">
          <Checkbox defaultSelected>Inclure les commentaires</Checkbox>
          <Checkbox isIndeterminate>Sélection partielle</Checkbox>
          <Switch defaultSelected>Synchronisation automatique</Switch>
          <Switch isDisabled>Désactivé</Switch>
        </div>
        <div className="kit__stack">
          <Slider label="Qualité de l’image" defaultValue={40} formatOptions={{ style: 'percent', maximumFractionDigits: 0 }} minValue={0} maxValue={1} step={0.01} />
          <ProgressBar label="Conversion en document modifiable…" value={64} />
        </div>
      </section>

      <section aria-labelledby="k-tabs">
        <h2 id="k-tabs">Onglets</h2>
        <Tabs>
          <TabList aria-label="Types de fichiers">
            <Tab id="docs">Documents</Tab>
            <Tab id="pres">Présentations</Tab>
            <Tab id="sheets">Tableurs</Tab>
          </TabList>
          <TabPanel id="docs" className="kit__cards">
            <Card title="Rapport annuel 2026" meta="Document · modifié il y a 2 h" media={null} onPress={() => toast({ title: 'Ouverture du rapport' })} />
            <Card title="Communiqué" meta="Document · modifié hier" media={null} onPress={() => {}} />
            <Card title="Notes de réunion" meta="Groupé, non interactif" appearance="debossed" />
          </TabPanel>
          <TabPanel id="pres" className="kit__cards">
            <Card title="Présentation T3" meta="Présentation · modifiée hier" media={null} onPress={() => {}} />
          </TabPanel>
          <TabPanel id="sheets" className="kit__cards">
            <Card title="Budget 2027" meta="Tableur · modifié le 28 sept." media={null} onPress={() => {}} />
          </TabPanel>
        </Tabs>
      </section>

      <section aria-labelledby="k-badges">
        <h2 id="k-badges">Badges</h2>
        <div className="kit__row">
          <Badge tone="accent">Nouveau</Badge>
          <Badge appearance="stamp" tone="success">Publié</Badge>
          <Badge appearance="stamp" tone="warning">En attente</Badge>
          <Badge appearance="stamp" tone="warning" tilt={6}>À signer</Badge>
          <Badge appearance="stamp" tone="danger">À vérifier</Badge>
          <Badge tone="neutral" dot={false}>12</Badge>
        </div>
      </section>

      <section aria-labelledby="k-overlays">
        <h2 id="k-overlays">Superpositions</h2>
        <div className="kit__row">
          <DialogTrigger>
            <Button variant="destructive" leadingIcon="trash">Supprimer le document</Button>
            <DialogOverlay>
              <SheetDialog
                title="Supprimer « Rapport annuel 2026 » ?"
                tone="destructive"
                role="alertdialog"
                actions={(close) => (
                  <>
                    <Button variant="ghost" onPress={close}>Annuler</Button>
                    <Button
                      variant="destructive"
                      leadingIcon="trash"
                      onPress={() => {
                        close();
                        toast({ title: 'Document supprimé', tone: 'danger', action: { label: 'Annuler', onAction: () => toast({ title: 'Restauré', tone: 'success' }) } });
                      }}
                    >
                      Supprimer
                    </Button>
                  </>
                )}
              >
                Le fichier ira dans la corbeille pendant 30 jours.
              </SheetDialog>
            </DialogOverlay>
          </DialogTrigger>
          <DialogTrigger>
            <Button leadingIcon="info">Popover</Button>
            <Popover placement="top">
              <strong className="kit__pop-title">Lien en retard</strong>
              <p className="kit__pop-body">La copie dans « Bilan » date d’avant la dernière modification du tableur.</p>
              <Button size="sm" variant="primary">Actualiser</Button>
            </Popover>
          </DialogTrigger>
          <Button variant="success" leadingIcon="check" onPress={() => toast({ title: 'Enregistré', description: 'Toutes les modifications sont sauvegardées.', tone: 'success' })}>
            Afficher un toast
          </Button>
          <Button
            leadingIcon="plus"
            onPress={() => {
              const pile: Parameters<typeof toast>[0][] = [
                { title: 'Document enregistré', description: 'Toutes vos modifications sont dans le nuage.' },
                { title: 'Exportation terminée', description: 'rapport-annuel.pdf est prêt à télécharger.', tone: 'success' },
                { title: 'Espace presque plein', description: 'Il vous reste 200 Mo sur 5 Go.', tone: 'warning' },
                { title: 'Échec de l’envoi', description: 'Vérifiez votre connexion puis réessayez.', tone: 'danger', action: { label: 'Réessayer', onAction: () => {} } },
              ];
              pile.forEach((t, i) => setTimeout(() => toast(t), i * 400));
            }}
          >
            Empiler 4 toasts
          </Button>
          <NotificationsButton />
        </div>
      </section>

      <section aria-labelledby="k-pagination">
        <h2 id="k-pagination">Pagination</h2>
        <Pagination page={page} pageCount={12} onChange={setPage} />
      </section>

      <section aria-labelledby="k-icons">
        <h2 id="k-icons">Icônes</h2>
        <p className="kit__note">Grille 24, trait 1,75. Les icônes du kit Figma, plus celles ajoutées pour l’éditeur.</p>
        <ul className="kit__icons">
          {iconNames.map((n) => (
            <li key={n}>
              <Icon name={n} size={24} />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      </section>

      <ToastRegion />
    </div>
  );
}
