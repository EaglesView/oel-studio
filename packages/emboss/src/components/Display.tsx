import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import {
  Button as RACButton,
  Link,
  ProgressBar as RACProgressBar,
  type LinkProps,
  type ProgressBarProps as RACProgressBarProps,
  composeRenderProps,
} from 'react-aria-components';
import { Icon, type IconName } from '../icons/Icon';
import { Logo } from '../icons/Logo';
import { WithTooltip } from './Tooltip';
import { cx } from '../utils';
import { keyLabel } from '../keys';
import { tr } from '@oel/i18n';

/* ── Badge (kit 68:864) ────────────────────────────────────────────── */

export type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Stamp = inked outline pressed onto the paper (document states). Tinted = soft chip (counts, filters). */
  appearance?: 'stamp' | 'tinted';
  tone?: Tone;
  dot?: boolean;
  /** Slight rotation, like a real stamp. */
  tilt?: number;
}

export function Badge({ appearance = 'tinted', tone = 'accent', dot = true, tilt, className, style, children, ...rest }: BadgeProps) {
  return (
    <span
      {...rest}
      className={cx('emb-badge', `emb-badge--${appearance}`, `emb-badge--${tone}`, className)}
      style={tilt ? { ...style, rotate: `${tilt}deg` } : style}
    >
      {dot && <span className="emb-badge__dot" aria-hidden />}
      {children}
    </span>
  );
}

/* ── Card (kit 68:908) ─────────────────────────────────────────────── */

export interface CardProps {
  title: ReactNode;
  meta?: ReactNode;
  media?: ReactNode;
  appearance?: 'raised' | 'debossed';
  /** Interactive cards lift on hover and press in on click. */
  onPress?: () => void;
  href?: string;
  className?: string;
  children?: ReactNode;
}

export function Card({ title, meta, media, appearance = 'raised', onPress, href, className, children }: CardProps) {
  const body = (
    <>
      {media !== undefined && <div className="emb-card__media">{media ?? <Icon name="image" size={32} />}</div>}
      <div className="emb-card__body">
        <span className="emb-card__title">{title}</span>
        {meta && <span className="emb-card__meta">{meta}</span>}
      </div>
      {children}
    </>
  );
  const cls = cx('emb-card', `emb-card--${appearance}`, (onPress || href) && 'emb-card--interactive', className);
  if (href) {
    return (
      <Link href={href} className={cls}>
        {body}
      </Link>
    );
  }
  if (onPress) {
    return (
      <RACButton onPress={onPress} className={cls}>
        {body}
      </RACButton>
    );
  }
  return <div className={cls}>{body}</div>;
}

/* ── Avatar / presence ─────────────────────────────────────────────── */

export interface Person {
  id: string;
  name: string;
  initials: string;
  /** CSS colour (kit uses fill-primary, success, warning). */
  color: string;
}

export function Avatar({ person, size = 32 }: { person: Person; size?: number }) {
  return (
    <span
      className="emb-avatar"
      style={{ background: person.color, width: size, height: size }}
      title={person.name}
      role="img"
      aria-label={person.name}
    >
      <span aria-hidden>{person.initials}</span>
    </span>
  );
}

export function AvatarStack({ people, label }: { people: Person[]; label?: string }) {
  return (
    <span className="emb-avatar-stack" role="group" aria-label={label ?? tr(`${people.length} personnes présentes`, `${people.length} people here`)}>
      {people.map((p) => (
        <Avatar key={p.id} person={p} />
      ))}
    </span>
  );
}

/* ── Sidebar + Nav Item (kit 68:756) ───────────────────────────────── */

export interface SidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
  brand?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  label?: string;
}

/** Navigation on a paper rail; Expanded / Collapsed like the Figma set. */
export function Sidebar({ collapsed, onToggle, brand = 'OutilsEnLigne', children, footer, label = tr('Navigation principale', 'Main navigation') }: SidebarProps) {
  return (
    <nav className={cx('emb-sidebar', collapsed && 'is-collapsed')} aria-label={label}>
      <div className="emb-sidebar__brand">
        <span className="emb-sidebar__logo">
          <Logo size={24} />
          {!collapsed && <span className="emb-sidebar__name">{brand}</span>}
        </span>
        {onToggle && (
          <RACButton
            className="emb-button emb-button--secondary emb-button--icon-sm"
            onPress={onToggle}
            aria-label={collapsed ? tr('Déplier la navigation', 'Expand the navigation') : tr('Replier la navigation', 'Collapse the navigation')}
            aria-expanded={!collapsed}
          >
            <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={18} />
          </RACButton>
        )}
      </div>
      <ul className="emb-sidebar__list">{children}</ul>
      {footer && <ul className="emb-sidebar__list emb-sidebar__footer">{footer}</ul>}
    </nav>
  );
}

export interface NavItemProps extends Omit<LinkProps, 'children'> {
  icon: IconName;
  label: string;
  count?: number;
  current?: boolean;
  collapsed?: boolean;
}

/** Hover lifts; the active item is pressed into the page with inked text, like a stamped entry. */
export function NavItem({ icon, label, count, current, collapsed, className, ...props }: NavItemProps) {
  return (
    <li>
      <Link
        {...props}
        aria-current={current ? 'page' : undefined}
        aria-label={collapsed ? (count != null ? `${label}, ${count}` : label) : undefined}
        className={composeRenderProps(className, (cls) => cx('emb-nav-item', current && 'is-current', cls))}
      >
        <Icon name={icon} size={18} />
        {!collapsed && <span className="emb-nav-item__label">{label}</span>}
        {count != null && (
          <span className="emb-nav-item__count" aria-hidden={collapsed || undefined}>
            {count}
          </span>
        )}
      </Link>
    </li>
  );
}

