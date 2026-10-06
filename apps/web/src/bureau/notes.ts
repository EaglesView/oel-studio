/**
 * Notes collées (Figma K): helpers with no UI, shared by the desk, the list
 * view and tests.
 */

/** Keys that keep their desk shortcut on a selected note instead of starting the text (K2 · 1). */
export const NOTE_RESERVED_KEYS = new Set([' ', 'p', 'P', 'n', 'N', '?', '/', '+', '-', '=', '_', '0']);

/** Whether a key press on a selected note should start writing with that character. */
export function startsNoteText(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !NOTE_RESERVED_KEYS.has(e.key);
}

interface LegacyNote {
  kind: string;
  data: { assignee?: string; preview: { kind: string; text?: string } };
}

/**
 * K3 « Notes déjà assignées »: the old « Assigner » field becomes a leading
 * `@Nom ` in the text, without a notification. Other papers pass through.
 */
export function migrateNote<P extends LegacyNote>(p: P): P {
  if (p.kind !== 'note' || !p.data.assignee) return p;
  const { assignee, ...data } = p.data;
  const text = p.data.preview.kind === 'note' ? (p.data.preview.text ?? '') : '';
  const mention = `@${assignee}`;
  return { ...p, data: { ...data, preview: { kind: 'note', text: text.startsWith(mention) ? text : `${mention} ${text}` } } };
}
