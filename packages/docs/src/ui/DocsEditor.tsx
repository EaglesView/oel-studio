import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { NodeSelection, type Selection, type Transaction } from '@tiptap/pm/state';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { linkedTableStyleChanges, tableAsLinked } from '../extensions/linkedTables';
import { linkClip, linkHost, linksOf, newLinkId, pictureBytes, pictureValue, revOf, setLinkClip, type LinkClip } from '@oel/links';
import { MenuTrigger } from 'react-aria-components';
import { Badge, Button, Icon, Kbd, Menu, MenuItem, MenuPopover, toast, useToolbarDock } from '@oel/emboss';
import type { DocSession } from '../collab/session';
import type { Identity } from '../collab/identity';
import { previewFromYDoc, type DocumentPreview } from '../model/preview';
import { meta } from '../model/ydoc';
import { EMU_PER_PX, type HeaderFooterKind } from '../model/types';
import { pageKind, type PageInfo } from '../model/sections';
import { sanitizeStylesheet } from '../model/format';
import { useDocEditor, useDocMeta } from './useDocEditor';
import { fontNoticeOnFirstOpen } from './fonts';
import type { FontReport } from '@oel/fonts';
import { DocsToolbar, ROLE_LABELS, ZOOMS, useToolbarState } from './DocsToolbar';
import { ChartFloat, LinkedEditNotice, PictureFloat, TableFloat } from './Floats';
import { RetouchPanel } from './RetouchPanel';
import { ContextMenu, MenuBar, MoreMenu, type MenuEntry, type MenuSpec } from './MenuBar';
import { NotesArea, PageView, usePages, type EditingStory } from './PageView';
import { printPages } from './print';
import { FindBar } from './FindBar';
import { Peers, SyncStatus, useSessionStatus } from './SyncStatus';
import { OutlinePanel, VersionPanel } from './panels';
import { IdentityDialog, ImageDialog, LinkDialog, PageSetupDialog, ShareDialog, SpecialCharsDialog, WordCountDialog } from './dialogs';
import { FontsDialog } from '@oel/collab-client';
import {
  download,
  downloadHTML,
  downloadMarkdown,
  downloadText,
  ensureStory,
  insertFootnote,
  insertSectionBreak,
  sectionIndexAt,
  insertImageFile,
  insertOrUpdateToc,
  insertPageNumbers,
  printDocument,
  safeFileName,
} from './actions';

export type ExportInput = Awaited<ReturnType<DocSession['exportInput']>>;

export interface DocsEditorProps {
  session: DocSession;
  /** Title shown and edited in the title bar (also stored in the shared document). */
  title: string;
  onTitleChange?: (title: string) => void;
  /** Light preview for desk thumbnails, debounced. */
  onPreview?: (preview: DocumentPreview) => void;
  /** Write a .docx with the codec (usually the engine worker). Falls back to the server. */
  exportDocx?: (input: ExportInput) => Promise<Uint8Array>;
  onOpenFile?: (file: File) => void;
  onNewDocument?: () => void;
  /** Origin used in share links (`https://outilsenligne.ca`). */
  shareOrigin?: string;
  identity: Identity;
  onIdentityChange?: (identity: Identity) => void;
  /**
   * Where the editor lives (Editor — Behaviors, A1):
   * - `sheet`: level 2, « ouvert sur place » — compact ribbon, menus folded into « Plus »;
   * - `full`: level 3, « plein écran » — breadcrumb, menus, outline, status bar, « Réduire »;
   * - `standalone`: the /document page — like `full`, without « Réduire ».
   */
  variant?: 'sheet' | 'full' | 'standalone';
  /** « ‹ Bureau »: straight back to the desk, from any level. */
  onBureau?: () => void;
  /** Level 3 → 2 (« Réduire », Échap, Ctrl+Maj+Entrée). */
  onReduce?: () => void;
  /** Level 2 → 3 (« Agrandir », Ctrl+Maj+Entrée). */
  onExpand?: () => void;
  /** The image worker (`@oel/img`): « Retoucher » on pictures (L3). Without it, retouching is unavailable. */
  createImageWorker?: () => Worker;
}

type DialogName = 'link' | 'page' | 'words' | 'chars' | 'image' | 'share' | 'identity' | null;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const LANGS: Record<string, string> = {
  'fr-CA': 'Français (Canada)',
  'fr-FR': 'Français (France)',
  fr: 'Français',
  'en-US': 'Anglais (États-Unis)',
  'en-CA': 'Anglais (Canada)',
  'en-GB': 'Anglais (Royaume-Uni)',
  en: 'Anglais',
  es: 'Espagnol',
};

/** Caret and scroll position per document, restored on reopen (C1 · « Le curseur où on l’avait laissé »). */
const POS_KEY = (docId: string) => `oel-docpos:${docId}`;

