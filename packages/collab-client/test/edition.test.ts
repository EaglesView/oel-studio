// @vitest-environment happy-dom
/** Single-user edition (plan solo MVP, S-1): hidden menu entries and a status chip that never mentions sharing. */
import { describe, expect, it } from 'vitest';
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { visibleItems } from '../src/ui/menuItems';
import { SyncStatus } from '../src/ui/SyncStatus';
import type { MenuEntry } from '../src/ui/MenuBar';
import type { SessionStatus } from '../src/session';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ids = (items: Array<MenuEntry | '-'>) => items.map((i) => (i === '-' ? '-' : i.id));

describe('visibleItems', () => {
  it('drops hidden entries and the separators they strand', () => {
    const items: Array<MenuEntry | '-'> = [
      { id: 'new', label: 'Nouveau' },
      '-',
      { id: 'share', label: 'Partager…', hidden: true },
      '-',
      { id: 'history', label: 'Historique', hidden: true },
      '-',
      { id: 'print', label: 'Imprimer' },
      '-',
      { id: 'identity', label: 'Votre nom…', hidden: true },
    ];
    expect(ids(visibleItems(items))).toEqual(['new', '-', 'print']);
  });

  it('filters submenus and drops the ones left empty', () => {
    const items: Array<MenuEntry | '-'> = [
      { id: 'dl', label: 'Télécharger', children: [{ id: 'docx', label: '.docx' }, { id: 'srv', label: 'Serveur', hidden: true }] },
      { id: 'team', label: 'Équipe', children: [{ id: 'invite', label: 'Inviter', hidden: true }] },
    ];
    const out = visibleItems(items) as MenuEntry[];
    expect(ids(out)).toEqual(['dl']);
    expect(out[0]!.children!.map((c) => c.id)).toEqual(['docx']);
  });

  it('leaves menus without hidden entries untouched', () => {
    const items: Array<MenuEntry | '-'> = [{ id: 'a', label: 'A' }, '-', { id: 'b', label: 'B' }];
    expect(visibleItems(items)).toEqual(items);
  });
});

describe('SyncStatus', () => {
  const status: SessionStatus = { docId: 'local-x', token: null, role: 'owner', readOnly: false, connection: 'local', saved: true, error: null, peers: [] };
  const render = async (collab: boolean) => {
    const root = document.createElement('div');
    await act(async () => createRoot(root).render(h(SyncStatus, { status, noun: 'classeur', collab })));
    return root.textContent ?? '';
  };

  it('says where the file is kept, without offering to share it, when collab is off', async () => {
    const text = await render(false);
    expect(text).toContain('Enregistré sur cet appareil');
    expect(text).toContain('Le classeur est gardé dans ce navigateur.');
    expect(text).not.toMatch(/Partagez/);
  });

  it('still invites to share in the team edition', async () => {
    expect(await render(true)).toMatch(/Partagez-le/);
  });
});
