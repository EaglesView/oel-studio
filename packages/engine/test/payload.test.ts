import { describe, expect, it } from 'vitest';
import { PAYLOAD_FORMATS, PayloadFormatError, asDocxPayload, asWorkbookPayload } from '../src';

describe('payload format guard', () => {
  it('accepts the formats this build reads', () => {
    const docx = { format: PAYLOAD_FORMATS.docx, json: '{}', media: [], original: null };
    expect(asDocxPayload(docx)).toBe(docx);
    const wb = { format: PAYLOAD_FORMATS.workbook, json: '{}', original: null };
    expect(asWorkbookPayload(wb)).toBe(wb);
  });

  it('refuses unknown or missing formats with a French message', () => {
    expect(() => asDocxPayload({ format: 'oeldocx-pm@2', json: '{}' })).toThrow(PayloadFormatError);
    expect(() => asDocxPayload({ format: 'oeldocx-pm@2' })).toThrow(/non pris en charge.*oeldocx-pm@2/);
    expect(() => asWorkbookPayload({ format: PAYLOAD_FORMATS.docx })).toThrow(/attendu « oelxlsx-workbook@1 »/);
    expect(() => asWorkbookPayload(undefined)).toThrow(/Contenu illisible/);
  });
});
