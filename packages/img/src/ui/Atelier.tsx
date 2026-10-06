/**
 * L'atelier d'image (Figma L1): the picture on the stage, the panel on the right with the
 * histogram and the Simple / Avancé tabs, both editing one recipe. The bar: back to the desk,
 * undo / redo, before / after (hold « \ »), copy / paste settings, export.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Menu, MenuItem, MenuTrigger, Popover, Slider, Tab, TabList, TabPanel, Tabs, toast } from '@oel/emboss';
import type { Histogram as Bins } from '../engine';
import type { ExportOptions, Raster } from '../protocol';
import { fieldSpec, frameSize, leafValue, outputSize, type Recipe } from '../recipe';
import { ADVANCED_PANELS, GRADING_WHEELS, HSL_ASPECTS, HSL_BANDS, SIMPLE_GROUPS, leafSlider, type SliderControl } from '../model/controls';
import { ASPECTS, aspectRatio, cropForAspect, flipLeaves, formatValue, turnLeaves } from '../model/format';
import { BUILTIN_STYLES, autoTone, currentStyle, lookOf } from '../model/looks';
import { flattenRecipe, isGeometryPath, unflattenRecipe, type RecipeDoc } from '../model/recipeDoc';
import { CropOverlay } from './CropOverlay';
import { CurveEditor } from './CurveEditor';
import { ExportPopover } from './ExportPopover';
import { Histogram } from './Histogram';
import { Section } from './Section';
import { SliderRow } from './SliderRow';
import { fitBox, useBox, useDraw, useImageEngine } from './useEngine';

export interface AtelierProps {
  /** File name shown in the bar (`affiche-v3.jpg`). */
  title: string;
  /** The original picture; `null` while it loads or when there is none (`missing`). */
  original: Blob | null;
  missing?: string;
  doc: RecipeDoc;
  createWorker: () => Worker;
  onBureau: () => void;
  /** Saves an exported file (download on the web, a save dialog in the app). */
  onExport: (blob: Blob, fileName: string) => void;
  /** The retouched picture, a while after edits settle (desk thumbnail). */
  onRendered?: (r: Raster) => void;
}

type Rect = [number, number, number, number];

// Copied settings, shared by every atelier of the tab (« Copier » here, « Coller » on another image).
let copied: Recipe | null = null;
const copiedListeners = new Set<() => void>();
const subscribeCopied = (fn: () => void) => (copiedListeners.add(fn), () => void copiedListeners.delete(fn));

function useRecipe(doc: RecipeDoc): Recipe {
  const cache = useRef<{ v: number; r: Recipe }>({ v: -1, r: {} });
  const version = useRef(0);
  const subscribe = useCallback((fn: () => void) => doc.onChange(() => (version.current++, fn())), [doc]);
  return useSyncExternalStore(subscribe, () => {
    if (cache.current.v !== version.current) cache.current = { v: version.current, r: doc.recipe() };
    return cache.current.r;
  });
}

function useUndoState(doc: RecipeDoc) {
  const [, force] = useState(0);
  useEffect(() => {
    const bump = () => force((n) => n + 1);
    doc.undo.on('stack-item-added', bump);
    doc.undo.on('stack-item-popped', bump);
    doc.undo.on('stack-cleared', bump);
    return () => {
      doc.undo.off('stack-item-added', bump);
      doc.undo.off('stack-item-popped', bump);
      doc.undo.off('stack-cleared', bump);
    };
  }, [doc]);
  return { canUndo: doc.undo.canUndo(), canRedo: doc.undo.canRedo() };
}

const geometryOf = (r: Recipe): Recipe => unflattenRecipe(Object.entries(flattenRecipe(r)).filter(([k]) => isGeometryPath(k)));
const withLook = (look: Recipe, r: Recipe): Recipe => unflattenRecipe([...Object.entries(lookOf(look)), ...Object.entries(flattenRecipe(geometryOf(r)))]);

