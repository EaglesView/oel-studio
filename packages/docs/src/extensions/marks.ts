import { TextStyle } from '@tiptap/extension-text-style';

/**
 * `textStyle` carries the run's original rPr (raw XML) next to the editable
 * font, size and colour. The codec writes the raw rPr back and only patches
 * what changed, so language, spacing, theme colours… survive edits.
 */
export const DocTextStyle = TextStyle.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      rPr: { default: null, rendered: false },
      rStyle: {
        default: null,
        parseHTML: (el: HTMLElement) => el.dataset.rstyle ?? null,
        renderHTML: (a: Record<string, unknown>) => (a.rStyle ? { 'data-rstyle': a.rStyle } : {}),
      },
    };
  },
});
