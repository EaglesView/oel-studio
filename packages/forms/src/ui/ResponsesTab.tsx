import { useState } from 'react';
import { Badge, Button, DialogOverlay, Icon, SheetDialog, Switch, Tab, TabList, TabPanel, Tabs } from '@oel/emboss';
import { questionsOf } from '../model/create';
import { cellText, toCsv } from '../model/sheet';
import { formatDate, responsesToday, summarize } from '../model/steps';
import type { FormDef, FormResponse } from '../model/types';
import { download } from './qr';

const nf = new Intl.NumberFormat('fr-CA');

function ago(ts: number) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'à l’instant';
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return h < 48 ? 'hier' : new Date(ts).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
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
        <h3>Pas encore de réponses</h3>
        <p>{form.link ? 'Publiez le formulaire pour recevoir des réponses : elles arriveront ici et dans le tableur lié.' : 'Liez un tableur puis publiez : chaque réponse deviendra une ligne du tableur.'}</p>
        <div className="forms-dialog__row">
          {!form.link && (
            <Button leadingIcon="link" onPress={onLinkSheet}>
              Lier les réponses
            </Button>
          )}
          <Button variant="primary" leadingIcon="share" onPress={onPublish}>
            Publier
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
          {nf.format(accepted.length)} réponse{accepted.length > 1 ? 's' : ''}
        </h3>
        {today > 0 && <Badge tone="success">+{today} aujourd’hui</Badge>}
        <span className="fb-card__spacer" />
        <Switch isSelected={form.settings.acceptResponses} onChange={onToggleAccept}>
          Accepter les réponses
        </Switch>
        <Button leadingIcon="download" onPress={() => download(`${form.title || 'formulaire'}.csv`, `﻿${toCsv(form, responses)}`, 'text/csv')}>
          Exporter CSV
        </Button>
        {form.link && (
          <Button variant="primary" leadingIcon="table" onPress={onOpenSheet}>
            Ouvrir le tableur
          </Button>
        )}
      </header>

      <Tabs defaultSelectedKey="summary">
        <TabList aria-label="Vues des réponses">
          <Tab id="summary">Résumé</Tab>
          <Tab id="one">Une par une</Tab>
          <Tab id="held">Mises de côté{held.length ? ` · ${held.length}` : ''}</Tab>
        </TabList>

        <TabPanel id="summary" className="fb-summary">
          {accepted.length === 0 && <p className="emb-field__helper">Les réponses apparaîtront ici en direct, dès leur envoi.</p>}
          {summarize(form, responses).map((s) => {
            const max = Math.max(1, ...s.counts.map((c) => c.count));
            return (
              <section key={s.question.id} className="fb-summary__card" aria-label={s.question.title}>
                <h4>{s.question.title || 'Question sans titre'}</h4>
                <p className="emb-field__helper">
                  {s.answered} réponse{s.answered > 1 ? 's' : ''}
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
                <Button variant="ghost" size="icon-sm" leadingIcon="chevron-left" aria-label="Réponse précédente" isDisabled={index <= 0} onPress={() => setIndex(index - 1)} />
                <span role="status">
                  Réponse {Math.min(index, accepted.length - 1) + 1} sur {accepted.length} · {ago(current.submittedAt)}
                </span>
                <Button variant="ghost" size="icon-sm" leadingIcon="chevron-right" aria-label="Réponse suivante" isDisabled={index >= accepted.length - 1} onPress={() => setIndex(index + 1)} />
                <span className="fb-card__spacer" />
                <Button variant="ghost" size="sm" leadingIcon="trash" onPress={() => setConfirm(current)}>
                  Supprimer
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
                    <dt>Courriel du répondant</dt>
                    <dd>{current.email}</dd>
                  </div>
                )}
              </dl>
            </>
          ) : (
            <p className="emb-field__helper">Aucune réponse acceptée pour l’instant.</p>
          )}
        </TabPanel>

        <TabPanel id="held" className="fb-held">
          <p className="fb-held__intro">
            {held.length > 0 && <Badge tone="warning">{held.length} à vérifier</Badge>} Ces réponses ne sont pas dans le tableur tant que vous ne les acceptez pas. Rien n’est supprimé sans vous.
          </p>
          {held.length === 0 && <p className="emb-field__helper">Aucune réponse mise de côté.</p>}
          <ul>
            {held.map((r) => (
              <li key={r.id} className="fb-held__row">
                <Badge appearance="stamp" tone="warning" dot={false}>
                  Douteuse
                </Badge>
                <div>
                  <strong>
                    {who(r)} · {ago(r.submittedAt)}
                  </strong>
                  <span>{r.heldReason}</span>
                </div>
                <Button size="sm" leadingIcon="check" onPress={() => onAccept(r.id)}>
                  Accepter
                </Button>
                <Button variant="ghost" size="sm" leadingIcon="trash" onPress={() => setConfirm(r)}>
                  Supprimer
                </Button>
              </li>
            ))}
          </ul>
        </TabPanel>
      </Tabs>

      <DialogOverlay isOpen={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <SheetDialog
          title="Supprimer cette réponse ?"
          tone="destructive"
          actions={(close) => (
            <>
              <Button variant="ghost" onPress={close}>
                Annuler
              </Button>
              <Button
                variant="destructive"
                onPress={() => {
                  if (confirm) onDelete(confirm.id);
                  close();
                }}
              >
                Supprimer
              </Button>
            </>
          )}
        >
          <p>
            La réponse de {confirm ? who(confirm) : ''} sera supprimée{confirm?.status === 'accepted' ? ' et sa ligne retirée du tableur' : ''}. Ses fichiers joints aussi.
            {/* TODO(backend): offer to keep the attachments in the folder. */}
          </p>
        </SheetDialog>
      </DialogOverlay>
    </div>
  );
}