export function DocsEditor(props: DocsEditorProps) {
  const { session, identity } = props;
  const variant = props.variant ?? 'standalone';
  const sheet = variant === 'sheet';
  const status = useSessionStatus(session);
  const docMeta = useDocMeta(session);
  const [fontReport, setFontReport] = useState<FontReport | null>(null);
  const [fontsOpen, setFontsOpen] = useState(false);
  // TODO(ux): once this toast is dismissed (or times out) the fonts dialog cannot be reached again;
  // decide where it lives (the font menu, the document info, the toast history…).
  useEffect(
    () =>
      fontNoticeOnFirstOpen(session.status.docId, docMeta.fonts, session.mediaUrl, (n, report) => {
        setFontReport(report);
        toast({ ...n, tone: 'warning', action: { label: 'Voir plus', onAction: () => setFontsOpen(true) } });
      }),
    [session, docMeta.fonts],
  );
  const [mode, setMode] = useState<'edit' | 'view'>('edit');
  const [paginated, setPaginated] = useState(true);
  const [zoom, setZoom] = useState(1);
  // Plan du document: open by default in full screen on wide windows (B1 · 4).
  const [showOutline, setShowOutline] = useState(() => !sheet && typeof innerWidth === 'number' && innerWidth >= 1440);
  const [focusMode, setFocusMode] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [showMarks, setShowMarks] = useState(false);
  const [tableGrid, setTableGrid] = useState(true);
  const [showAnchors, setShowAnchors] = useState(false);
  const [find, setFind] = useState<{ replace: boolean } | null>(null);
  const [dialog, setDialog] = useState<DialogName>(null);
  /** L3 · the retouch panel on a picture (`crop`: open on the crop frame). */
  const [retouch, setRetouch] = useState<{ editor: Editor; pos: number; crop: boolean } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; editor: Editor } | null>(null);
  const [editingStory, setEditingStory] = useState<EditingStory | null>(null);
  const [french, setFrench] = useState(true);
  const editable = !status.readOnly && mode === 'edit';
  const editor = useDocEditor(session, docMeta, { editable, pagination: paginated });
  const [active, setActive] = useState<Editor | null>(null);
  const target = active && !active.isDestroyed ? active : editor;
  const toolbar = useToolbarState(target, docMeta.styles, docMeta.defaults);
  const painter = useEditorState({ editor, selector: ({ editor: e }) => !!e?.storage.docEditing.painter }) ?? false;
  const sheets = usePages(editor);
  const pages = Math.max(1, sheets.length);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Put the caret and the scroll back where they were, and focus the page: typing writes at once.
  useEffect(() => {
    if (!editor) return;
    const key = POS_KEY(session.status.docId);
    let saved: { pos: number; scroll: number } | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
      /* ignore */
    }
    const t = setTimeout(() => {
      if (editor.isDestroyed) return;
      const size = editor.state.doc.content.size;
      if (saved && saved.pos > 0 && saved.pos < size) editor.commands.setTextSelection(saved.pos);
      editor.commands.focus(undefined, { scrollIntoView: false });
      if (saved && canvasRef.current) canvasRef.current.scrollTop = saved.scroll;
    }, 380);
    let save: ReturnType<typeof setTimeout> | null = null;
    const remember = () => {
      if (save) clearTimeout(save);
      save = setTimeout(() => {
        try {
          localStorage.setItem(key, JSON.stringify({ pos: editor.state.selection.from, scroll: canvasRef.current?.scrollTop ?? 0 }));
        } catch {
          /* ignore */
        }
      }, 400);
    };
    editor.on('selectionUpdate', remember);
    const canvas = canvasRef.current;
    canvas?.addEventListener('scroll', remember, { passive: true });
    return () => {
      clearTimeout(t);
      if (save) clearTimeout(save);
      editor.off('selectionUpdate', remember);
      canvas?.removeEventListener('scroll', remember);
    };
  }, [editor, session]);

  /** Focus mode: tools come back while the pointer moves or Alt is held. */
  const reveal = () => {
    if (!focusMode) return;
    setRevealed(true);
    if (revealTimer.current) clearTimeout(revealTimer.current);
    revealTimer.current = setTimeout(() => setRevealed(false), 1800);
  };

  const title = (docMeta.title ?? props.title) || 'Document sans titre';
  const [titleDraft, setTitleDraft] = useState(title);
  useEffect(() => setTitleDraft(title), [title]);
  const commitTitle = () => {
    const t = titleDraft.trim() || 'Document sans titre';
    if (t !== title && !status.readOnly) {
      meta(session.ydoc).set('title', t);
      props.onTitleChange?.(t);
    }
  };

  // Geometry of the section at the selection (image widths, page setup, printing).
  const sectionInfo = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      const { sections, frame } = e.storage.pagination.layout;
      const index = sectionIndexAt(e, e.state.selection.from);
      return { index, count: sections.length, id: sections[index]?.id ?? 'body', textWidth: frame.boxes[index]?.textWidth ?? 624, frameWidth: frame.width };
    },
    equalityFn: (a, b) => !!a && !!b && a.index === b.index && a.count === b.count && a.id === b.id && a.textWidth === b.textWidth && a.frameWidth === b.frameWidth,
  });
  const contentWidth = sectionInfo?.textWidth ?? 624;
  const currentSection = (sectionInfo && docMeta.sections.get(sectionInfo.id)) ?? null;
  const firstSheet = sheets[0];
  const pageForPrint = firstSheet
    ? { width: firstSheet.width, margins: [firstSheet.margins.top, firstSheet.margins.right, firstSheet.margins.bottom, firstSheet.margins.left] as [number, number, number, number] }
    : { width: 816, margins: [96, 96, 96, 96] as [number, number, number, number] };

  // Fit the page to narrow screens.
  const frameWidth = sectionInfo?.frameWidth ?? 816;
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const fit = () => {
      const avail = el.clientWidth - 32;
      if (avail < frameWidth && zoom === 1) setZoom(Math.max(0.5, Math.floor((avail / frameWidth) * 20) / 20));
    };
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameWidth]);

  useEffect(() => {
    if (editor) editor.storage.docEditing.frenchTypography = french;
  }, [editor, french]);

  // Desk thumbnail (debounced).
  useEffect(() => {
    if (!editor || !props.onPreview) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => props.onPreview?.(previewFromYDoc(session.ydoc, editor.storage.pagination.pages.length)), 700);
    };
    editor.on('update', fire);
    fire();
    return () => {
      editor.off('update', fire);
      if (t) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const addImage = useCallback(
    (file: Blob, at?: number) => {
      if (!editor) return;
      insertImageFile(editor, session, file, contentWidth, at).catch(() => toast({ title: 'Image non insérée', tone: 'danger' }));
    },
    [editor, session, contentWidth],
  );

  // Style changes on linked tables become the copy's local edits (Figma I6 §1).
  useEffect(() => {
    if (!editor) return;
    const onTx = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.docChanged || transaction.getMeta(ySyncPluginKey)) return;
      for (const ch of linkedTableStyleChanges(transaction.before, editor.state.doc)) linkHost().recordTableEdit(ch.linkId, ch);
    };
    editor.on('transaction', onTx);
    return () => void editor.off('transaction', onTx);
  }, [editor]);

  // Paste and drop images.
  useEffect(() => {
    if (!editor) return;
    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
          if (!editor.isEditable) return false;
          // An outside picture is inserted as before.
          if (files.length) {
            files.forEach((f) => addImage(f));
            return true;
          }
          // A picture copied in another desk file pastes linked (Figma I1 d, I6 §5) —
          // unless the clipboard now holds text copied since.
          const clip = linkClip(session.status.docId);
          const html = event.clipboardData?.getData('text/html') ?? '';
          const text = event.clipboardData?.getData('text/plain') ?? '';
          // One cell copied in a desk workbook: a linked value in the text (Figma I4).
          if (clip?.value.kind === 'value') {
            if (text.trim() !== clip.value.text.trim()) return false;
            pasteLinkedValue(editor, session, clip);
            return true;
          }
          if (!clip || (text.trim() && !html.includes('<img'))) return false;
          void pasteLinkedPicture(editor, session, clip, contentWidth);
          return true;
        },
        handleDOMEvents: {
          ...editor.options.editorProps.handleDOMEvents,
          copy: (view) => {
            rememberPictureCopy(view.state.selection, editor, session);
            return false;
          },
          cut: (view) => {
            rememberPictureCopy(view.state.selection, editor, session);
            return false;
          },
        },
        handleDrop: (view, event) => {
          const files = Array.from((event as DragEvent).dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
          if (!files.length || !editor.isEditable) return false;
          const pos = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })?.pos;
          files.forEach((f) => addImage(f, pos));
          return true;
        },
      },
    });
  }, [editor, addImage]);

  /** Sheet index (0-based) holding document position `pos`. */
  const sheetAt = useCallback(
    (pos: number): number | null => {
      if (!editor || !paginated) return null;
      try {
        const list = editor.storage.pagination.pages;
        const root = editor.view.dom.getBoundingClientRect();
        const scale = root.width / (editor.view.dom.offsetWidth || 1) || 1;
        const y = (editor.view.coordsAtPos(pos + 1).top - root.top) / scale + (list[0]?.margins.top ?? 0);
        let k = 0;
        while (k + 1 < list.length && list[k + 1]!.top <= y) k++;
        return k;
      } catch {
        return null;
      }
    },
    [editor, paginated],
  );
  /** Page number as printed on the sheet (roman numerals, restarts…), for the table of contents. */
  const pageOf = useCallback(
    (pos: number): string | null => {
      const k = sheetAt(pos);
      return k == null ? null : (editor?.storage.pagination.pages[k]?.label ?? String(k + 1));
    },
    [editor, sheetAt],
  );

  const exportDocx = async () => {
    try {
      const input = await session.exportInput();
      let bytes: Uint8Array;
      if (props.exportDocx) bytes = await props.exportDocx(input);
      else if (session.api && status.token && status.connection !== 'local') {
        const r = await fetch(`${session.api.baseUrl}/docs/${status.docId}/export.docx`, { headers: { Authorization: `Bearer ${status.token}` } });
        if (!r.ok) throw new Error();
        bytes = new Uint8Array(await r.arrayBuffer());
      } else throw new Error('Aucun moteur d’export disponible');
      download(`${safeFileName(title)}.docx`, bytes as Uint8Array<ArrayBuffer>, DOCX_MIME);
    } catch (e) {
      toast({ title: 'Export impossible', description: (e as Error).message || 'Le fichier .docx n’a pas pu être créé.', tone: 'danger' });
    }
  };

  const openFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    input.onchange = () => input.files?.[0] && props.onOpenFile?.(input.files[0]);
    input.click();
  };

  const openStory = (side: 'header' | 'footer') => {
    if (!editor) return;
    const { sections } = editor.storage.pagination.layout;
    const index = sectionIndexAt(editor, editor.state.selection.from);
    const kind: HeaderFooterKind = 'default';
    const storyId = ensureStory(editor, session, sections, index, side, kind);
    if (!paginated) setPaginated(true);
    // Open it on the section's first sheet that shows the default slot.
    const list = editor.storage.pagination.pages;
    const section = sections[index]!;
    const at = list.findIndex((p: PageInfo) => p.section === index && pageKind(p.indexInSection, p.number, section, docMeta.settings) === kind);
    setEditingStory({ side, kind, page: Math.max(0, at >= 0 ? at : list.findIndex((p: PageInfo) => p.section === index)), section: index, storyId });
  };

  const act = (id: string) => {
    if (!editor) return;
    const e = target ?? editor;
    const chain = () => e.chain().focus();
    if (id.startsWith('zoom:')) return setZoom(Number(id.slice(5)));
    if (id.startsWith('role:')) return void chain().setParagraphRole(id.slice(5)).run();
    if (id.startsWith('line:')) return void chain().setLineSpacing(Number(id.slice(5))).run();
    switch (id) {
      case 'new': return props.onNewDocument?.();
      case 'open': return openFile();
      case 'share': return setDialog('share');
      case 'history': return setShowVersions(true);
      case 'name-version':
        return void session.createVersion(window.prompt('Nom de la version :', '')?.trim() || null).then(
          () => toast({ title: 'Version enregistrée', tone: 'success' }),
          (err: Error) => toast({ title: 'Impossible d’enregistrer la version', description: err.message, tone: 'warning' }),
        );
      case 'dl-docx': return void exportDocx();
      case 'dl-pdf':
      case 'print': return void (printPages(editor, title) || printDocument(editor, title, docMeta.stylesCss, pageForPrint));
      case 'dl-html': return downloadHTML(editor, title, docMeta.stylesCss, pageForPrint);
      case 'dl-md': return downloadMarkdown(editor, title);
      case 'dl-txt': return downloadText(editor, title);
      case 'page-setup': return setDialog('page');
      case 'undo': return void chain().undo().run();
      case 'redo': return void chain().redo().run();
      case 'cut': e.view.focus(); return void document.execCommand('cut');
      case 'copy': e.view.focus(); return void document.execCommand('copy');
      case 'paste':
      case 'paste-plain':
        return void pasteFromClipboard(e, id === 'paste-plain').catch(() =>
          toast({ title: 'Collez avec le clavier', description: id === 'paste' ? 'Ctrl+V colle avec la mise en forme.' : 'Ctrl+Maj+V colle sans mise en forme.', tone: 'info' }),
        );
      case 'select-all': return void chain().selectAll().run();
      case 'delete': return void chain().deleteSelection().run();
      case 'find': return setFind({ replace: false });
      case 'replace': return setFind({ replace: true });
      case 'mode-edit': return setMode('edit');
      case 'mode-view': return setMode('view');
      case 'paginated': return setPaginated((v) => !v);
      case 'outline': return setShowOutline((v) => !v);
      case 'marks': return setShowMarks((v) => !v);
      case 'table-grid': return setTableGrid((v) => !v);
      case 'anchors': return setShowAnchors((v) => !v);
      case 'fullscreen': return sheet ? props.onExpand?.() : props.onReduce?.();
      case 'focus': return setFocusMode((v) => !v);
      case 'ins-image': return setDialog('image');
      case 'ins-table': return void chain().insertTable({ rows: 3, cols: 3, withHeaderRow: false }).run();
      case 'ins-link': return setDialog('link');
      case 'ins-hr': return void chain().insertHorizontalLine().run();
      case 'ins-pagebreak': return void chain().insertPageBreak().run();
      case 'ins-section-next': return void (insertSectionBreak(editor, session, 'nextPage') || toast({ title: 'Placez le curseur dans un paragraphe du corps du texte.', tone: 'warning' }));
      case 'ins-section-cont': return void (insertSectionBreak(editor, session, 'continuous') || toast({ title: 'Placez le curseur dans un paragraphe du corps du texte.', tone: 'warning' }));
      case 'ins-footnote': return void insertFootnote(editor, session, 'footnote');
      case 'ins-endnote': return void insertFootnote(editor, session, 'endnote');
      case 'ins-chars': return setDialog('chars');
      case 'ins-date': return void chain().insertContent(new Date().toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' })).run();
      case 'ins-toc': return insertOrUpdateToc(editor, pageOf);
      case 'ins-header': return openStory('header');
      case 'ins-footer': return openStory('footer');
      case 'ins-pagenum': insertPageNumbers(editor, session); return setPaginated(true);
      case 'bold': return void chain().toggleBold().run();
      case 'italic': return void chain().toggleItalic().run();
      case 'underline': return void chain().toggleUnderline().run();
      case 'strike': return void chain().toggleStrike().run();
      case 'sup': return void chain().toggleSuperscript().run();
      case 'sub': return void chain().toggleSubscript().run();
      case 'upper':
      case 'lower':
      case 'capital': {
        const { from, to, empty } = e.state.selection;
        if (empty) return;
        const tr = e.state.tr;
        e.state.doc.nodesBetween(from, to, (node, pos) => {
          if (!node.isText) return;
          const s = Math.max(from, pos);
          const t = Math.min(to, pos + node.nodeSize);
          const text = node.text!.slice(s - pos, t - pos);
          const next = id === 'upper' ? text.toLocaleUpperCase('fr') : id === 'lower' ? text.toLocaleLowerCase('fr') : text.toLocaleLowerCase('fr').replace(/(^|[\s'’-])(\p{L})/gu, (_, a: string, b: string) => a + b.toLocaleUpperCase('fr'));
          tr.insertText(next, tr.mapping.map(s), tr.mapping.map(t));
        });
        return e.view.dispatch(tr);
      }
      case 'align-left': return void chain().setAlign('left').run();
      case 'align-center': return void chain().setAlign('center').run();
      case 'align-right': return void chain().setAlign('right').run();
      case 'align-justify': return void chain().setAlign('justify').run();
      case 'indent-more': return void chain().changeIndent(720).run();
      case 'indent-less': return void chain().changeIndent(-720).run();
      case 'space-before': return void chain().setParagraphSpacing(240, null).run();
      case 'space-after': return void chain().setParagraphSpacing(null, 240).run();
      case 'list-bullet': return void chain().toggleList('bullet').run();
      case 'list-numbered': return void chain().toggleList('numbered').run();
      case 'list-check': return void chain().toggleList('check').run();
      case 'clear': return void chain().clearFormatting().run();
      case 'tbl-row-before': return void chain().addRowBefore().run();
      case 'tbl-row-after': return void chain().addRowAfter().run();
      case 'tbl-col-before': return void chain().addColumnBefore().run();
      case 'tbl-col-after': return void chain().addColumnAfter().run();
      case 'tbl-merge': return void chain().mergeOrSplit().run();
      case 'tbl-header': return void chain().toggleHeaderRow().run();
      case 'tbl-del-row': return void chain().deleteRow().run();
      case 'tbl-del-col': return void chain().deleteColumn().run();
      case 'tbl-del': return void chain().deleteTable().run();
      case 'tbl-send': return sendTableToSheet(e, session);
      case 'img-options': return setDialog('image');
      case 'words': return setDialog('words');
      case 'french': return setFrench((v) => !v);
      case 'identity': return setDialog('identity');
    }
  };

  const inTable = !!toolbar?.inTable;
  // The bar folds into « Plus » and can dock at the bottom (Figma J3), remembered per editor.
  const dock = useToolbarDock(sheet ? 'docs-sheet' : 'docs');
  const imageSelected = !!editor?.isActive('image');
  const ro = !editable;
  const local = status.connection === 'local';
  const spec: MenuSpec = useMemo(
    () => [
      {
        label: 'Fichier',
        items: [
          { id: 'new', label: 'Nouveau document', icon: 'new-page', disabled: !props.onNewDocument },
          { id: 'open', label: 'Ouvrir un fichier .docx…', icon: 'upload', disabled: !props.onOpenFile },
          '-',
          { id: 'share', label: 'Partager…', icon: 'share' },
          {
            id: 'download',
            label: 'Télécharger',
            icon: 'download',
            children: [
              { id: 'dl-docx', label: 'Microsoft Word (.docx)' },
              { id: 'dl-pdf', label: 'Document PDF (.pdf)' },
              { id: 'dl-html', label: 'Page Web (.html)' },
              { id: 'dl-md', label: 'Markdown (.md)' },
              { id: 'dl-txt', label: 'Texte brut (.txt)' },
            ],
          },
          '-',
          { id: 'history', label: 'Historique des versions', icon: 'history', shortcut: 'Ctrl+Alt+Maj+H', disabled: local || status.role === 'viewer' },
          { id: 'name-version', label: 'Nommer la version actuelle', disabled: local || ro },
          '-',
          { id: 'page-setup', label: 'Configuration de la page…', icon: 'page', disabled: ro },
          { id: 'print', label: 'Imprimer', icon: 'print', shortcut: 'Ctrl+P' },
        ],
      },
      {
        label: 'Édition',
        items: [
          { id: 'undo', label: 'Annuler', icon: 'undo', shortcut: 'Ctrl+Z', disabled: ro },
          { id: 'redo', label: 'Rétablir', icon: 'redo', shortcut: 'Ctrl+Maj+Z', disabled: ro },
          '-',
          { id: 'cut', label: 'Couper', icon: 'cut', shortcut: 'Ctrl+X', disabled: ro },
          { id: 'copy', label: 'Copier', icon: 'copy', shortcut: 'Ctrl+C' },
          { id: 'paste', label: 'Coller', icon: 'paste', shortcut: 'Ctrl+V', disabled: ro },
          { id: 'paste-plain', label: 'Coller sans la mise en forme', shortcut: 'Ctrl+Maj+V', disabled: ro },
          '-',
          { id: 'select-all', label: 'Tout sélectionner', shortcut: 'Ctrl+A' },
          { id: 'delete', label: 'Supprimer', disabled: ro },
          '-',
          { id: 'find', label: 'Rechercher', icon: 'search', shortcut: 'Ctrl+F' },
          { id: 'replace', label: 'Rechercher et remplacer', shortcut: 'Ctrl+H', disabled: ro },
        ],
      },
      {
        label: 'Affichage',
        items: [
          { id: 'mode-edit', label: 'Mode édition', icon: 'pen', checked: mode === 'edit', disabled: status.readOnly },
          { id: 'mode-view', label: 'Mode lecture', icon: 'eye', checked: mode === 'view' },
          '-',
          { id: 'paginated', label: 'Mise en page imprimable', checked: paginated },
          { id: 'outline', label: 'Plan du document', icon: 'outline', shortcut: 'Ctrl+Maj+P', checked: showOutline },
          { id: 'marks', label: 'Afficher les caractères non imprimables', checked: showMarks },
          { id: 'table-grid', label: 'Quadrillage des tableaux', checked: tableGrid },
          { id: 'anchors', label: 'Afficher les ancres', checked: showAnchors },
          { id: 'zoom', label: 'Zoom', icon: 'zoom', children: ZOOMS.map((z) => ({ id: `zoom:${z}`, label: `${Math.round(z * 100)} %`, checked: z === zoom })) },
          { id: 'focus', label: 'Mode concentration', icon: 'focus-mode', shortcut: 'Ctrl+Maj+F', checked: focusMode },
          ...(sheet && props.onExpand ? ([{ id: 'fullscreen', label: 'Agrandir en plein écran', icon: 'expand', shortcut: 'Ctrl+Maj+Entrée' }] as const) : []),
          ...(!sheet && props.onReduce ? ([{ id: 'fullscreen', label: 'Réduire (ouvert sur place)', icon: 'collapse', shortcut: 'Ctrl+Maj+Entrée' }] as const) : []),
        ],
      },
      {
        label: 'Insertion',
        items: [
          { id: 'ins-image', label: 'Image…', icon: 'image', disabled: ro },
          { id: 'ins-table', label: 'Tableau', icon: 'table', disabled: ro },
          { id: 'ins-link', label: 'Lien…', icon: 'link', shortcut: 'Ctrl+K', disabled: ro },
          '-',
          { id: 'ins-hr', label: 'Ligne horizontale', icon: 'minus', disabled: ro },
          { id: 'ins-pagebreak', label: 'Saut de page', icon: 'page-break', shortcut: 'Ctrl+Entrée', disabled: ro },
          {
            id: 'ins-section',
            label: 'Saut de section',
            disabled: ro,
            children: [
              { id: 'ins-section-next', label: 'Page suivante' },
              { id: 'ins-section-cont', label: 'Continu' },
            ],
          },
          { id: 'ins-footnote', label: 'Note de bas de page', icon: 'footnote', shortcut: 'Ctrl+Alt+F', disabled: ro },
          { id: 'ins-endnote', label: 'Note de fin', disabled: ro },
          '-',
          { id: 'ins-chars', label: 'Caractères spéciaux…', icon: 'special-chars', disabled: ro },
          { id: 'ins-date', label: 'Date du jour', icon: 'calendar', disabled: ro },
          { id: 'ins-toc', label: 'Table des matières', icon: 'toc', disabled: ro },
          '-',
          { id: 'ins-header', label: 'En-tête', icon: 'header-footer', disabled: ro },
          { id: 'ins-footer', label: 'Pied de page', disabled: ro },
          { id: 'ins-pagenum', label: 'Numéros de page', disabled: ro },
        ],
      },
      {
        label: 'Format',
        items: [
          {
            id: 'text',
            label: 'Texte',
            icon: 'bold',
            disabled: ro,
            children: [
              { id: 'bold', label: 'Gras', shortcut: 'Ctrl+B' },
              { id: 'italic', label: 'Italique', shortcut: 'Ctrl+I' },
              { id: 'underline', label: 'Souligné', shortcut: 'Ctrl+U' },
              { id: 'strike', label: 'Barré', shortcut: 'Alt+Maj+5' },
              { id: 'sup', label: 'Exposant', shortcut: 'Ctrl+.' },
              { id: 'sub', label: 'Indice', shortcut: 'Ctrl+,' },
              { id: 'upper', label: 'MAJUSCULES' },
              { id: 'lower', label: 'minuscules' },
              { id: 'capital', label: 'Majuscule À Chaque Mot' },
            ],
          },
          { id: 'styles', label: 'Styles de paragraphe', disabled: ro, children: ROLE_LABELS.map(([r, l]) => ({ id: `role:${r}`, label: l, shortcut: r.startsWith('heading') ? `Ctrl+Alt+${r.slice(7)}` : r === 'normal' ? 'Ctrl+Alt+0' : undefined })) },
          {
            id: 'align',
            label: 'Aligner et mettre en retrait',
            icon: 'align-left',
            disabled: ro,
            children: [
              { id: 'align-left', label: 'Gauche', shortcut: 'Ctrl+Maj+L' },
              { id: 'align-center', label: 'Centrer', shortcut: 'Ctrl+Maj+E' },
              { id: 'align-right', label: 'Droite', shortcut: 'Ctrl+Maj+R' },
              { id: 'align-justify', label: 'Justifier', shortcut: 'Ctrl+Maj+J' },
              { id: 'indent-more', label: 'Augmenter le retrait', shortcut: 'Ctrl+]' },
              { id: 'indent-less', label: 'Diminuer le retrait', shortcut: 'Ctrl+[' },
            ],
          },
          {
            id: 'spacing',
            label: 'Interligne et espacement',
            icon: 'line-spacing',
            disabled: ro,
            children: [
              { id: 'line:240', label: 'Simple' },
              { id: 'line:276', label: '1,15' },
              { id: 'line:360', label: '1,5' },
              { id: 'line:480', label: 'Double' },
              { id: 'space-before', label: 'Ajouter un espace avant' },
              { id: 'space-after', label: 'Ajouter un espace après' },
            ],
          },
          {
            id: 'lists',
            label: 'Puces et numéros',
            icon: 'list',
            disabled: ro,
            children: [
              { id: 'list-bullet', label: 'Liste à puces', shortcut: 'Ctrl+Maj+8' },
              { id: 'list-numbered', label: 'Liste numérotée', shortcut: 'Ctrl+Maj+7' },
              { id: 'list-check', label: 'Liste de contrôle', shortcut: 'Ctrl+Maj+9' },
            ],
          },
          '-',
          {
            id: 'table',
            label: 'Tableau',
            icon: 'table',
            disabled: ro || !inTable,
            children: [
              { id: 'tbl-row-before', label: 'Insérer une ligne au-dessus' },
              { id: 'tbl-row-after', label: 'Insérer une ligne en dessous' },
              { id: 'tbl-col-before', label: 'Insérer une colonne à gauche' },
              { id: 'tbl-col-after', label: 'Insérer une colonne à droite' },
              { id: 'tbl-merge', label: 'Fusionner ou scinder les cellules' },
              { id: 'tbl-header', label: 'Ligne d’en-tête' },
              { id: 'tbl-send', label: 'Envoyer vers un tableur…', icon: 'table', disabled: ro || !inTable },
              { id: 'tbl-del-row', label: 'Supprimer la ligne' },
              { id: 'tbl-del-col', label: 'Supprimer la colonne' },
              { id: 'tbl-del', label: 'Supprimer le tableau' },
            ],
          },
          { id: 'img-options', label: 'Options de l’image…', icon: 'image', disabled: ro || !imageSelected },
          '-',
          { id: 'clear', label: 'Effacer la mise en forme', icon: 'clear-format', shortcut: 'Ctrl+\\', disabled: ro },
        ],
      },
      {
        label: 'Outils',
        items: [
          { id: 'words', label: 'Nombre de mots', icon: 'word-count', shortcut: 'Ctrl+Maj+C' },
          { id: 'french', label: 'Typographie française automatique', icon: 'translate', checked: french },
          { id: 'identity', label: 'Votre nom…', icon: 'user' },
        ],
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, paginated, showOutline, showMarks, tableGrid, showAnchors, zoom, ro, local, inTable, imageSelected, french, focusMode, sheet, status.readOnly, status.role],
  );

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Alt') reveal();
    // Échap ends what is in progress first; the level only changes when nothing was (A2).
    // Consumers stop propagation: ProseMirror preventDefaults every Échap, so that is no signal.
    if (e.key === 'Escape') {
      const consume = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (editor?.storage.docEditing.painter) {
        consume();
        editor.commands.cancelFormatPainter();
      } else if (find) {
        consume();
        setFind(null);
        editor?.commands.focus();
      } else if (editingStory) {
        consume();
        setEditingStory(null);
        setActive(editor);
        editor?.commands.focus();
      } else if (focusMode) {
        consume();
        setFocusMode(false);
      }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    const run = (id: string) => {
      e.preventDefault();
      act(id);
    };
    if (k === 'f' && !e.altKey && !e.shiftKey) return run('find');
    if (k === 'h' && !e.shiftKey && !e.altKey) return run('replace');
    if (k === 'k' && editable) return run('ins-link');
    if (k === 'p' && !e.shiftKey) return run('print');
    if (k === 's') {
      e.preventDefault();
      return toast({ title: 'Enregistrement automatique', description: 'Chaque modification est enregistrée dès qu’elle est faite.', tone: 'info' });
    }
    if (e.altKey && k === 'f' && editable) return run('ins-footnote');
    if (e.shiftKey && k === 'c') return run('words');
    if (e.shiftKey && !e.altKey && k === 'p') return run('outline');
    if (e.shiftKey && !e.altKey && k === 'f') return run('focus');
    if (e.altKey && e.shiftKey && k === 'h') return run('history');
  };

  if (!editor || !toolbar) {
    return (
      <div className="oel-docs oel-docs--loading" aria-busy>
        <p>Ouverture du document…</p>
      </div>
    );
  }

  const exportMenu = (
    <MenuTrigger>
      <Button size="sm" variant="secondary" leadingIcon="download">
        Exporter
      </Button>
      <MenuPopover placement="bottom end">
        <Menu aria-label="Exporter" onAction={(k) => act(String(k))}>
          <MenuItem id="dl-docx" icon="file">Word (.docx)</MenuItem>
          <MenuItem id="dl-pdf" icon="print">PDF (.pdf)</MenuItem>
          <MenuItem id="dl-html">Page Web (.html)</MenuItem>
          <MenuItem id="dl-md">Markdown (.md)</MenuItem>
          <MenuItem id="dl-txt">Texte brut (.txt)</MenuItem>
        </Menu>
      </MenuPopover>
    </MenuTrigger>
  );
  const shareButton = (
    <Button size="sm" variant="primary" leadingIcon="share" onPress={() => setDialog('share')}>
      Partager
    </Button>
  );
  const keepFocus = (e: ReactMouseEvent) => (e.target as HTMLElement).closest('input,select,textarea') || e.preventDefault();
  const toolbarEl = toolbar && target && (
    <DocsToolbar
      editor={target}
      state={toolbar}
      styles={docMeta.styles}
      fonts={docMeta.fonts}
      editable={editable}
      onLink={() => setDialog('link')}
      onImage={() => setDialog('image')}
      painterActive={painter}
      more={sheet ? <MoreMenu spec={spec} onAction={act} /> : undefined}
      dock={dock}
      storageKey={sheet ? 'docs-sheet' : 'docs'}
    />
  );
  const classes = ['oel-docs', `oel-docs--${variant}`, showMarks && 'oel-docs--marks', tableGrid && 'oel-docs--grid', showAnchors && 'oel-docs--anchors', focusMode && 'oel-docs--focus', focusMode && revealed && 'is-revealed'].filter(Boolean).join(' ');

  return (
    <div className={classes} onKeyDown={onKeyDown} onPointerMove={reveal}>
      <style>{sanitizeStylesheet(docMeta.stylesCss)}</style>
      {!sheet && (
        <header className="oel-docs__top">
          <nav className="oel-docs__crumbs" aria-label="Fil d’Ariane">
            {props.onBureau && (
              <Button variant="ghost" size="sm" leadingIcon="chevron-left" onPress={props.onBureau} aria-keyshortcuts={props.onReduce ? undefined : 'Escape'}>
                Bureau
              </Button>
            )}
            {props.onBureau && <span className="oel-docs__crumb-sep" aria-hidden>›</span>}
            <span className="oel-docs__icon" aria-hidden>
              <Icon name="file" size={20} />
            </span>
          </nav>
          <div className="oel-docs__titles">
            <div className="oel-docs__titlerow">
              <input
                className="oel-docs__title"
                aria-label="Titre du document"
                value={titleDraft}
                readOnly={status.readOnly}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur(), editor.commands.focus())}
              />
              {status.readOnly && <Badge appearance="stamp" tone="neutral" dot={false}>Lecture seule</Badge>}
              <SyncStatus status={status} />
            </div>
            <MenuBar spec={spec} onAction={act} />
          </div>
          <div className="oel-docs__right">
            {props.onReduce && (
              <Button size="sm" variant="ghost" leadingIcon="collapse" aria-keyshortcuts="Control+Shift+Enter" onPress={props.onReduce}>
                Réduire
              </Button>
            )}
            <Peers status={status} />
            <Button size="sm" variant="ghost" leadingIcon="history" aria-label="Historique des versions" isDisabled={local || status.role === 'viewer'} onPress={() => setShowVersions((v) => !v)} />
            {exportMenu}
            {shareButton}
          </div>
        </header>
      )}

      <div className="oel-docs__toolbar" onMouseDown={keepFocus}>
        {!dock.docked && toolbarEl}
        <div className="oel-docs__mode" role="group" aria-label="Mode">
          {status.readOnly ? (
            <span className="oel-docs__mode-label"><Icon name="eye" size={16} /> Lecture seule</span>
          ) : (
            <Button size="sm" variant="ghost" leadingIcon={mode === 'edit' ? 'pen' : 'eye'} onPress={() => setMode((m) => (m === 'edit' ? 'view' : 'edit'))} aria-label={mode === 'edit' ? 'Passer en mode lecture' : 'Passer en mode édition'}>
              {mode === 'edit' ? 'Édition' : 'Lecture'}
            </Button>
          )}
        </div>
        {sheet && (
          <div className="oel-docs__sheet-actions">
            <SyncStatus status={status} />
            <Peers status={status} />
            {exportMenu}
            {shareButton}
          </div>
        )}
      </div>
      {inTable && editable && target && <TableFloat editor={target} scroller={canvasRef.current} onSend={() => sendTableToSheet(target, session)} />}
      {toolbar?.chartAt != null && target && <ChartFloat key={toolbar.chartAt} editor={target} scroller={canvasRef.current} editable={editable} />}
      {toolbar?.pictureAt != null && target && !retouch && (
        <PictureFloat
          key={toolbar.pictureAt}
          editor={target}
          scroller={canvasRef.current}
          editable={editable}
          actions={{
            onRetouch: props.createImageWorker ? (crop) => setRetouch({ editor: target, pos: toolbar.pictureAt!, crop }) : undefined,
            onReplace: () => replacePicture(target, session, toolbar.pictureAt!),
            onAlt: () => setDialog('image'),
          }}
        />
      )}
      {editor && <LinkedEditNotice editor={editor} root={canvasRef.current} />}
      {ctxMenu && (
        <ContextMenu
          at={ctxMenu}
          label="Actions sur la sélection"
          items={contextItems(ctxMenu.editor, ro)}
          onAction={act}
          onClose={() => {
            const ed = ctxMenu.editor;
            setCtxMenu(null);
            requestAnimationFrame(() => !ed.isDestroyed && !document.querySelector('[role="dialog"]') && ed.view.focus());
          }}
        />
      )}

      <div className="oel-docs__body">
        {showOutline && !sheet && <OutlinePanel editor={editor} onClose={() => setShowOutline(false)} />}
        <div
          className="oel-docs__canvas"
          ref={canvasRef}
          onFocus={(e) => (e.target as HTMLElement).closest('.oel-body-wrap') && setActive(editor)}
          onContextMenu={(ev) => {
            // Linked copies open their own menu; Maj+clic droit keeps the browser's.
            if (ev.defaultPrevented || ev.shiftKey) return;
            const ed = ((ev.target as HTMLElement).closest('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null)?.editor;
            if (!ed || ed.isDestroyed) return;
            ev.preventDefault();
            caretToClick(ed, ev.clientX, ev.clientY);
            setActive(ed);
            setCtxMenu({ x: ev.clientX, y: ev.clientY, editor: ed });
          }}
        >
          {find && <FindBar editor={editor} replace={find.replace} editable={editable} onClose={() => setFind(null)} />}
          <PageView
            editor={editor}
            session={session}
            docMeta={docMeta}
            editable={editable}
            paginated={paginated}
            zoom={zoom}
            onStoryFocus={setActive}
            editingStory={editingStory}
            setEditingStory={(s) => {
              setEditingStory(s);
              if (!s) setActive(editor);
            }}
          >
            <NotesArea editor={editor} session={session} docMeta={docMeta} editable={editable} onFocus={setActive} />
          </PageView>
          {painter && (
            <p className="oel-docs__hint" role="status">
              Sélectionnez le texte qui recevra la mise en forme · <Kbd>Échap</Kbd> pour annuler
            </p>
          )}
        </div>
        {showVersions && <VersionPanel session={session} onClose={() => setShowVersions(false)} onRestored={() => editor.storage.pagination.relayout()} />}
        {retouch && props.createImageWorker && (
          <RetouchPanel
            key={retouch.pos}
            editor={retouch.editor}
            session={session}
            pos={retouch.pos}
            crop={retouch.crop}
            createWorker={props.createImageWorker}
            onClose={() => setRetouch(null)}
          />
        )}
      </div>

      {dock.docked && (
        <div className="oel-docs__dock" onMouseDown={keepFocus}>
          {toolbarEl}
        </div>
      )}
      {!sheet && <StatusBar editor={editor} sheets={sheets} sheetAt={sheetAt} sectionCount={sectionInfo?.count ?? 1} zoom={zoom} setZoom={setZoom} paginated={paginated} />}

      <LinkDialog editor={target!} isOpen={dialog === 'link'} onClose={() => setDialog(null)} />
      {currentSection && (
        <PageSetupDialog
          session={session}
          page={currentSection.page}
          background={docMeta.background}
          sectionId={currentSection.id}
          sectionIndex={sectionInfo?.index ?? 0}
          sectionCount={sectionInfo?.count ?? 1}
          isOpen={dialog === 'page'}
          onClose={() => setDialog(null)}
        />
      )}
      <WordCountDialog editor={editor} pages={pages} isOpen={dialog === 'words'} onClose={() => setDialog(null)} />
      <SpecialCharsDialog editor={target!} isOpen={dialog === 'chars'} onClose={() => setDialog(null)} />
      <ImageDialog editor={editor} isOpen={dialog === 'image'} onClose={() => setDialog(null)} onFile={(f) => addImage(f)} />
      <ShareDialog session={session} title={title} origin={props.shareOrigin ?? (typeof location !== 'undefined' ? location.origin : '')} isOpen={dialog === 'share'} onClose={() => setDialog(null)} />
      {fontReport && <FontsDialog fonts={docMeta.fonts} report={fontReport} isOpen={fontsOpen} onClose={() => setFontsOpen(false)} onChange={() => editor?.storage.pagination.relayout()} />}
      <IdentityDialog identity={identity} isOpen={dialog === 'identity'} onClose={() => setDialog(null)} onSave={(i) => (session.setIdentity(i), props.onIdentityChange?.(i))} />
    </div>
  );
}

/** Barre d’état (B1 · 7): page (and section), words, language, zoom of the page. */
function StatusBar({
  editor,
  sheets,
  sheetAt,
  sectionCount,
  zoom,
  setZoom,
  paginated,
}: {
  editor: Editor;
  sheets: PageInfo[];
  sheetAt: (pos: number) => number | null;
  sectionCount: number;
  zoom: number;
  setZoom: (z: number) => void;
  paginated: boolean;
}) {
  const pages = Math.max(1, sheets.length);
  const info = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const { $from, from } = e.state.selection;
      const rpr = ($from.marks().find((m) => m.type.name === 'textStyle')?.attrs.rPr as string | null) ?? '';
      const lang = /<w:lang [^>]*w:val="([^"]+)"/.exec(rpr)?.[1] ?? e.view.dom.getAttribute('lang') ?? 'fr-CA';
      return { sheet: paginated ? sheetAt(from) : null, section: sectionIndexAt(e, from), words: e.storage.characterCount?.words?.() ?? 0, lang };
    },
    equalityFn: (a, b) => !!a && !!b && a.sheet === b.sheet && a.section === b.section && a.words === b.words && a.lang === b.lang,
  });
  const step = (dir: 1 | -1) => {
    const i = ZOOMS.findIndex((z) => z >= zoom - 0.001);
    setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? ZOOMS.length - 1 : i) + dir))]!);
  };
  return (
    <footer className="oel-statusbar" aria-label="Barre d’état">
      <span>
        {info?.sheet != null ? `Page ${info.sheet + 1} sur ${pages}` : `${pages} page${pages > 1 ? 's' : ''}`}
        {sectionCount > 1 && info ? ` · Section ${info.section + 1}` : ''} · {(info?.words ?? 0).toLocaleString('fr-CA')} mot{(info?.words ?? 0) > 1 ? 's' : ''} ·{' '}
        {LANGS[info?.lang ?? 'fr-CA'] ?? LANGS[(info?.lang ?? 'fr').split('-')[0]!] ?? info?.lang}
      </span>
      <span className="oel-statusbar__zoom" role="group" aria-label="Zoom de la page">
        <Button size="icon-sm" variant="ghost" leadingIcon="minus" aria-label="Zoom arrière" onPress={() => step(-1)} />
        <span aria-live="polite">{Math.round(zoom * 100)} %</span>
        <Button size="icon-sm" variant="ghost" leadingIcon="plus" aria-label="Zoom avant" onPress={() => step(1)} />
      </span>
    </footer>
  );
}

