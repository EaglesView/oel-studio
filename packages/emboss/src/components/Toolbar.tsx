import type React from 'react';
import type { ReactNode } from 'react';
import {
  Button as RACButton,
  Separator,
  ToggleButton,
  Toolbar as RACToolbar,
  type ToggleButtonProps,
  type ToolbarProps as RACToolbarProps,
  composeRenderProps,
} from 'react-aria-components';
import { Icon, type IconName } from '../icons/Icon';
import { cx } from '../utils';
import { WithTooltip, type ToolTipInfo } from './Tooltip';

export interface ToolbarProps extends RACToolbarProps {
  ref?: React.Ref<HTMLDivElement>;
  /** `ribbon` = raised paper strip (kit Ribbon); `pill` = floating contextual bar / dock. */
  appearance?: 'ribbon' | 'pill' | 'plain';
}

/**
 * Toolbar · role="toolbar" with arrow-key navigation between tools (one Tab stop).
 */
export function Toolbar({ appearance = 'ribbon', className, ...props }: ToolbarProps) {
  return (
    <RACToolbar
      {...props}
      className={composeRenderProps(className, (cls) =>
        cx('emb-toolbar', `emb-toolbar--${appearance}`, cls),
      )}
    />
  );
}

/** Debossed groove between toolbar groups. */
export function ToolbarSeparator({ className }: { className?: string } = {}) {
  return <Separator orientation="vertical" className={cx('emb-toolbar-sep', className)} />;
}

export interface ToolbarToggleProps extends Omit<ToggleButtonProps, 'children'>, ToolTipInfo {
  icon: IconName;
  /** Show a live value on the tool itself (B3), e.g. "11 pt" or a counter. */
  value?: ReactNode;
}

/**
 * Latching icon key for formatting (kit 68:1107). Stays pressed in while active.
 * The tooltip shows name, shortcut and effect; unavailable tools stay focusable
 * and explain why instead of going silent.
 */
export function ToolbarToggle({
  icon,
  label,
  shortcut,
  description,
  unavailableReason,
  value,
  className,
  ...props
}: ToolbarToggleProps) {
  const unavailable = Boolean(unavailableReason);
  return (
    <WithTooltip label={label} shortcut={shortcut} description={description} unavailableReason={unavailableReason}>
      <ToggleButton
        {...props}
        aria-label={label}
        aria-keyshortcuts={shortcut?.join('+')}
        aria-disabled={unavailable || undefined}
        onChange={unavailable ? undefined : props.onChange}
        className={composeRenderProps(className, (cls) =>
          cx('emb-tool', value != null && 'emb-tool--with-value', unavailable && 'is-unavailable', cls),
        )}
      >
        <Icon name={icon} size={18} />
        {value != null && <span className="emb-tool__value">{value}</span>}
      </ToggleButton>
    </WithTooltip>
  );
}

export interface ToolButtonProps extends ToolTipInfo {
  icon: IconName;
  onPress?: () => void;
  /** Show the label next to the icon (ghost button style). */
  showLabel?: boolean;
  value?: ReactNode;
  className?: string;
  id?: string;
}

/** Momentary (non-latching) tool with the same tooltip contract as ToolbarToggle. */
export function ToolButton({
  icon,
  label,
  shortcut,
  description,
  unavailableReason,
  onPress,
  showLabel,
  value,
  className,
  id,
}: ToolButtonProps) {
  const unavailable = Boolean(unavailableReason);
  return (
    <WithTooltip label={label} shortcut={shortcut} description={description} unavailableReason={unavailableReason}>
      <RACButton
        id={id}
        aria-label={showLabel ? undefined : label}
        aria-keyshortcuts={shortcut?.join('+')}
        aria-disabled={unavailable || undefined}
        onPress={unavailable ? undefined : onPress}
        className={cx(
          'emb-tool',
          showLabel && 'emb-tool--labelled',
          value != null && 'emb-tool--with-value',
          unavailable && 'is-unavailable',
          className,
        )}
      >
        <Icon name={icon} size={showLabel ? 16 : 18} />
        {showLabel && <span>{label}</span>}
        {value != null && <span className="emb-tool__value">{value}</span>}
      </RACButton>
    </WithTooltip>
  );
}
