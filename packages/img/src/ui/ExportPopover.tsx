import { useState } from 'react';
import { Dialog, DialogTrigger, Heading } from 'react-aria-components';
import { Button as EmbButton, Popover, Radio, RadioGroup, Slider } from '@oel/emboss';
import type { ExportOptions } from '../protocol';

const FORMATS = [
  { mime: 'image/jpeg', label: 'JPEG', ext: 'jpg' },
  { mime: 'image/png', label: 'PNG', ext: 'png' },
  { mime: 'image/webp', label: 'WebP', ext: 'webp' },
] as const;

/** « Exporter » : format, taille, qualité. The full-resolution render runs in the worker. */
export function ExportPopover({ size, onExport }: { size: { width: number; height: number }; onExport: (o: ExportOptions, ext: string) => Promise<void> }) {
  const [mime, setMime] = useState<string>('image/jpeg');
  const [long, setLong] = useState<string>('original');
  const [quality, setQuality] = useState(90);
  const [busy, setBusy] = useState(false);
  const fmt = FORMATS.find((f) => f.mime === mime)!;
  const full = Math.max(size.width, size.height);
  const sizes = [
    { id: 'original', label: `Originale (${size.width} × ${size.height})` },
    ...[2048, 1280].filter((n) => n < full).map((n) => ({ id: String(n), label: `${n} px (côté long)` })),
  ];
  return (
    <DialogTrigger>
      <EmbButton variant="primary" size="sm" leadingIcon="download">
        Exporter
      </EmbButton>
      <Popover placement="bottom end">
        <Dialog className="atelier-export" aria-label="Exporter l’image">
          {({ close }) => (
            <>
              <Heading slot="title" className="atelier-export__title">
                Exporter l’image
              </Heading>
              <RadioGroup label="Format" value={mime} onChange={setMime} orientation="horizontal">
                {FORMATS.map((f) => (
                  <Radio key={f.mime} value={f.mime}>
                    {f.label}
                  </Radio>
                ))}
              </RadioGroup>
              <RadioGroup label="Taille" value={long} onChange={setLong}>
                {sizes.map((s) => (
                  <Radio key={s.id} value={s.id}>
                    {s.label}
                  </Radio>
                ))}
              </RadioGroup>
              {mime !== 'image/png' && (
                <Slider label="Qualité" minValue={50} maxValue={100} value={quality} onChange={(v) => setQuality(v as number)} valueLabel={(v) => `${v} %`} />
              )}
              <div className="atelier-export__actions">
                <EmbButton variant="ghost" size="sm" onPress={close}>
                  Annuler
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
                  {busy ? 'Exportation…' : `Exporter en ${fmt.label}`}
                </EmbButton>
              </div>
            </>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
