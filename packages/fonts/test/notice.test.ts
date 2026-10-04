import { describe, expect, it } from 'vitest';
import { fontNotice } from '../src/index';

describe('missing fonts notice', () => {
  it('says nothing when every font shows', () => {
    expect(fontNotice({ substituted: [], missing: [] })).toBeNull();
  });

  it('stays short: a count, details in the dialog', () => {
    expect(fontNotice({ substituted: [{ name: 'Gill Sans Nova Light', substitute: 'Lato' }], missing: [] })).toEqual({
      title: 'Une police manquante',
      description: 'Elle est affichée avec une police de remplacement.',
    });
    expect(fontNotice({ substituted: [{ name: 'Kunstler Script', substitute: 'Great Vibes' }], missing: ['Mystery', 'Other'] })).toEqual({
      title: '3 polices manquantes',
      description: 'Elles sont affichées avec des polices de remplacement.',
    });
  });
});
