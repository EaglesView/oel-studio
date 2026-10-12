import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { tr } from '@oel/i18n';

/**
 * E6 · 5 Code à 6 chiffres: the code pastes in one go, boxes advance on their
 * own, Backspace goes to the previous box. One group with a real label; each
 * box says which digit it is.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  label = tr('Code de vérification', 'Verification code'),
  invalid,
  describedBy,
  length = 6,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  label?: string;
  invalid?: boolean;
  describedBy?: string;
  length?: number;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, i) => (value[i] ?? '').trim());
  const focus = (i: number) => refs.current[Math.max(0, Math.min(length - 1, i))]?.focus();

  const setAt = (i: number, d: string) => {
    const next = digits.slice();
    next[i] = d;
    // Empty boxes are kept as spaces so later digits keep their position.
    const v = next.map((x) => x || ' ').join('').trimEnd();
    onChange(v);
    if (new RegExp(`^\\d{${length}}$`).test(v)) onComplete?.(v);
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    e.preventDefault();
    onChange(pasted);
    focus(pasted.length);
    if (pasted.length === length) onComplete?.(pasted);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.key === 'Backspace' && !digits[i]) {
      e.preventDefault();
      setAt(i - 1, '');
      focus(i - 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focus(i - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focus(i + 1);
    }
  };

  return (
    <div role="group" aria-label={label} aria-describedby={describedBy} className={`code-input${invalid ? ' is-invalid' : ''}`}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className="code-input__box emb-well"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          aria-label={tr(`Chiffre ${i + 1} sur ${length}`, `Digit ${i + 1} of ${length}`)}
          aria-invalid={invalid || undefined}
          value={d}
          onPaste={onPaste}
          onKeyDown={(e) => onKey(e, i)}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(-1);
            if (!v) return setAt(i, '');
            setAt(i, v);
            focus(i + 1);
          }}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}
