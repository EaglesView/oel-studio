import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog, Modal, ModalOverlay } from 'react-aria-components';
import { Badge, Button, Tab, TabList, TabPanel, Tabs, Toolbar, ToolbarToggle, cx, toast } from '@oel/emboss';
import type { Account, FormsBackend, PublishedForm } from '../api/backend';
import { questionsOf } from '../model/create';
import { cellText, createLink, syncLink } from '../model/sheet';
import type { FormDef, FormItem, FormResponse, SheetLink } from '../model/types';
import { FormFiller } from './FormFiller';
import { LinkSheetDialog, type LinkChoice, type SheetRef } from './LinkSheetDialog';
import { PublishDialog } from './PublishDialog';
import { QuestionsTab } from './QuestionsTab';
import { ResponsesTab } from './ResponsesTab';
import { SettingsTab } from './SettingsTab';
import { SignInDialog } from './SignInDialog';
import { tr } from '@oel/i18n';

export interface FormBuilderProps {
  form: FormDef;
  /** Every edit. The host stores it (desk paper) and decides about undo. */
  onChange: (form: FormDef) => void;
  backend: FormsBackend;
  /** Spreadsheets the host can link to or read choices from. */
  sheets: SheetRef[];
  /** Create the spreadsheet that receives the responses; the host draws the thread. */
  onCreateSheet: (title: string, header: string[]) => SheetRef;
  /** « Ouvrir le tableur » — open the linked sheet in place. */
  onOpenSheet: (sheetId: string) => void;
  /** Level 2 (ouvert sur place): no outline, narrower inspector. */
  compact?: boolean;
}

type Flow = null | 'link' | 'signin' | 'publish';
type TabKey = 'questions' | 'responses' | 'settings';

function savedLabel(ts: number, now: number) {
  const m = Math.floor((now - ts) / 60000);
  return m < 1 ? tr('Enregistré', 'Saved') : tr(`Enregistré il y a ${m} min`, `Saved ${m} min ago`);
}

/**
 * E1 · Constructeur: three tabs like Google Forms — Questions · Réponses ·
 * Paramètres — with the response count always visible, « Aperçu » (the
 * respondent's view, nothing is sent) and « Publier ».
 *
 * Publishing asks only for what is missing, in order: a linked sheet (« pas
 * de tableur, pas de publication »), then an account (E6), then the rules.
 */
