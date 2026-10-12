/**
 * L'atelier d'image (Figma L1): the picture on the stage, the panel on the right with the
 * histogram and the Simple / Avancé tabs, both editing one recipe. The bar: back to the desk,
 * undo / redo, before / after (hold « \ »), copy / paste settings, export.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import type * as Y from 'yjs';
import { Button, Menu, MenuItem, MenuTrigger, Popover, Slider, Tab, TabList, TabPanel, Tabs, toast } from '@oel/emboss';
import type { Histogram as Bins, ImageEngine } from '../engine';
import type { ExportOptions, Raster } from '../protocol';
import { frameSize, leafValue, outputSize, stackRecipes, type Recipe } from '../recipe';
import { ADVANCED_PANELS, GRADING_WHEELS, HSL_ASPECTS, HSL_BANDS, SIMPLE_GROUPS, leafSlider, type SliderControl } from '../model/controls';
import { ASPECTS, aspectRatio, cropForAspect, flipLeaves, formatValue, turnLeaves } from '../model/format';
import { BUILTIN_STYLES, autoTone, currentStyle, lookOf } from '../model/looks';
import { RecipeDoc, flattenRecipe, isGeometryPath, unflattenRecipe } from '../model/recipeDoc';
import { CropOverlay } from './CropOverlay';
import { CurveEditor } from './CurveEditor';
import { ExportPopover } from './ExportPopover';
import { Histogram } from './Histogram';
import { Section } from './Section';
import { SliderRow } from './SliderRow';
import { fitBox, useBox, useDraw, useImageEngine } from './useEngine';
import { messages, plural } from '@oel/i18n';

const t = messages(
  {
    copied: 'Réglages copiés',
    copiedBody: 'Collez-les sur une autre image avec « Coller les réglages ».',
    image: 'image',
    exportFailed: 'Exportation impossible',
    openFailed: 'Impossible d’ouvrir l’image :',
    opening: 'Ouverture de l’image…',
    before: 'Avant',
    straighten: 'Redresser',
    cancel: 'Annuler',
    done: 'Terminer',
    mode: 'Mode de retouche',
    simple: 'Simple',
    advanced: 'Avancé',
    scope: 'Où vont les réglages',
    galleryStyle: 'Style de la galerie',
    theseImages: (n: number) => `Ces images (${n})`,
    thisImage: 'Cette image',
    toStyle: (n: number) => `Ce que vous réglez ici s’applique aux ${n} images.`,
    ownMany: (n: number) => `Réglages propres à ces ${n} images, par-dessus le style.`,
    ownOne: 'Réglages propres à cette image, par-dessus le style.',
    backToStyle: 'Revenir au style de la galerie',
    auto: 'Auto',
    frame: 'Cadrer',
    crop: 'Recadrer',
    rotate: 'Pivoter',
    soon: 'Bientôt',
    rotateLeft: 'Pivoter à gauche',
    rotateRight: 'Pivoter à droite',
    flipH: 'Miroir horizontal',
    flipV: 'Miroir vertical',
    lensLater: 'Profils d’objectif et correction de perspective : plus tard.',
    retouch: 'Retoucher l’image',
    undo: 'Annuler',
    redo: 'Rétablir',
    beforeAfter: 'Avant / après',
    close: 'Fermer',
    bureau: 'Bureau',
    gallery: (n: number) => `Galerie · ${n} ${plural(n, 'image', 'images')}`,
    copySettings: 'Copier les réglages',
    pasteSettings: 'Coller les réglages',
    exportAll: (n: number) => `Exporter les ${n}`,
    settings: 'Réglages de l’image',
    format: 'Format',
    formatOf: (label: string) => `Format : ${label}`,
    cropFormat: 'Format du recadrage',
    mixer: 'Réglage du mélangeur',
    hue: 'Teinte',
    saturation: 'Saturation',
    luminance: 'Luminance',
    blending: 'Fusion',
    balance: 'Équilibre',
    styles: 'Styles',
    galleryImages: 'Images de la galerie',
    ownSettings: 'Réglages propres',
    filmHint: '← → image suivante · Ctrl + clic pour en régler plusieurs',
  },
  {
    copied: 'Settings copied',
    copiedBody: 'Paste them on another image with “Paste settings”.',
    image: 'image',
    exportFailed: 'Export failed',
    openFailed: 'The image could not be opened:',
    opening: 'Opening the image…',
    before: 'Before',
    straighten: 'Straighten',
    cancel: 'Cancel',
    done: 'Done',
    mode: 'Editing mode',
    simple: 'Simple',
    advanced: 'Advanced',
    scope: 'Where the settings go',
    galleryStyle: 'Gallery style',
    theseImages: (n) => `These images (${n})`,
    thisImage: 'This image',
    toStyle: (n) => `What you set here applies to the ${n} images.`,
    ownMany: (n) => `Settings of these ${n} images only, over the style.`,
    ownOne: 'Settings of this image only, over the style.',
    backToStyle: 'Back to the gallery style',
    auto: 'Auto',
    frame: 'Crop',
    crop: 'Crop',
    rotate: 'Rotate',
    soon: 'Coming soon',
    rotateLeft: 'Rotate left',
    rotateRight: 'Rotate right',
    flipH: 'Flip horizontally',
    flipV: 'Flip vertically',
    lensLater: 'Lens profiles and perspective correction: later.',
    retouch: 'Retouch the image',
    undo: 'Undo',
    redo: 'Redo',
    beforeAfter: 'Before / after',
    close: 'Close',
    bureau: 'Bureau',
    gallery: (n) => `Gallery · ${n} ${plural(n, 'image', 'images')}`,
    copySettings: 'Copy settings',
    pasteSettings: 'Paste settings',
    exportAll: (n) => `Export the ${n}`,
    settings: 'Image settings',
    format: 'Format',
    formatOf: (label) => `Format: ${label}`,
    cropFormat: 'Crop format',
    mixer: 'Mixer setting',
    hue: 'Hue',
    saturation: 'Saturation',
    luminance: 'Luminance',
    blending: 'Blending',
    balance: 'Balance',
    styles: 'Styles',
    galleryImages: 'Gallery images',
    ownSettings: 'Its own settings',
    filmHint: '← → next image · Ctrl + click to set several',
  },
);

/** One picture of a gallery's filmstrip. */
export interface AtelierImage {
  id: string;
  title: string;
  /** Its own settings, on top of the gallery style. */
  doc: RecipeDoc;
  /** Current rendering for the filmstrip (desk picture), if any. */
  thumbnail?: string;
}

