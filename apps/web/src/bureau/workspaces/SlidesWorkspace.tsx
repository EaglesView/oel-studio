import { useState } from 'react';
import { ListBox, ListBoxItem } from 'react-aria-components';
import type { Preview } from '@oel/engine';
import { Button, TextField, Toolbar, ToolbarSeparator, ToolButton } from '@oel/emboss';
import type { WorkspaceProps } from '../OpenSheet';
import { Inspector, InspectorRow } from './Inspector';

type Slides = Extract<Preview, { kind: 'slides' }>['slides'];
const ENGINE_LATER = 'Arrive avec le moteur de présentations (WASM).';

/** 02 · Diapositives: filmstrip, the active slide as a raised sheet, notes in a well. */
export function SlidesWorkspace({ paper, onDraft }: WorkspaceProps) {
  const initial = paper.data.preview.kind === 'slides' ? paper.data.preview.slides : [];
  const [slides, setSlides] = useState<Slides>(initial.length ? initial : [{ title: '' }]);
  const [active, setActive] = useState(0);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const slide = slides[active] ?? slides[0]!;

  const update = (next: Slides) => {
    setSlides(next);
    onDraft({ kind: 'slides', slides: next });
  };
  const edit = (patch: Partial<Slides[number]>) => update(slides.map((s, i) => (i === active ? { ...s, ...patch } : s)));

  return (
    <div className="ws ws--slides">
      <div className="ws__ribbon">
        <Toolbar aria-label="Outils de présentation">
          <ToolButton
            icon="plus"
            label="Nouvelle diapo"
            showLabel
            shortcut={['Ctrl', 'M']}
            onPress={() => {
              update([...slides.slice(0, active + 1), { title: '' }, ...slides.slice(active + 1)]);
              setActive(active + 1);
            }}
          />
          <ToolButton icon="trash" label="Supprimer la diapo" unavailableReason={slides.length < 2 ? 'Une présentation garde au moins une diapo.' : undefined} onPress={() => { update(slides.filter((_, i) => i !== active)); setActive(Math.max(0, active - 1)); }} />
          <ToolbarSeparator />
          <ToolButton icon="layout" label="Disposition" unavailableReason={ENGINE_LATER} />
          <ToolButton icon="sparkle" label="Thème" unavailableReason={ENGINE_LATER} />
          <ToolButton icon="chart" label="Graphique lié" description="Relié à Budget!B2:B8 (fil de liaison)." />
          <ToolbarSeparator />
          <ToolButton icon="slide" label="Présenter" showLabel shortcut={['F5']} onPress={() => document.querySelector('.ws-slide')?.requestFullscreen?.()} />
        </Toolbar>
      </div>

      <div className="ws__stage ws__stage--slides">
        <ListBox
          aria-label="Pellicule des diapositives"
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[String(active)]}
          onSelectionChange={(keys) => {
            const k = [...(keys as Set<string>)][0];
            if (k != null) setActive(Number(k));
          }}
          className="filmstrip"
        >
          {slides.map((s, i) => (
            <ListBoxItem key={i} id={String(i)} textValue={`Diapo ${i + 1} : ${s.title || 'sans titre'}`} className="filmstrip__item">
              <span className="filmstrip__num">{i + 1}</span>
              <span className="filmstrip__thumb">{s.title}</span>
            </ListBoxItem>
          ))}
        </ListBox>

        <div className="ws-slide-col">
          <section className="ws-slide" aria-label={`Diapo ${active + 1} sur ${slides.length}`}>
            <input
              className="ws-slide__title"
              value={slide.title}
              placeholder="Titre de la diapositive"
              aria-label="Titre de la diapositive"
              onChange={(e) => edit({ title: e.target.value })}
            />
            <textarea
              className="ws-slide__body"
              value={slide.body ?? ''}
              placeholder="Texte"
              aria-label="Texte de la diapositive"
              onChange={(e) => edit({ body: e.target.value })}
            />
          </section>
          <TextField
            label="Notes de l’orateur"
            multiline
            rows={3}
            value={notes[active] ?? ''}
            onChange={(v) => setNotes({ ...notes, [active]: v })}
            placeholder="Ce que vous direz pendant cette diapo…"
          />
        </div>
      </div>

      <Inspector title="Diapositive">
        <InspectorRow label="Position" value={`${active + 1} / ${slides.length}`} />
        <InspectorRow label="Format" value="16:9" />
        <InspectorRow label="Transition" value="Aucune" />
        <Button size="sm" variant="secondary" leadingIcon="chevron-right" onPress={() => setActive(Math.min(slides.length - 1, active + 1))} isDisabled={active >= slides.length - 1}>
          Diapo suivante
        </Button>
      </Inspector>
    </div>
  );
}
