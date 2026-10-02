import type { HTMLAttributes, ReactNode } from 'react';
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
import { cx } from '../utils';

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
    <span className="emb-avatar-stack" role="group" aria-label={label ?? `${people.length} personnes présentes`}>
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
export function Sidebar({ collapsed, onToggle, brand = 'OutilsEnLigne', children, footer, label = 'Navigation principale' }: SidebarProps) {
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
            aria-label={collapsed ? 'Déplier la navigation' : 'Replier la navigation'}
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
  return <kbd className="emb-kbd">{children}</kbd>;
}
