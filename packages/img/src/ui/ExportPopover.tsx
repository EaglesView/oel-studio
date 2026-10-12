import { useState } from 'react';
import { Dialog, DialogTrigger, Heading } from 'react-aria-components';
import { Button as EmbButton, Popover, Radio, RadioGroup, Slider } from '@oel/emboss';
import type { ExportOptions } from '../protocol';
import { messages } from '@oel/i18n';

const t = messages(
  {
    export: 'Exporter',
    originalEach: 'Originale (chaque image)',
    original: (w: number, h: number) => `Originale (${w} × ${h})`,
    longSide: (n: number) => `${n} px (côté long)`,
    title: 'Exporter l’image',
    format: 'Format',
    size: 'Taille',
    quality: 'Qualité',
    cancel: 'Annuler',
    exporting: 'Exportation…',
    exportAs: (format: string) => `Exporter en ${format}`,
  },
  {
    export: 'Export',
    originalEach: 'Original (each image)',
    original: (w, h) => `Original (${w} × ${h})`,
    longSide: (n) => `${n} px (long side)`,
    title: 'Export the image',
    format: 'Format',
    size: 'Size',
    quality: 'Quality',
    cancel: 'Cancel',
    exporting: 'Exporting…',
    exportAs: (format) => `Export as ${format}`,
  },
);

const FORMATS = [
  { mime: 'image/jpeg', label: 'JPEG', ext: 'jpg' },
  { mime: 'image/png', label: 'PNG', ext: 'png' },
  { mime: 'image/webp', label: 'WebP', ext: 'webp' },
] as const;

/** « Exporter » : format, taille, qualité. The full-resolution render runs in the worker. */
export function ExportPopover({
  size,
  onExport,
  label = t.export,
  sizeIsSample = false,
}: {
  size: { width: number; height: number };
  onExport: (o: ExportOptions, ext: string) => Promise<void>;
  label?: string;
  /** Several pictures: « Originale » is each one's own size. */
  sizeIsSample?: boolean;
}) {
  const [mime, setMime] = useState<string>('image/jpeg');
  const [long, setLong] = useState<string>('original');
  const [quality, setQuality] = useState(90);
  const [busy, setBusy] = useState(false);
  const fmt = FORMATS.find((f) => f.mime === mime)!;
  const full = Math.max(size.width, size.height);
  const sizes = [
    { id: 'original', label: sizeIsSample ? t.originalEach : t.original(size.width, size.height) },
    ...[2048, 1280].filter((n) => n < full).map((n) => ({ id: String(n), label: t.longSide(n) })),
  ];
  return (
    <DialogTrigger>
      <EmbButton variant="primary" size="sm" leadingIcon="download">
        {label}
      </EmbButton>
      <Popover placement="bottom end">
        <Dialog className="atelier-export" aria-label={t.title}>
          {({ close }) => (
            <>
              <Heading slot="title" className="atelier-export__title">
                {t.title}
              </Heading>
              <RadioGroup label={t.format} value={mime} onChange={setMime} orientation="horizontal">
                {FORMATS.map((f) => (
                  <Radio key={f.mime} value={f.mime}>
                    {f.label}
                  </Radio>
                ))}
              </RadioGroup>
              <RadioGroup label={t.size} value={long} onChange={setLong}>
                {sizes.map((s) => (
                  <Radio key={s.id} value={s.id}>
                    {s.label}
                  </Radio>
                ))}
              </RadioGroup>
              {mime !== 'image/png' && (
                <Slider label={t.quality} minValue={50} maxValue={100} value={quality} onChange={(v) => setQuality(v as number)} valueLabel={(v) => `${v} %`} />
              )}
              <div className="atelier-export__actions">
                <EmbButton variant="ghost" size="sm" onPress={close}>
                  {t.cancel}
                </EmbButton>
                <EmbButton
                  variant="primary"
                  size="sm"
                  isDisabled={busy}
                  onPress={async () => {
                    setBusy(true);
                    try {
                      await onExport({ mime, quality: quality / 100, maxLong: long === 'original' ? undefined : Number(long) }, fmt.ext);
                      close();
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? t.exporting : t.exportAs(fmt.label)}
                </EmbButton>
              </div>
            </>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
