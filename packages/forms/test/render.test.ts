// @vitest-environment happy-dom
/** Smoke test: every builder tab and the respondent page render without throwing. */
import { createElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createLink, registrationTemplate } from '../src/model';
import { createLocalBackend } from '../src/api/local';
import { SettingsTab } from '../src/ui/SettingsTab';
import { ResponsesTab } from '../src/ui/ResponsesTab';
import { QuestionsTab } from '../src/ui/QuestionsTab';
import { FormFiller } from '../src/ui/FormFiller';
import { FormBuilder } from '../src/ui/FormBuilder';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLElement;
const render = async (el: ReturnType<typeof createElement>) => {
  host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(el));
  return root;
};
afterEach(() => host?.remove());

const form = (() => {
  const f = registrationTemplate('Salon des créateurs');
  return { ...f, link: createLink(f, { id: 's', title: 'Budget', tab: 'Inscriptions' }), publication: { slug: 'x', url: 'http://x/f?s=x', publishedAt: 0, version: 1, dirty: false } };
})();
const noop = () => {};

describe('render', () => {
  it('Questions tab', async () => {
    await render(createElement(QuestionsTab, { form, setItems: noop, setForm: noop, sheets: [], taken: {}, onLinkSheet: noop }));
    expect(host.textContent).toContain('Atelier choisi');
    expect(host.querySelector('.fb-rail')).not.toBeNull();
  });
  it('Paramètres tab with live preview', async () => {
    await render(createElement(SettingsTab, { form: { ...form, appearance: { ...form.appearance, accent: '#F5C518' } }, setForm: noop }));
    expect(host.textContent).toContain('refusé');
    expect(host.textContent).toContain('Commencer');
  });
  it('Réponses tab', async () => {
    const responses = [
      { id: 'a', formId: form.id, answers: {}, email: null, submittedAt: Date.now(), updatedAt: Date.now(), status: 'accepted' as const },
      { id: 'b', formId: form.id, answers: {}, email: null, submittedAt: Date.now(), updatedAt: Date.now(), status: 'held' as const, heldReason: 'Courriel non vérifiable' },
    ];
    await render(createElement(ResponsesTab, { form, responses, onAccept: noop, onDelete: noop, onOpenSheet: noop, onLinkSheet: noop, onToggleAccept: noop, onPublish: noop }));
    expect(host.textContent).toContain('1 réponse');
    expect(host.textContent).toContain('+1 aujourd’hui');
  });
  it('respondent page', async () => {
    await render(createElement(FormFiller, { backend: null, slug: 'x', published: { form, acceptedCount: 0, taken: {}, ranges: {} }, preview: true }));
    expect(host.textContent).toContain('Aperçu');
    expect(host.textContent).toContain('Propulsé par');
  });
  it('builder shell', async () => {
    const backend = createLocalBackend({ origin: 'http://x', latency: 0 });
    await render(createElement(FormBuilder, { form, onChange: noop, backend, sheets: [], onCreateSheet: () => ({ id: 's', title: 't', tab: 'r', rows: [] }), onOpenSheet: noop }));
    expect(host.textContent).toContain('Réponses · 0');
  });
});
