import type { CSSProperties, ReactNode } from 'react';
import { Checkbox, CheckboxGroup, Label, Text } from 'react-aria-components';
import { Icon, Radio, RadioGroup, Select, SelectItem, TextField, cx } from '@oel/emboss';
import { accentVars } from '../model/contrast';
import type { AnswerValue, Appearance, Choice, FormDef, Question } from '../model/types';
import { tr } from '@oel/i18n';

/** Root style of a form surface: accent variables + title font (E5 · Personnalisable). */
export function formStyle(a: Appearance): CSSProperties {
  return accentVars(a.accent) as CSSProperties;
}

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || 'OEL';

/** Form/Cover (kit 111:5904): the band takes the accent (or the cover image); everything else stays OEL. */
export function FormCover({
  form,
  subtitle,
  titleSlot,
  descriptionSlot,
  headingLevel = 1,
}: {
  form: Pick<FormDef, 'title' | 'description' | 'organiser' | 'appearance'>;
  subtitle?: ReactNode;
  /** Builder: editable title instead of the heading. */
  titleSlot?: ReactNode;
  descriptionSlot?: ReactNode;
  headingLevel?: 1 | 2;
}) {
  const a = form.appearance;
  const H = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <header className={cx('form-cover', a.titleFont === 'noto-serif' && 'is-serif')}>
      <div className="form-cover__band" style={a.coverUrl ? { backgroundImage: `url(${a.coverUrl})` } : undefined}>
        <span className="form-cover__logo" aria-hidden={!a.logoUrl}>
          {a.logoUrl ? <img src={a.logoUrl} alt={tr(`Logo · ${form.organiser || form.title}`, `Logo · ${form.organiser || form.title}`)} /> : initialsOf(form.organiser || form.title)}
        </span>
      </div>
      <div className="form-cover__intro">
        {titleSlot ?? <H className="form-cover__title">{form.title || tr('Formulaire sans titre', 'Untitled form')}</H>}
        {subtitle && <p className="form-cover__subtitle">{subtitle}</p>}
        {descriptionSlot ?? (form.description ? <p className="form-cover__desc">{form.description}</p> : null)}
      </div>
    </header>
  );
}

/** E3 · 6 Pied de page fixe: the organiser cannot remove it. */
export function FormFooter({ organiser }: { organiser: string }) {
  return (
    <footer className="form-footer">
      <Icon name="form" size={14} />
      <span>
        {tr('Propulsé par', 'Powered by')} <a href="/">OutilsEnLigne</a> · {tr('Les réponses vont à', 'Responses go to')} {organiser ? <strong>{organiser}</strong> : tr('l’organisateur', 'the organizer')} ·{' '}
        {/* TODO(backend): real privacy page and abuse report endpoint (with the form slug). */}
        <a href="/confidentialite">{tr('Confidentialité', 'Privacy')}</a> · <a href="mailto:abus@outilsenligne.ca?subject=Signaler%20un%20formulaire">{tr('Signaler un abus', 'Report abuse')}</a>
      </span>
    </footer>
  );
}

function choiceLabel(c: Choice) {
  if (c.remaining == null) return c.label;
  if (c.remaining === 0) return `${c.label} · complet`;
  return `${c.label} · ${c.remaining} place${c.remaining > 1 ? 's' : ''} restante${c.remaining > 1 ? 's' : ''}`;
}

export const OTHER = '__autre__';

export interface QuestionFieldProps {
  question: Question;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue) => void;
  onBlur?: () => void;
  error?: string;
  /** Builder canvas: rendered but not interactive. */
  isDisabled?: boolean;
  /** Free-text value of « Autre ». */
  other?: string;
  onOtherChange?: (v: string) => void;
  /** File questions are rendered by the host (they need the backend). */
  renderFile?: (q: Question) => ReactNode;
}

/**
 * One question, answered with the kit's own fields: a respondent recognises an
 * OEL field from one form to the next (E5 · Toujours OEL). Real labels,
 * errors tied with aria-describedby by react-aria, the right mobile keyboard.
 */
