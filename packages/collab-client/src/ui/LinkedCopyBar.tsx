import type { CSSProperties, ReactNode } from 'react';
import { Toolbar, ToolbarSeparator, ToolButton } from '@oel/emboss';

/** What the bar of a linked copy shows about its link (the host reads it from @oel/links). */
export interface LinkedCopyInfo {
  /** Source title (« Budget 2027 », « affiche-v3.png »). */
  source: string;
  /** State in words (« À jour », « En retard »…). */
  stateLabel: string;
  stale: boolean;
  frozen: boolean;
  /** Why « Voir la source » is unavailable. */
  sourceUnavailable?: string;
  onSource: () => void;
  onUpdate: () => void;
  onManage: (anchor: { x: number; y: number; width: number; height: number }) => void;
}

/**
 * The floating bar over a linked copy that isn't a chart (Figma I1: pictures;
 * later tables and values): its own tools first (`children`), then the link —
 * « Voir la source », « Mettre à jour » when it's behind, and the link popover.
 */
export function LinkedCopyBar({ label, link, children, style, className }: { label: string; link: LinkedCopyInfo; children?: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <div className={`oel-chart-bar${className ? ` ${className}` : ''}`} style={style} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.preventDefault()} onKeyDown={(e) => e.stopPropagation()}>
      <Toolbar aria-label={label}>
        <span className="oel-chart-bar__label">{label}</span>
        {children}
        {children && <ToolbarSeparator />}
        <ToolButton icon="table" label="Voir la source" showLabel description={`Ouvrir ${link.source}`} unavailableReason={link.sourceUnavailable} onPress={link.onSource} />
        {link.stale && !link.frozen && <ToolButton icon="refresh" label="Mettre à jour" showLabel onPress={link.onUpdate} />}
        <ToolButton
          icon="link"
          label={`Lien · ${link.stateLabel}`}
          description="Mode, mise à jour, couper le lien"
          onPress={() => {
            const r = document.activeElement?.getBoundingClientRect() ?? { x: 0, y: 0, width: 0, height: 0 };
            link.onManage({ x: r.x, y: r.y, width: r.width, height: r.height });
          }}
        />
      </Toolbar>
    </div>
  );
}
