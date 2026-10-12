/// <reference lib="webworker" />
/**
 * Default engine worker. Engines registered after the preview engine take
 * over the kinds they handle; WASM modules load on first use.
 */
import { previewEngine } from '../engines/preview';
import { createOeldocxEngine, createOelpptxEngine, createOelxlsxEngine } from '../engines/wasm';
import { EngineRegistry } from '../registry';
import { serveEngines } from './serve';

const registry = new EngineRegistry()
  .register(previewEngine)
  .register(createOeldocxEngine(() => import('oeldocx-rs')))
  .register(createOelxlsxEngine(() => import('oelxlsx-rs')))
  .register(createOelpptxEngine(() => import('oelpptx-rs')));
serveEngines(registry, self as unknown as Parameters<typeof serveEngines>[1]);