/** Figma L2: the atelier on a gallery — filmstrip, and a style shared by every picture. */
export interface AtelierGallery {
  title: string;
  styleDoc: RecipeDoc;
  images: AtelierImage[];
  /** The picture on the stage (its `doc` is `AtelierProps.doc`). */
  current: string;
  onCurrent: (id: string) => void;
  /** Covers the style and every picture (they share a Y.Doc). */
  undo: Y.UndoManager;
  /** « Exporter les N » : every picture with its effective settings. */
  onExportAll: (o: ExportOptions, ext: string) => Promise<void>;
}

export interface AtelierProps {
  /** File name shown in the bar (`affiche-v3.jpg`). */
  title: string;
  /** The original picture; `null` while it loads or when there is none (`missing`). */
  original: Blob | null;
  missing?: string;
  doc: RecipeDoc;
  createWorker: () => Worker;
  onBureau?: () => void;
  /** Saves an exported file (download on the web, a save dialog in the app). */
  onExport: (blob: Blob, fileName: string) => void;
  /** The retouched picture, a while after edits settle (desk thumbnail). */
  onRendered?: (r: Raster) => void;
  /** Present when the picture belongs to a gallery. */
  gallery?: AtelierGallery;
  /**
   * `full`: the atelier at full screen (desk images). `panel`: docked inside an editor (L3), the
   * picture on the page being the result; `onClose` gets the engine to render the final pixels.
   */
  variant?: 'full' | 'panel';
  onClose?: (engine: ImageEngine | null) => void | Promise<void>;
  /** Text under the panel (what the file keeps). */
  note?: string;
  /** Open with the crop frame (« Recadrer »). */
  startInCrop?: boolean;
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

function useUndoState(undo: Y.UndoManager) {
  const [, force] = useState(0);
  useEffect(() => {
    const bump = () => force((n) => n + 1);
    undo.on('stack-item-added', bump);
    undo.on('stack-item-popped', bump);
    undo.on('stack-cleared', bump);
    return () => {
      undo.off('stack-item-added', bump);
      undo.off('stack-item-popped', bump);
      undo.off('stack-cleared', bump);
    };
  }, [undo]);
  return { canUndo: undo.canUndo(), canRedo: undo.canRedo() };
}

const NO_STYLE = RecipeDoc.create();

/** Whether two leaf values are the same (curves and crops are arrays). */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const geometryOf = (r: Recipe): Recipe => unflattenRecipe(Object.entries(flattenRecipe(r)).filter(([k]) => isGeometryPath(k)));
/** `r` with the crop being drawn. */
const withCrop = (r: Recipe, crop: Rect): Recipe =>
  unflattenRecipe([...Object.entries(flattenRecipe(r)).filter(([k]) => k !== 'geometry.crop'), ...(sameRect(crop, [0, 0, 1, 1]) ? [] : [['geometry.crop', crop] as [string, unknown]])]);
const withLook = (look: Recipe, r: Recipe): Recipe => unflattenRecipe([...Object.entries(lookOf(look)), ...Object.entries(flattenRecipe(geometryOf(r)))]);

export function Atelier({ title, original, missing, doc, createWorker, onBureau, onExport, onRendered, gallery, variant = 'full', onClose, note, startInCrop }: AtelierProps) {
  const own = useRecipe(doc);
  const styleDoc = gallery?.styleDoc ?? NO_STYLE;
  const style = useRecipe(styleDoc);
  const undo = gallery?.undo ?? doc.undo;
  const { canUndo, canRedo } = useUndoState(undo);

  // In a gallery, settings go to the style (every picture) or to the chosen pictures; the
  // geometry always belongs to the picture on the stage.
  const [scope, setScope] = useState<'gallery' | 'image'>('gallery');
  const [chosen, setChosen] = useState<string[]>([]);
  const styleLook = useMemo(() => unflattenRecipe(Object.entries(lookOf(style))), [style]);
  /** What the stage shows for the current picture. */
  const recipe = useMemo(() => (gallery ? stackRecipes([own, styleLook]) : own), [gallery, own, styleLook]);
  const toStyle = !!gallery && scope === 'gallery';
  /** The layer below what is being edited: a value equal to it is no override. */
  const below = gallery && !toStyle ? styleLook : {};
  /** Values the panel shows: the style's look (with this picture's geometry), or the picture's. */
  const values = useMemo(() => (toStyle ? stackRecipes([geometryOf(own), styleLook]) : recipe), [toStyle, own, styleLook, recipe]);
  const targets = useMemo(() => {
    if (!gallery) return [doc];
    if (toStyle) return [gallery.styleDoc];
    const ids = chosen.length ? chosen : [gallery.current];
    return gallery.images.filter((i) => ids.includes(i.id)).map((i) => i.doc);
  }, [gallery, toStyle, chosen, doc]);

  /** Writes leaves where they belong (one undo step per call, merged while dragging). */
  const apply = useCallback(
    (entries: Record<string, unknown>) => {
      const geo: Record<string, unknown> = {};
      const look: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(entries)) (isGeometryPath(k) ? geo : look)[k] = v;
      const doIt = () => {
        if (Object.keys(geo).length) doc.update(Object.fromEntries(Object.entries(geo).map(([k, v]) => [k, v === undefined || same(v, leafValue({}, k)) ? undefined : v])));
        if (Object.keys(look).length)
          for (const t of targets) t.update(Object.fromEntries(Object.entries(look).map(([k, v]) => [k, v === undefined || same(v, leafValue(below, k)) ? undefined : v])));
      };
      if (doc.map.doc) doc.map.doc.transact(doIt);
      else doIt();
    },
    [doc, targets, below],
  );
  const replaceLook = (look: Recipe) => {
    undo.stopCapturing();
    for (const t of targets) t.replace(look, isGeometryPath);
    undo.stopCapturing();
  };
  const stage = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const engineState = useImageEngine(host, createWorker, original);
  const { engine, source } = engineState;
  const box = useBox(stage);

