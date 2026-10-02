import type { ReactNode } from 'react';

/** Inspector card pinned to the right edge of the open sheet (B4, 08 · zone E). */
export function Inspector({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="ws__inspector" aria-label={`Inspecteur : ${title}`}>
      <p className="emb-t-overline">{title}</p>
      <dl>{children}</dl>
    </aside>
  );
}

export function InspectorRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="ws__inspector-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
