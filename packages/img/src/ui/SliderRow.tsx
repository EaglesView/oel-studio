import { Slider } from '@oel/emboss';
import { formatValue } from '../model/format';
import type { SliderControl } from '../model/controls';

const TRACKS: Record<string, string> = {
  temp: 'linear-gradient(90deg, #4f7fd8, #d8d4cc 50%, #e8a33a)',
  tint: 'linear-gradient(90deg, #4aa35a, #d8d4cc 50%, #c24fb0)',
  hue: 'linear-gradient(90deg, #d8433b, #e3c53a 17%, #4fa64a 33%, #3cb3b0 50%, #3f6fd1 67%, #c84aa8 83%, #d8433b)',
};

/**
 * One slider of the panel: inked from zero for centred controls, double-click resets,
 * `onStart` / `onEnd` bracket a drag (one undo step, half-size preview while it lasts).
 */
export function SliderRow({
  control,
  value,
  reset,
  onChange,
  onStart,
  onEnd,
  disabled,
}: {
  control: SliderControl;
  value: number;
  /** Double-click value (the default, or the gallery style's). */
  reset: number;
  onChange: (v: number | undefined) => void;
  onStart: () => void;
  onEnd: () => void;
  disabled?: boolean;
}) {
  const centred = control.min < 0 && control.max > 0;
  const track = control.track && (TRACKS[control.track] ?? `linear-gradient(90deg, #d8d4cc, ${control.track})`);
  return (
    <Slider
      size="sm"
      label={control.label}
      minValue={control.min}
      maxValue={control.max}
      step={control.step}
      value={Math.min(control.max, Math.max(control.min, value))}
      origin={centred ? 0 : undefined}
      resetValue={reset}
      isDisabled={disabled}
      valueLabel={(v) => formatValue(v, control.display)}
      trackStyle={track ? { background: track } : undefined}
      onChange={(v) => {
        onStart();
        onChange(v as number);
      }}
      onChangeEnd={() => onEnd()}
    />
  );
}