/* ── Rail (full-screen menu, Figma M2) ─────────────────────────────── */

export interface RailNavProps {
  /** Accessible name of the navigation. */
  label: string;
  /** Product name next to the logo. */
  brand?: ReactNode;
  /** Makes the logo a button (e.g. « Fermer le menu »). */
  onBrandPress?: () => void;
  brandLabel?: string;
  children: ReactNode;
  /** Pinned to the bottom of the rail. */
  footer?: ReactNode;
  className?: string;
}

/** The left rail of a full-screen menu: logo, sections in groups, a footer action. Items are buttons that switch panes. */
export function RailNav({ label, brand = 'OutilsEnLigne', onBrandPress, brandLabel, children, footer, className }: RailNavProps) {
  const logo = (
    <span className="emb-rail__logo">
      <Logo size={22} aria-hidden />
    </span>
  );
  return (
    <nav className={cx('emb-rail', className)} aria-label={label}>
      <div className="emb-rail__brand">
        {onBrandPress ? (
          <RACButton className="emb-rail__brand-button" onPress={onBrandPress} aria-label={brandLabel}>
            {logo}
          </RACButton>
        ) : (
          logo
        )}
        <span className="emb-rail__name">{brand}</span>
      </div>
      <ul className="emb-rail__list">{children}</ul>
      {footer && <ul className="emb-rail__list emb-rail__footer">{footer}</ul>}
    </nav>
  );
}

export interface RailItemProps {
  icon: IconName;
  label: string;
  /** Shown after the label, e.g. « Ctrl+Maj+L ». */
  shortcut?: string;
  /** The pane on show. */
  current?: boolean;
  /** A small ink dot (something needs attention), with its spoken meaning. */
  dot?: string;
  onPress?: () => void;
  autoFocus?: boolean;
}

export function RailItem({ icon, label, shortcut, current, dot, onPress, autoFocus }: RailItemProps) {
  return (
    <li>
      <RACButton
        className={cx('emb-rail-item', current && 'is-current')}
        aria-current={current ? 'page' : undefined}
        onPress={onPress}
        autoFocus={autoFocus}
      >
        <Icon name={icon} size={16} />
        <span className="emb-rail-item__label">{label}</span>
        {dot && (
          <span className="emb-rail-item__dot">
            <span className="emb-visually-hidden">{dot}</span>
          </span>
        )}
        {shortcut && <kbd className="emb-rail-item__shortcut">{keyLabel(shortcut)}</kbd>}
      </RACButton>
    </li>
  );
}

export function RailSeparator() {
  return <li className="emb-rail__separator" aria-hidden />;
}

/* ── Choice card (large creation choices: empty desk, menu « Nouveau ») ─ */

export interface ChoiceCardProps {
  icon: IconName;
  label: string;
  /** A picture above the label (e.g. a blank page); the icon then sits small beside the label. */
  media?: ReactNode;
  /** Icon colour, e.g. the file kind's colour. Default: ink. */
  iconColor?: string;
  onPress?: () => void;
  /** Greyed out; the tooltip says why (Figma B3). */
  unavailableReason?: string;
  className?: string;
}

/** A raised sheet you pick: a big icon over its name, or a picture with the icon and name below. */
export function ChoiceCard({ icon, label, media, iconColor, onPress, unavailableReason, className }: ChoiceCardProps) {
  const card = (
    <RACButton
      className={cx('emb-choice', media !== undefined && 'emb-choice--media', unavailableReason && 'is-unavailable', className)}
      style={iconColor ? ({ '--emb-choice-icon': iconColor } as CSSProperties) : undefined}
      onPress={unavailableReason ? undefined : onPress}
      aria-disabled={unavailableReason ? true : undefined}
    >
      {media !== undefined ? (
        <>
          <span className="emb-choice__media" aria-hidden>
            {media}
          </span>
          <span className="emb-choice__name">
            <Icon name={icon} size={12} />
            {label}
          </span>
        </>
      ) : (
        <>
          <Icon name={icon} size={32} />
          {label}
        </>
      )}
    </RACButton>
  );
  return unavailableReason ? (
    <WithTooltip label={label} unavailableReason={unavailableReason}>
      {card}
    </WithTooltip>
  ) : (
    card
  );
}

/* ── Progress (conversion / import) ────────────────────────────────── */

export function ProgressBar({ label, className, ...props }: RACProgressBarProps & { label?: string }) {
  return (
    <RACProgressBar
      {...props}
      aria-label={props['aria-label'] ?? label}
      className={composeRenderProps(className, (cls) => cx('emb-progress', cls))}
    >
      {({ percentage, valueText }) => (
        <>
          {label && (
            <span className="emb-progress__header">
              <span>{label}</span>
              <span className="emb-progress__value">{valueText}</span>
            </span>
          )}
          <span className="emb-progress__groove">
            <span className="emb-progress__fill" style={{ width: `${percentage ?? 0}%` }} />
          </span>
        </>
      )}
    </RACProgressBar>
  );
}

/* ── Kbd ──────────────────────────────────────────────────────────── */

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="emb-kbd">{typeof children === 'string' ? keyLabel(children) : children}</kbd>;
}