/**
 * Like Word: a right-click outside the selection moves the caret there first;
 * inside the selection (or a cell selection) it keeps it.
 */
function caretToClick(ed: Editor, x: number, y: number) {
  const hit = ed.view.posAtCoords({ left: x, top: y });
  if (!hit) return;
  const { from, to, empty } = ed.state.selection;
  if (!empty && hit.pos >= from && hit.pos <= to) return;
  if (!empty && ed.view.dom.querySelector('.selectedCell')) {
    const cell = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('td, th');
    if (cell?.classList.contains('selectedCell')) return;
  }
  ed.chain().focus().setTextSelection(hit.pos).run();
}

/** Right-click menu of the document: clipboard, link, then the table's actions. */
function contextItems(ed: Editor, ro: boolean): Array<MenuEntry | '-'> {
  const empty = ed.state.selection.empty;
  const items: Array<MenuEntry | '-'> = [
    { id: 'cut', label: 'Couper', icon: 'cut', shortcut: 'Ctrl+X', disabled: ro || empty },
    { id: 'copy', label: 'Copier', icon: 'copy', shortcut: 'Ctrl+C', disabled: empty },
    { id: 'paste', label: 'Coller', icon: 'paste', shortcut: 'Ctrl+V', disabled: ro },
    { id: 'paste-plain', label: 'Coller sans mise en forme', shortcut: 'Ctrl+Maj+V', disabled: ro },
    '-',
    { id: 'ins-link', label: ed.isActive('link') ? 'Modifier le lien…' : 'Lien…', icon: 'link', shortcut: 'Ctrl+K', disabled: ro },
  ];
  if (ed.isActive('image')) items.push({ id: 'img-options', label: 'Options de l’image…', icon: 'image', disabled: ro });
  items.push({ id: 'clear', label: 'Effacer la mise en forme', icon: 'clear-format', shortcut: 'Ctrl+\\', disabled: ro || empty });
  if (ed.isActive('table') && !ro) {
    items.push(
      '-',
      { id: 'tbl-row-before', label: 'Insérer une ligne au-dessus', icon: 'table-rows' },
      { id: 'tbl-row-after', label: 'Insérer une ligne en dessous', icon: 'table-rows' },
      { id: 'tbl-col-before', label: 'Insérer une colonne à gauche', icon: 'insert-col' },
      { id: 'tbl-col-after', label: 'Insérer une colonne à droite', icon: 'insert-col' },
      { id: 'tbl-merge', label: 'Fusionner / scinder les cellules', icon: 'merge' },
      { id: 'tbl-header', label: 'Ligne d’en-tête' },
      { id: 'tbl-send', label: 'Envoyer vers un tableur…', icon: 'table' },
      {
        id: 'tbl-delete',
        label: 'Supprimer',
        icon: 'trash',
        children: [
          { id: 'tbl-del-row', label: 'La ligne' },
          { id: 'tbl-del-col', label: 'La colonne' },
          { id: 'tbl-del', label: 'Le tableau' },
        ],
      },
    );
  }
  return items;
}

