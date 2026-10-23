import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineHost } from '../src/host';
import type { EngineRegistry } from '../src/registry';
import type { FromWorker, ToWorker } from '../src/worker/protocol';
import { serveEngines } from '../src/worker/serve';

/** Answers like the engine worker; `answer` returns null to stay silent (a request queued behind a trap). */
class FakeWorker {
  static made: FakeWorker[] = [];
  onmessage: ((e: { data: FromWorker }) => void) | null = null;
  onerror: unknown = null;
  received: ToWorker[] = [];
  terminated = false;
  constructor(private answer: (m: ToWorker, w: FakeWorker) => FromWorker | null) {
    FakeWorker.made.push(this);
  }
  postMessage(m: ToWorker) {
    this.received.push(m);
    const reply = this.answer(m, this);
    if (reply) queueMicrotask(() => this.onmessage?.({ data: reply }));
  }
  terminate() {
    this.terminated = true;
  }
}

const result = (id: number): FromWorker => ({ id, op: 'result', result: { kind: 'document' } as never });
const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name);

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.made = [];
});

describe('EngineHost after a WASM trap (backlog T0-3)', () => {
  it('replaces the worker and sends it the requests the old one still held', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const host = new EngineHost(
      () =>
        new FakeWorker((m, w) => {
          if (m.op !== 'import') return null;
          // The first worker traps on bad.docx and never gets to good.docx.
          if (w === FakeWorker.made[0]) return m.name === 'bad.docx' ? { id: m.id, op: 'error', message: 'unreachable', fatal: true } : null;
          return result(m.id);
        }) as unknown as Worker,
    );
    const bad = host.import(file('bad.docx'));
    const good = host.import(file('good.docx'));

    await expect(bad).rejects.toThrow(/bad\.docx/);
    await expect(bad).rejects.not.toThrow(/unreachable/);
    await expect(good).resolves.toEqual({ kind: 'document' });
    expect(FakeWorker.made).toHaveLength(2);
    expect(FakeWorker.made[0]!.terminated).toBe(true);
    expect(FakeWorker.made[1]!.received.map((m) => m.op === 'import' && m.name)).toEqual(['good.docx']);
    // The bytes were copied, not transferred, so they could be sent again.
    expect((FakeWorker.made[1]!.received[0] as Extract<ToWorker, { op: 'import' }>).bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('keeps the worker after an ordinary error', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const host = new EngineHost(() => new FakeWorker((m) => ({ id: m.id, op: 'error', message: 'Fichier illisible' })) as unknown as Worker);
    await expect(host.import(file('a.docx'))).rejects.toThrow('Fichier illisible');
    expect(FakeWorker.made).toHaveLength(1);
    expect(FakeWorker.made[0]!.terminated).toBe(false);
  });
});

describe('serveEngines', () => {
  const serve = (error: Error) => {
    const posted: FromWorker[] = [];
    const scope = { onmessage: null as unknown, postMessage: (m: FromWorker) => posted.push(m) };
    const registry = { import: async () => Promise.reject(error) } as unknown as EngineRegistry;
    serveEngines(registry, scope);
    return { posted, send: (m: ToWorker) => (scope.onmessage as (e: { data: ToWorker }) => Promise<void>)({ data: m }) };
  };
  const msg: ToWorker = { id: 1, op: 'import', name: 'a.docx', type: '', bytes: new Uint8Array() };

  it('marks a WASM trap as fatal', async () => {
    const s = serve(new WebAssembly.RuntimeError('unreachable'));
    await s.send(msg);
    expect(s.posted).toEqual([{ id: 1, op: 'error', message: 'unreachable', fatal: true }]);
  });

  it('leaves other errors ordinary', async () => {
    const s = serve(new Error('pas un .docx'));
    await s.send(msg);
    expect(s.posted).toEqual([{ id: 1, op: 'error', message: 'pas un .docx', fatal: false }]);
  });
});
