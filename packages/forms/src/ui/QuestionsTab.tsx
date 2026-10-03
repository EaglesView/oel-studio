import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Input, TextArea } from 'react-aria-components';
import {
  Badge,
  Button,
  Checkbox,
  DialogOverlay,
  Icon,
  Menu,
  MenuItem,
  MenuPopover,
  MenuTrigger,
  NumberField,
  Select,
  SelectItem,
  SheetDialog,
  Switch,
  Toolbar,
  ToolButton,
  cx,
  toast,
  type IconName,
} from '@oel/emboss';
import { duplicateItem, fid, guessType, isQuestion, newQuestion, retype } from '../model/create';
import { choicesFromRange, colLetter, rangeLabel } from '../model/sheet';
import { FILE_FAMILIES, QUESTION_TYPES, type FileFamily, type FormDef, type FormItem, type Question, type QuestionType } from '../model/types';
import { acceptedLabel } from '../model/validate';
import { FormCover, QuestionField } from './FormView';
import type { SheetRef } from './LinkSheetDialog';

const typeIcon = (t: QuestionType) => (QUESTION_TYPES.find((x) => x.type === t)?.icon ?? 'input') as IconName;
const typeLabel = (t: QuestionType) => QUESTION_TYPES.find((x) => x.type === t)?.label ?? t;
const IMAGE_LATER = 'Les images arrivent avec le stockage des fichiers des formulaires (à brancher).';

export interface QuestionsTabProps {
  form: FormDef;
  setItems: (items: FormItem[], label?: string) => void;
  setForm: (patch: Partial<FormDef>) => void;
  sheets: SheetRef[];
  /** Places taken per question/choice label, from accepted responses. */
  taken: Record<string, Record<string, number>>;
  onLinkSheet: () => void;
  compact?: boolean;
}

/**
 * E1 · Constructeur: outline (left), the form paper (centre), an add rail that
 * follows the selected question, and the inspector (right). Click to select;
 * ↑ / ↓ move between questions, Alt + ↑ / ↓ reorder, Ctrl + D duplicates,
 * « / » in an empty question opens the type list.
 */
