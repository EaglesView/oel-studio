import type { NodeRenderContext } from '@oel/desk/react';
import { Badge, Icon, ProgressBar } from '@oel/emboss';
import type { Pile } from '@oel/desk';
import { KIND_ICON, kindLabel, type Paper as PaperNode, type PaperKind } from './model';

const nf = new Intl.NumberFormat('fr-CA');

export function sheetTotal(rows: string[][]): number | null {
  const values = rows.slice(1).map((r) => Number((r[1] ?? '').replace(/\s/g, '').replace(',', '.')));
  const nums = values.filter((v) => Number.isFinite(v) && !Number.isNaN(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}

/**
 * One paper on the desk. Purely presentational (it lives inside a listbox
 * option): every action is in the contextual toolbar or the open sheet.
 */
export function Paper({ node, ctx }: { node: PaperNode; ctx: NodeRenderContext }) {
  const { data } = node;
  const status = data.status;
  return (
    <div
      className={`paper paper--${node.kind}`}
      data-lod={ctx.lod}
      data-selected={ctx.isSelected || undefined}
      data-state={status.state}
      aria-hidden
    >
      {ctx.lod === 'mid' ? <Thumbnail node={node} /> : <Content node={node} />}

      {status.state === 'importing' && (
        <div className="paper__veil">
          <ProgressBar
            label={status.stage}
            value={status.progress == null ? undefined : status.progress * 100}
            isIndeterminate={status.progress == null}
          />
        </div>
      )}
      {status.state === 'readonly' && ctx.lod === 'near' && (
        <div className="paper__readonly">
          <Badge appearance="stamp" tone="neutral" dot={false}>
            Lecture seule
          </Badge>
          <span>{status.reason}</span>
        </div>
      )}
      {data.comments.length > 0 && ctx.lod === 'near' && (
        <span className="paper__comments">
          <Icon name="comment" size={14} />
          {data.comments.length}
        </span>
      )}
    </div>
  );
}

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

/** Mid-distance (40–80 %): thumbnail card with title, status stamp and last editor (B5). */
function Thumbnail({ node }: { node: PaperNode }) {
  return (
    <div className="paper__thumb">
      <span className="paper__thumb-icon">
        <Icon name={KIND_ICON[node.kind]} size={28} />
      </span>
      <span className="paper__thumb-title">{node.title}</span>
      <span className="paper__thumb-meta">
        {kindLabel(node.kind)}
        {node.data.editor ? ` · ${node.data.editor}` : ''}
      </span>
      {node.data.stamp && (
        <Badge appearance="stamp" tone={node.data.stamp.tone} className="paper__thumb-stamp">
          {node.data.stamp.label}
        </Badge>
      )}
    </div>
  );
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

/** Far zoom (< 40 %): labelled pile with a counter (B5). */
export function PaperPile({ pile, nodes }: { pile: Pile; nodes: PaperNode[] }) {
  const kind = pile.key as PaperKind;
  return (
    <div className="pile" aria-hidden>
      <span className="pile__sheet pile__sheet--3" />
      <span className="pile__sheet pile__sheet--2" />
      <span className="pile__sheet pile__sheet--1">
        <Icon name={KIND_ICON[kind] ?? 'file'} size={28} />
        <strong>{kindLabel(kind)}</strong>
        <span className="pile__titles">{nodes.slice(0, 2).map((n) => n.title).join(' · ')}</span>
      </span>
      <span className="pile__count">{nodes.length}</span>
    </div>
  );
}