  const [dragging, setDragging] = useState(false);
  const [before, setBefore] = useState(false);
  const [hoverStyle, setHoverStyle] = useState<Recipe | null>(null);
  const [crop, setCrop] = useState<Rect | null>(null);
  const cropOnOpen = useRef(startInCrop);
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
  // In a gallery the stage is padded at the bottom for the filmstrip (the box is its content).
  const css = source && box ? fitBox(outputSize(shown, source.width, source.height), box, variant === 'panel' ? 12 : 48) : null;
  useEffect(() => {
    if (!source || !cropOnOpen.current) return;
    cropOnOpen.current = false;
    setCrop(leafValue(recipe, 'geometry.crop') as Rect);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  useDraw(engineState, css, shown, dragging, setBins);

  // The result as the host shows it (desk thumbnail, the picture on the page), a while after edits
  // settle: the recipe with the crop being drawn, so the page follows the frame while cropping.
  const result = useMemo(() => (crop ? withCrop(recipe, crop) : recipe), [recipe, crop]);
  const resultJson = JSON.stringify(result);
  const rendered = useRef(onRendered);
  rendered.current = onRendered;
  useEffect(() => {
    if (!rendered.current || !engine || !source || dragging) return;
    const t = setTimeout(() => void engine.raster(640, JSON.parse(resultJson) as Recipe).then((r) => rendered.current?.(r)).catch(() => {}), 500);
    return () => clearTimeout(t);
  }, [engine, source, resultJson, dragging]);

  /** Closing keeps a crop still being drawn, and the engine renders exactly what is kept. */
  const close = () => {
    if (crop) finishCrop();
    engine?.setRecipe(result);
    void onClose?.(engine);
  };

  // One drag (or one click) = one undo step, rendered from the half-size proxy while it lasts.
  const startEdit = useCallback(() => {
    setDragging((d) => {
      if (!d) undo.stopCapturing();
      return true;
    });
  }, [undo]);
  const endEdit = useCallback(() => {
    setDragging(false);
    undo.stopCapturing();
  }, [undo]);

  const setLeaf = (path: string, v: number | undefined) => apply({ [path]: v });

  const frame = source ? frameSize(recipe, source.width, source.height) : { width: 1, height: 1 };
  const aspect = String(leafValue(recipe, 'geometry.aspect'));
  const ratio = aspectRatio(aspect, frame.width, frame.height);

  const setAspect = (id: string) => {
    const r = aspectRatio(id, frame.width, frame.height);
    const base = crop ?? (leafValue(recipe, 'geometry.crop') as Rect);
    const next = cropForAspect(base, r, frame.width, frame.height);
    if (crop) setCrop(next);
    apply({ 'geometry.aspect': id === 'original' ? undefined : id, ...(crop ? {} : { 'geometry.crop': sameRect(next, [0, 0, 1, 1]) ? undefined : next }) });
  };
  const finishCrop = () => {
    if (!crop) return;
    apply({ 'geometry.crop': sameRect(crop, [0, 0, 1, 1]) ? undefined : crop });
    setCrop(null);
  };

  const auto = async () => {
    if (!engine) return;
    const h = await engine.histogram(geometryOf(recipe));
    undo.stopCapturing();
    apply(autoTone(h.luma));
    undo.stopCapturing();
  };

  const copy = () => {
    copied = unflattenRecipe(Object.entries(lookOf(recipe)));
    copiedListeners.forEach((l) => l());
    void navigator.clipboard?.writeText(JSON.stringify({ format: 'oel-img-recipe@1', ...copied })).catch(() => {});
    toast({ title: t.copied, description: t.copiedBody, tone: 'success' });
  };
  const paste = () => {
    if (copied) replaceLook(copied);
  };

  const exportFile = async (o: ExportOptions, ext: string) => {
    if (!engine) return;
    try {
      const blob = await engine.export(o);
      onExport(blob, `${title.replace(/\.[^.]+$/, '') || t.image}.${ext}`);
    } catch (e) {
      toast({ title: t.exportFailed, description: e instanceof Error ? e.message : String(e), tone: 'danger' });
    }
  };

  // Keys: undo / redo, before / after (« \\ » held), ← → in a gallery, Entrée / Échap while cropping.
  const keys = {
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      const mod = e.ctrlKey || e.metaKey;
      const typing = (e.target as HTMLElement).closest('input[type=text], textarea, [contenteditable]');
      const inSlider = (e.target as HTMLElement).closest('.emb-slider, [role=slider], [role=radio], [role=tab]');
      if (mod && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) undo.redo();
        else undo.undo();
      } else if (mod && e.key.toLowerCase() === 'y' && !typing) {
        e.preventDefault();
        e.stopPropagation();
        undo.redo();
      } else if (gallery && !crop && !mod && !inSlider && !typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        // ← → : previous / next picture of the gallery.
        const i = gallery.images.findIndex((x) => x.id === gallery.current);
        const next = gallery.images[(i + (e.key === 'ArrowRight' ? 1 : -1) + gallery.images.length) % gallery.images.length];
        if (next && next.id !== gallery.current) {
          e.preventDefault();
          setChosen([]);
          gallery.onCurrent(next.id);
        }
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
    },
    onKeyUp: (e: KeyboardEvent<HTMLDivElement>) => void (e.key === '\\' && setBefore(false)),
  };

  const stageEl = (
    <div className={`atelier__stage${gallery ? ' atelier__stage--gallery' : ''}`} ref={stage}>
      {missing ? (
        <p className="atelier__message">{missing}</p>
      ) : engineState.error ? (
        <p className="atelier__message">{t.openFailed} {engineState.error}</p>
      ) : (
        <div className="atelier__frame" style={css ? { width: css.width, height: css.height } : { visibility: 'hidden' }}>
          <div className="atelier__canvas-host" ref={host} />
          {crop && source && <CropOverlay rect={crop} ratio={aspect === 'libre' ? null : ratio} fw={frame.width} fh={frame.height} onChange={setCrop} />}
        </div>
      )}
      {!missing && !engineState.error && !source && <p className="atelier__message">{t.opening}</p>}
      {before && <span className="atelier__badge">{t.before}</span>}
      {crop && (
        <div className="atelier__cropbar chrome-pill">
          <Slider
            size="sm"
            label={t.straighten}
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
            {t.cancel}
          </Button>
          <Button variant="primary" size="sm" onPress={finishCrop}>
            {t.done}
          </Button>
        </div>
      )}
      {engine?.notice && <p className="atelier__notice">{engine.notice}</p>}
      {gallery && (
        <Filmstrip
          gallery={gallery}
          chosen={chosen}
          onPick={(id, add) => {
            if (add) {
              // Ctrl + clic : several pictures receive « Cette image » settings together.
              const base = chosen.length ? chosen : [gallery.current];
              const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
              setChosen(next.length ? next : [gallery.current]);
              if (next.length > 1) setScope('image');
            } else {
              setChosen([]);
              gallery.onCurrent(id);
            }
          }}
        />
      )}
    </div>
  );

  const controls = (
    <Tabs className="atelier__tabs" defaultSelectedKey="simple">
      <TabList aria-label={t.mode} className="atelier__tablist">
        <Tab id="simple">{t.simple}</Tab>
        <Tab id="avance">{t.advanced}</Tab>
      </TabList>
      {gallery && (
        <div className="atelier__scope">
          <Tabs selectedKey={scope} onSelectionChange={(k) => setScope(k as 'gallery' | 'image')}>
            <TabList aria-label={t.scope} className="atelier__tablist atelier__tablist--scope">
              <Tab id="gallery">{t.galleryStyle}</Tab>
              <Tab id="image">{chosen.length > 1 ? t.theseImages(chosen.length) : t.thisImage}</Tab>
            </TabList>
          </Tabs>
          <p className="atelier-hint">
            {toStyle
              ? t.toStyle(gallery.images.length)
              : chosen.length > 1
                ? t.ownMany(chosen.length)
                : t.ownOne}
          </p>
          {!toStyle && Object.keys(lookOf(own)).length > 0 && (
            <Button variant="ghost" size="sm" onPress={() => replaceLook({})}>
              {t.backToStyle}
            </Button>
          )}
        </div>
      )}
      <TabPanel id="simple" className="atelier__tabpanel">
        <Styles engine={engine} recipe={values} geometry={recipe} source={source} onHover={setHoverStyle} onPick={replaceLook} />
        <Button variant="secondary" size="sm" leadingIcon="magic-wand" className="atelier__auto" isDisabled={!engine} onPress={auto}>
          {t.auto}
        </Button>
        {SIMPLE_GROUPS.map((g) => (
          <Section key={g.id} title={g.label}>
            {g.controls.map((c) => (
              <SliderRow
                key={c.id}
                control={c}
                value={c.read(values)}
                reset={c.read(below)}
                onChange={(v) => apply(c.write(v === c.read(below) ? undefined : v))}
                onStart={startEdit}
                onEnd={endEdit}
              />
            ))}
          </Section>
        ))}
        <Section title={t.frame}>
          <div className="atelier__row">
            <Button variant="ghost" size="sm" leadingIcon="crop" isDisabled={!source} onPress={() => setCrop(leafValue(recipe, 'geometry.crop') as Rect)}>
              {t.crop}
            </Button>
            <Button variant="ghost" size="sm" leadingIcon="rotate-3d" onPress={() => apply(turnLeaves(recipe, 1))}>
              {t.rotate}
            </Button>
            <AspectMenu value={aspect} onChange={setAspect} />
          </div>
        </Section>
      </TabPanel>
      <TabPanel id="avance" className="atelier__tabpanel">
        {ADVANCED_PANELS.map((p) => (
          <Section key={p.id} title={p.label} defaultOpen={p.open} disabled={p.body.kind === 'soon' ? t.soon : undefined}>
            {p.body.kind === 'sliders' &&
              p.body.groups.map((g, i) => (
                <div key={i} className="atelier__group">
                  {g.label && <h4 className="atelier__group-label">{g.label}</h4>}
                  {g.sliders.map((c) => (
                    <LeafRow key={c.id} control={c} recipe={values} below={below} onChange={setLeaf} onStart={startEdit} onEnd={endEdit} />
                  ))}
                </div>
              ))}
            {p.body.kind === 'curve' && (
              <CurveEditor
                curves={Object.fromEntries(['rgb', 'r', 'g', 'b'].map((c) => [c, leafValue(values, `toneCurve.${c}`) as [number, number][]]))}
                onChange={(ch, pts) => apply({ [`toneCurve.${ch}`]: pts })}
                onStart={startEdit}
                onEnd={endEdit}
              />
            )}
            {p.body.kind === 'hsl' && <HslMixer recipe={values} below={below} onChange={setLeaf} onStart={startEdit} onEnd={endEdit} />}
            {p.body.kind === 'grading' && <Grading recipe={values} below={below} onChange={setLeaf} onStart={startEdit} onEnd={endEdit} />}
            {p.body.kind === 'geometry' && (
              <div className="atelier__group">
                <LeafRow control={leafSlider('geometry.angle', t.straighten, { signed: true, digits: 1, unit: '°' })} recipe={recipe} below={{}} onChange={setLeaf} onStart={startEdit} onEnd={endEdit} />
                <div className="atelier__row">
                  <Button variant="ghost" size="sm" onPress={() => apply(turnLeaves(recipe, -1))}>
                    {t.rotateLeft}
                  </Button>
                  <Button variant="ghost" size="sm" leadingIcon="rotate-3d" onPress={() => apply(turnLeaves(recipe, 1))}>
                    {t.rotateRight}
                  </Button>
                </div>
                <div className="atelier__row">
                  <Button variant="ghost" size="sm" onPress={() => apply(flipLeaves(recipe, 'h'))}>
                    {t.flipH}
                  </Button>
                  <Button variant="ghost" size="sm" onPress={() => apply(flipLeaves(recipe, 'v'))}>
                    {t.flipV}
                  </Button>
                </div>
                <div className="atelier__row">
                  <Button variant="ghost" size="sm" leadingIcon="crop" isDisabled={!source} onPress={() => setCrop(leafValue(recipe, 'geometry.crop') as Rect)}>
                    {t.crop}
                  </Button>
                  <AspectMenu value={aspect} onChange={setAspect} />
                </div>
                <p className="atelier-hint">{t.lensLater}</p>
              </div>
            )}
            {p.body.kind === 'soon' && <p className="atelier-hint">{p.body.text}</p>}
          </Section>
        ))}
      </TabPanel>
    </Tabs>
  );

  if (variant === 'panel') {
    // L3 · the same atelier docked inside an editor: small preview, then the tabs.
    return (
      <div className="atelier atelier--panel" {...keys}>
        <header className="atelier-panel__head">
          <h2 className="atelier-panel__title">{t.retouch}</h2>
          <Button variant="ghost" size="icon-sm" leadingIcon="undo" aria-label={t.undo} aria-keyshortcuts="Control+Z" isDisabled={!canUndo} onPress={() => undo.undo()} />
          <Button variant="ghost" size="icon-sm" leadingIcon="redo" aria-label={t.redo} aria-keyshortcuts="Control+Shift+Z" isDisabled={!canRedo} onPress={() => undo.redo()} />
          <Button variant="ghost" size="icon-sm" leadingIcon="eye" aria-label={t.beforeAfter} aria-pressed={before} aria-keyshortcuts="\" onPress={() => setBefore(!before)} />
          <Button variant="ghost" size="icon-sm" leadingIcon="close" aria-label={t.close} onPress={close} />
        </header>
        {stageEl}
        {controls}
        {note && <p className="atelier-hint">{note}</p>}
      </div>
    );
  }

  return (
    <div className="atelier" {...keys}>
      <header className="atelier__bar">
        <Button variant="ghost" size="sm" leadingIcon="chevron-left" onPress={onBureau}>
          {t.bureau}
        </Button>
        <h2 className="atelier__title">{gallery ? gallery.title : title}</h2>
        {gallery && <span className="atelier__chip">{t.gallery(gallery.images.length)}</span>}
        <span className="atelier__spacer" />
        <Button variant="ghost" size="icon-sm" leadingIcon="undo" aria-label={t.undo} aria-keyshortcuts="Control+Z" isDisabled={!canUndo} onPress={() => undo.undo()} />
        <Button variant="ghost" size="icon-sm" leadingIcon="redo" aria-label={t.redo} aria-keyshortcuts="Control+Shift+Z" isDisabled={!canRedo} onPress={() => undo.redo()} />
        <Button variant="ghost" size="sm" leadingIcon="eye" aria-pressed={before} aria-keyshortcuts="\" onPress={() => setBefore(!before)}>
          {t.beforeAfter}
        </Button>
        <Button variant="ghost" size="sm" leadingIcon="copy" onPress={copy}>
          {t.copySettings}
        </Button>
        {hasCopied && (
          <Button variant="ghost" size="sm" leadingIcon="paste" onPress={paste}>
            {t.pasteSettings}
          </Button>
        )}
        {source && engine && !gallery && <ExportPopover size={outputSize(recipe, source.width, source.height)} onExport={exportFile} />}
        {source && engine && gallery && (
          <ExportPopover size={outputSize(recipe, source.width, source.height)} label={t.exportAll(gallery.images.length)} sizeIsSample onExport={gallery.onExportAll} />
        )}
      </header>


      <div className="atelier__body">
        {stageEl}

        <aside className="atelier__panel" aria-label={t.settings}>
          <Histogram bins={bins} />
          {controls}
        </aside>
      </div>
    </div>
  );
}

const sameRect = (a: Rect, b: Rect) => a.every((v, i) => Math.abs(v - b[i]!) < 1e-4);

type RowProps = { recipe: Recipe; below: Recipe; onChange: (path: string, v: number | undefined) => void; onStart: () => void; onEnd: () => void };

/** A slider bound to one leaf; double-click goes back to the layer below (gallery style or default). */
function LeafRow({ control, recipe, below, onChange, onStart, onEnd }: RowProps & { control: SliderControl }) {
  return (
    <SliderRow
      control={control}
      value={Number(leafValue(recipe, control.id)) || 0}
      reset={Number(leafValue(below, control.id)) || 0}
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
      <Button variant="ghost" size="sm" trailingIcon="chevron-down" aria-label={t.formatOf(label)}>
        {t.format}
      </Button>
      <Popover placement="bottom start" showArrow={false}>
        <Menu aria-label={t.cropFormat} selectionMode="single" selectedKeys={[value]} onAction={(k) => onChange(String(k))}>
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

function HslMixer(row: RowProps) {
  return (
    <Tabs className="atelier__subtabs" defaultSelectedKey="hue">
      <TabList aria-label={t.mixer} className="atelier__tablist atelier__tablist--small">
        {HSL_ASPECTS.map((a) => (
          <Tab key={a.id} id={a.id}>
            {a.label}
          </Tab>
        ))}
      </TabList>
      {HSL_ASPECTS.map((a) => (
        <TabPanel key={a.id} id={a.id} className="atelier__group">
          {HSL_BANDS.map((b) => (
            <LeafRow key={b.id} control={leafSlider(`hsl.${b.id}.${a.id}`, b.label, { signed: true }, b.color)} {...row} />
          ))}
        </TabPanel>
      ))}
    </Tabs>
  );
}

function Grading(row: RowProps) {
  const { recipe } = row;
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
            <LeafRow control={leafSlider(`grading.${w.id}.hue`, t.hue, { unit: '°' }, 'hue')} {...row} />
            <LeafRow control={leafSlider(`grading.${w.id}.sat`, t.saturation, {})} {...row} />
            <LeafRow control={leafSlider(`grading.${w.id}.lum`, t.luminance)} {...row} />
          </div>
        );
      })}
      <div className="atelier__group">
        <LeafRow control={leafSlider('grading.blending', t.blending, {})} {...row} />
        <LeafRow control={leafSlider('grading.balance', t.balance)} {...row} />
      </div>
    </>
  );
}

