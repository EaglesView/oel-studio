/**
 * The image worker's logic, with the browser-only parts injected (decoding, resizing,
 * encoding, backend creation) so it runs under vitest with the CPU backend.
 */
import type { ExportOptions, FromImage, GpuPreference, Raster, ToImage } from '../protocol';
import { fit, proxySizes, scaleOf, type Size } from '../proxies';
import type { Backend, OelImgWasm } from './backend';
import { tr } from '@oel/i18n';

export interface Platform {
  /** Upright sRGB RGBA of an encoded picture. */
  decode(blob: Blob): Promise<Raster>;
  resize(r: Raster, width: number, height: number): Promise<Raster>;
  encode(r: Raster, mime: string, quality?: number): Promise<Blob>;
}

export interface HandlerDeps {
  createBackend(canvas: OffscreenCanvas | null, gpu: GpuPreference): Promise<Backend>;
  platform: Platform;
  /** CPU reference, for exports larger than the GPU accepts. */
  cpu: OelImgWasm;
}

interface Version extends Size {
  slot: number;
}

export function createImageHandler(deps: HandlerDeps) {
  let backend: Backend | null = null;
  let original: Raster | null = null;
  let preview: Version | null = null;
  let drag: Version | null = null;
  let full: Version | null = null;
  let recipe = '{}';

  const need = () => {
    if (!backend) throw new Error(tr('Moteur d’image non initialisé', 'Image engine not started'));
    if (!original || !preview || !drag) throw new Error(tr('Aucune image chargée', 'No image loaded'));
    return { backend, original, preview, drag };
  };

  const use = (v: Version, json = recipe) => {
    const { backend, original } = need();
    backend.use(v.slot, json, scaleOf(v, original));
  };

  async function upload(r: Raster): Promise<Version> {
    return { width: r.width, height: r.height, slot: backend!.addSource(r) };
  }

  async function version(size: Size): Promise<Version> {
    if (size.width === original!.width && size.height === original!.height) return upload(original!);
    return upload(await deps.platform.resize(original!, size.width, size.height));
  }

  /** The output at full resolution: GPU when the original fits, else the CPU reference. */
  async function fullOutput(): Promise<Raster> {
    const { backend, original, preview } = need();
    if (preview.width === original.width && preview.height === original.height) {
      use(preview);
      return backend.render();
    }
    if (Math.max(original.width, original.height) <= backend.maxSize) {
      full ??= await upload(original);
      use(full);
      const out = await backend.render();
      use(preview);
      return out;
    }
    const r = deps.cpu.render_rgba(original.data, original.width, original.height, recipe, 1, false);
    const out = { width: r.width, height: r.height, data: r.pixels };
    r.free();
    return out;
  }

  async function shrink(r: Raster, maxLong: number | undefined): Promise<Raster> {
    if (!maxLong || Math.max(r.width, r.height) <= maxLong) return r;
    const s = fit(r.width, r.height, maxLong);
    return deps.platform.resize(r, s.width, s.height);
  }

  async function exportBlob(options: ExportOptions): Promise<Blob> {
    const r = await shrink(await fullOutput(), options.maxLong);
    return deps.platform.encode(r, options.mime, options.quality);
  }

  return async function handle(m: ToImage): Promise<FromImage> {
    try {
      switch (m.op) {
        case 'init':
          backend = await deps.createBackend(m.canvas, m.gpu);
          return { id: m.id, op: 'ready', capability: backend.capability, maxSize: backend.maxSize };
        case 'source': {
          if (!backend) throw new Error(tr('Moteur d’image non initialisé', 'Image engine not started'));
          backend.clearSources();
          full = null;
          original = await deps.platform.decode(m.blob);
          const sizes = proxySizes(original.width, original.height, backend.maxSize);
          preview = await version(sizes.preview);
          drag = await version(sizes.drag);
          use(preview);
          return { id: m.id, op: 'source', width: original.width, height: original.height };
        }
        case 'recipe':
          recipe = m.json;
          if (preview) use(preview);
          return { id: m.id, op: 'done' };
        case 'draw': {
          const { backend, preview, drag } = need();
          use(m.interactive ? drag : preview);
          await backend.draw(m.width, m.height);
          return { id: m.id, op: 'done' };
        }
        case 'export':
          return { id: m.id, op: 'blob', blob: await exportBlob(m.options) };
        case 'raster': {
          const { backend, drag, preview } = need();
          use(drag, m.json);
          const r = await shrink(await backend.render(), m.maxLong);
          if (m.json) use(preview);
          return { id: m.id, op: 'raster', raster: r };
        }
        case 'histogram': {
          const { backend, preview } = need();
          use(preview, m.json);
          const bins = await backend.histogram();
          if (m.json) use(preview);
          return { id: m.id, op: 'histogram', bins };
        }
      }
    } catch (e) {
      return { id: m.id, op: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  };
}
