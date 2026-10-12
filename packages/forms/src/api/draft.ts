import type { Answers } from '../model/types';

/**
 * E3 · 5 « Brouillon sur l’appareil »: every answer is kept in this browser
 * until it is sent, so the respondent can close the tab and come back.
 * Files are not kept (only their uploaded references).
 */
export interface Draft {
  answers: Answers;
  step: number;
  email: string | null;
  emailToken: string | null;
  savedAt: number;
}

const key = (slug: string) => `oel-forms-draft:${slug}`;

export const draftStore = {
  load(slug: string): Draft | null {
    try {
      const v = localStorage.getItem(key(slug));
      return v ? (JSON.parse(v) as Draft) : null;
    } catch {
      return null;
    }
  },
  save(slug: string, d: Omit<Draft, 'savedAt'>) {
    try {
      localStorage.setItem(key(slug), JSON.stringify({ ...d, savedAt: Date.now() }));
      return true;
    } catch {
      return false;
    }
  },
  clear(slug: string) {
    try {
      localStorage.removeItem(key(slug));
    } catch {
      /* private mode */
    }
  },
};

/** Personal « Modifier ma réponse » links, remembered on this device. */
export const editLinks = {
  save(slug: string, responseId: string, editKey: string) {
    try {
      localStorage.setItem(`oel-forms-edit:${slug}`, JSON.stringify({ responseId, editKey }));
    } catch {
      /* ignore */
    }
  },
  load(slug: string): { responseId: string; editKey: string } | null {
    try {
      const v = localStorage.getItem(`oel-forms-edit:${slug}`);
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  },
};
