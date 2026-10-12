import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Badge, Button, DialogOverlay, NumberField, Radio, RadioGroup, Select, SelectItem, SheetDialog, TextField, toast } from '@oel/emboss';
import type { DocSession } from '../collab/session';
import { countWords } from '../model/ydoc';
import { EMU_PER_PX, type PageSetup } from '../model/types';
import { setBackground, setSectionPage } from './useDocEditor';
import { SPECIAL_CHARS } from './actions';
import { locale, tr } from '@oel/i18n';

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
        title={tr('Lien', 'Link')}
        width={460}
        actions={() => (
          <>
            {editor.isActive('link') && (
              <Button variant="ghost" onPress={() => (editor.chain().focus().extendMarkRange('link').unsetLink().run(), onClose())}>
                {tr('Supprimer le lien', 'Remove the link')}
              </Button>
            )}
            <Button variant="secondary" onPress={onClose}>{tr('Annuler', 'Cancel')}</Button>
            <Button onPress={apply} isDisabled={!href.trim()}>{tr('Appliquer', 'Apply')}</Button>
          </>
        )}
      >
        <form className="oel-form" onSubmit={(e) => (e.preventDefault(), apply())}>
          <TextField label={tr('Texte', 'Text')} value={text} onChange={setText} />
          <TextField label={tr('Lien (adresse Web, courriel ou #signet)', 'Link (web address, email or #bookmark)')} value={href} onChange={setHref} autoFocus placeholder="https://" />
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
  { id: 'letter', label: tr('Lettre (21,6 × 27,9 cm)', 'Letter (21.6 × 27.9 cm)'), w: 12240, h: 15840 },
  { id: 'legal', label: tr('Légal (21,6 × 35,6 cm)', 'Legal (21.6 × 35.6 cm)'), w: 12240, h: 20160 },
  { id: 'a4', label: tr('A4 (21 × 29,7 cm)', 'A4 (21 × 29.7 cm)'), w: 11906, h: 16838 },
  { id: 'a5', label: tr('A5 (14,8 × 21 cm)', 'A5 (14.8 × 21 cm)'), w: 8391, h: 11906 },
  { id: 'tabloid', label: tr('Tabloïd (27,9 × 43,2 cm)', 'Tabloid (27.9 × 43.2 cm)'), w: 15840, h: 24480 },
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
        title={tr('Configuration de la page', 'Page setup')}
        width={520}
        actions={() => (
          <>
            <Button variant="secondary" onPress={onClose}>{tr('Annuler', 'Cancel')}</Button>
            <Button onPress={apply}>OK</Button>
          </>
        )}
      >
        <div className="oel-form">
          {sectionCount > 1 && (
            <RadioGroup label={tr('Appliquer à', 'Apply to')} orientation="horizontal" value={scope} onChange={(v) => setScope(v as 'section' | 'all')}>
              <Radio value="section">Cette section (section {sectionIndex + 1})</Radio>
              <Radio value="all">{tr('Tout le document', 'Whole document')}</Radio>
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
            <Radio value="landscape">{tr('Paysage', 'Landscape')}</Radio>
          </RadioGroup>
          <Select
            label={tr('Format du papier', 'Paper size')}
            selectedKey={paper}
            onSelectionChange={(k) => {
              const p = PAPERS.find((x) => x.id === k);
              if (p) setDraft({ ...draft, width: landscape ? p.h : p.w, height: landscape ? p.w : p.h });
            }}
          >
            {[...PAPERS.map((p) => <SelectItem key={p.id} id={p.id}>{p.label}</SelectItem>), ...(paper === 'custom' ? [<SelectItem key="custom" id="custom">{tr('Personnalisé', 'Custom')}</SelectItem>] : [])]}
          </Select>
          <fieldset className="oel-form__grid">
            <legend>{tr('Marges (cm)', 'Margins (cm)')}</legend>
            {margin('top', tr('Haut', 'Top'))}
            {margin('bottom', tr('Bas', 'Bottom'))}
            {margin('left', tr('Gauche', 'Left'))}
            {margin('right', tr('Droite', 'Right'))}
          </fieldset>
          <div>
            <p className="emb-field__label">{tr('Couleur de la page', 'Page colour')}</p>
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
      <SheetDialog title={tr('Nombre de mots', 'Word count')} width={380} actions={() => <Button onPress={onClose}>OK</Button>}>
        {stats && (
          <table className="oel-stats">
            <tbody>
              {stats.selection && (
                <tr>
                  <td colSpan={2}>
                    <Badge tone="accent">{tr('Sélection', 'Selection')}</Badge>
                  </td>
                </tr>
              )}
              {!stats.selection && (
                <tr>
                  <th scope="row">Pages</th>
                  <td>{pages.toLocaleString(locale())}</td>
                </tr>
              )}
              <tr>
                <th scope="row">{tr('Mots', 'Words')}</th>
                <td>{stats.words.toLocaleString(locale())}</td>
              </tr>
              <tr>
                <th scope="row">{tr('Caractères', 'Characters')}</th>
                <td>{stats.chars.toLocaleString(locale())}</td>
              </tr>
              <tr>
                <th scope="row">{tr('Caractères sans espaces', 'Characters without spaces')}</th>
                <td>{stats.charsNoSpace.toLocaleString(locale())}</td>
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
      <SheetDialog title={tr('Caractères spéciaux', 'Special characters')} width={520} actions={() => <Button variant="secondary" onPress={onClose}>{tr('Fermer', 'Close')}</Button>}>
        <div className="oel-chars" role="group" aria-label={tr('Caractères', 'Characters')}>
          {SPECIAL_CHARS.map((c) => (
            <button key={c} type="button" className="oel-chars__key" onClick={() => editor.chain().focus().insertContent(c).run()} aria-label={tr(`Insérer ${c}`, `Insert ${c}`)}>
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
      toast({ title: tr('Image inaccessible', 'Image unreachable'), description: tr('Le site ne permet pas de récupérer cette image. Téléchargez-la puis importez-la.', 'The site doesn’t allow fetching this image. Download it, then import it.'), tone: 'warning' });
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
        title={selected ? tr('Options de l’image', 'Image options') : tr('Insérer une image', 'Insert an image')}
        width={460}
        actions={() =>
          selected ? (
            <>
              <Button variant="secondary" onPress={onClose}>{tr('Annuler', 'Cancel')}</Button>
              <Button
                onPress={() => {
                  const a = editor.getAttributes('image');
                  const ratio = (a.cy || 1) / (a.cx || 1);
                  const cx = width > 0 ? Math.round(width * EMU_PER_PX) : a.cx;
                  editor.chain().focus().updateAttributes('image', { alt, cx, cy: Math.round(cx * ratio) }).run();
                  onClose();
                }}
              >
                {tr('Appliquer', 'Apply')}
              </Button>
            </>
          ) : (
            <Button variant="secondary" onPress={onClose}>{tr('Annuler', 'Cancel')}</Button>
          )
        }
      >
        {selected ? (
          <div className="oel-form">
            <TextField label={tr('Texte de remplacement (accessibilité)', 'Alt text (accessibility)')} value={alt} onChange={setAlt} multiline rows={3} description={tr('Décrivez l’image pour les personnes qui ne la voient pas.', 'Describe the image for people who can’t see it.')} />
            <NumberField label="Largeur (px)" value={width} minValue={16} maxValue={2000} onChange={setWidth} />
          </div>
        ) : (
          <div className="oel-form">
            <Button leadingIcon="upload" onPress={pick}>{tr('Importer depuis l’ordinateur', 'Import from the computer')}</Button>
            <p className="emb-field__helper">{tr('Vous pouvez aussi coller une image ou la déposer dans le document.', 'You can also paste an image or drop it in the document.')}</p>
            <TextField label="Par adresse Web" value={url} onChange={setUrl} placeholder="https://…/image.png" />
            <Button variant="secondary" onPress={fromUrl} isDisabled={!url.trim()}>{tr('Insérer depuis l’adresse', 'Insert from the address')}</Button>
          </div>
        )}
      </SheetDialog>
    </DialogOverlay>
  );
}

// Identity and share dialogs are shared with the spreadsheet editor.
export { IdentityDialog, ShareDialog } from '@oel/collab-client';