export function Atelier({ title, original, missing, doc, createWorker, onBureau, onExport, onRendered }: AtelierProps) {
  const recipe = useRecipe(doc);
  const { canUndo, canRedo } = useUndoState(doc);
  const stage = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const engineState = useImageEngine(host, createWorker, original);
  const { engine, source } = engineState;
  const box = useBox(stage);

  const [dragging, setDragging] = useState(false);
  const [before, setBefore] = useState(false);
  const [hoverStyle, setHoverStyle] = useState<Recipe | null>(null);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [bins, setBins] = useState<Bins | null>(null);
  const hasCopied = useSyncExternalStore(subscribeCopied, () => copied !== null);

  // What the stage shows: the recipe, or the original (before), a hovered style, or the
  // uncropped frame while cropping.
  const shown = useMemo<Recipe>(() => {
    if (crop) return unflattenRecipe([...Object.entries(flattenRecipe(recipe)), ['geometry.crop', [0, 0, 1, 1]]]);
    if (before) return geometryOf(recipe);
    if (hoverStyle) return withLook(hoverStyle, recipe);
    return recipe;
  }, [recipe, before, hoverStyle, crop]);
  const css = source && box ? fitBox(outputSize(shown, source.width, source.height), box) : null;

  const rendered = useRef(onRendered);
  rendered.current = onRendered;
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useDraw(engineState, css, shown, dragging, setBins, () => {
    if (!rendered.current || !engine || crop || before || hoverStyle) return;
    if (renderTimer.current) clearTimeout(renderTimer.current);
    renderTimer.current = setTimeout(() => void engine.raster(640).then((r) => rendered.current?.(r)).catch(() => {}), 600);
  });
  useEffect(() => () => void (renderTimer.current && clearTimeout(renderTimer.current)), []);

  // One drag (or one click) = one undo step, rendered from the half-size proxy while it lasts.
  const startEdit = useCallback(() => {
    setDragging((d) => {
      if (!d) doc.stopCapturing();
      return true;
    });
  }, [doc]);
  const endEdit = useCallback(() => {
    setDragging(false);
    doc.stopCapturing();
  }, [doc]);

  const setLeaf = (path: string, v: number | undefined) => {
    const def = fieldSpec(path)?.default;
    doc.set(path, v === undefined || v === def ? undefined : v);
  };

  const frame = source ? frameSize(recipe, source.width, source.height) : { width: 1, height: 1 };
  const aspect = String(leafValue(recipe, 'geometry.aspect'));
  const ratio = aspectRatio(aspect, frame.width, frame.height);

  const setAspect = (id: string) => {
    const r = aspectRatio(id, frame.width, frame.height);
    const base = crop ?? (leafValue(recipe, 'geometry.crop') as Rect);
    const next = cropForAspect(base, r, frame.width, frame.height);
    if (crop) setCrop(next);
    doc.update({ 'geometry.aspect': id === 'original' ? undefined : id, ...(crop ? {} : { 'geometry.crop': sameRect(next, [0, 0, 1, 1]) ? undefined : next }) });
  };
  const finishCrop = () => {
    if (!crop) return;
    doc.set('geometry.crop', sameRect(crop, [0, 0, 1, 1]) ? undefined : crop);
    setCrop(null);
  };

  const auto = async () => {
    if (!engine) return;
    const h = await engine.histogram(geometryOf(recipe));
    doc.stopCapturing();
    doc.update(autoTone(h.luma));
    doc.stopCapturing();
  };

  const copy = () => {
    copied = unflattenRecipe(Object.entries(lookOf(recipe)));
    copiedListeners.forEach((l) => l());
    void navigator.clipboard?.writeText(JSON.stringify({ format: 'oel-img-recipe@1', ...copied })).catch(() => {});
    toast({ title: 'Réglages copiés', description: 'Collez-les sur une autre image avec « Coller les réglages ».', tone: 'success' });
  };
  const paste = () => {
    if (!copied) return;
    doc.stopCapturing();
    doc.replace(copied, isGeometryPath);
    doc.stopCapturing();
  };

  const exportFile = async (o: ExportOptions, ext: string) => {
    if (!engine) return;
    try {
      const blob = await engine.export(o);
      onExport(blob, `${title.replace(/\.[^.]+$/, '') || 'image'}.${ext}`);
    } catch (e) {
      toast({ title: 'Exportation impossible', description: e instanceof Error ? e.message : String(e), tone: 'danger' });
    }
  };

  return (
    <div
      className="atelier"
      onKeyDown={(e) => {
        const mod = e.ctrlKey || e.metaKey;
        const typing = (e.target as HTMLElement).closest('input[type=text], textarea, [contenteditable]');
        if (mod && e.key.toLowerCase() === 'z' && !typing) {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) doc.undo.redo();
          else doc.undo.undo();
        } else if (mod && e.key.toLowerCase() === 'y' && !typing) {
          e.preventDefault();
          e.stopPropagation();
          doc.undo.redo();
        } else if (e.key === '\\' && !typing) {
          e.preventDefault();
          setBefore(true);
        } else if (crop && e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          finishCrop();
        } else if (crop && e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setCrop(null);
        }
      }}
      onKeyUp={(e) => e.key === '\\' && setBefore(false)}
    >
      <header className="atelier__bar">
        <Button variant="ghost" size="sm" leadingIcon="chevron-left" onPress={onBureau}>
          Bureau
        </Button>
        <h2 className="atelier__title">{title}</h2>
        <span className="atelier__spacer" />
        <Button variant="ghost" size="icon-sm" leadingIcon="undo" aria-label="Annuler" aria-keyshortcuts="Control+Z" isDisabled={!canUndo} onPress={() => doc.undo.undo()} />
        <Button variant="ghost" size="icon-sm" leadingIcon="redo" aria-label="Rétablir" aria-keyshortcuts="Control+Shift+Z" isDisabled={!canRedo} onPress={() => doc.undo.redo()} />
        <Button variant="ghost" size="sm" leadingIcon="eye" aria-pressed={before} aria-keyshortcuts="\" onPress={() => setBefore(!before)}>
          Avant / après
        </Button>
        <Button variant="ghost" size="sm" leadingIcon="copy" onPress={copy}>
          Copier les réglages
        </Button>
        {hasCopied && (
          <Button variant="ghost" size="sm" leadingIcon="paste" onPress={paste}>
            Coller les réglages
          </Button>
        )}
        {source && engine && <ExportPopover size={outputSize(recipe, source.width, source.height)} onExport={exportFile} />}
      </header>

      <div className="atelier__body">
        <div className="atelier__stage" ref={stage}>
          {missing ? (
            <p className="atelier__message">{missing}</p>
          ) : engineState.error ? (
            <p className="atelier__message">Impossible d’ouvrir l’image : {engineState.error}</p>
          ) : (
            <div className="atelier__frame" style={css ? { width: css.width, height: css.height } : { visibility: 'hidden' }}>
              <div className="atelier__canvas-host" ref={host} />
              {crop && source && <CropOverlay rect={crop} ratio={aspect === 'libre' ? null : ratio} fw={frame.width} fh={frame.height} onChange={setCrop} />}
            </div>
          )}
          {!missing && !engineState.error && !source && <p className="atelier__message">Ouverture de l’image…</p>}
          {before && <span className="atelier__badge">Avant</span>}
          {crop && (
            <div className="atelier__cropbar chrome-pill">
              <Slider
                size="sm"
                label="Redresser"
                minValue={-45}
                maxValue={45}
                step={0.1}
                origin={0}
                resetValue={0}
                value={Number(leafValue(recipe, 'geometry.angle')) || 0}
                valueLabel={(v) => formatValue(v, { signed: true, digits: 1, unit: '°' })}
                onChange={(v) => {
                  startEdit();
                  setLeaf('geometry.angle', v as number);
                }}
                onChangeEnd={endEdit}
              />
              <Button variant="ghost" size="sm" onPress={() => setCrop(null)}>
                Annuler
              </Button>
              <Button variant="primary" size="sm" onPress={finishCrop}>
                Terminer
              </Button>
            </div>
          )}
          {engine?.notice && <p className="atelier__notice">{engine.notice}</p>}
        </div>

        <aside className="atelier__panel" aria-label="Réglages de l’image">
          <Histogram bins={bins} />
          <Tabs className="atelier__tabs" defaultSelectedKey="simple">
            <TabList aria-label="Mode de retouche" className="atelier__tablist">
              <Tab id="simple">Simple</Tab>
              <Tab id="avance">Avancé</Tab>
            </TabList>
            <TabPanel id="simple" className="atelier__tabpanel">
              <Styles engine={engine} recipe={recipe} source={source} onHover={setHoverStyle} onPick={(look) => (doc.stopCapturing(), doc.replace(look, isGeometryPath), doc.stopCapturing())} />
              <Button variant="secondary" size="sm" leadingIcon="magic-wand" className="atelier__auto" isDisabled={!engine} onPress={auto}>
                Auto
              </Button>
              {SIMPLE_GROUPS.map((g) => (
                <Section key={g.id} title={g.label}>
                  {g.controls.map((c) => (
                    <SliderRow
                      key={c.id}
                      control={c}
                      value={c.read(recipe)}
                      reset={0}
                      onChange={(v) => doc.update(c.write(v === 0 ? undefined : v))}
                      onStart={startEdit}
                      onEnd={endEdit}
                    />
                  ))}
                </Section>
              ))}
              <Section title="Cadrer">
                <div className="atelier__row">
                  <Button variant="ghost" size="sm" leadingIcon="crop" isDisabled={!source} onPress={() => setCrop(leafValue(recipe, 'geometry.crop') as Rect)}>
                    Recadrer
                  </Button>
                  <Button variant="ghost" size="sm" leadingIcon="rotate-3d" onPress={() => doc.update(turnLeaves(recipe, 1))}>
                    Pivoter
                  </Button>
                  <AspectMenu value={aspect} onChange={setAspect} />
                </div>
              </Section>
            </TabPanel>
            <TabPanel id="avance" className="atelier__tabpanel">
              {ADVANCED_PANELS.map((p) => (
                <Section key={p.id} title={p.label} defaultOpen={p.open} disabled={p.body.kind === 'soon' ? 'Bientôt' : undefined}>
                  {p.body.kind === 'sliders' &&
                    p.body.groups.map((g, i) => (
                      <div key={i} className="atelier__group">
                        {g.label && <h4 className="atelier__group-label">{g.label}</h4>}
                        {g.sliders.map((c) => (
                          <LeafRow key={c.id} control={c} recipe={recipe} onChange={setLeaf} onStart={startEdit} onEnd={endEdit} />
                        ))}
                      </div>
                    ))}
                  {p.body.kind === 'curve' && (
                    <CurveEditor
                      curves={Object.fromEntries(['rgb', 'r', 'g', 'b'].map((c) => [c, leafValue(recipe, `toneCurve.${c}`) as [number, number][]]))}
                      onChange={(ch, pts) => doc.set(`toneCurve.${ch}`, pts.length === 2 && pts.every(([x, y]) => x === y) ? undefined : pts)}
                      onStart={startEdit}
                      onEnd={endEdit}
                    />
                  )}
                  {p.body.kind === 'hsl' && <HslMixer recipe={recipe} onChange={setLeaf} onStart={startEdit} onEnd={endEdit} />}
                  {p.body.kind === 'grading' && <Grading recipe={recipe} onChange={setLeaf} onStart={startEdit} onEnd={endEdit} />}
                  {p.body.kind === 'geometry' && (
                    <div className="atelier__group">
                      <LeafRow control={leafSlider('geometry.angle', 'Redresser', { signed: true, digits: 1, unit: '°' })} recipe={recipe} onChange={setLeaf} onStart={startEdit} onEnd={endEdit} />
                      <div className="atelier__row">
                        <Button variant="ghost" size="sm" onPress={() => doc.update(turnLeaves(recipe, -1))}>
                          Pivoter à gauche
                        </Button>
                        <Button variant="ghost" size="sm" leadingIcon="rotate-3d" onPress={() => doc.update(turnLeaves(recipe, 1))}>
                          Pivoter à droite
                        </Button>
                      </div>
                      <div className="atelier__row">
                        <Button variant="ghost" size="sm" onPress={() => doc.update(flipLeaves(recipe, 'h'))}>
                          Miroir horizontal
                        </Button>
                        <Button variant="ghost" size="sm" onPress={() => doc.update(flipLeaves(recipe, 'v'))}>
                          Miroir vertical
                        </Button>
                      </div>
                      <div className="atelier__row">
                        <Button variant="ghost" size="sm" leadingIcon="crop" isDisabled={!source} onPress={() => setCrop(leafValue(recipe, 'geometry.crop') as Rect)}>
                          Recadrer
                        </Button>
                        <AspectMenu value={aspect} onChange={setAspect} />
                      </div>
                      <p className="atelier-hint">Profils d’objectif et correction de perspective : plus tard.</p>
                    </div>
                  )}
                  {p.body.kind === 'soon' && <p className="atelier-hint">{p.body.text}</p>}
                </Section>
              ))}
            </TabPanel>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}

