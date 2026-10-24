/**
 * When this device refuses a write (backlog T0-4). In the single-user edition the browser holds
 * the only copy of the desk, so a full disk or a private window must not lose work silently:
 * a warning that stays until it is closed, with « Exporter le bureau » at hand.
 */
import { onStorageFailure, type StorageFailure } from '@oel/collab-client';
import { toast, type ToastData } from '@oel/emboss';
import { messages } from '@oel/i18n';

const t = messages(
  {
    full: {
      title: 'Plus d’espace sur cet appareil',
      body: 'Les derniers changements ne sont plus enregistrés dans ce navigateur. Gardez cet onglet ouvert, exportez le bureau, puis libérez de l’espace.',
    },
    unavailable: {
      title: 'Ce navigateur n’enregistre pas le bureau',
      body: 'Il refuse de garder des fichiers sur cet appareil (fenêtre privée ou données du site bloquées) : fermer l’onglet les perdra. Exportez le bureau pour en garder une copie.',
    },
    export: 'Exporter le bureau',
  },
  {
    full: {
      title: 'This device is out of space',
      body: 'The latest changes are no longer saved in this browser. Keep this tab open, export the desk, then free up some space.',
    },
    unavailable: {
      title: 'This browser isn’t saving the desk',
      body: 'It refuses to keep files on this device (private window or blocked site data): closing the tab will lose them. Export the desk to keep a copy.',
    },
    export: 'Export the desk',
  },
);

/** The warning for a refused write; `onExport` backs the desk up. */
export function storageWarning(failure: StorageFailure, onExport: () => void): ToastData {
  const m = t[failure.reason];
  return { title: m.title, description: m.body, tone: 'warning', action: { label: t.export, onAction: onExport } };
}

/** The note « Ce bureau » shows while writes are refused. */
export const storageNote = (failure: StorageFailure) => t[failure.reason].title;

/** Warn once per kind of failure, with a toast that stays until it is closed. */
export function warnOnStorageFailure(onExport: () => void): () => void {
  const shown = new Set<StorageFailure['reason']>();
  return onStorageFailure((f) => {
    if (shown.has(f.reason)) return;
    shown.add(f.reason);
    toast(storageWarning(f, onExport), null);
  });
}
