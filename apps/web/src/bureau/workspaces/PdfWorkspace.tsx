import { Icon, Toolbar, ToolButton } from '@oel/emboss';
import type { WorkspaceProps } from '../OpenSheet';
import { Inspector, InspectorRow } from './Inspector';
import { messages, plural } from '@oel/i18n';

const t = messages(
  {
    later: 'Arrive avec le moteur PDF.',
    tools: 'Outils d’annotation',
    highlight: 'Surligner',
    note: 'Note de texte',
    sign: 'Signer',
    convert: 'Convertir pour modifier',
    pages: (n: number) => `${n} ${plural(n, 'page', 'pages')}`,
    kept: 'Le bureau garde ce PDF ; l’afficher, l’annoter et le convertir en document arrivent avec le moteur PDF.',
    pagesLabel: 'Pages',
    text: 'Texte',
    scanned: 'Numérisé (image)',
    selectable: 'Sélectionnable',
  },
  {
    later: 'Comes with the PDF engine.',
    tools: 'Annotation tools',
    highlight: 'Highlight',
    note: 'Text note',
    sign: 'Sign',
    convert: 'Convert to edit',
    pages: (n) => `${n} ${plural(n, 'page', 'pages')}`,
    kept: 'The desk keeps this PDF; showing it, annotating it and converting it to a document come with the PDF engine.',
    pagesLabel: 'Pages',
    text: 'Text',
    scanned: 'Scanned (image)',
    selectable: 'Selectable',
  },
);

/** Until a PDF engine draws, annotates and converts PDFs (plan solo MVP, R2: no stand-in pages). */
const PDF_ENGINE_LATER = t.later;

/**
 * 04 · Annoter, as far as it goes today: the PDF's facts and what is coming. The Figma rail
 * (select, highlight, note, sign) and « Convertir pour modifier » (06) are shown unavailable,
 * with the reason, rather than drawing pages that are not the file's.
 */
export function PdfWorkspace({ paper }: WorkspaceProps) {
  const pages = paper.data.preview.kind === 'pdf' ? paper.data.preview.pageCount : null;
  const scanned = paper.data.preview.kind === 'pdf' && paper.data.preview.scanned;

  return (
    <div className="ws ws--pdf">
      <div className="ws__stage ws__stage--pdf">
        <Toolbar aria-label={t.tools} orientation="vertical" className="tool-rail">
          <ToolButton icon="highlight" label={t.highlight} unavailableReason={PDF_ENGINE_LATER} />
          <ToolButton icon="note" label={t.note} unavailableReason={PDF_ENGINE_LATER} />
          <ToolButton icon="pen" label={t.sign} unavailableReason={PDF_ENGINE_LATER} />
          <ToolButton icon="sparkle" label={t.convert} unavailableReason={PDF_ENGINE_LATER} />
        </Toolbar>
        <div className="workspace-empty">
          <Icon name="pdf" size={40} />
          <p>
            {paper.title}
            {pages != null ? ` · ${t.pages(pages)}` : ''}
          </p>
          <p>{t.kept}</p>
        </div>
      </div>

      <Inspector title="PDF">
        <InspectorRow label={t.pagesLabel} value={pages ?? '—'} />
        <InspectorRow label={t.text} value={scanned ? t.scanned : t.selectable} />
      </Inspector>
    </div>
  );
}
