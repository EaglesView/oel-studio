/// <reference lib="webworker" />
/**
 * Default engine worker. Swap or extend the registry here to add WASM engines:
 *
 *   import { createOeldocxEngine } from '../engines/wasm';
 *   registry.register(createOeldocxEngine(() => import('oeldocx-rs')));
 */
import { previewEngine } from '../engines/preview';
import { EngineRegistry } from '../registry';
import { serveEngines } from './serve';

const registry = new EngineRegistry().register(previewEngine);
serveEngines(registry, self as unknown as Parameters<typeof serveEngines>[1]);
