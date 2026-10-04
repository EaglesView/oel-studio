import { describe, expect, it } from 'vitest';
import { fontNotice } from '../src/index';

describe('missing fonts notice', () => {
  it('says nothing when every font shows', () => {
    expect(fontNotice({ substituted: [], missing: [] })).toBeNull();
  });

  it('names one substituted font in the singular', () => {
    expect(fontNotice({ substituted: [{ name: 'Gill Sans Nova Light', substitute: 'Lato' }], missing: [] })).toEqual({
      title: 'Une police n’est pas dans ce fichier',
      description: 'Elle n’est ni intégrée au fichier ni installée sur cet appareil : Gill Sans Nova Light est remplacée par Lato. Le fichier la garde à l’export.',
    });
  });

  it('lists substitutes, then fonts without a look-alike', () => {
    const n = fontNotice({ substituted: [{ name: 'Kunstler Script', substitute: 'Great Vibes' }], missing: ['Mystery', 'Other'] });
    expect(n?.title).toBe('3 polices ne sont pas dans ce fichier');
    expect(n?.description).toBe(
      'Elles ne sont ni intégrées au fichier ni installées sur cet appareil : Kunstler Script est remplacée par Great Vibes ; Mystery et Other s’affichent dans une police par défaut. Le fichier les garde à l’export.',
    );
  });
});
