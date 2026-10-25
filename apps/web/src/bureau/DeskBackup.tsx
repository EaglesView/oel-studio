import { useEffect, useState } from 'react';
import { FileTrigger } from 'react-aria-components';
import type * as Y from 'yjs';
import { Button, DialogOverlay, SheetDialog, toast } from '@oel/emboss';
import type { Bureau, Paper } from './model';
import { exportBureau, scheduleImport, scheduleReset } from './deskStorage';
import { saveFile } from '@oel/platform';
import { storageUsed } from './restore';
import { storageFailure, onStorageFailure, type StorageFailure } from '@oel/collab-client';
import { storageNote } from './storageWarning';
import { locale, messages } from '@oel/i18n';

const t = messages(
  {
    desk: 'bureau',
    exported: 'Bureau exporté',
    exportedBody: 'Gardez ce .zip : « Importer un bureau » le remet tel quel.',
    exportFailed: 'Export impossible',
    importFailed: 'Import impossible',
    confirm: {
      clear: { title: 'Vider le bureau ?', body: 'Tous les fichiers posés sur ce bureau seront supprimés de cet appareil.', action: 'Vider le bureau' },
      demo: { title: 'Réinitialiser la démo ?', body: 'Le bureau reprend les fichiers de démonstration ; ceux qui y sont posés seront supprimés de cet appareil.', action: 'Réinitialiser' },
      import: { title: 'Remplacer ce bureau ?', body: 'Le bureau importé prend sa place ; les fichiers posés sur celui-ci seront supprimés de cet appareil.', action: 'Remplacer' },
    } as Record<Confirm['kind'], { title: string; body: string; action: string }>,
    thisDesk: 'Ce bureau',
    kept: (mb: string | null) =>
      `Le bureau et ses fichiers sont gardés dans ce navigateur${mb != null ? ` (${mb} Mo sur cet appareil)` : ''}. Exportez-le de temps en temps : effacer les données du site les efface aussi.`,
    export: 'Exporter le bureau (.zip)',
    import: 'Importer un bureau…',
    resetDemo: 'Réinitialiser la démo',
    clear: 'Vider le bureau',
    cancel: 'Annuler',
    exportFirst: 'Pour en garder une copie, exportez-le d’abord.',
  },
  {
    desk: 'desk',
    exported: 'Desk exported',
    exportedBody: 'Keep this .zip: “Import a desk” brings it back as it was.',
    exportFailed: 'Export failed',
    importFailed: 'Import failed',
    confirm: {
      clear: { title: 'Empty the desk?', body: 'Every file on this desk will be deleted from this device.', action: 'Empty the desk' },
      demo: { title: 'Reset the demo?', body: 'The desk goes back to the demo files; the files on it will be deleted from this device.', action: 'Reset' },
      import: { title: 'Replace this desk?', body: 'The imported desk takes its place; the files on this one will be deleted from this device.', action: 'Replace' },
    },
    thisDesk: 'This desk',
    kept: (mb) =>
      `The desk and its files are kept in this browser${mb != null ? ` (${mb} MB on this device)` : ''}. Export it now and then: clearing the site’s data clears them too.`,
    export: 'Export the desk (.zip)',
    import: 'Import a desk…',
    resetDemo: 'Reset the demo',
    clear: 'Empty the desk',
    cancel: 'Cancel',
    exportFirst: 'To keep a copy, export it first.',
  },
);

/** What the menu needs to save, replace or reset the desk saved on this device. */
export interface DeskActions {
  projectId: string;
  title: string;
  doc: Y.Doc;
  /** Write pending desk changes now. */
  flush: () => void;
}

type Confirm = { kind: 'clear' } | { kind: 'demo' } | { kind: 'import'; file: File };

const mb = new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 });
const fileName = (title: string) => `${(title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || t.desk).slice(0, 80)} — ${t.desk} ${new Date().toISOString().slice(0, 10)}.zip`;

const fail = (title: string) => (e: unknown) => toast({ title, description: e instanceof Error ? e.message : String(e), tone: 'danger' });

/** « Exporter le bureau »: the whole desk as one .zip, downloaded. */
export async function exportDesk(store: Bureau, desk: DeskActions): Promise<void> {
  try {
    desk.flush();
    if (await saveFile(await exportBureau(store.nodes as Paper[], desk.doc, desk.title), fileName(desk.title))) {
      toast({ title: t.exported, description: t.exportedBody, tone: 'success' });
    }
  } catch (e) {
    fail(t.exportFailed)(e);
  }
}

/**
 * « Ce bureau » (plan solo MVP, S-2): everything lives in this browser, so this is where it is
 * backed up, brought back, emptied or reset to the demo.
 */
export function DeskBackup({ store, desk }: { store: Bureau; desk: DeskActions }) {
  const [used, setUsed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [refused, setRefused] = useState<StorageFailure | null>(storageFailure);
  useEffect(() => void storageUsed().then(setUsed), []);
  useEffect(() => onStorageFailure(setRefused), []);

  const doExport = async () => {
    setBusy(true);
    await exportDesk(store, desk);
    setBusy(false);
  };

  const run = (c: Confirm) => {
    if (c.kind === 'import') return scheduleImport(desk.projectId, c.file).catch(fail(t.importFailed));
    desk.flush();
    scheduleReset(desk.projectId, c.kind);
  };

  const c = confirm && t.confirm[confirm.kind];

  return (
    <section className="app-menu__section app-menu__section--narrow" aria-labelledby="menu-desk">
      <h3 id="menu-desk" className="app-menu__h3">{t.thisDesk}</h3>
      <p className="app-menu__note">{t.kept(used != null ? mb.format(used / 1e6) : null)}</p>
      {refused && (
        <p className="app-menu__note app-menu__note--warning" role="alert">
          {storageNote(refused)}
        </p>
      )}
      <div className="app-menu__actions">
        <Button variant="secondary" leadingIcon="download" isDisabled={busy} onPress={doExport}>
          {t.export}
        </Button>
        <FileTrigger acceptedFileTypes={['.zip', 'application/zip']} onSelect={(list) => list?.[0] && setConfirm({ kind: 'import', file: list[0] })}>
          <Button variant="secondary" leadingIcon="upload">
            {t.import}
          </Button>
        </FileTrigger>
        <Button variant="ghost" leadingIcon="refresh" onPress={() => setConfirm({ kind: 'demo' })}>
          {t.resetDemo}
        </Button>
        <Button variant="ghost" leadingIcon="trash" onPress={() => setConfirm({ kind: 'clear' })}>
          {t.clear}
        </Button>
      </div>
      <DialogOverlay isOpen={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        {c && (
          <SheetDialog
            title={c.title}
            tone="destructive"
            role="alertdialog"
            actions={(close) => (
              <>
                <Button variant="ghost" onPress={close}>
                  {t.cancel}
                </Button>
                <Button
                  variant="destructive"
                  onPress={() => {
                    const pending = confirm;
                    close();
                    if (pending) void run(pending);
                  }}
                >
                  {c.action}
                </Button>
              </>
            )}
          >
            <p>{c.body}</p>
            <p>{t.exportFirst}</p>
          </SheetDialog>
        )}
      </DialogOverlay>
    </section>
  );
}
