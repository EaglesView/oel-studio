import type { EngineRegistry } from '../registry';
import type { FromWorker, ToWorker } from './protocol';

/** Call from a worker module to expose a registry to an EngineHost. */
export function serveEngines(registry: EngineRegistry, scope: { onmessage: unknown; postMessage: (m: FromWorker, transfer?: Transferable[]) => void }) {
  scope.onmessage = async (e: MessageEvent<ToWorker>) => {
    const msg = e.data;
    const { id } = msg;
    try {
      if (msg.op === 'export') {
        const bytes = await registry.export(msg.req);
        scope.postMessage({ id, op: 'bytes', bytes }, [bytes.buffer]);
      } else if (msg.op === 'create') {
        scope.postMessage({ id, op: 'result', result: await registry.create(msg.kind, msg.title) });
      } else {
        const result = await registry.import({ name: msg.name, type: msg.type, bytes: msg.bytes }, (progress) => scope.postMessage({ id, op: 'progress', progress }));
        scope.postMessage({ id, op: 'result', result });
      }
    } catch (err) {
      scope.postMessage({ id, op: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };
}
