import type { ReactNode } from 'react';
import {
  Button as RACButton,
  Dialog as RACDialog,
  DialogTrigger,
  Heading,
  Menu as RACMenu,
  MenuItem as RACMenuItem,
  MenuTrigger,
  Modal,
  ModalOverlay,
  OverlayArrow,
  Popover as RACPopover,
  Separator,
  SubmenuTrigger,
  type DialogProps,
  type MenuItemProps,
  type MenuProps,
  type ModalOverlayProps,
  type PopoverProps as RACPopoverProps,
  composeRenderProps,
} from 'react-aria-components';
import { Icon, type IconName } from '../icons/Icon';
import { cx } from '../utils';
import { keyLabel } from '../keys';
import { tr } from '@oel/i18n';

export { DialogTrigger, MenuTrigger, SubmenuTrigger };

/* ── Popover (kit 66:609) ──────────────────────────────────────────── */

export interface PopoverProps extends Omit<RACPopoverProps, 'children'> {
  children: ReactNode;
  /** Draw the pointer toward the trigger. */
  showArrow?: boolean;
}

/** A floating paper sheet anchored to a control. Uses the Sheet shadow. */
export function Popover({ children, showArrow = true, className, offset = 10, ...props }: PopoverProps) {
  return (
    <RACPopover
      {...props}
      offset={offset}
      className={composeRenderProps(className, (cls) => cx('emb-popover', cls))}
    >
      {showArrow && (
        <OverlayArrow className="emb-popover__arrow">
          <svg width={16} height={8} viewBox="0 0 16 8" aria-hidden>
            <path d="M0 0L8 8L16 0" />
          </svg>
        </OverlayArrow>
      )}
      {children}
    </RACPopover>
  );
}

/* ── Dialog (kit 67:412) ───────────────────────────────────────────── */

export interface SheetDialogProps extends Omit<DialogProps, 'children'> {
  title: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Right-aligned action row, receives `close`. */
  actions?: (close: () => void) => ReactNode;
  /** Destructive adds a red alert seal. */
  tone?: 'default' | 'destructive';
  /** Visual width in px. */
  width?: number;
}

/**
 * A raised sheet of paper over a dimmed page. Opens as an overlay that dissolves
 * in and rises 8 px (240 ms). Focus is trapped and restored by react-aria.
 */
export function SheetDialog({ title, children, actions, tone = 'default', width = 480, ...props }: SheetDialogProps) {
  return (
    <RACDialog {...props} className="emb-dialog" style={{ width }}>
      {({ close }) => (
        <>
          <header className="emb-dialog__header">
            {tone === 'destructive' && (
              <span className="emb-dialog__seal" aria-hidden>
                <Icon name="alert" size={20} />
              </span>
            )}
            <Heading slot="title" className="emb-t-dialog-title emb-dialog__title">
              {title}
            </Heading>
            <RACButton className="emb-button emb-button--ghost emb-button--icon-sm" aria-label={tr('Fermer', 'Close')} onPress={close}>
              <Icon name="close" size={18} />
            </RACButton>
          </header>
          <div className="emb-dialog__body">{typeof children === 'function' ? children(close) : children}</div>
          {actions && <footer className="emb-dialog__actions">{actions(close)}</footer>}
        </>
      )}
    </RACDialog>
  );
}

/** Scrim + modal container. Put a <SheetDialog> inside; wrap with <DialogTrigger> or control `isOpen`. */
export function DialogOverlay({ className, isDismissable = true, ...props }: ModalOverlayProps) {
  return (
    <ModalOverlay
      {...props}
      isDismissable={isDismissable}
      className={composeRenderProps(className, (cls) => cx('emb-modal-overlay', cls))}
    >
      <Modal className="emb-modal">{props.children}</Modal>
    </ModalOverlay>
  );
}

/* ── Menu (context / overflow menus, uses the Select Menu paper) ───── */

export function Menu<T extends object>(props: MenuProps<T>) {
  return <RACMenu {...props} className={cx('emb-menu', props.className as string)} />;
}

export function MenuItem({
  icon,
  shortcut,
  children,
  ...props
}: MenuItemProps & { icon?: IconName; shortcut?: string }) {
  const textValue = props.textValue ?? (typeof children === 'string' ? children : undefined);
  return (
    <RACMenuItem
      {...props}
      textValue={textValue}
      className={composeRenderProps(props.className, (cls) => cx('emb-menu-item', cls))}
    >
      {composeRenderProps(children, (content, { hasSubmenu }) => (
        <>
          {icon && <Icon name={icon} size={18} />}
          <span className="emb-menu-item__label">{content}</span>
          {shortcut && <kbd>{keyLabel(shortcut)}</kbd>}
          {hasSubmenu && <Icon name="chevron-right" size={16} className="emb-menu-item__submenu" />}
        </>
      ))}
    </RACMenuItem>
  );
}

export function MenuSeparator() {
  return <Separator className="emb-menu-separator" />;
}

export function MenuPopover({ children, ...props }: Omit<RACPopoverProps, 'children'> & { children: ReactNode }) {
  return (
    <RACPopover {...props} offset={props.offset ?? 6} className="emb-menu-popover">
      {children}
    </RACPopover>
  );
}
