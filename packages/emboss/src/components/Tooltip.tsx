import { cloneElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import {
  OverlayArrow,
  Tooltip as RACTooltip,
  TooltipTrigger,
  type PressEvent,
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

/** How long a finger rests on a tool before its slip shows (Figma O4 · 5, same as the desk's long-press). */
const HOLD_MS = 500;

type PressableProps = {
  onPressStart?: (e: PressEvent) => void;
  onPressEnd?: (e: PressEvent) => void;
  onPress?: (e: PressEvent) => void;
  onChange?: (value: unknown) => void;
};

/**
 * Wraps a pressable control (a react-aria button) with a tool-information tooltip. A mouse sees it on hover, a
 * keyboard on focus. A finger has no hover (Figma O0 · 5, O2 · 4): a tap on an unavailable tool opens the slip, a
 * hold on any other tool opens it without acting (so icon-only tools can say their name), and the next touch
 * anywhere closes it.
 */
export function WithTooltip({ children, placement = 'top', delay = 450, ...info }: WithTooltipProps) {
  const unavailable = Boolean(info.unavailableReason);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [touchOpen, setTouchOpen] = useState(false);
  const hold = useRef<number | undefined>(undefined);
  const held = useRef(false);

  useEffect(() => {
    if (!touchOpen) return;
    const close = () => setTouchOpen(false);
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [touchOpen]);
  useEffect(() => () => window.clearTimeout(hold.current), []);

  const own = children.props as PressableProps;
  const trigger = cloneElement(children as ReactElement<PressableProps>, {
    onPressStart: (e: PressEvent) => {
      own.onPressStart?.(e);
      held.current = false;
      window.clearTimeout(hold.current);
      if (e.pointerType !== 'touch') return;
      if (unavailable) {
        setTouchOpen(true);
        return;
      }
      hold.current = window.setTimeout(() => {
        held.current = true;
        setTouchOpen(true);
        navigator.vibrate?.(12);
      }, HOLD_MS);
    },
    onPressEnd: (e: PressEvent) => {
      own.onPressEnd?.(e);
      window.clearTimeout(hold.current);
    },
    // The release that ends a hold only showed the name; it must not also act.
    ...(own.onPress && { onPress: (e: PressEvent) => (held.current ? undefined : own.onPress?.(e)) }),
    ...(own.onChange && { onChange: (v: unknown) => (held.current ? undefined : own.onChange?.(v)) }),
  });

  return (
    <TooltipTrigger delay={delay} closeDelay={80} isOpen={hoverOpen || touchOpen} onOpenChange={setHoverOpen}>
      {trigger}
      <Tooltip placement={placement}>
        <ToolTipContent {...info} />
      </Tooltip>
    </TooltipTrigger>
  );
}