export function QuestionsTab({ form, setItems, setForm, sheets, taken, onLinkSheet, compact }: QuestionsTabProps) {
  const items = form.items;
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null);
  const [importOpen, setImportOpen] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const selIndex = selected ? items.indexOf(selected) : -1;

  useEffect(() => {
    if (selectedId && !items.some((i) => i.id === selectedId)) setSelectedId(items[Math.min(selIndex, items.length - 1)]?.id ?? null);
  }, [items, selectedId, selIndex]);

  const focusCard = (id: string) => requestAnimationFrame(() => canvasRef.current?.querySelector<HTMLElement>(`[data-item="${CSS.escape(id)}"]`)?.focus());

  const select = (id: string, focus = false) => {
    setSelectedId(id);
    if (focus) focusCard(id);
  };

  const patchItem = (id: string, patch: Partial<Question> | Partial<FormItem>) =>
    setItems(items.map((i) => (i.id === id ? ({ ...i, ...patch } as FormItem) : i)));

  const insertAfter = (item: FormItem, at = selIndex) => {
    const next = items.slice();
    next.splice(at < 0 ? items.length : at + 1, 0, item);
    setItems(next, 'Ajout');
    select(item.id, true);
  };

  const move = (id: string, delta: -1 | 1) => {
    const i = items.findIndex((x) => x.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j]!, next[i]!];
    setItems(next, 'Déplacement');
  };

  const remove = (id: string) => {
    const before = items;
    const it = items.find((x) => x.id === id);
    setItems(items.filter((x) => x.id !== id), 'Suppression');
    toast({
      title: `${it && isQuestion(it) ? 'Question' : 'Élément'} supprimé${it && isQuestion(it) ? 'e' : ''}`,
      description: form.link && it && isQuestion(it) ? 'Sa colonne reste dans le tableur, marquée « archivée ».' : undefined,
      tone: 'info',
      action: { label: 'Annuler', onAction: () => setItems(before, 'Annulation') },
    });
  };

  const duplicate = (id: string) => {
    const it = items.find((x) => x.id === id);
    if (it) insertAfter(duplicateItem(it), items.indexOf(it));
  };

  /** Keys shared by cards and outline rows. Returns true when handled. */
  const itemKeys = (e: KeyboardEvent, id: string, own: boolean): boolean => {
    const i = items.findIndex((x) => x.id === id);
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      move(id, e.key === 'ArrowUp' ? -1 : 1);
      requestAnimationFrame(() => (e.currentTarget as HTMLElement | null)?.focus?.());
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      duplicate(id);
      return true;
    }
    if (!own) return false;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const n = items[i + (e.key === 'ArrowUp' ? -1 : 1)];
      if (n) select(n.id, true);
      return true;
    }
    if (e.key === 'Delete') {
      e.preventDefault();
      remove(id);
      return true;
    }
    return false;
  };

  let n = 0;
  const numbers = new Map(items.filter(isQuestion).map((q) => [q.id, ++n]));

  return (
    <div className={cx('fb-questions', compact && 'is-compact')}>
      <Outline items={items} numbers={numbers} selectedId={selectedId} onSelect={(id) => select(id, true)} onKeys={itemKeys} onReorder={(next) => setItems(next, 'Déplacement')} />

      <div className="fb-canvas" ref={canvasRef}>
        <div className="fb-paper">
          <FormCover
            form={form}
            headingLevel={2}
            titleSlot={
              <Input aria-label="Titre du formulaire" className="fb-inline fb-inline--title" value={form.title} placeholder="Titre du formulaire" onChange={(e) => setForm({ title: e.target.value })} />
            }
            descriptionSlot={
              <TextArea
                aria-label="Description du formulaire"
                className="fb-inline fb-inline--desc"
                value={form.description}
                rows={2}
                placeholder="Description courte : pourquoi on répond, combien de temps ça prend."
                onChange={(e) => setForm({ description: e.target.value })}
              />
            }
          />
          <ol className="fb-items" aria-label="Questions du formulaire">
            {items.map((item) => (
              <li key={item.id} className="fb-items__li">
                <ItemCard
                  item={item}
                  number={numbers.get(item.id)}
                  selected={item.id === selectedId}
                  form={form}
                  sheets={sheets}
                  taken={taken}
                  onSelect={() => select(item.id)}
                  onPatch={(p) => patchItem(item.id, p)}
                  onRetype={(t) => isQuestion(item) && patchItem(item.id, retype(item, t))}
                  onDuplicate={() => duplicate(item.id)}
                  onRemove={() => remove(item.id)}
                  onKeyDown={(e) => itemKeys(e, item.id, e.target === e.currentTarget)}
                />
                {item.id === selectedId && (
                  <AddRail
                    onAdd={(t) => insertAfter(newQuestion(t, ''))}
                    onText={() => insertAfter({ id: fid(), kind: 'text', title: 'Titre', text: '' })}
                    onSection={() => insertAfter({ id: fid(), kind: 'section', title: 'Nouvelle section' })}
                    onImport={() => setImportOpen(true)}
                    canImport={sheets.length > 0}
                  />
                )}
              </li>
            ))}
          </ol>
          {items.length === 0 && (
            <div className="fb-empty">
              <p>Ce formulaire est vide.</p>
              <Button variant="primary" leadingIcon="plus" onPress={() => insertAfter(newQuestion('short', ''), -1)}>
                Ajouter une question
              </Button>
            </div>
          )}
        </div>
      </div>

      <Inspector form={form} item={selected} sheets={sheets} taken={taken} onPatch={(p) => selected && patchItem(selected.id, p)} onRetype={(t) => selected && isQuestion(selected) && patchItem(selected.id, retype(selected, t))} onLinkSheet={onLinkSheet} />

      <ImportColumnsDialog
        isOpen={importOpen}
        onOpenChange={setImportOpen}
        sheets={sheets}
        onImport={(qs) => {
          const next = items.slice();
          next.splice(selIndex < 0 ? items.length : selIndex + 1, 0, ...qs);
          setItems(next, 'Import de colonnes');
          if (qs[0]) select(qs[0].id, true);
          toast({ title: `${qs.length} question${qs.length > 1 ? 's' : ''} ajoutée${qs.length > 1 ? 's' : ''}`, tone: 'success' });
        }}
      />
    </div>
  );
}

