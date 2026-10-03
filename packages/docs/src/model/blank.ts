import type { DocStyle, DocxJson, PMDoc } from './types';
import { DEFAULT_SETTINGS, defaultSection } from './sections';

const style = (id: string, name: string, role: string | null, outline: number | null = null, isDefault = false): DocStyle => ({
  id, name, kind: 'paragraph', role, basedOn: isDefault ? null : 'Normal', isDefault, quick: true, hidden: false, outline, numId: null,
});

/**
 * A new document when the codec is not at hand: same styles as the codec's
 * built-in template (`template.rs`), which the exporter adds when missing.
 */
export function blankDocxJson(doc?: PMDoc): DocxJson {
  const headings = [[20, 400, 120, ''], [16, 360, 120, ''], [14, 320, 80, 'color:#434343;'], [12, 280, 80, 'color:#666666;'], [11, 240, 80, 'color:#666666;'], [11, 240, 80, 'color:#666666;font-style:italic;']] as const;
  const css = [
    '.oel-doc .oel-p{font-family:"Arial", "Liberation Sans", Arimo, sans-serif;font-size:11pt;line-height:1.322;margin-bottom:0pt;}',
    '.oel-doc .oel-p[data-style="Normal"]{font-family:"Arial", "Liberation Sans", Arimo, sans-serif;font-size:11pt;}',
    '.oel-doc .oel-p[data-style="Title"]{font-family:"Arial", "Liberation Sans", Arimo, sans-serif;font-size:26pt;margin-bottom:3pt;}',
    '.oel-doc .oel-p[data-style="Subtitle"]{font-family:"Arial", "Liberation Sans", Arimo, sans-serif;font-size:15pt;color:#666666;margin-bottom:16pt;}',
    ...headings.map(([sz, before, after, extra], i) => `.oel-doc .oel-p[data-style="Heading${i + 1}"]{font-family:"Arial", "Liberation Sans", Arimo, sans-serif;font-size:${sz}pt;margin-top:${before / 20}pt;margin-bottom:${after / 20}pt;${extra}}`),
    '.oel-doc [data-rstyle="Hyperlink"]{color:#1155CC;text-decoration-line:underline;}',
  ].join('\n');
  return {
    version: 2,
    doc: doc ?? { type: 'doc', content: [{ type: 'paragraph', attrs: { styleId: null } }] },
    notes: { footnote: {}, endnote: {} },
    stories: {},
    sections: [defaultSection()],
    settings: { ...DEFAULT_SETTINGS },
    background: null,
    styles: [
      style('Normal', 'Normal', 'normal', null, true),
      style('Title', 'Title', 'title'),
      style('Subtitle', 'Subtitle', 'subtitle'),
      ...[1, 2, 3, 4, 5, 6].map((l) => style(`Heading${l}`, `heading ${l}`, `heading${l}`, l - 1)),
    ],
    stylesCss: css,
    defaults: { fontFamily: 'Arial', fontSize: '11pt' },
    numbering: { nums: {}, maxNumId: 0, maxAbstractId: 0 },
    title: null,
    media: [],
  };
}
