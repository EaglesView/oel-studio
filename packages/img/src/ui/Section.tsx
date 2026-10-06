import { useId, useState, type ReactNode } from 'react';
import { Button } from 'react-aria-components';

/** A collapsible group of the panel (Lumière, Base, Présence…). */
export function Section({ title, defaultOpen = true, disabled, children }: { title: string; defaultOpen?: boolean; disabled?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen && !disabled);
  const id = useId();
  return (
    <section className={`atelier-section${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`}>
      <Button className="atelier-section__head" aria-expanded={open} aria-controls={id} onPress={() => setOpen(!open)} isDisabled={!!disabled}>
        <span>{title}</span>
        <span className="atelier-section__hint">{disabled ?? (open ? '▾' : '▸')}</span>
      </Button>
      {open && (
        <div className="atelier-section__body" id={id}>
          {children}
        </div>
      )}
    </section>
  );
}
