import { Icon, Toolbar, ToolButton } from '@oel/emboss';
import type { WorkspaceProps } from '../OpenSheet';
import { Inspector, InspectorRow } from './Inspector';

const IMAGE_ENGINE_LATER = 'Arrive avec le moteur d’images oelimg-rs (WASM).';

export function ImageWorkspace({ paper }: WorkspaceProps) {
  const p = paper.data.preview;
  return (
    <div className="ws ws--image">
      <div className="ws__ribbon">
        <Toolbar aria-label="Outils d’image">
          <ToolButton icon="crop" label="Rogner" showLabel unavailableReason={IMAGE_ENGINE_LATER} />
          <ToolButton icon="sparkle" label="Détourer" showLabel unavailableReason={IMAGE_ENGINE_LATER} />
          <ToolButton icon="search" label="Texte (OCR)" showLabel unavailableReason={IMAGE_ENGINE_LATER} />
          <ToolButton icon="download" label="Exporter" showLabel unavailableReason={IMAGE_ENGINE_LATER} />
        </Toolbar>
      </div>
      <div className="ws__stage">
        <figure className="ws-photo">
          {paper.data.imageUrl ? (
            <img src={paper.data.imageUrl} alt={paper.title} />
          ) : (
            <div className="ws-photo__placeholder" role="img" aria-label={`${paper.title} (aperçu indisponible)`}>
              <Icon name="image" size={64} />
            </div>
          )}
          <figcaption>{paper.data.fileName ?? paper.title}</figcaption>
        </figure>
      </div>
      <Inspector title="Image">
        <InspectorRow label="Dimensions" value={p.kind === 'image' && p.width ? `${p.width} × ${p.height} px` : '—'} />
        <InspectorRow label="Fichier" value={paper.data.fileName ?? '—'} />
      </Inspector>
    </div>
  );
}