/* ── Outline (E1 · 6) ───────────────────────────────────────────────── */

function Outline({
  items,
  numbers,
  selectedId,
  onSelect,
  onKeys,
  onReorder,
}: {
  items: FormItem[];
  numbers: Map<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onKeys: (e: KeyboardEvent, id: string, own: boolean) => boolean;
  onReorder: (items: FormItem[]) => void;
}) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  return (
    <nav className="fb-outline" aria-label="Plan des questions">
      <p className="emb-t-overline" id="fb-outline-title">
        Questions
      </p>
      <ul aria-labelledby="fb-outline-title">
        {items.map((it) => {
          const q = isQuestion(it) ? it : null;
          return (
            <li
              key={it.id}
              draggable
              onDragStart={(e) => {
                setDrag(it.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(it.id);
              }}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (!drag || drag === it.id) return;
                const next = items.filter((x) => x.id !== drag);
                next.splice(next.findIndex((x) => x.id === it.id), 0, items.find((x) => x.id === drag)!);
                onReorder(next);
                setDrag(null);
                setOver(null);
              }}
              className={cx(over === it.id && drag !== it.id && 'is-drop-target')}
            >
              <button
                type="button"
                className={cx('fb-outline__item', it.kind === 'section' && 'is-section', it.id === selectedId && 'is-current')}
                aria-current={it.id === selectedId || undefined}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                onClick={() => onSelect(it.id)}
                onKeyDown={(e) => onKeys(e, it.id, false)}
              >
                <Icon name={q ? (it.id === selectedId ? 'check' : typeIcon(q.type)) : it.kind === 'section' ? 'section' : 'text-block'} size={18} />
                <span>{q ? `${numbers.get(it.id)}. ${it.title || 'Question sans titre'}` : it.title || (it.kind === 'section' ? 'Section' : 'Titre et texte')}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="fb-outline__hint">Glisser pour réordonner ; Alt + ↑ / ↓ au clavier.</p>
    </nav>
  );
}

/* ── Add rail (E1 · 3) ──────────────────────────────────────────────── */

function AddRail({ onAdd, onText, onSection, onImport, canImport }: { onAdd: (t: QuestionType) => void; onText: () => void; onSection: () => void; onImport: () => void; canImport: boolean }) {
  return (
    <div className="fb-rail">
      <Toolbar appearance="pill" orientation="vertical" aria-label="Ajouter sous la question sélectionnée">
        <MenuTrigger>
          <ToolButton icon="plus" label="Ajouter une question" description="Le nouveau type s’insère juste dessous." />
          <MenuPopover placement="end top">
            <Menu aria-label="Type de question" onAction={(k) => onAdd(k as QuestionType)}>
              {QUESTION_TYPES.map((t) => (
                <MenuItem key={t.type} id={t.type} icon={t.icon as IconName}>
                  {t.label}
                </MenuItem>
              ))}
            </Menu>
          </MenuPopover>
        </MenuTrigger>
        <ToolButton icon="text-block" label="Titre et texte" description="Un bloc d’explication, sans réponse." onPress={onText} />
        <ToolButton icon="media" label="Image" unavailableReason={IMAGE_LATER} />
        <ToolButton icon="section" label="Section" description="Commence une nouvelle étape pour le répondant." onPress={onSection} />
        <ToolButton
          icon="table"
          label="Importer des colonnes"
          description="Une question par colonne d’un tableur du bureau."
          unavailableReason={canImport ? undefined : 'Aucun tableur sur le bureau.'}
          onPress={onImport}
        />
      </Toolbar>
    </div>
  );
}

/* ── Item card (E1 · 2) ─────────────────────────────────────────────── */

function ItemCard({
  item,
  number,
  selected,
  form,
  sheets,
  taken,
  onSelect,
  onPatch,
  onRetype,
  onDuplicate,
  onRemove,
  onKeyDown,
}: {
  item: FormItem;
  number?: number;
  selected: boolean;
  form: FormDef;
  sheets: SheetRef[];
  taken: Record<string, Record<string, number>>;
  onSelect: () => void;
  onPatch: (p: Partial<Question> | Partial<FormItem>) => void;
  onRetype: (t: QuestionType) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const [typeMenu, setTypeMenu] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const q = isQuestion(item) ? item : null;
  const label = q ? `Question ${number} : ${item.title || 'sans titre'}, ${typeLabel(q.type)}` : `${item.kind === 'section' ? 'Section' : 'Titre et texte'} : ${item.title}`;

  const tools = (
    <div className="fb-card__tools">
      {q ? (
        <Select aria-label="Type de réponse" className="fb-card__type" selectedKey={q.type} onSelectionChange={(k) => onRetype(k as QuestionType)}>
          {QUESTION_TYPES.map((t) => (
            <SelectItem key={t.type} id={t.type} icon={t.icon as IconName}>
              {t.label}
            </SelectItem>
          ))}
        </Select>
      ) : (
        <Badge tone="neutral" dot={false}>{item.kind === 'section' ? 'Section · nouvelle étape' : 'Titre et texte'}</Badge>
      )}
      <span className="fb-card__spacer" />
      {q && (
        <Switch isSelected={q.required} onChange={(v) => onPatch({ required: v })}>
          Obligatoire
        </Switch>
      )}
      <Button variant="ghost" size="icon-sm" leadingIcon="copy" aria-label="Dupliquer" aria-keyshortcuts="Control+D" onPress={onDuplicate} />
      <Button variant="ghost" size="icon-sm" leadingIcon="trash" aria-label="Supprimer" onPress={onRemove} />
    </div>
  );

  let content: ReactNode;
  if (!selected) {
    content = q ? (
      <QuestionField question={resolved(q, sheets, taken)} value={undefined} onChange={() => {}} isDisabled renderFile={(fq) => <FilePreview q={fq} />} />
    ) : item.kind === 'section' ? (
      <p className="fb-card__section">{item.title || 'Section'}</p>
    ) : (
      <div className="form-text-block">
        <h3>{item.title}</h3>
        {"text" in item && item.text && <p>{item.text}</p>}
      </div>
    );
  } else {
    content = (
      <>
        {tools}
        <Input
            ref={titleRef}
            aria-label={q ? 'Intitulé de la question' : 'Titre'}
            className="fb-inline fb-inline--q"
            value={item.title}
            placeholder={q ? 'Question (tapez « / » pour choisir le type)' : item.kind === 'section' ? 'Titre de la section' : 'Titre'}
            autoFocus={!item.title}
            onChange={(e) => onPatch({ title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === '/' && q && !item.title) {
                e.preventDefault();
                setTypeMenu(true);
              }
            }}
          />
        {typeMenu && (
          <MenuPopover placement="bottom start" triggerRef={titleRef} isOpen onOpenChange={setTypeMenu}>
            <Menu
              aria-label="Type de question"
              autoFocus="first"
              onAction={(k) => {
                onRetype(k as QuestionType);
                setTypeMenu(false);
                requestAnimationFrame(() => titleRef.current?.focus());
              }}
            >
              {QUESTION_TYPES.map((t) => (
                <MenuItem key={t.type} id={t.type} icon={t.icon as IconName}>
                  {t.label}
                </MenuItem>
              ))}
            </Menu>
          </MenuPopover>
        )}
        {q ? (
          <>
            <Input aria-label="Texte d’aide" className="fb-inline fb-inline--help" value={q.help ?? ''} placeholder="Texte d’aide (facultatif)" onChange={(e) => onPatch({ help: e.target.value })} />
            <QuestionEditor q={q} form={form} sheets={sheets} taken={taken} onPatch={onPatch} />
          </>
        ) : item.kind === 'text' ? (
          <TextArea aria-label="Texte" className="fb-inline fb-inline--desc" rows={3} value={item.text ?? ''} placeholder="Texte (facultatif)" onChange={(e) => onPatch({ text: e.target.value })} />
        ) : (
          <p className="emb-field__helper">Le répondant voit une nouvelle étape à partir d’ici, avec ce titre dans la barre de progression.</p>
        )}
      </>
    );
  }

  return (
    <div
      role="group"
      aria-label={label}
      aria-roledescription="carte de question"
      tabIndex={0}
      data-item={item.id}
      className={cx('fb-card', selected && 'is-selected', !q && `fb-card--${item.kind}`)}
      onFocus={(e) => !selected && e.target === e.currentTarget && onSelect()}
      onPointerDown={() => !selected && onSelect()}
      onKeyDown={onKeyDown}
    >
      {content}
    </div>
  );
}

/** Choices as the respondent would see them now (range labels + places left). */
function resolved(q: Question, sheets: SheetRef[], taken: Record<string, Record<string, number>>): Question {
  const src = q.choiceSource;
  const sheet = src ? sheets.find((s) => s.id === src.sheetId) : undefined;
  if (!src || !sheet) return q;
  const byLabel = new Map((q.choices ?? []).map((c) => [c.label, c.id]));
  return { ...q, choices: choicesFromRange(src, sheet.rows, taken[q.id]).map((c) => ({ id: byLabel.get(c.label) ?? c.label, label: c.label, remaining: c.remaining })) };
}

function FilePreview({ q }: { q: Question }) {
  const r = q.file!;
  return (
    <div className="form-q form-file">
      <p className="emb-field__label">
        {q.title || 'Question sans titre'}
        {q.required && <span className="form-required"> *</span>}
      </p>
      {q.help && <p className="emb-field__helper">{q.help}</p>}
      <div className="form-file__drop emb-well is-disabled">
        <Icon name="upload" size={22} />
        <span>Glissez vos fichiers ici ou</span>
        <span className="emb-button emb-button--secondary emb-button--sm" aria-hidden>
          Parcourir…
        </span>
        <span className="form-file__limits">
          {acceptedLabel(r.families)} · {r.maxSizeMb} Mo au plus par fichier · {r.maxFiles} fichier{r.maxFiles > 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}

/** Type-specific editing on the selected card. */
function QuestionEditor({ q, sheets, taken, onPatch }: { q: Question; form: FormDef; sheets: SheetRef[]; taken: Record<string, Record<string, number>>; onPatch: (p: Partial<Question>) => void }) {
  if (q.choices) {
    const view = resolved(q, sheets, taken);
    const fromRange = !!q.choiceSource && view !== q;
    const glyph = q.type === 'multiple' ? 'emb-check__box' : 'emb-radio__well';
    return (
      <div className="fb-choices">
        {fromRange && <p className="emb-field__helper">Les choix viennent du tableur ({rangeLabel(q.choiceSource!, sheets.find((s) => s.id === q.choiceSource!.sheetId)!.rows)}). Un choix complet se grise tout seul.</p>}
        <ul>
          {view.choices!.map((c, i) => (
            <li key={c.id} className={cx('fb-choice', c.remaining === 0 && 'is-full')}>
              <span className={glyph} aria-hidden />
              {fromRange ? (
                <span className="fb-choice__label">
                  {c.label}
                  {c.remaining != null && <em> · {c.remaining === 0 ? 'complet' : `${c.remaining} places`}</em>}
                </span>
              ) : (
                <>
                  <Input
                    aria-label={`Option ${i + 1}`}
                    className="fb-inline fb-choice__input"
                    value={c.label}
                    onChange={(e) => onPatch({ choices: q.choices!.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)) })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const nc = { id: fid('c'), label: '' };
                        const list = q.choices!.slice();
                        list.splice(i + 1, 0, nc);
                        onPatch({ choices: list });
                        requestAnimationFrame(() => (e.currentTarget.closest('ul')?.querySelectorAll('input')[i + 1] as HTMLInputElement | undefined)?.focus());
                      }
                    }}
                  />
                  <Button variant="ghost" size="icon-sm" leadingIcon="close" aria-label={`Retirer l’option ${c.label || i + 1}`} isDisabled={q.choices!.length <= 1} onPress={() => onPatch({ choices: q.choices!.filter((x) => x.id !== c.id) })} />
                </>
              )}
            </li>
          ))}
          {q.allowOther && (
            <li className="fb-choice is-other">
              <span className={glyph} aria-hidden />
              <span className="fb-choice__label">Autre (texte libre)</span>
            </li>
          )}
        </ul>
        {!fromRange && (
          <div className="fb-choices__add">
            <Button variant="ghost" size="sm" leadingIcon="plus" onPress={() => onPatch({ choices: [...q.choices!, { id: fid('c'), label: `Option ${q.choices!.length + 1}` }] })}>
              Ajouter une option
            </Button>
            {!q.allowOther && (
              <Button variant="ghost" size="sm" onPress={() => onPatch({ allowOther: true })}>
                Ajouter « Autre »
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }
  if (q.type === 'file') return <FilePreview q={{ ...q, title: '', help: '' }} />;
  if (q.type === 'short' || q.type === 'email' || q.type === 'number') {
    return (
      <div className="fb-answer-preview emb-well-input">
        <Input aria-label="Exemple affiché dans le champ" className="emb-well-input__control" value={q.placeholder ?? ''} placeholder="Exemple affiché dans le champ (facultatif)" onChange={(e) => onPatch({ placeholder: e.target.value })} />
      </div>
    );
  }
  return (
    <div className="fb-answer-preview emb-well-input is-disabled" aria-hidden>
      <span className="emb-well-input__control">{q.type === 'date' ? 'jj / mm / aaaa' : 'Réponse longue'}</span>
      {q.type === 'date' && <Icon name="calendar" size={18} />}
    </div>
  );
}

/* ── Inspector (E1 · right) ─────────────────────────────────────────── */

function Inspector({
  form,
  item,
  sheets,
  taken,
  onPatch,
  onRetype,
  onLinkSheet,
}: {
  form: FormDef;
  item: FormItem | null;
  sheets: SheetRef[];
  taken: Record<string, Record<string, number>>;
  onPatch: (p: Partial<Question>) => void;
  onRetype: (t: QuestionType) => void;
  onLinkSheet: () => void;
}) {
  const q = item && isQuestion(item) ? item : null;
  const col = q && form.link ? form.link.columns.find((c) => c.questionId === q.id) : null;
  const [sourceOpen, setSourceOpen] = useState(false);
  return (
    <aside className="fb-inspector" aria-label="Inspecteur de la question">
      {!q ? (
        <>
          <p className="emb-t-overline">{item ? (item.kind === 'section' ? 'Section' : 'Titre et texte') : 'Question'}</p>
          <p className="emb-field__helper">{item ? 'Pas de réponse : ce bloc n’a pas de colonne dans le tableur.' : 'Sélectionnez une question.'}</p>
        </>
      ) : (
        <>
          <p className="emb-t-overline">Question</p>
          <Select label="Type de réponse" selectedKey={q.type} onSelectionChange={(k) => onRetype(k as QuestionType)}>
            {QUESTION_TYPES.map((t) => (
              <SelectItem key={t.type} id={t.type} icon={t.icon as IconName}>
                {t.label}
              </SelectItem>
            ))}
          </Select>
          <Switch isSelected={q.required} onChange={(v) => onPatch({ required: v })}>
            Obligatoire
          </Switch>
          {q.choices && (
            <>
              <Switch isSelected={!!q.allowOther} onChange={(v) => onPatch({ allowOther: v })}>
                Ajouter « Autre » (texte libre)
              </Switch>
              <Switch isSelected={!!q.hideFull} onChange={(v) => onPatch({ hideFull: v })}>
                Masquer les choix complets
              </Switch>
            </>
          )}
          {q.file && (
            <fieldset className="forms-fieldset">
              <legend className="emb-t-overline">Fichiers acceptés</legend>
              {FILE_FAMILIES.map((f) => (
                <Checkbox
                  key={f.id}
                  isSelected={q.file!.families.includes(f.id)}
                  isDisabled={q.file!.families.length === 1 && q.file!.families.includes(f.id)}
                  onChange={(v) => onPatch({ file: { ...q.file!, families: v ? [...q.file!.families, f.id] : q.file!.families.filter((x: FileFamily) => x !== f.id) } })}
                >
                  {f.label}
                </Checkbox>
              ))}
              <NumberField label="Taille max par fichier (Mo)" minValue={1} maxValue={100} value={q.file.maxSizeMb} onChange={(v) => Number.isFinite(v) && onPatch({ file: { ...q.file!, maxSizeMb: v } })} />
              <NumberField label="Fichiers au plus" description="Entre 1 et 10." minValue={1} maxValue={10} value={q.file.maxFiles} onChange={(v) => Number.isFinite(v) && onPatch({ file: { ...q.file!, maxFiles: v } })} />
            </fieldset>
          )}

          <p className="emb-t-overline">Données</p>
          <div className="fb-data emb-well">
            {form.link ? (
              <>
                <p className="fb-data__head">
                  <strong>
                    {q.type === 'file'
                      ? `Colonne ${form.link.filesColumn != null ? colLetter(form.link.filesColumn) : '—'} · Pièces jointes`
                      : col
                        ? `Colonne ${colLetter(col.column)} · ${col.header}`
                        : 'Nouvelle colonne'}
                  </strong>
                  <Badge tone="success">Lié</Badge>
                </p>
                <p>
                  Réponses → {form.link.tab} (feuille de « {form.link.sheetTitle} »)
                </p>
                {q.type === 'file' && form.link.filesFolder && <p>Fichiers → dossier « {form.link.filesFolder} », un sous-dossier par réponse.</p>}
              </>
            ) : (
              <>
                <p className="fb-data__head">
                  <strong>Pas encore lié</strong>
                  <Badge tone="warning">À lier</Badge>
                </p>
                <p>Chaque question deviendra une colonne du tableur lié. Pas de tableur, pas de publication.</p>
                <Button size="sm" leadingIcon="link" onPress={onLinkSheet}>
                  Lier les réponses
                </Button>
              </>
            )}
            {q.choices && (
              <>
                {q.choiceSource && <p>{rangeLabel(q.choiceSource, sheets.find((s) => s.id === q.choiceSource!.sheetId)?.rows ?? [])}</p>}
                <div className="forms-dialog__row">
                  <Button variant="ghost" size="sm" leadingIcon="refresh" onPress={() => setSourceOpen(true)} isDisabled={!sheets.length}>
                    {q.choiceSource ? 'Changer la source' : 'Choix depuis un tableur'}
                  </Button>
                  {q.choiceSource && (
                    <Button variant="ghost" size="sm" onPress={() => onPatch({ choiceSource: null })}>
                      Saisir les choix
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
          {q.choices && <ChoiceSourceDialog isOpen={sourceOpen} onOpenChange={setSourceOpen} q={q} sheets={sheets} taken={taken} onPatch={onPatch} />}
        </>
      )}
    </aside>
  );
}

/* ── Choices from a range (E1 · 4) ──────────────────────────────────── */

function ChoiceSourceDialog({
  isOpen,
  onOpenChange,
  q,
  sheets,
  taken,
  onPatch,
}: {
  isOpen: boolean;
  onOpenChange: (o: boolean) => void;
  q: Question;
  sheets: SheetRef[];
  taken: Record<string, Record<string, number>>;
  onPatch: (p: Partial<Question>) => void;
}) {
  const [sheetId, setSheetId] = useState(q.choiceSource?.sheetId ?? sheets[0]?.id ?? '');
  const sheet = sheets.find((s) => s.id === sheetId);
  const header = sheet?.rows[0] ?? [];
  const [labelCol, setLabelCol] = useState(q.choiceSource?.labelColumn ?? 0);
  const [quotaCol, setQuotaCol] = useState<number | null>(q.choiceSource?.quotaColumn ?? (header.length > 1 ? 1 : null));
  const src = sheet ? { sheetId: sheet.id, sheetTitle: sheet.title, labelColumn: labelCol, quotaColumn: quotaCol, fromRow: 1 } : null;
  const previewChoices = src && sheet ? choicesFromRange(src, sheet.rows, taken[q.id]) : [];
  const cols = header.map((h, i) => ({ id: String(i), label: `${colLetter(i)} · ${h || '(sans en-tête)'}` }));
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={onOpenChange}>
      <SheetDialog
        title="Choix depuis un tableur"
        width={520}
        actions={(close) => (
          <>
            <Button variant="ghost" onPress={close}>
              Annuler
            </Button>
            <Button
              variant="primary"
              isDisabled={!src || !previewChoices.length}
              onPress={() => {
                onPatch({ choiceSource: src, choices: previewChoices.map((c) => ({ id: q.choices?.find((x) => x.label === c.label)?.id ?? fid('c'), label: c.label })) });
                close();
              }}
            >
              Utiliser cette plage
            </Button>
          </>
        )}
      >
        <div className="forms-dialog">
          <p>Les choix et leurs places sont lus dans le tableur, en direct. Quand un choix n’a plus de place, il se grise chez le répondant.</p>
          <Select label="Tableur" selectedKey={sheetId} onSelectionChange={(k) => setSheetId(String(k))}>
            {sheets.map((s) => (
              <SelectItem key={s.id} id={s.id} icon="table">
                {s.title}
              </SelectItem>
            ))}
          </Select>
          <Select label="Colonne des choix" selectedKey={String(labelCol)} onSelectionChange={(k) => setLabelCol(Number(k))} items={cols}>
            {(c) => <SelectItem id={c.id}>{c.label}</SelectItem>}
          </Select>
          <Select label="Colonne des places (quota)" selectedKey={quotaCol == null ? 'none' : String(quotaCol)} onSelectionChange={(k) => setQuotaCol(k === 'none' ? null : Number(k))} items={[{ id: 'none', label: 'Pas de quota' }, ...cols]}>
            {(c) => <SelectItem id={c.id}>{c.label}</SelectItem>}
          </Select>
          {src && sheet && <p className="emb-field__helper">{rangeLabel(src, sheet.rows)}</p>}
          <ul className="fb-source-preview">
            {previewChoices.slice(0, 8).map((c) => (
              <li key={c.label}>
                {c.label}
                {c.remaining != null && <em> · {c.remaining === 0 ? 'complet' : `${c.remaining} places`}</em>}
              </li>
            ))}
          </ul>
        </div>
      </SheetDialog>
    </DialogOverlay>
  );
}

/* ── Importer des colonnes ──────────────────────────────────────────── */

function ImportColumnsDialog({ isOpen, onOpenChange, sheets, onImport }: { isOpen: boolean; onOpenChange: (o: boolean) => void; sheets: SheetRef[]; onImport: (qs: Question[]) => void }) {
  const [sheetId, setSheetId] = useState(sheets[0]?.id ?? '');
  const sheet = sheets.find((s) => s.id === sheetId);
  const header = (sheet?.rows[0] ?? []).map((h, i) => ({ h: h.trim(), i })).filter((x) => x.h);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  useEffect(() => setPicked(new Set(header.map((x) => x.i))), [sheetId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={onOpenChange}>
      <SheetDialog
        title="Importer des colonnes"
        width={480}
        actions={(close) => (
          <>
            <Button variant="ghost" onPress={close}>
              Annuler
            </Button>
            <Button
              variant="primary"
              isDisabled={!picked.size}
              onPress={() => {
                const body = sheet!.rows.slice(1);
                onImport(header.filter((x) => picked.has(x.i)).map((x) => newQuestion(guessType(x.h, body.map((r) => r[x.i] ?? '')), x.h)));
                close();
              }}
            >
              Ajouter {picked.size} question{picked.size > 1 ? 's' : ''}
            </Button>
          </>
        )}
      >
        <div className="forms-dialog">
          <Select label="Tableur" selectedKey={sheetId} onSelectionChange={(k) => setSheetId(String(k))}>
            {sheets.map((s) => (
              <SelectItem key={s.id} id={s.id} icon="table">
                {s.title}
              </SelectItem>
            ))}
          </Select>
          <p className="emb-field__helper">Une question par colonne ; le type est deviné d’après l’en-tête et les valeurs.</p>
          {header.map((x) => (
            <Checkbox key={x.i} isSelected={picked.has(x.i)} onChange={(v) => setPicked((p) => (v ? new Set(p).add(x.i) : new Set([...p].filter((y) => y !== x.i))))}>
              {colLetter(x.i)} · {x.h}
            </Checkbox>
          ))}
        </div>
      </SheetDialog>
    </DialogOverlay>
  );
}
