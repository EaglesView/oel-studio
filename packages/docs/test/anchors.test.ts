// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { anchorBox, anchorsOf } from '../src/ui/Anchors';
import { anchorWrapStyle } from '../src/extensions/nodes';
import { defaultSection, frameOf, makePage } from '../src/model/sections';
import type { AnchorAttrs, DocxJson } from '../src/model/types';

const require = createRequire(import.meta.url);
const codec = require('oeldocx-node') as { docx_to_pm(b: Uint8Array): { json: string } };
const here = dirname(fileURLToPath(import.meta.url));
const load = (name: string) => JSON.parse(codec.docx_to_pm(readFileSync(join(here, '../../../fixtures/docx', name))).json) as DocxJson;

// Chapter geometry of complex_template.docx: Letter, 2" left margin, 0.5" others.
const chapter = { ...defaultSection(), page: { ...defaultSection().page, top: 720, right: 720, bottom: 720, left: 2880 } };
const sheet = makePage([chapter], frameOf([chapter]), 0, null, 24);
const at = { paraTop: 48, lineTop: 60, charLeft: 300 };

describe('anchor positions', () => {
  const anchors = anchorsOf(load('complex_template.docx').doc);

  it('puts the chapter sidebar band at the page edge, full height', () => {
    // relH column −1828800 EMU (= −2") from a 2" margin; relV paragraph −0.5" from the anchor paragraph.
    const band = anchors.find((a) => a.kind === 'textbox' && a.shape.geometry === 'rect')!;
    const box = anchorBox(band, sheet, at);
    expect(box.left).toBe(0);
    expect(box.top).toBe(0);
    expect(box.width).toBe(144);
    expect(box.height).toBe(1056);
  });

  it('honours alignments and other references', () => {
    const base = anchors[0]!;
    const a = (position: Partial<AnchorAttrs['position']>): AnchorAttrs => ({ ...base, cx: 914400, cy: 914400, position: { ...base.position, ...position } });
    expect(anchorBox(a({ relH: 'margin', h: null, alignH: 'right' }), sheet, at).left).toBe(816 - 48 - 96);
    expect(anchorBox(a({ relH: 'page', h: null, alignH: 'center' }), sheet, at).left).toBe((816 - 96) / 2);
    expect(anchorBox(a({ relV: 'margin', v: null, alignV: 'bottom' }), sheet, at).top).toBe(1056 - 48 - 96);
    expect(anchorBox(a({ relV: 'line', v: 0, alignV: null }), sheet, at).top).toBe(60);
    expect(anchorBox(a({ relH: 'character', h: 9525 * 10, alignH: null }), sheet, at).left).toBe(310);
  });
});

describe('text wrap approximation', () => {
  const anchors = anchorsOf(load('anchors.docx').doc);

  it('floats column-relative square wraps and spaces top-and-bottom ones', () => {
    const picture = anchors.find((a) => a.kind === 'picture')!;
    expect(anchorWrapStyle(picture)?.style).toMatch(/^float:right;width:168px;height:96px/);
    const textbox = anchors.find((a) => a.kind === 'textbox')!;
    expect(anchorWrapStyle(textbox)?.style).toContain('width:100%');
  });

  it('leaves page-relative and unwrapped objects out of the flow', () => {
    const behind = anchors[0]!;
    expect(anchorWrapStyle(behind)).toBeNull();
    const pageSquare = { ...behind, wrap: 'square' };
    expect(anchorWrapStyle(pageSquare)).toEqual({ style: '', note: expect.stringContaining('par rapport à la page') });
  });
});