export function FormBuilder({ form, onChange, backend, sheets, onCreateSheet, onOpenSheet, compact }: FormBuilderProps) {
  const [tab, setTab] = useState<TabKey>('questions');
  const [flow, setFlow] = useState<Flow>(null);
  /** The link dialog was opened by « Publier »: continue to publishing after it. */
  const [publishAfterLink, setPublishAfterLink] = useState(false);
  const [account, setAccount] = useState<Account | null>(() => backend.account());
  const [responses, setResponses] = useState<FormResponse[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => backend.onAccountChange(setAccount), [backend]);
  useEffect(() => backend.watchResponses(form.id, setResponses), [backend, form.id]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  /** All edits go through here: timestamp, « modifications non publiées », sheet columns in step. */
  const commit = useCallback(
    (next: FormDef) => {
      const link = next.link ? syncLink(next, next.link) : null;
      onChange({ ...next, link, updatedAt: Date.now(), publication: next.publication ? { ...next.publication, dirty: true } : null });
    },
    [onChange],
  );
  const setForm = (patch: Partial<FormDef>) => commit({ ...form, ...patch });
  const setItems = (items: FormItem[]) => commit({ ...form, items });

  const taken = useMemo(() => {
    const t: Record<string, Record<string, number>> = {};
    for (const q of questionsOf(form)) {
      if (!q.choices) continue;
      const m: Record<string, number> = {};
      for (const r of responses) if (r.status === 'accepted') for (const l of cellText(q, r.answers[q.id]).split(', ').filter(Boolean)) m[l] = (m[l] ?? 0) + 1;
      t[q.id] = m;
    }
    return t;
  }, [form, responses]);

  const accepted = responses.filter((r) => r.status === 'accepted').length;
  const held = responses.length - accepted;

  // ── Linking (E2 · 3) ─────────────────────────────────────────────
  const link = (choice: LinkChoice) => {
    const sheet = choice.target.kind === 'new' ? onCreateSheet(choice.target.title, []) : choice.target.sheet;
    const base = createLink(form, { id: sheet.id, title: sheet.title, tab: sheet.tab, header: sheet.rows[0] ?? [] });
    const l: SheetLink = { ...base, columns: base.columns.map((c) => ({ ...c, column: choice.columns[c.questionId] ?? c.column })) };
    commit({ ...form, link: l });
    toast({ title: tr('Réponses liées', 'Linked responses'), description: tr(`Chaque réponse ajoutera une ligne à « ${sheet.title} ».`, `Each response will add a row to “${sheet.title}”.`), tone: 'success' });
    setFlow(publishAfterLink ? (account ? 'publish' : 'signin') : null);
    setPublishAfterLink(false);
  };

  // ── Publishing (E2 · 5, E6) ──────────────────────────────────────
  const startPublish = () => {
    setPublishAfterLink(false);
    if (!form.link) {
      setPublishAfterLink(true);
      return setFlow('link');
    }
    setFlow(account ? 'publish' : 'signin');
  };
  const onSignedIn = useCallback(
    (a: Account) => {
      setAccount(a);
      toast({ title: tr('Connecté', 'Connected'), description: a.email, tone: 'success' });
      setFlow('publish');
    },
    [],
  );
  const publish = async () => {
    const publication = await backend.publish(form);
    onChange({ ...form, publication });
    toast({ title: form.publication ? tr('Modifications publiées', 'Changes published') : tr('Formulaire publié', 'Form published'), description: publication.url, tone: 'success' });
  };

  const pub = form.publication;
  const published: PublishedForm = useMemo(() => ({ form, acceptedCount: accepted, taken, ranges: Object.fromEntries(sheets.map((s) => [s.id, s.rows])) }), [form, accepted, taken, sheets]);

  return (
    <div className={cx('fb', compact && 'is-compact')}>
      <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(k as TabKey)} className="fb-tabs">
        <div className="fb-bar">
          <p className="fb-bar__saved" role="status">
            {savedLabel(form.updatedAt, now)}
            {pub && (pub.dirty ? <Badge tone="warning">{tr('Modifications non publiées', 'Unpublished changes')}</Badge> : <Badge tone="success">{tr('En ligne', 'Online')}</Badge>)}
          </p>
          <TabList aria-label={tr('Constructeur de formulaire', 'Form builder')} className="fb-bar__tabs">
            <Tab id="questions">{tr('Questions', 'Questions')}</Tab>
            <Tab id="responses">
              {tr('Réponses', 'Responses')} · {accepted}
              {held > 0 && <span className="fb-bar__held" aria-label={tr(`, ${held} mises de côté`, `, ${held} set aside`)}> (+{held})</span>}
            </Tab>
            <Tab id="settings">{tr('Paramètres', 'Settings')}</Tab>
          </TabList>
          <div className="fb-bar__actions">
            <Button size="sm" leadingIcon="eye" onPress={() => setPreviewOpen(true)}>
              {tr('Aperçu', 'Preview')}
            </Button>
            <Button size="sm" variant="primary" leadingIcon="share" onPress={startPublish}>
              {pub ? (pub.dirty ? tr('Republier', 'Republish') : tr('Publié', 'Published')) : tr('Publier', 'Publish')}
            </Button>
          </div>
        </div>

        <TabPanel id="questions" className="fb-panel">
          <QuestionsTab form={form} setItems={setItems} setForm={setForm} sheets={sheets} taken={taken} onLinkSheet={() => {
              setPublishAfterLink(false);
              setFlow('link');
            }} compact={compact} />
        </TabPanel>
        <TabPanel id="responses" className="fb-panel">
          <ResponsesTab
            form={form}
            responses={responses}
            onAccept={(id) => void backend.acceptHeld(form.id, id)}
            onDelete={(id) => void backend.deleteResponse(form.id, id)}
            onOpenSheet={() => form.link && onOpenSheet(form.link.sheetId)}
            onLinkSheet={() => setFlow('link')}
            onToggleAccept={(v) => {
              // Closing or reopening answers applies at once to the live form (no republish needed).
              onChange({ ...form, settings: { ...form.settings, acceptResponses: v } });
              void backend.setAccepting(form.id, v);
              toast({ title: v ? tr('Réponses ouvertes', 'Responses open') : tr('Réponses fermées', 'Responses closed'), description: v ? undefined : tr('Le lien affiche « Ce formulaire n’accepte plus de réponses ».', 'The link shows “This form no longer accepts responses”.'), tone: 'info' });
            }}
            onPublish={startPublish}
          />
        </TabPanel>
        <TabPanel id="settings" className="fb-panel">
          <SettingsTab form={form} setForm={setForm} />
        </TabPanel>
      </Tabs>

      <LinkSheetDialog
        key={flow === 'link' ? 'open' : 'closed'}
        form={form}
        sheets={sheets}
        isOpen={flow === 'link'}
        onOpenChange={(o) => {
          // « Lier » closes the dialog after moving the flow on: only « Plus tard » / Échap cancel.
          if (!o) setFlow((f) => (f === 'link' ? null : f));
        }}
        onLink={link}
        reason={publishAfterLink ? tr('Pas de tableur, pas de publication : liez d’abord le formulaire à l’endroit où ranger les réponses.', 'No spreadsheet, no publishing: first link the form to where the responses go.') : undefined}
      />
      <SignInDialog backend={backend} isOpen={flow === 'signin'} onOpenChange={(o) => !o && setFlow(null)} onSignedIn={onSignedIn} />
      {account && (
        <PublishDialog
          form={form}
          account={account}
          isOpen={flow === 'publish'}
          onOpenChange={(o) => !o && setFlow(null)}
          onSettings={(settings) => commit({ ...form, settings })}
          onPublish={publish}
          onSignOut={() => {
            void backend.signOut();
            setFlow(null);
          }}
        />
      )}

      <PreviewOverlay isOpen={previewOpen} onOpenChange={setPreviewOpen} published={published} />
    </div>
  );
}

