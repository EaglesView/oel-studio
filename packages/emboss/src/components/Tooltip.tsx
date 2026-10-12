import type { ReactElement, ReactNode } from 'react';
import {
  OverlayArrow,
  Tooltip as RACTooltip,
  TooltipTrigger,
  type TooltipProps as RACTooltipProps,
} from 'react-aria-components';
import { cx } from '../utils';
import { keyLabel } from '../keys';

export interface TooltipProps extends Omit<RACTooltipProps, 'children'> {
  children: ReactNode;
}

/** A small dark slip of paper with a pointer (kit 66:537). */
export function Tooltip({ children, className, offset = 8, ...props }: TooltipProps) {
  return (
    <RACTooltip {...props} offset={offset} className={cx('emb-tooltip', className as string)}>
      <OverlayArrow className="emb-tooltip__arrow">
        <svg width={14} height={7} viewBox="0 0 14 7" aria-hidden>
          <path d="M0 0L7 7L14 0" />
        </svg>
      </OverlayArrow>
      {children}
    </RACTooltip>
  );
}

export interface ToolTipInfo {
  /** Tool name, e.g. "Gras". */
  label: string;
  /** Keys, e.g. ["Ctrl", "B"]. */
  shortcut?: string[];
  /** What it does, e.g. "Met le texte sélectionné en gras." */
  description?: string;
  /** Why the tool is unavailable (B3: a disabled tool explains what to do). */
  unavailableReason?: string;
}

/** Tool information slip (Figma B3): name, shortcut, effect — or why it is greyed out. */
export function ToolTipContent({ label, shortcut, description, unavailableReason }: ToolTipInfo) {
  return (
    <div className="emb-tooltip__tool">
      <span className="emb-tooltip__row">
        <strong>{label}</strong>
        {shortcut && (
          <span className="emb-tooltip__keys">
            {shortcut.map((k) => (
              <kbd key={k}>{keyLabel(k)}</kbd>
            ))}
          </span>
        )}
      </span>
      {unavailableReason ? (
        <span className="emb-tooltip__why">{unavailableReason}</span>
      ) : (
        description && <span className="emb-tooltip__desc">{description}</span>
      )}
    </div>
  );
}

export interface WithTooltipProps extends ToolTipInfo {
  children: ReactElement;
  placement?: RACTooltipProps['placement'];
  delay?: number;
}

/** Wraps a focusable control with a tool-information tooltip (shows on hover and keyboard focus). */
export function WithTooltip({ children, placement = 'top', delay = 450, ...info }: WithTooltipProps) {
  return (
    <TooltipTrigger delay={delay} closeDelay={80}>
      {children}
      <Tooltip placement={placement}>
        <ToolTipContent {...info} />
      </Tooltip>
    </TooltipTrigger>
  );
}
