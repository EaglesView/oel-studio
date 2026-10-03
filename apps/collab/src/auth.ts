/**
 * Share tokens: `base64url(payload).base64url(hmac-sha256)`, signed with
 * COLLAB_SECRET. The payload names the document, the role and the link it
 * came from, so revoking a link (server side) invalidates its tokens.
 * No accounts yet: identity is a display name chosen in the browser.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Role } from './db';

export interface TokenPayload {
  /** Document id. */
  d: string;
  r: Role;
  /** Link id (revocation). */
  l: string;
  /** Expiry, ms since epoch. */
  x?: number;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function signToken(p: TokenPayload, secret: string): string {
  const body = b64(JSON.stringify(p));
  return `${body}.${b64(createHmac('sha256', secret).update(body).digest())}`;
}

export function verifyToken(token: string | null | undefined, secret: string, now = Date.now()): TokenPayload | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (!p.d || !p.l || !['owner', 'editor', 'viewer'].includes(p.r)) return null;
    if (p.x && p.x < now) return null;
    return p;
  } catch {
    return null;
  }
}

export const canEdit = (r: Role) => r === 'owner' || r === 'editor';
