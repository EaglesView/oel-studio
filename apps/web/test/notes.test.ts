import { describe, expect, it } from 'vitest';
import { migrateNote, startsNoteText } from '../src/bureau/notes';

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe('notes', () => {
  it('turns an assignee into a leading mention, once', () => {
    const old = { kind: 'note', data: { assignee: 'Alex', preview: { kind: 'note', text: 'Reprendre les chiffres.' } } };
    const m = migrateNote(old);
    expect(m.data).toEqual({ preview: { kind: 'note', text: '@Alex Reprendre les chiffres.' } });
    expect(migrateNote({ ...m, data: { ...m.data, assignee: 'Alex' } }).data.preview.text).toBe('@Alex Reprendre les chiffres.');
  });

  it('leaves other papers alone', () => {
    const doc = { kind: 'document', data: { assignee: 'Alex', preview: { kind: 'document' } } };
    expect(migrateNote(doc)).toBe(doc);
  });

  it('starts the text on printable keys, not on desk shortcuts', () => {
    expect(startsNoteText(key('a'))).toBe(true);
    expect(startsNoteText(key('É'))).toBe(true);
    expect(startsNoteText(key('p'))).toBe(false);
    expect(startsNoteText(key('N'))).toBe(false);
    expect(startsNoteText(key('a', { ctrlKey: true }))).toBe(false);
    expect(startsNoteText(key('Enter'))).toBe(false);
  });
});
