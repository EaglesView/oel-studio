import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import type { Preview } from '@oel/engine';
import { Badge, Button, Icon, Kbd } from '@oel/emboss';
import { kindLabel, paperSizeFor, type Bureau, type Paper } from './model';
import { queueThumbnail } from './thumbnails';
import { DocumentWorkspace } from './workspaces/DocumentWorkspace';
import { SlidesWorkspace } from './workspaces/SlidesWorkspace';
import { SheetWorkspace } from './workspaces/SheetWorkspace';
import { PdfWorkspace } from './workspaces/PdfWorkspace';
import { ImageWorkspace } from './workspaces/SimpleWorkspaces';
import { FormWorkspace } from './workspaces/FormWorkspace';

/** 2 = ouvert sur place (floating sheet), 3 = plein écran (Editor — Behaviors · A1). */
export type OpenLevel = 2 | 3;

export interface WorkspaceProps {
  paper: Paper;
  level: OpenLevel;
  /** Report the edited preview; committed as one undo step when the sheet closes. */
  onDraft: (preview: Preview) => void;
  /** Workspaces with live state register a function giving their latest preview, called on close. */
  registerFlush: (flush: () => Preview | null) => void;
  onConvert: (id: string) => void;
  /** Immediate update of the paper (title, linked document), outside the draft. */
  onPatch?: (patch: Partial<Paper>) => void;
  onExpand: () => void;
  onReduce: () => void;
  onBureau: () => void;
  /** The desk, for workspaces that work across papers (forms ↔ spreadsheets). */
  store?: Bureau;
  /** Open another paper in place (« Ouvrir le tableur » from a form). */
  onOpenPaper?: (id: string) => void;
}

export interface OpenSheetHandle {
  /** Commit the edited preview to the desk (thumbnail up to date at once). */
  commit: () => void;
}

/** Kinds whose workspace brings its own full-screen chrome (breadcrumb, « Réduire », status bar). */
const OWN_CHROME = new Set(['document', 'spreadsheet', 'slides']);

/**
 * B4 · Ouvrir sur place (level 2) and Plein écran (level 3).
 *
 * Level 2: the paper comes toward you, the desk blurs behind. A click outside
 * the content, « Reposer », Échap or the browser's Back put it back.
 * Level 3: the editor fills the window (not the browser's full screen);
 * « Réduire », Échap or Ctrl+Maj+Entrée go back to level 2, « ‹ Bureau »
 * straight to the desk.
 *
 * Échap always ends what is in progress first (menu, find bar, header…): the
 * level only changes when nothing inside handled the key.
 */