const sameRect = (a: Rect, b: Rect) => a.every((v, i) => Math.abs(v - b[i]!) < 1e-4);

function LeafRow({ control, recipe, onChange, onStart, onEnd }: { control: SliderControl; recipe: Recipe; onChange: (path: string, v: number | undefined) => void; onStart: () => void; onEnd: () => void }) {
  return (
    <SliderRow
      control={control}
      value={Number(leafValue(recipe, control.id)) || 0}
      reset={fieldSpec(control.id)?.default ?? 0}
      onChange={(v) => onChange(control.id, v)}
      onStart={onStart}
      onEnd={onEnd}
    />
  );
}

function AspectMenu({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const label = ASPECTS.find((a) => a.id === value)?.label ?? value;
  return (
    <MenuTrigger>
      <Button variant="ghost" size="sm" trailingIcon="chevron-down" aria-label={`Format : ${label}`}>
        Format
      </Button>
      <Popover placement="bottom start" showArrow={false}>
        <Menu aria-label="Format du recadrage" selectionMode="single" selectedKeys={[value]} onAction={(k) => onChange(String(k))}>
          {ASPECTS.map((a) => (
            <MenuItem key={a.id} id={a.id}>
              {a.label}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

function HslMixer({ recipe, onChange, onStart, onEnd }: { recipe: Recipe; onChange: (path: string, v: number | undefined) => void; onStart: () => void; onEnd: () => void }) {
  return (
    <Tabs className="atelier__subtabs" defaultSelectedKey="hue">
      <TabList aria-label="Réglage du mélangeur" className="atelier__tablist atelier__tablist--small">
        {HSL_ASPECTS.map((a) => (
          <Tab key={a.id} id={a.id}>
            {a.label}
          </Tab>
        ))}
      </TabList>
      {HSL_ASPECTS.map((a) => (
        <TabPanel key={a.id} id={a.id} className="atelier__group">
          {HSL_BANDS.map((b) => (
            <LeafRow key={b.id} control={leafSlider(`hsl.${b.id}.${a.id}`, b.label, { signed: true }, b.color)} recipe={recipe} onChange={onChange} onStart={onStart} onEnd={onEnd} />
          ))}
        </TabPanel>
      ))}
    </Tabs>
  );
}

function Grading({ recipe, onChange, onStart, onEnd }: { recipe: Recipe; onChange: (path: string, v: number | undefined) => void; onStart: () => void; onEnd: () => void }) {
  return (
    <>
      {GRADING_WHEELS.map((w) => {
        const hue = Number(leafValue(recipe, `grading.${w.id}.hue`)) || 0;
        return (
          <div key={w.id} className="atelier__group">
            <h4 className="atelier__group-label">
              <span className="atelier__swatch" style={{ background: `hsl(${hue} 70% 55% / ${Math.min(1, (Number(leafValue(recipe, `grading.${w.id}.sat`)) || 0) / 60 + 0.15)})` }} aria-hidden />
              {w.label}
            </h4>
            <LeafRow control={leafSlider(`grading.${w.id}.hue`, 'Teinte', { unit: '°' }, 'hue')} recipe={recipe} onChange={onChange} onStart={onStart} onEnd={onEnd} />
            <LeafRow control={leafSlider(`grading.${w.id}.sat`, 'Saturation', {})} recipe={recipe} onChange={onChange} onStart={onStart} onEnd={onEnd} />
            <LeafRow control={leafSlider(`grading.${w.id}.lum`, 'Luminance')} recipe={recipe} onChange={onChange} onStart={onStart} onEnd={onEnd} />
          </div>
        );
      })}
      <div className="atelier__group">
        <LeafRow control={leafSlider('grading.blending', 'Fusion', {})} recipe={recipe} onChange={onChange} onStart={onStart} onEnd={onEnd} />
        <LeafRow control={leafSlider('grading.balance', 'Équilibre')} recipe={recipe} onChange={onChange} onStart={onStart} onEnd={onEnd} />
      </div>
    </>
  );
}

/** Style thumbnails rendered on the image itself; hovering one previews it on the stage. */
function Styles({
  engine,
  recipe,
  source,
  onHover,
  onPick,
}: {
  engine: ReturnType<typeof useImageEngine>['engine'];
  recipe: Recipe;
  source: { width: number; height: number } | null;
  onHover: (r: Recipe | null) => void;
  onPick: (r: Recipe) => void;
}) {
  const geometry = JSON.stringify(geometryOf(recipe));
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!engine || !source) return;
    let alive = true;
    const urls: string[] = [];
    void (async () => {
      for (const s of BUILTIN_STYLES) {
        const r = await engine.raster(176, withLook(s.recipe, JSON.parse(geometry) as Recipe)).catch(() => null);
        if (!alive || !r) return;
        const c = document.createElement('canvas');
        c.width = r.width;
        c.height = r.height;
        c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.data.buffer as ArrayBuffer, r.data.byteOffset, r.data.byteLength), r.width, r.height), 0, 0);
        const url = c.toDataURL('image/jpeg', 0.85);
        urls.push(url);
        setThumbs((t) => ({ ...t, [s.id]: url }));
      }
    })();
    return () => void (alive = false);
  }, [engine, source, geometry]);
  const current = currentStyle(recipe)?.id;
  return (
    <div className="atelier__styles" role="radiogroup" aria-label="Styles">
      <h3 className="atelier__heading">Styles</h3>
      <div className="atelier__style-row">
        {BUILTIN_STYLES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={current === s.id}
            className={`atelier__style${current === s.id ? ' is-current' : ''}`}
            onPointerEnter={() => onHover(s.recipe)}
            onPointerLeave={() => onHover(null)}
            onFocus={() => onHover(s.recipe)}
            onBlur={() => onHover(null)}
            onClick={() => {
              onHover(null);
              onPick(s.recipe);
            }}
          >
            <span className="atelier__style-thumb">{thumbs[s.id] && <img src={thumbs[s.id]} alt="" />}</span>
            <span className="atelier__style-label">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
