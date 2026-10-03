import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Badge, Button, DialogOverlay, NumberField, Radio, RadioGroup, Select, SelectItem, SheetDialog, TextField, toast } from '@oel/emboss';
import type { DocSession } from '../collab/session';
import { countWords } from '../model/ydoc';
import { EMU_PER_PX, type PageSetup } from '../model/types';
import { setBackground, setSectionPage } from './useDocEditor';
import { SPECIAL_CHARS } from './actions';

interface Controlled {
  isOpen: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Link
// ---------------------------------------------------------------------------

export function LinkDialog({ editor, isOpen, onClose }: Controlled & { editor: Editor }) {
  const [text, setText] = useState('');
  const [href, setHref] = useState('');
  const [hadText, setHadText] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    if (editor.isActive('link')) editor.chain().extendMarkRange('link').run();
    const { from, to } = editor.state.selection;
    const t = editor.state.doc.textBetween(from, to, ' ');
    setText(t);
    setHadText(!!t);
    setHref((editor.getAttributes('link').href as string | undefined) ?? '');
  }, [isOpen, editor]);
  const apply = () => {
    let url = href.trim();
    if (!url) return;
    if (!/^[a-z][a-z0-9+.-]*:|^#|^\//i.test(url)) url = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(url) ? `mailto:${url}` : `https://${url}`;
    const c = editor.chain().focus();
    if (!hadText || (text && text !== editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' '))) {
      c.insertContent({ type: 'text', text: text || url, marks: [{ type: 'link', attrs: { href: url } }] }).run();
    } else c.extendMarkRange('link').setLink({ href: url }).run();
    onClose();
  };
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetDialog
        title="Lien"
        width={460}
        actions={() => (
          <>
            {editor.isActive('link') && (
              <Button variant="ghost" onPress={() => (editor.chain().focus().extendMarkRange('link').unsetLink().run(), onClose())}>
                Supprimer le lien
              </Button>
            )}
            <Button variant="secondary" onPress={onClose}>Annuler</Button>
            <Button onPress={apply} isDisabled={!href.trim()}>Appliquer</Button>
          </>
        )}
      >
        <form className="oel-form" onSubmit={(e) => (e.preventDefault(), apply())}>
          <TextField label="Texte" value={text} onChange={setText} />
          <TextField label="Lien (adresse Web, courriel ou #signet)" value={href} onChange={setHref} autoFocus placeholder="https://" />
          <button type="submit" hidden />
        </form>
      </SheetDialog>
    </DialogOverlay>
  );
}

// ---------------------------------------------------------------------------
// Page setup
// ---------------------------------------------------------------------------

const PAPERS = [
  { id: 'letter', label: 'Lettre (21,6 × 27,9 cm)', w: 12240, h: 15840 },
  { id: 'legal', label: 'Légal (21,6 × 35,6 cm)', w: 12240, h: 20160 },
  { id: 'a4', label: 'A4 (21 × 29,7 cm)', w: 11906, h: 16838 },
  { id: 'a5', label: 'A5 (14,8 × 21 cm)', w: 8391, h: 11906 },
  { id: 'tabloid', label: 'Tabloïd (27,9 × 43,2 cm)', w: 15840, h: 24480 },
];
const PAGE_COLORS = ['#FFFFFF', '#FFF8E7', '#F3F3F3', '#FCE5CD', '#D9EAD3', '#CFE2F3', '#EAD1DC', '#FFF2CC'];
const twToCm = (tw: number) => Math.round((tw / 1440) * 2.54 * 100) / 100;
const cmToTw = (cm: number) => Math.round((cm / 2.54) * 1440);

