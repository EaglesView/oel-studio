import { Icon, Toolbar, ToolButton } from '@oel/emboss';
import type { WorkspaceProps } from '../OpenSheet';
import { Inspector, InspectorRow } from './Inspector';

/** Until a PDF engine draws, annotates and converts PDFs (plan solo MVP, R2: no stand-in pages). */
const PDF_ENGINE_LATER = 'Arrive avec le moteur PDF.';

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
        <Toolbar aria-label="Outils d’annotation" orientation="vertical" className="tool-rail">
          <ToolButton icon="highlight" label="Surligner" unavailableReason={PDF_ENGINE_LATER} />
          <ToolButton icon="note" label="Note de texte" unavailableReason={PDF_ENGINE_LATER} />
          <ToolButton icon="pen" label="Signer" unavailableReason={PDF_ENGINE_LATER} />
          <ToolButton icon="sparkle" label="Convertir pour modifier" unavailableReason={PDF_ENGINE_LATER} />
        </Toolbar>
        <div className="workspace-empty">
          <Icon name="pdf" size={40} />
          <p>
            {paper.title}
            {pages != null ? ` · ${pages} page${pages > 1 ? 's' : ''}` : ''}
          </p>
          <p>Le bureau garde ce PDF ; l’afficher, l’annoter et le convertir en document arrivent avec le moteur PDF.</p>
        </div>
      </div>

      <Inspector title="PDF">
        <InspectorRow label="Pages" value={pages ?? '—'} />
        <InspectorRow label="Texte" value={scanned ? 'Numérisé (image)' : 'Sélectionnable'} />
      </Inspector>
    </div>
  );
}
