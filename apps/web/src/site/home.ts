/**
 * Home page content (Figma « Site — bureau.outilsenligne.ca », direction D2 « Média d’abord »,
 * frame 212:19294), for the single-user release: one capture per section, bands alternating
 * violet, night and paper. Left out from D2 for now: forms, teamwork, « Se connecter ».
 */
import type { DocId, Lang } from './i18n';
import type { CaptureId } from './captures';

export type Band = 'violet' | 'night' | 'paper' | 'sheet';

export interface Feature {
  id: string;
  band: Band;
  overline: string;
  /** Lines of the headline (each its own line on wide screens). */
  title: string[];
  lead: string;
  more: { doc: DocId; hash?: string };
  capture: { id: CaptureId; alt: string };
}

export interface HomeContent {
  title: string;
  description: string;
  hero: { title: string; lead: string; primary: string; secondary: string; capture: { id: CaptureId; alt: string } };
  features: Feature[];
  extras: { title: string; tiles: Array<{ icon: 'sparkle' | 'laptop' | 'check' | 'lock'; title: string; text: string }> };
  code: { overline: string; title: string; lead: string; crates: Array<{ name: string; text: string }>; foot: string; source: string };
  faq: { title: string; items: Array<{ q: string; a: string }> };
  cta: { title: string; button: string };
}

