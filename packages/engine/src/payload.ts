import type { DeckPayload, DocxPayload, WorkbookPayload } from './types';

/** Payload formats this build understands. Bump with the codec when its JSON breaks. */
export const PAYLOAD_FORMATS = {
  docx: 'oeldocx-pm@2',
  workbook: 'oelxlsx-workbook@1',
  deck: 'oelpptx-deck@1',
} as const satisfies { docx: DocxPayload['format']; workbook: WorkbookPayload['format']; deck: DeckPayload['format'] };

/** Thrown when an engine payload has a format this build does not read. */
export class PayloadFormatError extends Error {
  constructor(
    readonly expected: string,
    readonly received: unknown,
  ) {
    super(
      received === undefined
        ? 'Contenu illisible : le moteur n’a pas fourni de format.'
        : `Format de contenu non pris en charge (« ${String(received)} », attendu « ${expected} »). Rechargez la page pour obtenir la dernière version.`,
    );
    this.name = 'PayloadFormatError';
  }
}

function check<T extends { format: string }>(payload: unknown, expected: T['format']): T {
  const format = (payload as { format?: unknown } | null | undefined)?.format;
  if (format !== expected) throw new PayloadFormatError(expected, format);
  return payload as T;
}

/** The payload as a `DocxPayload`, or a fr-CA `PayloadFormatError`. */
export const asDocxPayload = (payload: unknown): DocxPayload => check<DocxPayload>(payload, PAYLOAD_FORMATS.docx);

/** The payload as a `WorkbookPayload`, or a fr-CA `PayloadFormatError`. */
export const asWorkbookPayload = (payload: unknown): WorkbookPayload => check<WorkbookPayload>(payload, PAYLOAD_FORMATS.workbook);

/** The payload as a `DeckPayload`, or a fr-CA `PayloadFormatError`. */
export const asDeckPayload = (payload: unknown): DeckPayload => check<DeckPayload>(payload, PAYLOAD_FORMATS.deck);