/** Style thumbnails rendered on the image itself; hovering one previews it on the stage. */
function Styles({
  engine,
  recipe,
  geometry: shown,
  source,
  onHover,
  onPick,
}: {
  engine: ReturnType<typeof useImageEngine>['engine'];
  /** The look being edited (which style is current). */
  recipe: Recipe;
  /** The picture on the stage (its geometry frames the thumbnails). */
  geometry: Recipe;
  source: { width: number; height: number } | null;
  onHover: (r: Recipe | null) => void;
  onPick: (r: Recipe) => void;
}) {
  const geometry = JSON.stringify(geometryOf(shown));
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
    <div className="atelier__styles" role="radiogroup" aria-label={t.styles}>
      <h3 className="atelier__heading">{t.styles}</h3>
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

/** Figma L2: the gallery's pictures under the stage; the current one is ringed, an amber dot marks own settings. */
function Filmstrip({ gallery, chosen, onPick }: { gallery: AtelierGallery; chosen: string[]; onPick: (id: string, add: boolean) => void }) {
  return (
    <div className="atelier__filmstrip" role="listbox" aria-label={t.galleryImages} aria-multiselectable="true">
      {gallery.images.map((img) => {
        const current = img.id === gallery.current;
        const picked = current || chosen.includes(img.id);
        return (
          <button
            key={img.id}
            type="button"
            role="option"
            aria-selected={picked}
            aria-current={current || undefined}
            className={`atelier__film${current ? ' is-current' : ''}${picked ? ' is-picked' : ''}`}
            title={img.title}
            onClick={(e) => onPick(img.id, e.ctrlKey || e.metaKey)}
          >
            {img.thumbnail ? <img src={img.thumbnail} alt={img.title} /> : <span className="atelier__film-empty">{img.title}</span>}
            {Object.keys(lookOf(img.doc.recipe())).length > 0 && <span className="atelier__film-dot" aria-label={t.ownSettings} />}
          </button>
        );
      })}
      <p className="atelier-hint">{t.filmHint}</p>
    </div>
  );
}
