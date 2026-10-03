import { useSyncExternalStore } from 'react';
import { Avatar, Icon, type IconName } from '@oel/emboss';
import type { DocSession, SessionStatus } from '../collab/session';

export function useSessionStatus(session: DocSession): SessionStatus {
  return useSyncExternalStore(session.subscribe, session.getStatus, session.getStatus);
}

/** « Enregistré » / « Hors ligne… » chip, as in Docs' title bar. */
export function SyncStatus({ status }: { status: SessionStatus }) {
  let icon: IconName = 'cloud-check';
  let text = 'Enregistré';
  let detail = 'Toutes les modifications sont enregistrées sur le serveur.';
  if (status.error) {
    icon = 'alert';
    text = 'Accès refusé';
    detail = status.error;
  } else if (status.connection === 'local') {
    icon = 'save';
    text = 'Enregistré sur cet appareil';
    detail = 'Le document est gardé dans ce navigateur. Partagez-le pour le mettre en ligne.';
  } else if (status.connection === 'offline') {
    icon = 'offline';
    text = 'Hors ligne';
    detail = 'Vos modifications sont conservées sur cet appareil et seront envoyées au retour de la connexion.';
  } else if (status.connection === 'connecting') {
    icon = 'cloud-sync';
    text = 'Connexion…';
    detail = 'Connexion au serveur de collaboration.';
  } else if (!status.saved) {
    icon = 'cloud-sync';
    text = 'Enregistrement…';
    detail = 'Envoi des dernières modifications.';
  }
  return (
    <span className={`oel-sync oel-sync--${status.error ? 'error' : status.connection}`} role="status" aria-live="polite" title={detail}>
      <Icon name={status.readOnly ? 'lock' : icon} size={16} />
      <span>{status.readOnly ? `Lecture seule · ${text}` : text}</span>
      <span className="emb-visually-hidden">{detail}</span>
    </span>
  );
}

export function Peers({ status }: { status: SessionStatus }) {
  if (!status.peers.length) return null;
  const shown = status.peers.slice(0, 4);
  return (
    <div className="oel-peers" aria-label={`${status.peers.length} autre${status.peers.length > 1 ? 's' : ''} personne${status.peers.length > 1 ? 's' : ''} dans le document`}>
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
