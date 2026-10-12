import { tr } from '@oel/i18n';
/** Anonymous identity: a display name and colour kept in this browser. */

export interface Identity {
  name: string;
  color: string;
}

const KEY = 'oel-identity';
const COLORS = ['#1a73e8', '#d93025', '#188038', '#e37400', '#9334e6', '#c5221f', '#129eaf', '#b06000'];

export function loadIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Identity;
    return v.name ? v : null;
  } catch {
    return null;
  }
}

export function saveIdentity(id: Identity) {
  try {
    localStorage.setItem(KEY, JSON.stringify(id));
  } catch {
    /* ignore */
  }
}

export function defaultIdentity(): Identity {
  const color = COLORS[Math.floor(Math.random() * COLORS.length)]!;
  return { name: tr(`Anonyme ${Math.floor(100 + Math.random() * 900)}`, `Anonymous ${Math.floor(100 + Math.random() * 900)}`), color };
}

export const IDENTITY_COLORS = COLORS;
