import { Button as RACButton } from 'react-aria-components';
import { Icon } from '../icons/Icon';
import { cx } from '../utils';
import { tr } from '@oel/i18n';

export interface PaginationProps {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  label?: string;
}

function pages(current: number, count: number): Array<number | 'gap'> {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const set = new Set([1, count, current - 1, current, current + 1]);
  const sorted = [...set].filter((n) => n >= 1 && n <= count).sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  sorted.forEach((n, i) => {
    const prev = sorted[i - 1];
    if (i > 0 && prev !== undefined && n - prev > 1) out.push('gap');
    out.push(n);
  });
  return out;
}

/** Page keys are small embossed keys; the current page is pressed in and inked (kit 68:687). */
export function Pagination({ page, pageCount, onChange, label = 'Pagination' }: PaginationProps) {
  return (
    <nav aria-label={label}>
      <ol className="emb-pagination">
        <li>
          <RACButton
            className="emb-button emb-button--ghost emb-button--icon"
            aria-label={tr('Page précédente', 'Previous page')}
            isDisabled={page <= 1}
            onPress={() => onChange(page - 1)}
          >
            <Icon name="chevron-left" size={20} />
          </RACButton>
        </li>
        {pages(page, pageCount).map((p, i) =>
          p === 'gap' ? (
            <li key={`gap-${i}`} className="emb-pagination__gap" aria-hidden>
              …
            </li>
          ) : (
            <li key={p}>
              <RACButton
                className={cx('emb-page-key', p === page && 'is-current')}
                aria-current={p === page ? 'page' : undefined}
                aria-label={`Page ${p}`}
                onPress={() => onChange(p)}
              >
                {p}
              </RACButton>
            </li>
          ),
        )}
        <li>
          <RACButton
            className="emb-button emb-button--ghost emb-button--icon"
            aria-label={tr('Page suivante', 'Next page')}
            isDisabled={page >= pageCount}
            onPress={() => onChange(page + 1)}
          >
            <Icon name="chevron-right" size={20} />
          </RACButton>
        </li>
      </ol>
    </nav>
  );
}
