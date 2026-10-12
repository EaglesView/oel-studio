import { useState } from 'react';
import { Badge, Button, DialogOverlay, Icon, SheetDialog, Switch, Tab, TabList, TabPanel, Tabs } from '@oel/emboss';
import { questionsOf } from '../model/create';
import { cellText, toCsv } from '../model/sheet';
import { formatDate, responsesToday, summarize } from '../model/steps';
import type { FormDef, FormResponse } from '../model/types';
import { download } from './qr';
import { locale, plural, tr } from '@oel/i18n';

const nf = new Intl.NumberFormat(locale());

function ago(ts: number) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return tr('à l’instant', 'just now');
  if (m < 60) return tr(`il y a ${m} min`, `${m} min ago`);
  const h = Math.round(m / 60);
  if (h < 24) return tr(`il y a ${h} h`, `${h} h ago`);
  return h < 48 ? tr('hier', 'yesterday') : new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
}

/**
 * E2 · 6 Suivre les réponses: live summary per question, one by one, CSV
 * export, « Ouvrir le tableur » and closing answers in one gesture.
 * E8 · 4 Mises de côté: doubtful responses wait outside the sheet with their
 * reason; accepting adds them, deleting asks first.
 */
export function ResponsesTab({
  form,
  responses,
  onAccept,
  onDelete,
  onOpenSheet,
  onLinkSheet,
  onToggleAccept,
  onPublish,
}: {
  form: FormDef;
  responses: FormResponse[];
  onAccept: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenSheet: () => void;
  onLinkSheet: () => void;
  onToggleAccept: (v: boolean) => void;
  onPublish: () => void;
}) {
  const accepted = responses.filter((r) => r.status === 'accepted');
  const held = responses.filter((r) => r.status === 'held');
  const today = responsesToday(responses);
  const [index, setIndex] = useState(0);
  const [confirm, setConfirm] = useState<FormResponse | null>(null);
  const qs = questionsOf(form);
  const nameQ = qs.find((q) => q.type === 'short' && /nom|name/i.test(q.title));
  const who = (r: FormResponse) => (nameQ && cellText(nameQ, r.answers[nameQ.id])) || r.email || '(sans nom)';

  if (!form.publication) {
    return (
      <div className="fb-responses fb-responses--empty">
        <Icon name="share" size={32} />
        <h3>{tr('Pas encore de réponses', 'No responses yet')}</h3>
        <p>{form.link ? tr('Publiez le formulaire pour recevoir des réponses : elles arriveront ici et dans le tableur lié.', 'Publish the form to get responses: they will arrive here and in the linked spreadsheet.') : tr('Liez un tableur puis publiez : chaque réponse deviendra une ligne du tableur.', 'Link a spreadsheet, then publish: each response will become a row of the spreadsheet.')}</p>
        <div className="forms-dialog__row">
          {!form.link && (
            <Button leadingIcon="link" onPress={onLinkSheet}>
              {tr('Lier les réponses', 'Link the responses')}
            </Button>
          )}
          <Button variant="primary" leadingIcon="share" onPress={onPublish}>
            {tr('Publier', 'Publish')}
          </Button>
        </div>
      </div>
    );
  }

  const current = accepted[Math.min(index, accepted.length - 1)];

  return (
    <div className="fb-responses">
      <header className="fb-responses__head">
        <h3>
          {nf.format(accepted.length)} {plural(accepted.length, tr('réponse', 'response'), tr('réponses', 'responses'))}
        </h3>
        {today > 0 && <Badge tone="success">+{today} {tr('aujourd’hui', 'today')}</Badge>}
        <span className="fb-card__spacer" />
        <Switch isSelected={form.settings.acceptResponses} onChange={onToggleAccept}>
          {tr('Accepter les réponses', 'Accept responses')}
        </Switch>
        <Button leadingIcon="download" onPress={() => download(`${form.title || 'formulaire'}.csv`, `﻿${toCsv(form, responses)}`, 'text/csv')}>
          {tr('Exporter CSV', 'Export CSV')}
        </Button>
        {form.link && (
          <Button variant="primary" leadingIcon="table" onPress={onOpenSheet}>
            {tr('Ouvrir le tableur', 'Open the spreadsheet')}
          </Button>
        )}
      </header>

      <Tabs defaultSelectedKey="summary">
        <TabList aria-label={tr('Vues des réponses', 'Response views')}>
          <Tab id="summary">{tr('Résumé', 'Summary')}</Tab>
          <Tab id="one">{tr('Une par une', 'One by one')}</Tab>
          <Tab id="held">{tr('Mises de côté', 'Set aside')}{held.length ? ` · ${held.length}` : ''}</Tab>
        </TabList>

        <TabPanel id="summary" className="fb-summary">
          {accepted.length === 0 && <p className="emb-field__helper">{tr('Les réponses apparaîtront ici en direct, dès leur envoi.', 'Responses will show here live, as soon as they are sent.')}</p>}
          {summarize(form, responses).map((s) => {
            const max = Math.max(1, ...s.counts.map((c) => c.count));
            return (
              <section key={s.question.id} className="fb-summary__card" aria-label={s.question.title}>
                <h4>{s.question.title || tr('Question sans titre', 'Untitled question')}</h4>
                <p className="emb-field__helper">
                  {s.answered} {plural(s.answered, tr('réponse', 'response'), tr('réponses', 'responses'))}
                </p>
                {s.counts.length > 0 ? (
                  <ul className="fb-bars">
                    {s.counts.map((c) => (
                      <li key={c.label}>
                        <span className="fb-bars__label">{s.question.type === 'date' ? c.label : c.label}</span>
                        <span className="fb-bars__track" aria-hidden>
                          <span style={{ width: `${(c.count / max) * 100}%` }} />
                        </span>
                        <span className="fb-bars__n">{c.count}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="fb-samples">
                    {s.samples.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </TabPanel>

        <TabPanel id="one" className="fb-one">
          {current ? (
            <>
              <div className="fb-one__nav">
                <Button variant="ghost" size="icon-sm" leadingIcon="chevron-left" aria-label={tr('Réponse précédente', 'Previous response')} isDisabled={index <= 0} onPress={() => setIndex(index - 1)} />
                <span role="status">
                  {tr(`Réponse ${Math.min(index, accepted.length - 1) + 1} sur ${accepted.length}`, `Response ${Math.min(index, accepted.length - 1) + 1} of ${accepted.length}`)} · {ago(current.submittedAt)}
                </span>
                <Button variant="ghost" size="icon-sm" leadingIcon="chevron-right" aria-label={tr('Réponse suivante', 'Next response')} isDisabled={index >= accepted.length - 1} onPress={() => setIndex(index + 1)} />
                <span className="fb-card__spacer" />
                <Button variant="ghost" size="sm" leadingIcon="trash" onPress={() => setConfirm(current)}>
                  {tr('Supprimer', 'Delete')}
                </Button>
              </div>
              <dl className="form-review">
                {qs.map((q) => {
                  const v = cellText(q, current.answers[q.id]);
                  return (
                    <div key={q.id} className="form-review__row">
                      <dt>{q.title}</dt>
                      <dd>{q.type === 'date' && v ? formatDate(v) : v || '—'}</dd>
                    </div>
                  );
                })}
                {current.email && (
                  <div className="form-review__row">
                    <dt>{tr('Courriel du répondant', 'Respondent’s email')}</dt>
                    <dd>{current.email}</dd>
                  </div>
                )}
              </dl>
            </>
          ) : (
            <p className="emb-field__helper">{tr('Aucune réponse acceptée pour l’instant.', 'No accepted responses yet.')}</p>
          )}
        </TabPanel>

        <TabPanel id="held" className="fb-held">
          <p className="fb-held__intro">
            {held.length > 0 && <Badge tone="warning">{tr(`${held.length} à vérifier`, `${held.length} to check`)}</Badge>}{' '}
            {tr('Ces réponses ne sont pas dans le tableur tant que vous ne les acceptez pas. Rien n’est supprimé sans vous.', 'These responses are not in the spreadsheet until you accept them. Nothing is deleted without you.')}
          </p>
          {held.length === 0 && <p className="emb-field__helper">{tr('Aucune réponse mise de côté.', 'No responses set aside.')}</p>}
          <ul>
            {held.map((r) => (
              <li key={r.id} className="fb-held__row">
                <Badge appearance="stamp" tone="warning" dot={false}>
                  {tr('Douteuse', 'Doubtful')}
                </Badge>
                <div>
                  <strong>
                    {who(r)} · {ago(r.submittedAt)}
                  </strong>
                  <span>{r.heldReason}</span>
                </div>
                <Button size="sm" leadingIcon="check" onPress={() => onAccept(r.id)}>
                  {tr('Accepter', 'Accept')}
                </Button>
                <Button variant="ghost" size="sm" leadingIcon="trash" onPress={() => setConfirm(r)}>
                  {tr('Supprimer', 'Delete')}
                </Button>
              </li>
            ))}
          </ul>
        </TabPanel>
      </Tabs>

      <DialogOverlay isOpen={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <SheetDialog
          title={tr('Supprimer cette réponse ?', 'Delete this response?')}
          tone="destructive"
          actions={(close) => (
            <>
              <Button variant="ghost" onPress={close}>
                {tr('Annuler', 'Cancel')}
              </Button>
              <Button
                variant="destructive"
                onPress={() => {
                  if (confirm) onDelete(confirm.id);
                  close();
                }}
              >
                {tr('Supprimer', 'Delete')}
              </Button>
            </>
          )}
        >
          <p>
            {tr(`La réponse de ${confirm ? who(confirm) : ''} sera supprimée${confirm?.status === 'accepted' ? ' et sa ligne retirée du tableur' : ''}. Ses fichiers joints aussi.`, `The response from ${confirm ? who(confirm) : ''} will be deleted${confirm?.status === 'accepted' ? ' and its row removed from the spreadsheet' : ''}. Its attached files too.`)}
            {/* TODO(backend): offer to keep the attachments in the folder. */}
          </p>
        </SheetDialog>
      </DialogOverlay>
    </div>
  );
}
