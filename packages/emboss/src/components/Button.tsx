import type { ReactNode } from 'react';
import {
  Button as RACButton,
  type ButtonProps as RACButtonProps,
  composeRenderProps,
} from 'react-aria-components';
import { Icon, type IconName } from '../icons/Icon';
import { cx } from '../utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

export interface ButtonProps extends Omit<RACButtonProps, 'children'> {
  /** Kit "Button/Primary|Secondary|Ghost|Destructive|Success". Default: secondary (blind emboss). */
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: IconName;
  trailingIcon?: IconName;
  children?: ReactNode;
}

const ICON_SIZE: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 20, icon: 20, 'icon-sm': 18 };

/**
 * Blind-emboss button. Hover lifts (200 ms), press sinks into a deboss (260 ms),
 * focus shows a 2 px ring 3 px outside. Icon-only buttons need `aria-label`.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  leadingIcon,
  trailingIcon,
  children,
  className,
  ...props
}: ButtonProps) {
  const iconSize = ICON_SIZE[size];
  return (
    <RACButton
      {...props}
      className={composeRenderProps(className, (cls) =>
        cx('emb-button', `emb-button--${variant}`, `emb-button--${size}`, cls),
      )}
    >
      {leadingIcon && <Icon name={leadingIcon} size={iconSize} />}
      {children != null && size !== 'icon' && size !== 'icon-sm' && (
        <span className="emb-button__label">{children}</span>
      )}
      {trailingIcon && <Icon name={trailingIcon} size={iconSize} />}
    </RACButton>
  );
}