const fr: HomeContent = {
  title: 'Bureau · OutilsEnLigne — tous vos fichiers sur un seul bureau',
  description: 'Documents, tableurs, présentations et images côte à côte, dans votre navigateur. Gratuit, sans compte, vos fichiers Office intacts.',
  hero: {
    title: 'Bureau.',
    lead: 'Tous vos fichiers d’études sur un seul bureau. Gratuit, dans votre navigateur.',
    primary: 'Ouvrir le Bureau',
    secondary: 'Lire la documentation',
    capture: { id: 'desk', alt: 'Le bureau : un tableur, une présentation, une image et un document posés côte à côte, reliés par des fils.' },
  },
  features: [
    {
      id: 'documents',
      band: 'night',
      overline: 'Documents',
      title: ['Votre .docx.', 'Intact, à l’aller comme au retour.'],
      lead: 'Un vrai traitement de texte : styles Word, listes, tableaux, notes de bas de page, en-têtes et pieds de page, plan cliquable.',
      more: { doc: 'editeurs', hash: 'documents' },
      capture: { id: 'document', alt: 'Un document Word ouvert en plein écran, avec son plan et sa barre d’outils.' },
    },
    {
      id: 'tableurs',
      band: 'paper',
      overline: 'Tableurs',
      title: ['Des formules qui calculent', 'pour vrai.'],
      lead: 'Formules en anglais, comme dans Excel : XLOOKUP, MINIFS, RANK.EQ… Tri, filtres, mise en forme — et le .xlsx revient tel quel.',
      more: { doc: 'editeurs', hash: 'tableurs' },
      capture: { id: 'sheet', alt: 'Un tableur de temps de course : résultats calculés à partir d’un autre onglet.' },
    },
    {
      id: 'graphiques',
      band: 'violet',
      overline: 'Graphiques',
      title: ['Un clic sur le graphique.', 'Un autre sur la série.'],
      lead: 'Insérez-le avec Alt + F1, réglez chaque élément. Les graphiques Office s’ouvrent et se modifient sans se défaire.',
      more: { doc: 'editeurs', hash: 'graphiques' },
      capture: { id: 'chart', alt: 'Un graphique sélectionné dans le tableur, avec ses réglages.' },
    },
    {
      id: 'presentations',
      band: 'night',
      overline: 'Présentations',
      title: ['Présentez,', 'directement du navigateur.'],
      lead: 'Dispositions, formes, images, notes de l’orateur, vue présentateur dans une deuxième fenêtre — et le .pptx revient tel quel.',
      more: { doc: 'editeurs', hash: 'presentations' },
      capture: { id: 'slides', alt: 'Une présentation ouverte : la pellicule à gauche, la diapo au centre.' },
    },
    {
      id: 'images',
      band: 'paper',
      overline: 'Images',
      title: ['Simple pour tous.', 'Avancé quand il le faut.'],
      lead: 'Recadrez, redressez, retouchez. Chaque copie liée suit la retouche, partout.',
      more: { doc: 'editeurs', hash: 'images' },
      capture: { id: 'image', alt: 'L’atelier d’image : styles, lumière et couleur à droite de la photo.' },
    },
    {
      id: 'liens',
      band: 'sheet',
      overline: 'Fils de liaison',
      title: ['Liez un graphique.', 'Il suit le tableur.'],
      lead: 'Un graphique, une plage, une image : mettez-les dans une présentation ou un document, ils restent à jour. Sur le bureau, un fil relie la source à ses copies.',
      more: { doc: 'liens' },
      capture: { id: 'links', alt: 'La diapo 3 montre le graphique du tableur ; un fil violet les relie sur le bureau.' },
    },
  ],
  extras: {
    title: 'Et tout ce qui va avec.',
    tiles: [
      { icon: 'sparkle', title: 'Gratuit pour les études', text: 'Aucun compte, aucun essai qui expire.' },
      { icon: 'laptop', title: 'Dans votre navigateur', text: 'Vos fichiers restent sur cet appareil ; exportez le bureau en .zip pour en garder une copie.' },
      { icon: 'check', title: 'Vos formats, intacts', text: 'Ce que vous ne modifiez pas reste identique dans le fichier.' },
      { icon: 'lock', title: 'Moteurs libres', text: 'Rust et WebAssembly, sous licence MPL-2.0.' },
    ],
  },
  code: {
    overline: 'Code ouvert',
    title: 'Les moteurs qui lisent vos fichiers sont libres.',
    lead: 'Le décodage des .docx, .xlsx et .pptx, le calcul et la retouche d’images tournent dans votre navigateur, en WebAssembly. Chacun peut les lire, les vérifier et les réutiliser.',
    crates: [
      { name: 'oel-opc', text: 'Paquets Office sans perte' },
      { name: 'oel-docx', text: 'Word ⇄ document' },
      { name: 'oel-xlsx', text: 'Excel et CSV, calcul' },
      { name: 'oel-pptx', text: 'PowerPoint ⇄ diapos' },
      { name: 'oel-chart', text: 'Graphiques Office' },
      { name: 'oel-img', text: 'Retouche d’images' },
    ],
    foot: 'Rust · WebAssembly · MPL-2.0',
    source: 'Voir le code source',
  },
  faq: {
    title: 'Questions fréquentes',
    items: [
      { q: 'Faut-il un compte ?', a: 'Non. Le Bureau s’ouvre et s’utilise sans inscription.' },
      {
        q: 'Où sont mes fichiers ?',
        a: 'Dans ce navigateur, sur cet appareil. Rien n’est envoyé à un serveur. Effacer les données du site les efface aussi : exportez le bureau de temps en temps (menu, « Ouvrir et importer »).',
      },
      {
        q: 'Mes fichiers Word, Excel et PowerPoint restent-ils intacts ?',
        a: 'Ce que vous ne modifiez pas est réécrit tel quel ; ce que vous modifiez suit le format d’origine. Ce que le Bureau ne sait pas encore modifier (animations, SmartArt…) est conservé.',
      },
      { q: 'Peut-on travailler à plusieurs ?', a: 'Pas dans cette version : le travail en équipe (partage, présence, formulaires) viendra ensuite.' },
      { q: 'Et les PDF ?', a: 'Ils se posent sur le bureau avec leur nombre de pages ; les afficher, les annoter et les convertir arriveront avec le moteur PDF.' },
    ],
  },
  cta: { title: 'Ouvrez le Bureau.', button: 'C’est parti' },
};

