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
import { tr } from '@oel/i18n';

const typeIcon = (t: QuestionType) => (QUESTION_TYPES.find((x) => x.type === t)?.icon ?? 'input') as IconName;
const typeLabel = (t: QuestionType) => QUESTION_TYPES.find((x) => x.type === t)?.label ?? t;
const IMAGE_LATER = tr('Les images arrivent avec le stockage des fichiers des formulaires (à brancher).', 'Images come with form file storage (to be connected).');

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
    setItems(next, tr('Ajout', 'Add'));
    select(item.id, true);
  };

  const move = (id: string, delta: -1 | 1) => {
    const i = items.findIndex((x) => x.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j]!, next[i]!];
    setItems(next, tr('Déplacement', 'Move'));
  };

  const remove = (id: string) => {
    const before = items;
    const it = items.find((x) => x.id === id);
    setItems(items.filter((x) => x.id !== id), tr('Suppression', 'Delete'));
    toast({
      title: tr(`${it && isQuestion(it) ? 'Question' : 'Élément'} supprimé${it && isQuestion(it) ? 'e' : ''}`, `${it && isQuestion(it) ? 'Question' : 'Item'} deleted`),
      description: form.link && it && isQuestion(it) ? tr('Sa colonne reste dans le tableur, marquée « archivée ».', 'Its column stays in the spreadsheet, marked “archived”.') : undefined,
      tone: 'info',
      action: { label: tr('Annuler', 'Undo'), onAction: () => setItems(before, tr('Annulation', 'Undo')) },
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
      <Outline items={items} numbers={numbers} selectedId={selectedId} onSelect={(id) => select(id, true)} onKeys={itemKeys} onReorder={(next) => setItems(next, tr('Déplacement', 'Move'))} />

      <div className="fb-canvas" ref={canvasRef}>
        <div className="fb-paper">
          <FormCover
            form={form}
            headingLevel={2}
            titleSlot={
              <Input aria-label={tr('Titre du formulaire', 'Form title')} className="fb-inline fb-inline--title" value={form.title} placeholder={tr('Titre du formulaire', 'Form title')} onChange={(e) => setForm({ title: e.target.value })} />
            }
            descriptionSlot={
              <TextArea
                aria-label={tr('Description du formulaire', 'Form description')}
                className="fb-inline fb-inline--desc"
                value={form.description}
                rows={2}
                placeholder={tr('Description courte : pourquoi on répond, combien de temps ça prend.', 'Short description: why answer, how long it takes.')}
                onChange={(e) => setForm({ description: e.target.value })}
              />
            }
          />
          <ol className="fb-items" aria-label={tr('Questions du formulaire', 'Form questions')}>
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
                    onText={() => insertAfter({ id: fid(), kind: 'text', title: tr('Titre', 'Title'), text: '' })}
                    onSection={() => insertAfter({ id: fid(), kind: 'section', title: tr('Nouvelle section', 'New section') })}
                    onImport={() => setImportOpen(true)}
                    canImport={sheets.length > 0}
                  />
                )}
              </li>
            ))}
          </ol>
          {items.length === 0 && (
            <div className="fb-empty">
              <p>{tr('Ce formulaire est vide.', 'This form is empty.')}</p>
              <Button variant="primary" leadingIcon="plus" onPress={() => insertAfter(newQuestion('short', ''), -1)}>
                {tr('Ajouter une question', 'Add a question')}
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
          setItems(next, tr('Import de colonnes', 'Column import'));
          if (qs[0]) select(qs[0].id, true);
          toast({ title: tr(`${qs.length} question${qs.length > 1 ? 's' : ''} ajoutée${qs.length > 1 ? 's' : ''}`, `${qs.length} question${qs.length > 1 ? 's' : ''} added`), tone: 'success' });
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
    <nav className="fb-outline" aria-label={tr('Plan des questions', 'Question outline')}>
      <p className="emb-t-overline" id="fb-outline-title">
        {tr('Questions', 'Questions')}
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
                <span>{q ? `${numbers.get(it.id)}. ${it.title || tr('Question sans titre', 'Untitled question')}` : it.title || (it.kind === 'section' ? tr('Section', 'Section') : tr('Titre et texte', 'Title and text'))}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="fb-outline__hint">{tr('Glisser pour réordonner ; Alt + ↑ / ↓ au clavier.', 'Drag to reorder; Alt + ↑ / ↓ with the keyboard.')}</p>
    </nav>
  );
}

