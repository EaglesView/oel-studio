/** Bureau backups (plan solo MVP, S-2): the .zip format, without the device. */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { writeZip } from '@oel/engine';
import { packBackup, readBackup } from '../src/bureau/backup';

const bytes = (...n: number[]) => new Uint8Array(n);

describe('bureau backup', () => {
  it('gives back every part as it went in', async () => {
    const desk = new Y.Doc();
    desk.getMap('meta').set('format', 1);
    const doc = new Y.Doc();
    doc.getText('t').insert(0, 'Bonjour');
    const parts = {
      title: 'Mon bureau',
      desk: Y.encodeStateAsUpdate(desk),
      docs: [{ docId: 'local-a', kind: 'doc' as const, update: Y.encodeStateAsUpdate(doc) }],
      files: [{ key: 'local-a|package', mime: 'application/zip', bytes: bytes(1, 2, 3) }, { key: 'img|original|h', mime: 'image/png', bytes: bytes(9) }],
    };
    const back = await readBackup(packBackup(parts));
    expect(back).toEqual(parts);
    const again = new Y.Doc();
    Y.applyUpdate(again, back.docs[0]!.update);
    expect(again.getText('t').toString()).toBe('Bonjour');
  });

  it('says what is wrong with a file that is not a backup', async () => {
    await expect(readBackup(bytes(1, 2, 3))).rejects.toThrow('n’est pas une archive .zip');
    await expect(readBackup(writeZip([{ name: 'a.txt', data: bytes(1) }]))).rejects.toThrow('bureau.json manque');
    const other = writeZip([{ name: 'bureau.json', data: new TextEncoder().encode('{"format":"autre","version":1}') }]);
    await expect(readBackup(other)).rejects.toThrow('pas une sauvegarde de bureau');
    const newer = writeZip([{ name: 'bureau.json', data: new TextEncoder().encode('{"format":"oel-bureau","version":99}') }]);
    await expect(readBackup(newer)).rejects.toThrow('plus récente');
  });
});