export function OpenSheet({
  store,
  paper,
  level,
  onExpand,
  onReduce,
  onRepose,
  onBureau,
  onConvert,
  onOpenPaper,
  handle,
}: {
  store: Bureau;
  paper: Paper;
  level: OpenLevel;
  onExpand: () => void;
  onReduce: () => void;
  onRepose: () => void;
  onBureau: () => void;
  onConvert: (id: string) => void;
  onOpenPaper?: (id: string) => void;
  handle: Ref<OpenSheetHandle>;
}) {
  const draft = useRef<Preview | null>(null);
  const flush = useRef<(() => Preview | null) | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const full = level === 3;
  const ownChrome = full && OWN_CHROME.has(paper.kind);

  // FLIP: start the page where the paper lies on the desk, then settle (320 ms).
  useLayoutEffect(() => {
    const page = pageRef.current;
    const from = document.querySelector(`[data-node-id="${CSS.escape(paper.id)}"]`)?.getBoundingClientRect();
    if (!page || !from || full || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const to = page.getBoundingClientRect();
    if (!to.width) return;
    const sx = from.width / to.width;
    const sy = from.height / to.height;
    page.style.transformOrigin = '0 0';
    page.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${sx}, ${sy})`;
    page.style.opacity = '0.6';
    requestAnimationFrame(() => {
      page.style.transition = 'transform var(--dur-open) var(--ease-paper), opacity var(--dur-open) var(--ease-paper)';
      page.style.transform = '';
      page.style.opacity = '';
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper.id]);

  useImperativeHandle(
    handle,
    () => ({
      commit() {
        const preview = flush.current?.() ?? draft.current;
        if (!preview) return;
        draft.current = null;
        const cur = store.node(paper.id) as Paper | undefined;
        if (!cur) return;
        // A document's paper follows its page setup (portrait, landscape, Legal…), a deck its slide shape.
        const size = cur.kind === 'document' || cur.kind === 'slides' ? paperSizeFor(cur.kind, preview) : null;
        store.update(
          paper.id,
          {
            data: { ...cur.data, preview, editor: 'JB', updatedAt: Date.now() },
            ...(size && (size.w !== cur.w || size.h !== cur.h) ? { w: size.w, h: size.h } : {}),
          },
          { label: `Modification de « ${paper.title} »` },
        );
        queueThumbnail(store, paper.id);
      },
    }),
    [store, paper.id, paper.title],
  );

  const props: WorkspaceProps = {
    paper,
    level,
    onDraft: (p) => (draft.current = p),
    registerFlush: (fn) => (flush.current = fn),
    onConvert,
    onPatch: (patch) => store.update(paper.id, patch, { history: false }),
    onExpand,
    onReduce,
    onBureau,
    store,
    onOpenPaper,
  };

  return (
    <ModalOverlay
      isOpen
      // Dismissal is ours: Échap moves one level, a click outside the content puts the sheet back.
      isDismissable={false}
      isKeyboardDismissDisabled
      className={`open-overlay${full ? ' is-full' : ''}`}
      data-desk-ui
    >
      <Modal className="open-modal">
        <Dialog className="open-sheet-dialog" aria-labelledby="open-sheet-title">
          <div
            className={`open-sheet${ownChrome ? ' open-sheet--chromeless' : ''}`}
            onPointerDown={(e) => {
              if (!full && e.target === e.currentTarget) onRepose();
            }}
            onKeyDown={(e) => {
              // Inner layers (menus, find bar, header editing…) stop propagation when they
              // consume Échap; ProseMirror's preventDefault on Échap/Entrée is not a signal.
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
                e.preventDefault();
                if (full) onReduce();
                else onExpand();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                if (full) onReduce();
                else onRepose();
              }
            }}
          >
            {ownChrome ? (
              <Heading slot="title" id="open-sheet-title" className="emb-visually-hidden">
                {paper.title}
              </Heading>
            ) : (
              <nav className="open-sheet__crumbs chrome-pill" aria-label="Fil d’Ariane">
                <ol>
                  <li>
                    <Button variant="ghost" size="sm" leadingIcon="chevron-left" onPress={onBureau}>
                      Bureau
                    </Button>
                  </li>
                  <li aria-current="page">
                    <Heading slot="title" id="open-sheet-title" className="open-sheet__title">
                      {paper.title}
                    </Heading>
                    <Badge tone="accent">{kindLabel(paper.kind)}</Badge>
                    {paper.data.status.state === 'readonly' && (
                      <Badge appearance="stamp" tone="neutral" dot={false}>
                        Lecture seule
                      </Badge>
                    )}
                  </li>
                </ol>
                <div className="open-sheet__actions">
                  {!full && (
                    <Button variant="ghost" size="sm" leadingIcon="download" onPress={onRepose} aria-keyshortcuts="Escape">
                      Reposer
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" leadingIcon={full ? 'collapse' : 'expand'} aria-keyshortcuts="Control+Shift+Enter" onPress={full ? onReduce : onExpand}>
                    {full ? 'Réduire' : 'Agrandir'}
                  </Button>
                </div>
              </nav>
            )}

            <div className="open-sheet__work" ref={pageRef}>
              {paper.kind === 'document' && <DocumentWorkspace {...props} />}
              {paper.kind === 'slides' && <SlidesWorkspace {...props} />}
              {paper.kind === 'spreadsheet' && <SheetWorkspace {...props} />}
              {paper.kind === 'pdf' && <PdfWorkspace {...props} />}
              {paper.kind === 'image' && <ImageWorkspace {...props} />}
              {paper.kind === 'form' && <FormWorkspace {...props} />}
              {paper.kind === 'file' && (
                <div className="workspace-empty">
                  <Icon name="file" size={40} />
                  <p>Aperçu seulement : ce format n’est pas encore pris en charge.</p>
                </div>
              )}
            </div>

            {!ownChrome && (
              <p className="open-sheet__hint chrome-pill" aria-hidden>
                {full ? (
                  <>
                    <Kbd>Échap</Kbd> réduire · <Kbd>Ctrl</Kbd>+<Kbd>Maj</Kbd>+<Kbd>Entrée</Kbd> ouvert sur place
                  </>
                ) : (
                  <>
                    <Kbd>Échap</Kbd> ou clic dehors : reposer sur le bureau · <Kbd>Ctrl</Kbd>+<Kbd>Maj</Kbd>+<Kbd>Entrée</Kbd> plein écran
                  </>
                )}
              </p>
            )}
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