/* ── Add rail (E1 · 3) ──────────────────────────────────────────────── */

function AddRail({ onAdd, onText, onSection, onImport, canImport }: { onAdd: (t: QuestionType) => void; onText: () => void; onSection: () => void; onImport: () => void; canImport: boolean }) {
  return (
    <div className="fb-rail">
      <Toolbar appearance="pill" orientation="vertical" aria-label={tr('Ajouter sous la question sélectionnée', 'Add below the selected question')}>
        <MenuTrigger>
          <ToolButton icon="plus" label={tr('Ajouter une question', 'Add a question')} description={tr('Le nouveau type s’insère juste dessous.', 'The new type goes just below.')} />
          <MenuPopover placement="end top">
            <Menu aria-label={tr('Type de question', 'Question type')} onAction={(k) => onAdd(k as QuestionType)}>
              {QUESTION_TYPES.map((t) => (
                <MenuItem key={t.type} id={t.type} icon={t.icon as IconName}>
                  {t.label}
                </MenuItem>
              ))}
            </Menu>
          </MenuPopover>
        </MenuTrigger>
        <ToolButton icon="text-block" label={tr('Titre et texte', 'Title and text')} description={tr('Un bloc d’explication, sans réponse.', 'A block of explanation, without an answer.')} onPress={onText} />
        <ToolButton icon="media" label="Image" unavailableReason={IMAGE_LATER} />
        <ToolButton icon="section" label={tr('Section', 'Section')} description={tr('Commence une nouvelle étape pour le répondant.', 'Starts a new step for the respondent.')} onPress={onSection} />
        <ToolButton
          icon="table"
          label={tr('Importer des colonnes', 'Import columns')}
          description={tr('Une question par colonne d’un tableur du bureau.', 'One question per column of a spreadsheet on the desk.')}
          unavailableReason={canImport ? undefined : tr('Aucun tableur sur le bureau.', 'No spreadsheet on the desk.')}
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
  const label = q ? tr(`Question ${number} : ${item.title || 'sans titre'}, ${typeLabel(q.type)}`, `Question ${number}: ${item.title || 'untitled'}, ${typeLabel(q.type)}`) : `${item.kind === 'section' ? tr('Section', 'Section') : tr('Titre et texte', 'Title and text')} : ${item.title}`;

  const tools = (
    <div className="fb-card__tools">
      {q ? (
        <Select aria-label={tr('Type de réponse', 'Answer type')} className="fb-card__type" selectedKey={q.type} onSelectionChange={(k) => onRetype(k as QuestionType)}>
          {QUESTION_TYPES.map((t) => (
            <SelectItem key={t.type} id={t.type} icon={t.icon as IconName}>
              {t.label}
            </SelectItem>
          ))}
        </Select>
      ) : (
        <Badge tone="neutral" dot={false}>{item.kind === 'section' ? tr('Section · nouvelle étape', 'Section · new step') : tr('Titre et texte', 'Title and text')}</Badge>
      )}
      <span className="fb-card__spacer" />
      {q && (
        <Switch isSelected={q.required} onChange={(v) => onPatch({ required: v })}>
          {tr('Obligatoire', 'Required')}
        </Switch>
      )}
      <Button variant="ghost" size="icon-sm" leadingIcon="copy" aria-label={tr('Dupliquer', 'Duplicate')} aria-keyshortcuts="Control+D" onPress={onDuplicate} />
      <Button variant="ghost" size="icon-sm" leadingIcon="trash" aria-label={tr('Supprimer', 'Delete')} onPress={onRemove} />
    </div>
  );

  let content: ReactNode;
  if (!selected) {
    content = q ? (
      <QuestionField question={resolved(q, sheets, taken)} value={undefined} onChange={() => {}} isDisabled renderFile={(fq) => <FilePreview q={fq} />} />
    ) : item.kind === 'section' ? (
      <p className="fb-card__section">{item.title || tr('Section', 'Section')}</p>
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
            aria-label={q ? tr('Intitulé de la question', 'Question wording') : tr('Titre', 'Title')}
            className="fb-inline fb-inline--q"
            value={item.title}
            placeholder={q ? tr('Question (tapez « / » pour choisir le type)', 'Question (type “/” to choose the type)') : item.kind === 'section' ? tr('Titre de la section', 'Section title') : tr('Titre', 'Title')}
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
              aria-label={tr('Type de question', 'Question type')}
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
            <Input aria-label={tr('Texte d’aide', 'Help text')} className="fb-inline fb-inline--help" value={q.help ?? ''} placeholder={tr('Texte d’aide (facultatif)', 'Help text (optional)')} onChange={(e) => onPatch({ help: e.target.value })} />
            <QuestionEditor q={q} form={form} sheets={sheets} taken={taken} onPatch={onPatch} />
          </>
        ) : item.kind === 'text' ? (
          <TextArea aria-label={tr('Texte', 'Text')} className="fb-inline fb-inline--desc" rows={3} value={item.text ?? ''} placeholder={tr('Texte (facultatif)', 'Text (optional)')} onChange={(e) => onPatch({ text: e.target.value })} />
        ) : (
          <p className="emb-field__helper">{tr('Le répondant voit une nouvelle étape à partir d’ici, avec ce titre dans la barre de progression.', 'The respondent sees a new step from here, with this title in the progress bar.')}</p>
        )}
      </>
    );
  }

  return (
    <div
      role="group"
      aria-label={label}
      aria-roledescription={tr('carte de question', 'question card')}
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
        {q.title || tr('Question sans titre', 'Untitled question')}
        {q.required && <span className="form-required"> *</span>}
      </p>
      {q.help && <p className="emb-field__helper">{q.help}</p>}
      <div className="form-file__drop emb-well is-disabled">
        <Icon name="upload" size={22} />
        <span>{tr('Glissez vos fichiers ici ou', 'Drag your files here or')}</span>
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
                  <Button variant="ghost" size="icon-sm" leadingIcon="close" aria-label={tr(`Retirer l’option ${c.label || i + 1}`, `Remove option ${c.label || i + 1}`)} isDisabled={q.choices!.length <= 1} onPress={() => onPatch({ choices: q.choices!.filter((x) => x.id !== c.id) })} />
                </>
              )}
            </li>
          ))}
          {q.allowOther && (
            <li className="fb-choice is-other">
              <span className={glyph} aria-hidden />
              <span className="fb-choice__label">{tr('Autre (texte libre)', 'Other (free text)')}</span>
            </li>
          )}
        </ul>
        {!fromRange && (
          <div className="fb-choices__add">
            <Button variant="ghost" size="sm" leadingIcon="plus" onPress={() => onPatch({ choices: [...q.choices!, { id: fid('c'), label: `Option ${q.choices!.length + 1}` }] })}>
              {tr('Ajouter une option', 'Add an option')}
            </Button>
            {!q.allowOther && (
              <Button variant="ghost" size="sm" onPress={() => onPatch({ allowOther: true })}>
                {tr('Ajouter « Autre »', 'Add “Other”')}
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
        <Input aria-label={tr('Exemple affiché dans le champ', 'Example shown in the field')} className="emb-well-input__control" value={q.placeholder ?? ''} placeholder={tr('Exemple affiché dans le champ (facultatif)', 'Example shown in the field (optional)')} onChange={(e) => onPatch({ placeholder: e.target.value })} />
      </div>
    );
  }
  return (
    <div className="fb-answer-preview emb-well-input is-disabled" aria-hidden>
      <span className="emb-well-input__control">{q.type === 'date' ? 'jj / mm / aaaa' : tr('Réponse longue', 'Long answer')}</span>
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
    <aside className="fb-inspector" aria-label={tr('Inspecteur de la question', 'Question inspector')}>
      {!q ? (
        <>
          <p className="emb-t-overline">{item ? (item.kind === 'section' ? tr('Section', 'Section') : tr('Titre et texte', 'Title and text')) : 'Question'}</p>
          <p className="emb-field__helper">{item ? tr('Pas de réponse : ce bloc n’a pas de colonne dans le tableur.', 'No answer: this block has no column in the spreadsheet.') : tr('Sélectionnez une question.', 'Select a question.')}</p>
        </>
      ) : (
        <>
          <p className="emb-t-overline">Question</p>
          <Select label={tr('Type de réponse', 'Answer type')} selectedKey={q.type} onSelectionChange={(k) => onRetype(k as QuestionType)}>
            {QUESTION_TYPES.map((t) => (
              <SelectItem key={t.type} id={t.type} icon={t.icon as IconName}>
                {t.label}
              </SelectItem>
            ))}
          </Select>
          <Switch isSelected={q.required} onChange={(v) => onPatch({ required: v })}>
            {tr('Obligatoire', 'Required')}
          </Switch>
          {q.choices && (
            <>
              <Switch isSelected={!!q.allowOther} onChange={(v) => onPatch({ allowOther: v })}>
                {tr('Ajouter « Autre » (texte libre)', 'Add “Other” (free text)')}
              </Switch>
              <Switch isSelected={!!q.hideFull} onChange={(v) => onPatch({ hideFull: v })}>
                {tr('Masquer les choix complets', 'Hide full choices')}
              </Switch>
            </>
          )}
          {q.file && (
            <fieldset className="forms-fieldset">
              <legend className="emb-t-overline">{tr('Fichiers acceptés', 'Accepted files')}</legend>
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
              <NumberField label={tr('Taille max par fichier (Mo)', 'Max size per file (MB)')} minValue={1} maxValue={100} value={q.file.maxSizeMb} onChange={(v) => Number.isFinite(v) && onPatch({ file: { ...q.file!, maxSizeMb: v } })} />
              <NumberField label={tr('Fichiers au plus', 'Files at most')} description={tr('Entre 1 et 10.', 'Between 1 and 10.')} minValue={1} maxValue={10} value={q.file.maxFiles} onChange={(v) => Number.isFinite(v) && onPatch({ file: { ...q.file!, maxFiles: v } })} />
            </fieldset>
          )}

          <p className="emb-t-overline">{tr('Données', 'Data')}</p>
          <div className="fb-data emb-well">
            {form.link ? (
              <>
                <p className="fb-data__head">
                  <strong>
                    {q.type === 'file'
                      ? tr(`Colonne ${form.link.filesColumn != null ? colLetter(form.link.filesColumn) : '—'} · Pièces jointes`, `Column ${form.link.filesColumn != null ? colLetter(form.link.filesColumn) : '—'} · Attachments`)
                      : col
                        ? tr(`Colonne ${colLetter(col.column)} · ${col.header}`, `Column ${colLetter(col.column)} · ${col.header}`)
                        : tr('Nouvelle colonne', 'New column')}
                  </strong>
                  <Badge tone="success">{tr('Lié', 'Linked')}</Badge>
                </p>
                <p>
                  {tr(`Réponses → ${form.link.tab} (feuille de « ${form.link.sheetTitle} »)`, `Responses → ${form.link.tab} (sheet of “${form.link.sheetTitle}”)`)}
                </p>
                {q.type === 'file' && form.link.filesFolder && <p>{tr(`Fichiers → dossier « ${form.link.filesFolder} », un sous-dossier par réponse.`, `Files → folder “${form.link.filesFolder}”, one subfolder per response.`)}</p>}
              </>
            ) : (
              <>
                <p className="fb-data__head">
                  <strong>{tr('Pas encore lié', 'Not linked yet')}</strong>
                  <Badge tone="warning">{tr('À lier', 'To link')}</Badge>
                </p>
                <p>{tr('Chaque question deviendra une colonne du tableur lié. Pas de tableur, pas de publication.', 'Each question will become a column of the linked spreadsheet. No spreadsheet, no publishing.')}</p>
                <Button size="sm" leadingIcon="link" onPress={onLinkSheet}>
                  {tr('Lier les réponses', 'Link the responses')}
                </Button>
              </>
            )}
            {q.choices && (
              <>
                {q.choiceSource && <p>{rangeLabel(q.choiceSource, sheets.find((s) => s.id === q.choiceSource!.sheetId)?.rows ?? [])}</p>}
                <div className="forms-dialog__row">
                  <Button variant="ghost" size="sm" leadingIcon="refresh" onPress={() => setSourceOpen(true)} isDisabled={!sheets.length}>
                    {q.choiceSource ? tr('Changer la source', 'Change the source') : tr('Choix depuis un tableur', 'Choices from a spreadsheet')}
                  </Button>
                  {q.choiceSource && (
                    <Button variant="ghost" size="sm" onPress={() => onPatch({ choiceSource: null })}>
                      {tr('Saisir les choix', 'Type the choices')}
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
  const cols = header.map((h, i) => ({ id: String(i), label: tr(`${colLetter(i)} · ${h || '(sans en-tête)'}`, `${colLetter(i)} · ${h || '(no header)'}`) }));
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={onOpenChange}>
      <SheetDialog
        title={tr('Choix depuis un tableur', 'Choices from a spreadsheet')}
        width={520}
        actions={(close) => (
          <>
            <Button variant="ghost" onPress={close}>
              {tr('Annuler', 'Undo')}
            </Button>
            <Button
              variant="primary"
              isDisabled={!src || !previewChoices.length}
              onPress={() => {
                onPatch({ choiceSource: src, choices: previewChoices.map((c) => ({ id: q.choices?.find((x) => x.label === c.label)?.id ?? fid('c'), label: c.label })) });
                close();
              }}
            >
              {tr('Utiliser cette plage', 'Use this range')}
            </Button>
          </>
        )}
      >
        <div className="forms-dialog">
          <p>{tr('Les choix et leurs places sont lus dans le tableur, en direct. Quand un choix n’a plus de place, il se grise chez le répondant.', 'Choices and their places are read live from the spreadsheet. When a choice has no places left, it greys out for the respondent.')}</p>
          <Select label={tr('Tableur', 'Spreadsheet')} selectedKey={sheetId} onSelectionChange={(k) => setSheetId(String(k))}>
            {sheets.map((s) => (
              <SelectItem key={s.id} id={s.id} icon="table">
                {s.title}
              </SelectItem>
            ))}
          </Select>
          <Select label={tr('Colonne des choix', 'Choices column')} selectedKey={String(labelCol)} onSelectionChange={(k) => setLabelCol(Number(k))} items={cols}>
            {(c) => <SelectItem id={c.id}>{c.label}</SelectItem>}
          </Select>
          <Select label={tr('Colonne des places (quota)', 'Places column (quota)')} selectedKey={quotaCol == null ? 'none' : String(quotaCol)} onSelectionChange={(k) => setQuotaCol(k === 'none' ? null : Number(k))} items={[{ id: 'none', label: tr('Pas de quota', 'No quota') }, ...cols]}>
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
        title={tr('Importer des colonnes', 'Import columns')}
        width={480}
        actions={(close) => (
          <>
            <Button variant="ghost" onPress={close}>
              {tr('Annuler', 'Undo')}
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
          <Select label={tr('Tableur', 'Spreadsheet')} selectedKey={sheetId} onSelectionChange={(k) => setSheetId(String(k))}>
            {sheets.map((s) => (
              <SelectItem key={s.id} id={s.id} icon="table">
                {s.title}
              </SelectItem>
            ))}
          </Select>
          <p className="emb-field__helper">{tr('Une question par colonne ; le type est deviné d’après l’en-tête et les valeurs.', 'One question per column; the type is guessed from the header and values.')}</p>
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
