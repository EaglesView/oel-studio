/**
 * The slide filmstrip: real thumbnails (drawn only when scrolled into view),
 * click or ↑/↓ to go to a slide, drag to reorder, Suppr to delete, and the
 * slide actions in a context menu.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { KeyboardEvent as RKeyboardEvent } from 'react';
import { Icon, Menu, MenuItem, MenuPopover, MenuSeparator } from '@oel/emboss';
import { ScaledSlide, type RenderCtx } from './render';
import type { SlidesController } from './controller';

/** Room around a thumbnail in its row: list padding (4 + 12), number column (22), gap (4), border (2 × 2). */
const AROUND = 46;

function Thumb({ ctl, id, ctx, width }: { ctl: SlidesController; id: string; ctx: RenderCtx; width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || seen) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: '400px' });
    io.observe(node);
    return () => io.disconnect();
  }, [seen]);
  const s = ctl.doc.slide(id);
  const info = ctl.info;
  return (
    <div ref={ref} className="oel-film__thumb" style={{ width, height: (width * info.height) / info.width }}>
      {seen && s && <ScaledSlide slide={s} info={info} ctx={ctx} width={width} />}
    </div>
  );
}

export function Filmstrip({ ctl, ctx, onPresent }: { ctl: SlidesController; ctx: RenderCtx; onPresent: (from: number) => void }) {
  const ids = ctl.doc.slideIds();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const ro = ctl.readOnly;
  // Thumbnails fill the strip's width, whatever the level (the strip is narrower when open in place).
  const [thumb, setThumb] = useState(150);
  useEffect(() => {
    const node = list.current;
    if (!node) return;
    const measure = () => setThumb(Math.max(60, Math.floor(node.clientWidth - AROUND)));
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  // Keep the current slide in view.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [ctl.current]);

  const onKey = (e: RKeyboardEvent) => {
    const i = ctl.index;
    const go = (n: number) => {
      e.preventDefault();
      ctl.goTo(n);
      requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[aria-current="true"] button')?.focus());
    };
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') go(i + 1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(ids.length - 1);
    else if (!ro && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      e.stopPropagation();
      ctl.deleteSlide();
    } else if (!ro && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      ctl.duplicateSlide();
    } else if (!ro && e.key === 'Enter' && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      ctl.newSlide();
    }
  };

  return (
    <nav className="oel-film" aria-label="Diapositives">
      <ol ref={list} className="oel-film__list" onKeyDown={onKey}>
        {ids.map((id, i) => {
          const s = ctl.doc.slide(id);
          const current = id === ctl.current;
          return (
            <li
              key={id}
              className={`oel-film__item${current ? ' is-current' : ''}${s?.hidden ? ' is-hidden' : ''}${over === i && dragging ? ' is-over' : ''}`}
              aria-current={current ? 'true' : undefined}
              draggable={!ro}
              onDragStart={(e) => {
                setDragging(id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/x-oel-slide', id);
              }}
              onDragEnd={() => (setDragging(null), setOver(null))}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                setOver(e.clientY > r.top + r.height / 2 ? i + 1 : i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging && over != null) {
                  const from = ids.indexOf(dragging);
                  ctl.moveSlide(dragging, over > from ? over - 1 : over);
                }
                setDragging(null);
                setOver(null);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                ctl.goTo(id);
                setMenu({ id, x: e.clientX, y: e.clientY });
              }}
            >
              <span className="oel-film__num" aria-hidden>
                {i + 1}
              </span>
              <button
                type="button"
                className="oel-film__button"
                tabIndex={current ? 0 : -1}
                aria-label={`Diapositive ${i + 1}${s?.hidden ? ' (masquée)' : ''}`}
                onClick={() => ctl.goTo(id)}
                onDoubleClick={() => onPresent(i)}
              >
                <Thumb ctl={ctl} id={id} width={thumb} ctx={{ ...ctx, editing: false, editingText: null, slideNumber: i + 1 }} />
              </button>
              {s?.hidden && (
                <span className="oel-film__hidden" title="Masquée pendant le diaporama">
                  <Icon name="eye" size={14} />
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {!ro && (
        <button type="button" className="oel-film__add" onClick={() => ctl.newSlide()}>
          <Icon name="plus" size={16} /> Nouvelle diapositive
        </button>
      )}
      {menu && <SlideMenu ctl={ctl} at={menu} onPresent={onPresent} onClose={() => setMenu(null)} />}
    </nav>
  );
}

function SlideMenu({ ctl, at, onPresent, onClose }: { ctl: SlidesController; at: { id: string; x: number; y: number }; onPresent: (from: number) => void; onClose: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const ro = ctl.readOnly;
  const s = ctl.doc.slide(at.id);
  const ids = ctl.doc.slideIds();
  const i = ids.indexOf(at.id);
  const actions: Record<string, () => void> = {
    new: () => ctl.newSlide(),
    duplicate: () => ctl.duplicateSlide(at.id),
    delete: () => ctl.deleteSlide(at.id),
    hide: () => ctl.toggleHidden(at.id),
    up: () => ctl.moveSlide(at.id, i - 1),
    down: () => ctl.moveSlide(at.id, i + 1),
    present: () => onPresent(i),
  };
  return (
    <>
      <span ref={ref} style={{ position: 'fixed', left: at.x, top: at.y }} aria-hidden />
      <MenuPopover triggerRef={ref as RefObject<HTMLSpanElement>} isOpen onOpenChange={(o) => !o && onClose()} placement="bottom start">
        <Menu
          aria-label="Diapositive"
          autoFocus="first"
          onAction={(k) => (actions[String(k)]?.(), onClose())}
          disabledKeys={ro ? ['new', 'duplicate', 'delete', 'hide', 'up', 'down'] : [...(ids.length < 2 ? ['delete'] : []), ...(i === 0 ? ['up'] : []), ...(i === ids.length - 1 ? ['down'] : [])]}
        >
          <MenuItem id="new" icon="plus">Nouvelle diapositive</MenuItem>
          <MenuItem id="duplicate" icon="copy">Dupliquer</MenuItem>
          <MenuItem id="delete" icon="trash">Supprimer</MenuItem>
          <MenuSeparator />
          <MenuItem id="hide" icon="eye">{s?.hidden ? 'Afficher pendant le diaporama' : 'Masquer pendant le diaporama'}</MenuItem>
          <MenuItem id="up" icon="chevron-up">Monter</MenuItem>
          <MenuItem id="down" icon="chevron-down">Descendre</MenuItem>
          <MenuSeparator />
          <MenuItem id="present" icon="slide">Présenter à partir d’ici</MenuItem>
        </Menu>
      </MenuPopover>
    </>
  );
}
