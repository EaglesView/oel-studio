import type { EngineRegistry } from '../registry';
import type { FromWorker, ToWorker } from './protocol';

/** Call from a worker module to expose a registry to an EngineHost. */
export function serveEngines(registry: EngineRegistry, scope: { onmessage: unknown; postMessage: (m: FromWorker) => void }) {
  scope.onmessage = async (e: MessageEvent<ToWorker>) => {
    const { id, name, type, bytes } = e.data;
    try {
      const result = await registry.import({ name, type, bytes }, (progress) => scope.postMessage({ id, op: 'progress', progress }));
      scope.postMessage({ id, op: 'result', result });
    } catch (err) {
      scope.postMessage({ id, op: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };
}
