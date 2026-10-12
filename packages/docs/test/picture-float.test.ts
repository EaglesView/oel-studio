// @vitest-environment happy-dom
/**
 * The picture bar (L-7) mounts inside the editor canvas, not on document.body: in the desk the
 * document is a react-aria modal and anything outside it is inert.
 */
import { it, expect } from 'vitest';
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { docsExtensions } from '../src/extensions';
import { useToolbarState } from '../src/ui/DocsToolbar';
import { PictureFloat } from '../src/ui/Floats';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

it('picture bar mounts inside the canvas, one toolbar', async () => {
  const e = new Editor({ element: document.createElement('div'), extensions: docsExtensions({ pagination: false }), content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'image', attrs: { src: 'media:word/media/x.png', path: 'word/media/x.png', cx: 1000000, cy: 1000000 } }] }] } });
  let pos = -1;
  e.state.doc.descendants((n, p) => { if (n.type.name === 'image') pos = p; });
  const canvas = document.createElement('div'); canvas.className = 'canvas'; document.body.append(canvas);
  canvas.append(e.view.dom);
  let retouched = false;
  function T() {
    const st = useToolbarState(e as any, [], { fontFamily: 'Arial', fontSize: '11pt' });
    return st?.pictureAt != null ? h(PictureFloat, { editor: e as any, scroller: canvas, editable: true, actions: { onRetouch: () => (retouched = true), onReplace() {}, onAlt() {} } }) : null;
  }
  const root = document.createElement('div'); document.body.append(root);
  await act(async () => createRoot(root).render(h(T)));
  expect(canvas.querySelector('.oel-docfloat')).toBeNull();
  await act(async () => { e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, pos))); });
  const bar = canvas.querySelector('.oel-docfloat');
  expect(bar).not.toBeNull();
  expect(bar!.querySelectorAll('[role=toolbar]').length).toBe(1);
  const btn = [...bar!.querySelectorAll('button')].find((b) => b.textContent?.includes('Retoucher'))!;
  expect(btn).toBeTruthy();
  await act(async () => btn.click());
  expect(retouched).toBe(true);
  e.destroy();
});
