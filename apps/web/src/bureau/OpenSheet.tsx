import { useLayoutEffect, useRef, useState } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import type { Preview } from '@oel/engine';
import { Badge, Button, Icon, Kbd } from '@oel/emboss';
import { kindLabel, type Bureau, type Paper } from './model';
import { DocumentWorkspace } from './workspaces/DocumentWorkspace';
import { SlidesWorkspace } from './workspaces/SlidesWorkspace';
import { SheetWorkspace } from './workspaces/SheetWorkspace';
import { PdfWorkspace } from './workspaces/PdfWorkspace';
import { ImageWorkspace, NoteWorkspace } from './workspaces/SimpleWorkspaces';

export interface WorkspaceProps {
  paper: Paper;
  /** Report the edited preview; committed as one undo step when the sheet closes. */
  onDraft: (preview: Preview) => void;
  onConvert: (id: string) => void;
}

/**
 * B4 · Ouvrir sur place. Double-click (or Enter) brings the paper toward you;
 * the desk blurs and dims but stays visible, so you never leave the project.
 * Échap puts the sheet back; Ctrl+Entrée switches to full screen.
 *
 * Built on react-aria's Modal: focus moves into the sheet, is trapped while
 * it is open and returns to the paper on the desk when it closes.
 */
export function OpenSheet({ store, paper, onClose, onConvert }: { store: Bureau; paper: Paper; onClose: () => void; onConvert: (id: string) => void }) {
  const [full, setFull] = useState(false);
  const draft = useRef<Preview | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  // FLIP: start the page where the paper lies on the desk, then settle (320 ms).
  useLayoutEffect(() => {
    const page = pageRef.current;
    const from = document.querySelector(`[data-node-id="${CSS.escape(paper.id)}"]`)?.getBoundingClientRect();
    if (!page || !from || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
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
  }, [paper.id]);

  const close = () => {
    if (draft.current) {
      const preview = draft.current;
      const firstHeading = preview.kind === 'document' ? preview.blocks.find((b) => b.type === 'heading')?.text : undefined;
      store.update(
        paper.id,
        { data: { ...paper.data, preview }, ...(firstHeading && paper.kind === 'document' ? { title: firstHeading } : {}) },
        { label: `Modification de « ${paper.title} »` },
      );
    }
    onClose();
  };

  const props: WorkspaceProps = { paper, onDraft: (p) => (draft.current = p), onConvert };

  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => !open && close()}
      className={`open-overlay${full ? ' is-full' : ''}`}
      data-desk-ui
    >
      <Modal className="open-modal">
        <Dialog className="open-sheet-dialog" aria-labelledby="open-sheet-title">
          <div
            className="open-sheet"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                setFull((f) => !f);
              }
            }}
          >
          <nav className="open-sheet__crumbs chrome-pill" aria-label="Fil d’Ariane">
            <ol>
              <li>
                <Button variant="ghost" size="sm" leadingIcon="chevron-left" onPress={close}>
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
            <Button
              variant="ghost"
              size="icon-sm"
              leadingIcon="expand"
              aria-label={full ? 'Quitter le plein écran' : 'Plein écran'}
              aria-keyshortcuts="Control+Enter"
              onPress={() => setFull((f) => !f)}
            />
          </nav>

          <div className="open-sheet__work" ref={pageRef}>
            {paper.kind === 'document' && <DocumentWorkspace {...props} />}
            {paper.kind === 'slides' && <SlidesWorkspace {...props} />}
            {paper.kind === 'spreadsheet' && <SheetWorkspace {...props} />}
            {paper.kind === 'pdf' && <PdfWorkspace {...props} />}
            {paper.kind === 'image' && <ImageWorkspace {...props} />}
            {paper.kind === 'note' && <NoteWorkspace {...props} />}
            {paper.kind === 'file' && (
              <div className="workspace-empty">
                <Icon name="file" size={40} />
                <p>Aperçu seulement : ce format n’est pas encore pris en charge.</p>
              </div>
            )}
          </div>

          <p className="open-sheet__hint chrome-pill" aria-hidden>
            <Kbd>Échap</Kbd> reposer sur le bureau · <Kbd>Ctrl</Kbd>+<Kbd>Entrée</Kbd> plein écran
          </p>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
