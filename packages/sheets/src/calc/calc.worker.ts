/// <reference lib="webworker" />
/**
 * Calc worker: the IronCalc engine (oelxlsx-rs WASM) off the main thread.
 * The editor's Y.Doc is the source of truth; this worker holds a computed
 * copy, kept in step with input diffs and rebuilt after structural edits.
 */
import init, { WasmCalc, XlsxParts } from 'oelxlsx-rs';
import { createCalcHandler } from './handler';
import type { ToCalc } from './protocol';

const handle = createCalcHandler((json) => new WasmCalc(json), init(), (bytes) => new XlsxParts(bytes));
self.onmessage = async (e: MessageEvent<ToCalc>) => (self as unknown as Worker).postMessage(await handle(e.data));