/** « Coller » from a menu: the async clipboard, through ProseMirror's own paste path. */
async function pasteFromClipboard(ed: Editor, plain: boolean) {
  ed.view.focus();
  if (!plain && navigator.clipboard?.read) {
    for (const item of await navigator.clipboard.read()) {
      if (item.types.includes('text/html')) return void ed.view.pasteHTML(await (await item.getType('text/html')).text());
    }
  }
  ed.view.pasteText(await navigator.clipboard.readText());
}

/**
 * A picture copied here pastes linked in another file of the desk (Figma I1 d):
 * remember where it comes from. It gets an `oid` (what a link points at) if it
 * had none; that change is not an undo step.
 */
function rememberPictureCopy(sel: Selection, editor: Editor, session: DocSession) {
  setLinkClip(null);
  if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'image') return;
  const path = sel.node.attrs.path as string | null;
  const url = path ? session.mediaUrl(path) : null;
  if (!path || !url) return;
  let oid = sel.node.attrs.oid as string | null;
  if (!oid) {
    oid = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(sel.from, undefined, { ...sel.node.attrs, oid }).setMeta('addToHistory', false));
  }
  const docId = session.status.docId;
  const ref = { kind: 'image' as const, objectId: oid };
  const label = (sel.node.attrs.alt as string) || path.split('/').pop() || 'Image';
  void fetch(url)
    .then((r) => r.blob())
    .then(pictureValue)
    .then((value) =>
      setLinkClip({
        // A linked copy pastes as another copy of its own source, never as a copy of a copy.
        source: linksOf(session.ydoc).byObject(oid!)?.source ?? { docId, kind: 'document', ref, title: linkHost().fileTitle(docId) ?? 'Document', label },
        value,
        at: Date.now(),
      }),
    )
    .catch(() => {});
}

