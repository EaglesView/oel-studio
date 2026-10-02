import { useState } from 'react';
import { Badge, Button, Toolbar, ToolbarToggle } from '@oel/emboss';
import type { WorkspaceProps } from '../OpenSheet';
import { Inspector, InspectorRow } from './Inspector';

type Tool = 'select' | 'highlight' | 'text' | 'sign';

/**
 * 04 · Annoter: read-only pages lie on a debossed desk; a vertical rail holds
 * latching tools. Text edits need a conversion step (06), offered up front.
 */
export function PdfWorkspace({ paper, onConvert }: WorkspaceProps) {
  const [tool, setTool] = useState<Tool>('select');
  const pages = paper.data.preview.kind === 'pdf' ? paper.data.preview.pageCount : 1;
  const scanned = paper.data.preview.kind === 'pdf' && paper.data.preview.scanned;
  const readOnly = paper.data.status.state === 'readonly';

  return (
    <div className="ws ws--pdf">
      <div className="ws__ribbon ws__ribbon--pdf">
        {readOnly && (
          <p className="ws__notice">
            <span>{paper.data.status.state === 'readonly' ? paper.data.status.reason : ''}</span>
            <Button variant="primary" size="sm" leadingIcon="sparkle" onPress={() => onConvert(paper.id)}>
              Convertir pour modifier
            </Button>
          </p>
        )}
      </div>

      <div className="ws__stage ws__stage--pdf">
        <Toolbar aria-label="Outils d’annotation" orientation="vertical" className="tool-rail">
          {(
            [
              ['select', 'move', 'Sélectionner', 'V'],
              ['highlight', 'highlight', 'Surligner', 'H'],
              ['text', 'note', 'Note de texte', 'T'],
              ['sign', 'pen', 'Signer', 'S'],
            ] as const
          ).map(([id, icon, label, key]) => (
            <ToolbarToggle key={id} icon={icon} label={label} shortcut={[key]} isSelected={tool === id} onChange={() => setTool(id)} />
          ))}
        </Toolbar>
        <div className="pdf-pages" role="document" aria-label={`${paper.title}, ${pages} pages`}>
          {Array.from({ length: Math.min(pages, 6) }, (_, i) => (
            <div key={i} className="pdf-page" aria-label={`Page ${i + 1}`} role="img">
              {i === 0 && <h3 className="paper__pdf-title">{paper.title}</h3>}
              <div className="paper__bars">
                {Array.from({ length: 14 }, (_, j) => (
                  <span key={j} style={{ width: j % 5 === 4 ? '55%' : '100%' }} />
                ))}
              </div>
              {i === pages - 1 && paper.data.stamp && (
                <Badge appearance="stamp" tone={paper.data.stamp.tone} tilt={6} className="pdf-page__stamp">
                  {paper.data.stamp.label}
                </Badge>
              )}
            </div>
          ))}
        </div>
      </div>

      <Inspector title="PDF">
        <InspectorRow label="Pages" value={pages} />
        <InspectorRow label="Texte" value={scanned ? 'Numérisé (image)' : 'Sélectionnable'} />
        <InspectorRow label="Outil" value={{ select: 'Sélection', highlight: 'Surligneur', text: 'Note', sign: 'Signature' }[tool]} />
      </Inspector>
    </div>
  );
}
