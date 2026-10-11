import { useEffect, useState } from 'react';
import { FileTrigger } from 'react-aria-components';
import type * as Y from 'yjs';
import { Button, DialogOverlay, SheetDialog, toast } from '@oel/emboss';
import type { Bureau, Paper } from './model';
import { exportBureau, scheduleImport, scheduleReset } from './deskStorage';
import { saveFile } from './images';
import { storageUsed } from './restore';

/** What the menu needs to save, replace or reset the desk saved on this device. */
export interface DeskActions {
  projectId: string;
  title: string;
  doc: Y.Doc;
  /** Write pending desk changes now. */
  flush: () => void;
}

type Confirm = { kind: 'clear' } | { kind: 'demo' } | { kind: 'import'; file: File };

const mb = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 1 });
const fileName = (title: string) => `${(title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'bureau').slice(0, 80)} — bureau ${new Date().toISOString().slice(0, 10)}.zip`;

/**
 * « Ce bureau » (plan solo MVP, S-2): everything lives in this browser, so this is where it is
 * backed up, brought back, emptied or reset to the demo.
 */
export function DeskBackup({ store, desk }: { store: Bureau; desk: DeskActions }) {
  const [used, setUsed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  useEffect(() => void storageUsed().then(setUsed), []);
  const fail = (title: string) => (e: unknown) => toast({ title, description: e instanceof Error ? e.message : String(e), tone: 'danger' });

  const doExport = async () => {
    setBusy(true);
    try {
      desk.flush();
      saveFile(await exportBureau(store.nodes as Paper[], desk.doc, desk.title), fileName(desk.title));
      toast({ title: 'Bureau exporté', description: 'Gardez ce .zip : « Importer un bureau » le remet tel quel.', tone: 'success' });
    } catch (e) {
      fail('Export impossible')(e);
    } finally {
      setBusy(false);
    }
  };

  const run = (c: Confirm) => {
    if (c.kind === 'import') return scheduleImport(desk.projectId, c.file).catch(fail('Import impossible'));
    desk.flush();
    scheduleReset(desk.projectId, c.kind);
  };

  const copy: Record<Confirm['kind'], { title: string; body: string; action: string }> = {
    clear: { title: 'Vider le bureau ?', body: 'Tous les fichiers posés sur ce bureau seront supprimés de cet appareil.', action: 'Vider le bureau' },
    demo: { title: 'Réinitialiser la démo ?', body: 'Le bureau reprend les fichiers de démonstration ; ceux qui y sont posés seront supprimés de cet appareil.', action: 'Réinitialiser' },
    import: { title: 'Remplacer ce bureau ?', body: 'Le bureau importé prend sa place ; les fichiers posés sur celui-ci seront supprimés de cet appareil.', action: 'Remplacer' },
  };
  const c = confirm && copy[confirm.kind];

  return (
    <section className="app-menu__section app-menu__section--narrow" aria-labelledby="menu-desk">
      <h3 id="menu-desk" className="app-menu__h3">Ce bureau</h3>
      <p className="app-menu__note">
        Le bureau et ses fichiers sont gardés dans ce navigateur{used != null ? ` (${mb.format(used / 1e6)} Mo sur cet appareil)` : ''}. Exportez-le de temps en
        temps : effacer les données du site les efface aussi.
      </p>
      <div className="app-menu__actions">
        <Button variant="secondary" leadingIcon="download" isDisabled={busy} onPress={doExport}>
          Exporter le bureau (.zip)
        </Button>
        <FileTrigger acceptedFileTypes={['.zip', 'application/zip']} onSelect={(list) => list?.[0] && setConfirm({ kind: 'import', file: list[0] })}>
          <Button variant="secondary" leadingIcon="upload">
            Importer un bureau…
          </Button>
        </FileTrigger>
        <Button variant="ghost" leadingIcon="refresh" onPress={() => setConfirm({ kind: 'demo' })}>
          Réinitialiser la démo
        </Button>
        <Button variant="ghost" leadingIcon="trash" onPress={() => setConfirm({ kind: 'clear' })}>
          Vider le bureau
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
                  Annuler
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
            <p>Pour en garder une copie, exportez-le d’abord.</p>
          </SheetDialog>
        )}
      </DialogOverlay>
    </section>
  );
}