/** Insert the clipboard's picture at the selection as a linked copy, with a way back to a plain copy. */
async function pasteLinkedPicture(editor: Editor, session: DocSession, clip: LinkClip, maxWidthPx: number) {
  if (clip.value.kind !== 'picture') return;
  const blob = pictureBytes(clip.value.media.hash);
  if (!blob) return;
  const path = await session.addImage(blob);
  const { width, height } = clip.value.media;
  const scale = Math.min(1, maxWidthPx / Math.max(1, width));
  const oid = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const linkId = newLinkId();
  editor.chain().focus().insertContent({ type: 'image', attrs: { src: `media:${path}`, path, cx: Math.round(width * scale * EMU_PER_PX), cy: Math.round(height * scale * EMU_PER_PX), alt: clip.source.label, oid } }).run();
  linksOf(session.ydoc).put(
    { id: linkId, source: clip.source, target: { objectId: oid, label: 'au curseur' }, carries: 'picture', mode: 'live', snapshot: { rev: revOf(clip.value), at: Date.now(), by: session.author } },
    'person',
  );
  toast({
    title: `Image liée à « ${clip.source.title} »`,
    description: 'Elle suivra l’image d’origine. Vous pouvez la garder comme simple copie.',
    tone: 'success',
    action: { label: 'Incorporer (sans lien)', onAction: () => linksOf(session.ydoc).remove(linkId, 'person') },
  });
}

