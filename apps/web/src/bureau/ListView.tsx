import { GridList, GridListItem, Button as RACButton, type Selection } from 'react-aria-components';
import { useDeskState } from '@oel/desk/react';
import { readingOrder } from '@oel/desk';
import { Badge, Checkbox, Icon } from '@oel/emboss';
import { KIND_ICON, kindLabel, statusText, type Bureau, type Paper } from './model';
import { features } from '../edition';

const day = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'short' });

/**
 * List view (note on 05 · Bureau: "a canvas is harder to make accessible than a
 * list, so a list view is required as an alternative"). Same store, same
 * selection, same open action — just a grid list in reading order.
 */
export function ListView({ store, onOpen }: { store: Bureau; onOpen: (id: string) => void }) {
  const nodesMap = useDeskState(store, (s) => s.nodes);
  const order = useDeskState(store, (s) => s.order);
  const selection = useDeskState(store, (s) => s.selection);
  const papers = readingOrder(order.map((id) => nodesMap[id] as Paper).filter(Boolean));

  return (
    <section className="list-view" aria-labelledby="list-view-title">
      <h2 id="list-view-title" className="emb-visually-hidden">
        Fichiers du projet
      </h2>
      <GridList
        aria-labelledby="list-view-title"
        selectionMode="multiple"
        selectionBehavior="toggle"
        selectedKeys={new Set(selection)}
        onSelectionChange={(keys: Selection) => store.select(keys === 'all' ? order : ([...keys] as string[]))}
        onAction={(key) => onOpen(String(key))}
        items={papers}
        className="list-view__grid"
        renderEmptyState={() => <p className="list-view__empty">Aucun fichier. Importez-en avec « Importer », en bas.</p>}
      >
        {(p) => (
          <GridListItem id={p.id} textValue={p.title} className="list-row">
            <Checkbox slot="selection" aria-label={`Sélectionner ${p.title}`} />
            <span className="list-row__icon" data-kind={p.kind}>
              <Icon name={KIND_ICON[p.kind]} size={20} />
            </span>
            <span className="list-row__title">{p.title}</span>
            <span className="list-row__type">{kindLabel(p.kind)}</span>
            <span className="list-row__state">
              {p.data.stamp && (
                <Badge appearance="stamp" tone={p.data.stamp.tone}>
                  {p.data.stamp.label}
                </Badge>
              )}
              {statusText(p) && <span className="list-row__status">{statusText(p)}</span>}
            </span>
            <span className="list-row__meta">
              {/* Who changed it last, or when (single-user: always you). */}
              {features.projects ? (p.data.editor ?? '—') : p.data.updatedAt ? day.format(p.data.updatedAt) : '—'}
            </span>
            <RACButton className="emb-button emb-button--secondary emb-button--sm" onPress={() => onOpen(p.id)}>
              Ouvrir
            </RACButton>
          </GridListItem>
        )}
      </GridList>
    </section>
  );
}