const en: HomeContent = {
  title: 'Bureau · OutilsEnLigne — all your files on one desk',
  description: 'Documents, spreadsheets, presentations and images side by side, in your browser. Free, no account, your Office files intact.',
  hero: {
    title: 'Bureau.',
    lead: 'All your school files on one desk. Free, in your browser.',
    primary: 'Open the Bureau',
    secondary: 'Read the docs',
    capture: { id: 'desk', alt: 'The desk: a spreadsheet, a presentation, an image and a document side by side, joined by threads.' },
  },
  features: [
    {
      id: 'documents',
      band: 'night',
      overline: 'Documents',
      title: ['Your .docx.', 'Intact, there and back.'],
      lead: 'A real word processor: Word styles, lists, tables, footnotes, headers and footers, a clickable outline.',
      more: { doc: 'editeurs', hash: 'documents' },
      capture: { id: 'document', alt: 'A Word document open full screen, with its outline and toolbar.' },
    },
    {
      id: 'spreadsheets',
      band: 'paper',
      overline: 'Spreadsheets',
      title: ['Formulas that', 'really calculate.'],
      lead: 'Formulas as in Excel: XLOOKUP, MINIFS, RANK.EQ… Sort, filters, formatting — and the .xlsx comes back as it was.',
      more: { doc: 'editeurs', hash: 'tableurs' },
      capture: { id: 'sheet', alt: 'A spreadsheet of race times: results computed from another tab.' },
    },
    {
      id: 'charts',
      band: 'violet',
      overline: 'Charts',
      title: ['One click on the chart.', 'Another on the series.'],
      lead: 'Insert one with Alt + F1 and tune every element. Office charts open and stay editable without falling apart.',
      more: { doc: 'editeurs', hash: 'graphiques' },
      capture: { id: 'chart', alt: 'A chart selected in the spreadsheet, with its settings.' },
    },
    {
      id: 'presentations',
      band: 'night',
      overline: 'Presentations',
      title: ['Present,', 'straight from the browser.'],
      lead: 'Layouts, shapes, pictures, speaker notes, a presenter view in a second window — and the .pptx comes back as it was.',
      more: { doc: 'editeurs', hash: 'presentations' },
      capture: { id: 'slides', alt: 'A presentation open: the filmstrip on the left, the slide in the middle.' },
    },
    {
      id: 'images',
      band: 'paper',
      overline: 'Images',
      title: ['Simple for everyone.', 'Advanced when you need it.'],
      lead: 'Crop, straighten, retouch. Every linked copy follows the retouch, everywhere.',
      more: { doc: 'editeurs', hash: 'images' },
      capture: { id: 'image', alt: 'The image workshop: styles, light and colour next to the photo.' },
    },
    {
      id: 'links',
      band: 'sheet',
      overline: 'Linked copies',
      title: ['Link a chart.', 'It follows the spreadsheet.'],
      lead: 'A chart, a range, an image: put them in a presentation or a document and they stay up to date. On the desk, a thread joins the source to its copies.',
      more: { doc: 'liens' },
      capture: { id: 'links', alt: 'Slide 3 shows the spreadsheet’s chart; a violet thread joins them on the desk.' },
    },
  ],
  extras: {
    title: 'And everything that comes with it.',
    tiles: [
      { icon: 'sparkle', title: 'Free for school', text: 'No account, no trial that runs out.' },
      { icon: 'laptop', title: 'In your browser', text: 'Your files stay on this device; export the desk as a .zip to keep a copy.' },
      { icon: 'check', title: 'Your formats, intact', text: 'What you don’t change stays the same in the file.' },
      { icon: 'lock', title: 'Open engines', text: 'Rust and WebAssembly, under the MPL-2.0 licence.' },
    ],
  },
  code: {
    overline: 'Open source',
    title: 'The engines that read your files are open source.',
    lead: 'Reading and writing .docx, .xlsx and .pptx, calculation and image retouching run in your browser, as WebAssembly. Anyone can read them, check them and reuse them.',
    crates: [
      { name: 'oel-opc', text: 'Lossless Office packages' },
      { name: 'oel-docx', text: 'Word ⇄ document' },
      { name: 'oel-xlsx', text: 'Excel and CSV, calculation' },
      { name: 'oel-pptx', text: 'PowerPoint ⇄ slides' },
      { name: 'oel-chart', text: 'Office charts' },
      { name: 'oel-img', text: 'Image retouching' },
    ],
    foot: 'Rust · WebAssembly · MPL-2.0',
    source: 'See the source code',
  },
  faq: {
    title: 'Questions',
    items: [
      { q: 'Do I need an account?', a: 'No. The Bureau opens and works without signing up.' },
      {
        q: 'Where are my files?',
        a: 'In this browser, on this device. Nothing is sent to a server. Clearing the site’s data clears them too: export the desk now and then (menu, “Ouvrir et importer”).',
      },
      {
        q: 'Do my Word, Excel and PowerPoint files stay intact?',
        a: 'What you don’t change is written back as it was; what you change follows the original format. What the Bureau can’t edit yet (animations, SmartArt…) is kept.',
      },
      { q: 'Can several people work together?', a: 'Not in this version: teamwork (sharing, presence, forms) comes next.' },
      { q: 'What about PDFs?', a: 'They sit on the desk with their page count; viewing, annotating and converting them come with the PDF engine.' },
    ],
  },
  cta: { title: 'Open the Bureau.', button: 'Let’s go' },
};

export const HOME: Record<Lang, HomeContent> = { fr, en };