/**
 * « Envoyer vers un tableur… » (Figma I3): the table around the caret goes to
 * the app, which asks where and, by default, links it back to the new range.
 * Refused, with the reason, for linked or nested tables.
 */
export function sendTableToSheet(editor: Editor, session: DocSession) {
  const $from = editor.state.selection.$from;
  let depth = -1;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'table') depth = d;
  if (depth < 0) return;
  const node = $from.node(depth);
  const pos = $from.before(depth);
  if (node.attrs.oid && linkHost().copyOf(node.attrs.oid as string)) return void toast({ title: 'Ce tableau est déjà lié', description: 'Ses valeurs viennent déjà d’un tableur.', tone: 'info' });
  const { table, lossy, nested } = tableAsLinked(node);
  if (nested) return void toast({ title: 'Tableau imbriqué', description: 'Ce tableau contient un autre tableau : aplatissez-le d’abord.', tone: 'warning' });
  let oid = node.attrs.oid as string | null;
  if (!oid) {
    oid = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, oid }).setMeta('addToHistory', false));
  }
  if (!linkHost().sendTableToSheet({ docId: session.status.docId, kind: 'document', objectId: oid, table, lossy }))
    toast({ title: 'Ouvrez ce document depuis le bureau', description: 'Le tableau peut alors partir vers un tableur du bureau.', tone: 'info' });
}

