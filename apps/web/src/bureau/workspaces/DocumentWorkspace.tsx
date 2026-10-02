import { useEffect, useMemo, useRef, useState } from 'react';
import type { Preview } from '@oel/engine';
import { Select, SelectItem, Toolbar, ToolbarSeparator, ToolbarToggle, ToolButton } from '@oel/emboss';
import type { WorkspaceProps } from '../OpenSheet';
import { Inspector, InspectorRow } from './Inspector';

type DocPreview = Extract<Preview, { kind: 'document' }>;

const ENGINE_LATER = 'Arrive avec le moteur oeldocx-rs (WASM).';

/**
 * 01 · Feuille: the page is a raised sheet, the ribbon floats over it.
 *
 * Editing runs on contentEditable + execCommand for the UX flow. Each command
 * maps 1:1 onto oeldocx-rs's DocxController (set_bold, set_italic,
 * set_underline, set_alignment_*, toggle_bullet_list, apply_style…), which is
 * what replaces this layer once the WASM engine is wired into @oel/engine.
 */
export function DocumentWorkspace({ paper, onDraft }: WorkspaceProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [state, setState] = useState({ bold: false, italic: false, underline: false, block: 'p', align: 'left' });
  const [words, setWords] = useState(paper.data.preview.kind === 'document' ? (paper.data.preview.wordCount ?? 0) : 0);
  const preview = paper.data.preview as DocPreview;
  // Rendered once: after mount the DOM belongs to contentEditable, React must not re-diff it.
  const initialContent = useMemo(
    () =>
      preview.blocks.map((b, i) =>
        b.type === 'heading' ? <h1 key={i}>{b.text}</h1> : <p key={i}>{b.text || <br />}</p>,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Track formatting state at the caret so toggles latch like the kit's Ribbon.
  useEffect(() => {
    const onSel = () => {
      const sel = document.getSelection();
      const ed = editorRef.current;
      if (!sel || !ed || !sel.rangeCount || !ed.contains(sel.anchorNode)) return;
      savedRange.current = sel.getRangeAt(0).cloneRange();
      const block = String(document.queryCommandValue('formatBlock') || 'p').toLowerCase();
      setState({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        block: block.startsWith('h') ? block : 'p',
        align: document.queryCommandState('justifyCenter') ? 'center' : document.queryCommandState('justifyRight') ? 'right' : 'left',
      });
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  useEffect(() => {
    // Put the caret in the page so typing works straight away.
    const ed = editorRef.current;
    if (!ed) return;
    const t = setTimeout(() => ed.focus({ preventScroll: true }), 340);
    return () => clearTimeout(t);
  }, []);

  const exec = (cmd: string, value?: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.focus({ preventScroll: true });
    const sel = document.getSelection();
    if (savedRange.current && sel && !ed.contains(sel.anchorNode)) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    document.execCommand(cmd, false, value);
    sync();
    document.dispatchEvent(new Event('selectionchange'));
  };

  const sync = () => {
    const ed = editorRef.current;
    if (!ed) return;
    const blocks: DocPreview['blocks'] = [];
    for (const el of Array.from(ed.children) as HTMLElement[]) {
      const text = el.innerText.trim();
      blocks.push({ type: /^H[1-6]$/.test(el.tagName) ? 'heading' : 'paragraph', text });
    }
    const wc = ed.innerText.split(/\s+/).filter(Boolean).length;
    setWords(wc);
    onDraft({ kind: 'document', blocks, wordCount: wc, pageCount: Math.max(1, Math.ceil(wc / 450)) });
  };

  return (
    <div className="ws ws--document">
      {/* Keep the text selection when clicking tools with a mouse. */}
      <div className="ws__ribbon" onMouseDown={(e) => e.preventDefault()}>
        <Toolbar aria-label="Mise en forme du document">
          <ToolButton icon="undo" label="Annuler" shortcut={['Ctrl', 'Z']} onPress={() => exec('undo')} />
          <ToolButton icon="redo" label="Rétablir" shortcut={['Ctrl', 'Maj', 'Z']} onPress={() => exec('redo')} />
          <ToolbarSeparator />
          <div className="ws__style-select">
            <Select
              aria-label="Style de paragraphe"
              selectedKey={state.block === 'h1' || state.block === 'h2' ? state.block : 'p'}
              onSelectionChange={(k) => exec('formatBlock', String(k))}
            >
              <SelectItem id="h1">Titre</SelectItem>
              <SelectItem id="h2">Sous-titre</SelectItem>
              <SelectItem id="p">Paragraphe</SelectItem>
            </Select>
          </div>
          <ToolbarSeparator />
          <ToolbarToggle icon="bold" label="Gras" shortcut={['Ctrl', 'B']} description="Met le texte sélectionné en gras." isSelected={state.bold} onChange={() => exec('bold')} />
          <ToolbarToggle icon="italic" label="Italique" shortcut={['Ctrl', 'I']} isSelected={state.italic} onChange={() => exec('italic')} />
          <ToolbarToggle icon="underline" label="Souligné" shortcut={['Ctrl', 'U']} isSelected={state.underline} onChange={() => exec('underline')} />
          <ToolbarSeparator />
          <ToolbarToggle icon="align-left" label="Aligner à gauche" isSelected={state.align === 'left'} onChange={() => exec('justifyLeft')} />
          <ToolButton icon="list" label="Liste à puces" onPress={() => exec('insertUnorderedList')} />
          <ToolbarSeparator />
          <ToolButton icon="image" label="Insérer une image" unavailableReason={ENGINE_LATER} />
          <ToolButton icon="table" label="Insérer un tableau" unavailableReason={ENGINE_LATER} />
        </Toolbar>
      </div>

      <div className="ws__stage">
        <article className="ws-page" aria-label={`Page : ${paper.title}`}>
          {paper.data.eyebrow && <p className="paper__eyebrow" aria-hidden>{paper.data.eyebrow}</p>}
          <div
            ref={editorRef}
            className="ws-page__editor"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Texte du document"
            spellCheck
            lang="fr"
            onInput={sync}
          >
            {initialContent}
          </div>
        </article>
      </div>

      <Inspector title="Document">
        <InspectorRow label="Mots" value={words.toLocaleString('fr-CA')} />
        <InspectorRow label="Pages" value={String(Math.max(1, Math.ceil(words / 450)))} />
        <InspectorRow label="Format" value="Lettre · 8,5 × 11 po" />
        <InspectorRow label="Moteur" value={paper.data.fileName ? 'Aperçu JS' : 'Local'} />
      </Inspector>
    </div>
  );
}
