import { useSyncExternalStore } from 'react';
import { Avatar, Icon, type IconName } from '@oel/emboss';
import type { SessionStatus, YSession } from '../session';
import { tr } from '@oel/i18n';

export function useSessionStatus(session: YSession): SessionStatus {
  return useSyncExternalStore(session.subscribe, session.getStatus, session.getStatus);
}

/**
 * « Enregistré » / « Hors ligne… » chip, as in Docs' title bar. `noun`: « document », « classeur »… (masculine).
 * `collab: false` (single-user edition): no mention of sharing or of a server.
 */
export function SyncStatus({ status, noun = 'document', collab = true }: { status: SessionStatus; noun?: string; collab?: boolean }) {
  let icon: IconName = 'cloud-check';
  let text = tr('Enregistré', 'Saved');
  let detail = tr('Toutes les modifications sont enregistrées sur le serveur.', 'Every change is saved on the server.');
  if (status.error) {
    icon = 'alert';
    text = tr('Accès refusé', 'Access denied');
    detail = status.error;
  } else if (status.connection === 'local') {
    icon = 'save';
    text = tr('Enregistré sur cet appareil', 'Saved on this device');
    detail = collab ? tr(`Le ${noun} est gardé dans ce navigateur. Partagez-le pour le mettre en ligne.`, `The ${noun} is kept in this browser. Share it to put it online.`) : tr(`Le ${noun} est gardé dans ce navigateur.`, `The ${noun} is kept in this browser.`);
  } else if (status.connection === 'offline') {
    icon = 'offline';
    text = tr('Hors ligne', 'Offline');
    detail = tr('Vos modifications sont conservées sur cet appareil et seront envoyées au retour de la connexion.', 'Your changes are kept on this device and will be sent when the connection is back.');
  } else if (status.connection === 'connecting') {
    icon = 'cloud-sync';
    text = tr('Connexion…', 'Connecting…');
    detail = tr('Connexion au serveur de collaboration.', 'Connecting to the collaboration server.');
  } else if (!status.saved) {
    icon = 'cloud-sync';
    text = tr('Enregistrement…', 'Saving…');
    detail = tr('Envoi des dernières modifications.', 'Sending the latest changes.');
  }
  return (
    <span className={`oel-sync oel-sync--${status.error ? 'error' : status.connection}`} role="status" aria-live="polite" title={detail}>
      <Icon name={status.readOnly ? 'lock' : icon} size={16} />
      <span>{status.readOnly ? tr(`Lecture seule · ${text}`, `Read-only · ${text}`) : text}</span>
      <span className="emb-visually-hidden">{detail}</span>
    </span>
  );
}

export function Peers({ status, noun = 'document' }: { status: SessionStatus; noun?: string }) {
  if (!status.peers.length) return null;
  const shown = status.peers.slice(0, 4);
  return (
    <div className="oel-peers" aria-label={tr(`${status.peers.length} autre${status.peers.length > 1 ? 's' : ''} personne${status.peers.length > 1 ? 's' : ''} dans le ${noun}`, `${status.peers.length} other ${status.peers.length > 1 ? 'people' : 'person'} in the ${noun}`)}>
      {shown.map((p) => (
        <span key={p.clientId} className="oel-peers__item">
          <Avatar person={{ id: String(p.clientId), name: p.name, initials: initials(p.name), color: p.color }} size={28} />
        </span>
      ))}
      {status.peers.length > shown.length && <span className="oel-peers__more">+{status.peers.length - shown.length}</span>}
    </div>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';