/**
 * Paste one copied cell as a linked value (Figma I4): the number is written
 * like text in the sentence, follows the cell, and prints as plain text. The
 * toast offers to keep plain text instead.
 */
function pasteLinkedValue(editor: Editor, session: DocSession, clip: LinkClip) {
  if (clip.value.kind !== 'value') return;
  const oid = `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const linkId = newLinkId();
  const text = clip.value.text;
  editor.chain().focus().insertContent({ type: 'ooxmlInline', attrs: { xml: '', label: text, hidden: false, oid } }).run();
  linksOf(session.ydoc).put(
    { id: linkId, source: clip.source, target: { objectId: oid, label: 'dans le texte' }, carries: 'value', mode: 'live', snapshot: { rev: revOf(clip.value), at: Date.now(), by: session.author } },
    'person',
  );
  toast({
    title: `Valeur liée à ${clip.source.label}`,
    description: `Elle suivra la cellule de « ${clip.source.title} ».`,
    tone: 'success',
    action: {
      label: 'Coller comme texte simple',
      onAction: () => {
        linksOf(session.ydoc).remove(linkId, 'person');
        // Replace the value by the same plain text.
        let at = -1;
        editor.state.doc.descendants((n, pos) => void (n.type.name === 'ooxmlInline' && n.attrs.oid === oid && (at = pos)));
        if (at >= 0) editor.chain().focus().insertContentAt({ from: at, to: at + 1 }, text).run();
      },
    },
  });
}

/** « Remplacer » (L3): another file in the same place and width; a retouch does not carry over. */
function replacePicture(editor: Editor, session: DocSession, pos: number) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const path = await session.addImage(file);
      const bmp = await createImageBitmap(file);
      const ratio = bmp.height / bmp.width;
      bmp.close();
      const n = editor.state.doc.nodeAt(pos);
      if (n?.type.name !== 'image') return;
      const cx = (n.attrs.cx as number | null) ?? null;
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, src: `media:${path}`, path, rid: null, recipe: null, orig: null, cy: cx ? Math.round(cx * ratio) : n.attrs.cy }),
      );
    } catch {
      toast({ title: 'Image non remplacée', tone: 'danger' });
    }
  };
  input.click();
}