/** E1 · 5 Aperçu = vue du répondant, ordinateur ou mobile. Rien n’est envoyé. */
function PreviewOverlay({ isOpen, onOpenChange, published }: { isOpen: boolean; onOpenChange: (o: boolean) => void; published: PublishedForm }) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable className="fb-preview-overlay">
      <Modal className="fb-preview-modal">
        <Dialog aria-label={tr('Aperçu du formulaire', 'Form preview')} className="fb-preview">
          {({ close }) => (
            <>
              <div className="fb-preview__bar">
                <strong>{tr('Aperçu', 'Preview')}</strong>
                <Toolbar appearance="pill" aria-label={tr('Appareil', 'Device')}>
                  <ToolbarToggle icon="laptop" label={tr('Ordinateur', 'Computer')} isSelected={device === 'desktop'} onChange={() => setDevice('desktop')} />
                  <ToolbarToggle icon="phone" label={tr('Mobile', 'Mobile')} isSelected={device === 'mobile'} onChange={() => setDevice('mobile')} />
                </Toolbar>
                <Button size="sm" leadingIcon="close" onPress={close}>
                  {tr('Fermer l’aperçu', 'Close the preview')}
                </Button>
              </div>
              <div className={cx('fb-preview__stage fb-device', `fb-device--${device}`)}>
                <FormFiller key={device} backend={null} slug="apercu" published={published} preview />
              </div>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