export function PageSetupDialog({
  session,
  page,
  background,
  sectionId,
  sectionIndex,
  sectionCount,
  isOpen,
  onClose,
}: Controlled & { session: DocSession; page: PageSetup; background: string | null; sectionId: string; sectionIndex: number; sectionCount: number }) {
  const [draft, setDraft] = useState(page);
  const [bg, setBg] = useState(background);
  const [scope, setScope] = useState<'section' | 'all'>('section');
  useEffect(() => {
    if (!isOpen) return;
    setDraft(page);
    setBg(background);
    setScope('section');
  }, [isOpen, page, background]);
  const apply = () => {
    setSectionPage(session, sectionCount > 1 && scope === 'section' ? sectionId : 'all', draft);
    if (bg !== background) setBackground(session, bg);
    onClose();
  };
  const landscape = draft.width > draft.height;
  const paper = PAPERS.find((p) => (p.w === draft.width && p.h === draft.height) || (p.h === draft.width && p.w === draft.height))?.id ?? 'custom';
  const margin = (k: 'top' | 'bottom' | 'left' | 'right', label: string) => (
    <NumberField label={label} value={twToCm(draft[k])} minValue={0} maxValue={10} step={0.1} formatOptions={{ maximumFractionDigits: 2 }} onChange={(v) => setDraft({ ...draft, [k]: cmToTw(v || 0) })} />
  );
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetDialog
        title="Configuration de la page"
        width={520}
        actions={() => (
          <>
            <Button variant="secondary" onPress={onClose}>Annuler</Button>
            <Button onPress={apply}>OK</Button>
          </>
        )}
      >
        <div className="oel-form">
          {sectionCount > 1 && (
            <RadioGroup label="Appliquer à" orientation="horizontal" value={scope} onChange={(v) => setScope(v as 'section' | 'all')}>
              <Radio value="section">Cette section (section {sectionIndex + 1})</Radio>
              <Radio value="all">Tout le document</Radio>
            </RadioGroup>
          )}
          <RadioGroup
            label="Orientation"
            orientation="horizontal"
            value={landscape ? 'landscape' : 'portrait'}
            onChange={(v) => {
              const wantLandscape = v === 'landscape';
              if (wantLandscape !== landscape) setDraft({ ...draft, width: draft.height, height: draft.width, orient: wantLandscape ? 'landscape' : 'portrait' });
            }}
          >
            <Radio value="portrait">Portrait</Radio>
            <Radio value="landscape">Paysage</Radio>
          </RadioGroup>
          <Select
            label="Format du papier"
            selectedKey={paper}
            onSelectionChange={(k) => {
              const p = PAPERS.find((x) => x.id === k);
              if (p) setDraft({ ...draft, width: landscape ? p.h : p.w, height: landscape ? p.w : p.h });
            }}
          >
            {[...PAPERS.map((p) => <SelectItem key={p.id} id={p.id}>{p.label}</SelectItem>), ...(paper === 'custom' ? [<SelectItem key="custom" id="custom">Personnalisé</SelectItem>] : [])]}
          </Select>
          <fieldset className="oel-form__grid">
            <legend>Marges (cm)</legend>
            {margin('top', 'Haut')}
            {margin('bottom', 'Bas')}
            {margin('left', 'Gauche')}
            {margin('right', 'Droite')}
          </fieldset>
          <div>
            <p className="emb-field__label">Couleur de la page</p>
            <div className="oel-swatches__grid">
              {PAGE_COLORS.map((c) => (
                <button key={c} type="button" className={`oel-swatch${(bg ?? '#FFFFFF').toUpperCase() === c ? ' is-on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => setBg(c === '#FFFFFF' ? null : c)} />
              ))}
            </div>
          </div>
        </div>
      </SheetDialog>
    </DialogOverlay>
  );
}

// ---------------------------------------------------------------------------
// Word count
// ---------------------------------------------------------------------------

export function WordCountDialog({ editor, pages, isOpen, onClose }: Controlled & { editor: Editor; pages: number }) {
  const stats = useMemo(() => {
    if (!isOpen) return null;
    const { from, to, empty } = editor.state.selection;
    const text = empty ? editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', ' ') : editor.state.doc.textBetween(from, to, '\n', ' ');
    return { selection: !empty, words: countWords(text), chars: text.replace(/\n/g, '').length, charsNoSpace: text.replace(/\s/g, '').length };
  }, [isOpen, editor]);
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetDialog title="Nombre de mots" width={380} actions={() => <Button onPress={onClose}>OK</Button>}>
        {stats && (
          <table className="oel-stats">
            <tbody>
              {stats.selection && (
                <tr>
                  <td colSpan={2}>
                    <Badge tone="accent">Sélection</Badge>
                  </td>
                </tr>
              )}
              {!stats.selection && (
                <tr>
                  <th scope="row">Pages</th>
                  <td>{pages.toLocaleString('fr-CA')}</td>
                </tr>
              )}
              <tr>
                <th scope="row">Mots</th>
                <td>{stats.words.toLocaleString('fr-CA')}</td>
              </tr>
              <tr>
                <th scope="row">Caractères</th>
                <td>{stats.chars.toLocaleString('fr-CA')}</td>
              </tr>
              <tr>
                <th scope="row">Caractères sans espaces</th>
                <td>{stats.charsNoSpace.toLocaleString('fr-CA')}</td>
              </tr>
            </tbody>
          </table>
        )}
      </SheetDialog>
    </DialogOverlay>
  );
}

// ---------------------------------------------------------------------------
// Special characters
// ---------------------------------------------------------------------------

export function SpecialCharsDialog({ editor, isOpen, onClose }: Controlled & { editor: Editor }) {
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetDialog title="Caractères spéciaux" width={520} actions={() => <Button variant="secondary" onPress={onClose}>Fermer</Button>}>
        <div className="oel-chars" role="group" aria-label="Caractères">
          {SPECIAL_CHARS.map((c) => (
            <button key={c} type="button" className="oel-chars__key" onClick={() => editor.chain().focus().insertContent(c).run()} aria-label={`Insérer ${c}`}>
              {c}
            </button>
          ))}
        </div>
      </SheetDialog>
    </DialogOverlay>
  );
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

export function ImageDialog({ editor, isOpen, onClose, onFile }: Controlled & { editor: Editor; onFile: (f: Blob) => void }) {
  const selected = editor.isActive('image');
  const [alt, setAlt] = useState('');
  const [width, setWidth] = useState(0);
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!isOpen) return;
    const a = editor.getAttributes('image');
    setAlt((a.alt as string) ?? '');
    setWidth(a.cx ? Math.round(a.cx / EMU_PER_PX) : 0);
    setUrl('');
  }, [isOpen, editor]);
  const fromUrl = async () => {
    try {
      const r = await fetch(url.trim());
      const blob = await r.blob();
      if (!blob.type.startsWith('image/')) throw new Error();
      onFile(blob);
      onClose();
    } catch {
      toast({ title: 'Image inaccessible', description: 'Le site ne permet pas de récupérer cette image. Téléchargez-la puis importez-la.', tone: 'warning' });
    }
  };
  const pick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/bmp';
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) onFile(f);
      onClose();
    };
    input.click();
  };
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetDialog
        title={selected ? 'Options de l’image' : 'Insérer une image'}
        width={460}
        actions={() =>
          selected ? (
            <>
              <Button variant="secondary" onPress={onClose}>Annuler</Button>
              <Button
                onPress={() => {
                  const a = editor.getAttributes('image');
                  const ratio = (a.cy || 1) / (a.cx || 1);
                  const cx = width > 0 ? Math.round(width * EMU_PER_PX) : a.cx;
                  editor.chain().focus().updateAttributes('image', { alt, cx, cy: Math.round(cx * ratio) }).run();
                  onClose();
                }}
              >
                Appliquer
              </Button>
            </>
          ) : (
            <Button variant="secondary" onPress={onClose}>Annuler</Button>
          )
        }
      >
        {selected ? (
          <div className="oel-form">
            <TextField label="Texte de remplacement (accessibilité)" value={alt} onChange={setAlt} multiline rows={3} description="Décrivez l’image pour les personnes qui ne la voient pas." />
            <NumberField label="Largeur (px)" value={width} minValue={16} maxValue={2000} onChange={setWidth} />
          </div>
        ) : (
          <div className="oel-form">
            <Button leadingIcon="upload" onPress={pick}>Importer depuis l’ordinateur</Button>
            <p className="emb-field__helper">Vous pouvez aussi coller une image ou la déposer dans le document.</p>
            <TextField label="Par adresse Web" value={url} onChange={setUrl} placeholder="https://…/image.png" />
            <Button variant="secondary" onPress={fromUrl} isDisabled={!url.trim()}>Insérer depuis l’adresse</Button>
          </div>
        )}
      </SheetDialog>
    </DialogOverlay>
  );
}

// Identity and share dialogs are shared with the spreadsheet editor.
export { IdentityDialog, ShareDialog } from '@oel/collab-client';
