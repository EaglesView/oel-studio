import { describe, expect, it } from 'vitest';
import { editionFrom, featuresOf } from '../src/edition';

describe('edition', () => {
  it('is single-user unless asked for the team build', () => {
    expect(editionFrom(undefined)).toBe('solo');
    expect(editionFrom('')).toBe('solo');
    expect(editionFrom('team')).toBe('solo');
    expect(editionFrom('equipe')).toBe('equipe');
  });

  it('turns collaboration, forms and members off in solo', () => {
    expect(featuresOf('solo')).toEqual({ collab: false, forms: false, projects: false });
    expect(featuresOf('equipe')).toEqual({ collab: true, forms: true, projects: true });
  });
});