export function QuestionField({ question: q, value, onChange, onBlur, error, isDisabled, other, onOtherChange, renderFile }: QuestionFieldProps) {
  const label = (
    <>
      {q.title || tr('Question sans titre', 'Untitled question')}
      {q.required && (
        <span className="form-required" aria-hidden>
          {' '}*
        </span>
      )}
    </>
  );
  const fieldId = `q-${q.id}`;
  const str = typeof value === 'string' ? value : '';
  const invalid = !!error;
  const choices = (q.choices ?? []).filter((c) => !(q.hideFull && c.remaining === 0));
  const common = { id: fieldId, isDisabled, isRequired: q.required, isInvalid: invalid, 'data-question': q.id } as const;

  switch (q.type) {
    case 'short':
    case 'email':
    case 'number':
    case 'paragraph':
      return (
        <TextField
          {...common}
          className="form-q"
          label={label}
          description={q.help}
          errorMessage={error}
          placeholder={q.placeholder}
          value={str}
          onChange={onChange}
          onBlur={onBlur}
          multiline={q.type === 'paragraph'}
          rows={4}
          type={q.type === 'email' ? 'email' : 'text'}
          inputMode={q.type === 'number' ? 'decimal' : q.type === 'email' ? 'email' : undefined}
          autoComplete={q.type === 'email' ? 'email' : /nom/i.test(q.title) ? 'name' : undefined}
          validationBehavior="aria"
        />
      );
    case 'date':
      return (
        <div className="form-q emb-field" data-question={q.id}>
          <label className="emb-field__label" htmlFor={fieldId}>
            {label}
          </label>
          <div className={cx('emb-well-input', invalid && 'is-invalid')}>
            <input
              id={fieldId}
              type="date"
              className="emb-well-input__control"
              value={str}
              disabled={isDisabled}
              required={q.required}
              aria-invalid={invalid || undefined}
              aria-describedby={[q.help && `${fieldId}-help`, error && `${fieldId}-err`].filter(Boolean).join(' ') || undefined}
              onChange={(e) => onChange(e.target.value)}
              onBlur={onBlur}
            />
          </div>
          {q.help && (
            <span id={`${fieldId}-help`} className="emb-field__helper">
              {q.help}
            </span>
          )}
          {error && (
            <span id={`${fieldId}-err`} className="emb-field__error">
              {error}
            </span>
          )}
        </div>
      );
    case 'single':
      return (
        <div className="form-q" data-question={q.id}>
          <RadioGroup
            {...common}
            label={label}
            description={q.help}
            value={str || null}
            onChange={onChange}
            onBlur={onBlur}
            validationBehavior="aria"
            aria-describedby={error ? `${fieldId}-err` : undefined}
          >
            {choices.map((c) => (
              <Radio key={c.id} value={c.id} isDisabled={c.remaining === 0}>
                {choiceLabel(c)}
              </Radio>
            ))}
            {q.allowOther && <Radio value={OTHER}>{tr('Autre', 'Other')}</Radio>}
          </RadioGroup>
          {q.allowOther && str === OTHER && (
            <TextField aria-label={tr('Précisez « Autre »', 'Specify “Other”')} placeholder={tr('Précisez', 'Specify')} value={other ?? ''} onChange={onOtherChange} isDisabled={isDisabled} className="form-q__other" />
          )}
          {error && (
            <span id={`${fieldId}-err`} className="emb-field__error">
              {error}
            </span>
          )}
        </div>
      );
    case 'multiple': {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <CheckboxGroup
          {...common}
          className="form-q emb-radio-group"
          value={arr}
          onChange={onChange}
          onBlur={onBlur}
          validationBehavior="aria"
          aria-describedby={error ? `${fieldId}-err` : undefined}
        >
          <Label className="emb-field__label">{label}</Label>
          {choices.map((c) => (
            <KitCheckbox key={c.id} value={c.id} isDisabled={c.remaining === 0}>
              {choiceLabel(c)}
            </KitCheckbox>
          ))}
          {q.allowOther && <KitCheckbox value={OTHER}>{tr('Autre', 'Other')}</KitCheckbox>}
          {q.help && (
            <Text slot="description" className="emb-field__helper">
              {q.help}
            </Text>
          )}
          {q.allowOther && arr.includes(OTHER) && (
            <TextField aria-label={tr('Précisez « Autre »', 'Specify “Other”')} placeholder={tr('Précisez', 'Specify')} value={other ?? ''} onChange={onOtherChange} isDisabled={isDisabled} className="form-q__other" />
          )}
          {error && (
            <span id={`${fieldId}-err`} className="emb-field__error">
              {error}
            </span>
          )}
        </CheckboxGroup>
      );
    }
    case 'dropdown':
      return (
        <div className="form-q" data-question={q.id}>
          <Select
            {...common}
            label={label}
            description={q.help}
            placeholder={tr('Choisir…', 'Choose…')}
            selectedKey={str || null}
            onSelectionChange={(k) => onChange(k == null ? null : String(k))}
            onBlur={onBlur}
            disabledKeys={choices.filter((c) => c.remaining === 0).map((c) => c.id)}
            validationBehavior="aria"
          >
            {[...choices.map((c) => <SelectItem key={c.id} id={c.id}>{choiceLabel(c)}</SelectItem>), ...(q.allowOther ? [<SelectItem key={OTHER} id={OTHER}>{tr('Autre', 'Other')}</SelectItem>] : [])]}
          </Select>
          {q.allowOther && str === OTHER && (
            <TextField aria-label={tr('Précisez « Autre »', 'Specify “Other”')} placeholder={tr('Précisez', 'Specify')} value={other ?? ''} onChange={onOtherChange} isDisabled={isDisabled} className="form-q__other" />
          )}
          {error && <span className="emb-field__error">{error}</span>}
        </div>
      );
    case 'file':
      return <>{renderFile?.(q)}</>;
  }
}

/** Kit checkbox look inside a react-aria CheckboxGroup (the kit's Checkbox is standalone). */
function KitCheckbox({ value, isDisabled, children }: { value: string; isDisabled?: boolean; children: ReactNode }) {
  return (
    <Checkbox value={value} isDisabled={isDisabled} className="emb-check">
      {({ isSelected }) => (
        <>
          <span className="emb-check__box" aria-hidden>
            {isSelected && <Icon name="check" size={14} />}
          </span>
          <span className="emb-check__label">{children}</span>
        </>
      )}
    </Checkbox>
  );
}
