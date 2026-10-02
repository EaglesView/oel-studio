import { memo, useEffect, useRef, useState } from 'react';
import type { NodeRenderContext } from '@oel/desk/react';
import { Badge, Icon, ProgressBar } from '@oel/emboss';
import type { Paper as PaperNode } from './model';

const nf = new Intl.NumberFormat('fr-CA');

export function sheetTotal(rows: string[][]): number | null {
  const values = rows.slice(1).map((r) => Number((r[1] ?? '').replace(/\s/g, '').replace(',', '.')));
  const nums = values.filter((v) => Number.isFinite(v) && !Number.isNaN(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}

/** How often a zoomed-out thumbnail catches up with live edits. */
export const THUMBNAIL_REFRESH_MS = 15_000;

/**
 * While `frozen`, returns a snapshot of `value` refreshed every `interval` ms
 * (and once on freezing); otherwise returns `value` live.
 */
function useThrottledSnapshot<T>(value: T, frozen: boolean, interval: number): T {
  const latest = useRef(value);
  latest.current = value;
  const [snapshot, setSnapshot] = useState(value);
  useEffect(() => {
    if (!frozen) return;
    setSnapshot(latest.current);
    const t = setInterval(() => setSnapshot(latest.current), interval);
    return () => clearInterval(t);
  }, [frozen, interval]);
  return frozen ? snapshot : value;
}

/**
 * One paper ("window") on the desk: a small version of the document at any
 * zoom. Purely presentational (it lives inside a listbox option); actions are
 * in the contextual toolbar or the open sheet.
 *
 * Zoomed out, the content is a thumbnail: it only catches up with edits every
 * THUMBNAIL_REFRESH_MS, so live editing elsewhere does not re-render every paper.
 * Status (import progress, read-only) always stays live.
 */
export const Paper = memo(
  function Paper({ node, ctx }: { node: PaperNode; ctx: NodeRenderContext }) {
    const thumbnail = ctx.lod === 'thumbnail';
    const content = useThrottledSnapshot<PaperNode>(node, thumbnail, THUMBNAIL_REFRESH_MS);
    const status = node.data.status;
    return (
    <div
      className={`paper paper--${node.kind}`}
      data-lod={ctx.lod}
      data-selected={ctx.isSelected || undefined}
      data-state={status.state}
      aria-hidden
    >
      <Content node={content} />

      {status.state === 'importing' && (
        <div className="paper__veil">
          <ProgressBar
            label={status.stage}
            value={status.progress == null ? undefined : status.progress * 100}
            isIndeterminate={status.progress == null}
          />
        </div>
      )}
      {status.state === 'readonly' && !thumbnail && (
        <div className="paper__readonly">
          <Badge appearance="stamp" tone="neutral" dot={false}>
            Lecture seule
          </Badge>
          <span>{status.reason}</span>
        </div>
      )}
    </div>
    );
  },
  (a, b) => a.node === b.node && a.ctx.lod === b.ctx.lod && a.ctx.isSelected === b.ctx.isSelected,
);

function Content({ node }: { node: PaperNode }) {
  const { data } = node;
  const p = data.preview;
  switch (node.kind) {
    case 'document': {
      const blocks = p.kind === 'document' ? p.blocks : [];
      const [first, ...rest] = blocks;
      const title = first?.type === 'heading' ? first.text : node.title;
      const body = first?.type === 'heading' ? rest : blocks;
      return (
        <div className="paper__doc">
          {data.eyebrow && <span className="paper__eyebrow">{data.eyebrow}</span>}
          <h3 className="paper__doc-title">{title}</h3>
          {body.length === 0 && <Bars count={8} />}
          {body.slice(0, 14).map((b, i) =>
            b.type === 'heading' ? (
              <h4 key={i} className="paper__doc-h">{b.text}</h4>
            ) : b.text ? (
              <p key={i} className="paper__doc-p">{b.text}</p>
            ) : (
              <Bars key={i} count={3} />
            ),
          )}
        </div>
      );
    }
    case 'slides': {
      const slide = p.kind === 'slides' ? p.slides[0] : undefined;
      return (
        <div className="paper__slide">
          {data.eyebrow && <span className="paper__eyebrow">{data.eyebrow}</span>}
          <h3 className="paper__slide-title">{slide?.title ?? node.title}</h3>
          <div className="paper__chart">
            {[58, 90, 120, 169].map((h, i) => (
              <span key={i} style={{ height: h }} data-last={i === 3 || undefined} />
            ))}
          </div>
          {p.kind === 'slides' && p.slides.length > 1 && <span className="paper__slide-count">{p.slides.length} diapos</span>}
        </div>
      );
    }
    case 'spreadsheet': {
      const rows = p.kind === 'spreadsheet' ? p.rows : [];
      const total = sheetTotal(rows);
      return (
        <div className="paper__sheet">
          <table>
            <tbody>
              {rows.slice(1, 9).map((r, i) => (
                <tr key={i}>
                  <th>{i + 2}</th>
                  <td>{r[0]}</td>
                  <td className="num">{r[1] && Number.isFinite(Number(r[1])) ? nf.format(Number(r[1])) : r[1]}</td>
                  <td />
                </tr>
              ))}
              {total != null && (
                <tr className="paper__sheet-total">
                  <th />
                  <td>Total</td>
                  <td className="num">{nf.format(total)} $</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      );
    }
    case 'image':
      return (
        <div className="paper__photo">
          <div className="paper__photo-frame">
            {data.imageUrl ? <img src={data.imageUrl} alt="" draggable={false} /> : <Icon name="image" size={40} />}
          </div>
          <span className="paper__caption">{data.fileName ?? node.title}</span>
        </div>
      );
    case 'pdf': {
      const pages = p.kind === 'pdf' ? p.pageCount : 1;
      return (
        <div className="paper__pdf" data-pages={Math.min(pages, 3)}>
          <h3 className="paper__pdf-title">{node.title}</h3>
          <Bars count={8} />
          {data.stamp && (
            <Badge appearance="stamp" tone={data.stamp.tone} tilt={6} className="paper__stamp">
              {data.stamp.label}
            </Badge>
          )}
          <span className="paper__pdf-pages">{pages} p.</span>
        </div>
      );
    }
    case 'note':
      return (
        <div className="paper__note">
          <strong>{node.title}</strong>
          <span>{p.kind === 'note' ? p.text : ''}</span>
        </div>
      );
    default:
      return (
        <div className="paper__file">
          <Icon name="file" size={40} />
          <span>{node.title}</span>
        </div>
      );
  }
}

function Bars({ count }: { count: number }) {
  return (
    <div className="paper__bars">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} style={{ width: i % 4 === 3 ? '60%' : '100%' }} />
      ))}
    </div>
  );
}

