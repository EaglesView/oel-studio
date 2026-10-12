import { useEffect, useRef, useState, type DragEvent } from 'react';
import { FileTrigger } from 'react-aria-components';
import { Button, Icon, ProgressBar, cx } from '@oel/emboss';
import type { FormsBackend } from '../api/backend';
import { acceptAttribute, acceptedLabel, fileProblem, formatSize } from '../model/validate';
import type { Question, UploadedFile } from '../model/types';
import { tr } from '@oel/i18n';

type Entry =
  | { key: string; state: 'sending'; name: string; size: number; progress: number; abort: AbortController }
  | { key: string; state: 'sent'; file: UploadedFile }
  | { key: string; state: 'refused'; name: string; size: number; reason: string };

/**
 * E7 · 2–4: drop zone with a real « Parcourir… » button; limits written before
 * anyone tries. Each file is a row with its own state (sending with progress
 * and « Annuler », sent with « Retirer », refused with what to do). A refused
 * file never blocks the others; filling can continue while files are sending.
 */
export function FileQuestion({
  question: q,
  value,
  onChange,
  onPendingChange,
  backend,
  slug,
  error,
  preview,
}: {
  question: Question;
  value: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
  /** Number of files still sending; « Envoyer » waits for them. */
  onPendingChange: (questionId: string, n: number) => void;
  backend: FormsBackend | null;
  slug: string;
  error?: string;
  /** Builder preview: nothing is uploaded. */
  preview?: boolean;
}) {
  const rules = q.file ?? { families: ['pdf', 'image'], maxSizeMb: 10, maxFiles: 3 };
  const [entries, setEntries] = useState<Entry[]>(() => value.map((f) => ({ key: f.id, state: 'sent', file: f })));
  const [over, setOver] = useState(false);
  const live = useRef<HTMLParagraphElement>(null);
  const latest = useRef(entries);
  latest.current = entries;

  const sentFiles = (list: Entry[]) => list.filter((e): e is Extract<Entry, { state: 'sent' }> => e.state === 'sent').map((e) => e.file);
  const pending = entries.filter((e) => e.state === 'sending').length;
  useEffect(() => onPendingChange(q.id, pending), [pending, q.id, onPendingChange]);
  useEffect(() => () => latest.current.forEach((e) => e.state === 'sending' && e.abort.abort()), []);

  const update = (fn: (list: Entry[]) => Entry[]) => {
    setEntries((prev) => {
      const next = fn(prev);
      const before = sentFiles(prev);
      const after = sentFiles(next);
      if (before.length !== after.length || before.some((f, i) => f.id !== after[i]?.id)) queueMicrotask(() => onChange(after));
      return next;
    });
  };

  const announce = (m: string) => {
    if (live.current) live.current.textContent = m;
  };

  const add = (files: File[]) => {
    let kept = latest.current.filter((e) => e.state !== 'refused').length;
    for (const file of files) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`;
      const problem = fileProblem(file, rules, kept);
      if (problem) {
        update((l) => [...l, { key, state: 'refused', name: file.name, size: file.size, reason: problem }]);
        announce(tr(`${file.name} refusé. ${problem}`, `${file.name} refused. ${problem}`));
        continue;
      }
      kept++;
      const abort = new AbortController();
      update((l) => [...l, { key, state: 'sending', name: file.name, size: file.size, progress: 0, abort }]);
      if (preview || !backend) {
        // Aperçu: rien n'est envoyé.
        update((l) => l.map((e) => (e.key === key ? { key, state: 'sent', file: { id: key, name: file.name, size: file.size, mime: file.type, url: '' } } : e)));
        continue;
      }
      backend
        .upload(slug, q.id, file, {
          signal: abort.signal,
          onProgress: (p) => update((l) => l.map((e) => (e.key === key && e.state === 'sending' ? { ...e, progress: p } : e))),
        })
        .then((uploaded) => {
          update((l) => l.map((e) => (e.key === key ? { key, state: 'sent', file: uploaded } : e)));
          announce(tr(`${file.name} envoyé.`, `${file.name} sent.`));
        })
        .catch((err: Error) => {
          if (abort.signal.aborted) return;
          update((l) => l.map((e) => (e.key === key ? { key, state: 'refused', name: file.name, size: file.size, reason: tr(`L’envoi a échoué (${err.message}). Réessayez.`, `Sending failed (${err.message}). Try again.`) } : e)));
        });
    }
  };

  const remove = (e: Entry) => {
    if (e.state === 'sending') e.abort.abort();
    if (e.state === 'sent' && backend && !preview) void backend.removeUpload(slug, e.file.id);
    update((l) => l.filter((x) => x.key !== e.key));
    announce(tr(`${e.state === 'sent' ? e.file.name : e.name} retiré.`, `${e.state === 'sent' ? e.file.name : e.name} removed.`));
  };

  const limits = tr(`${acceptedLabel(rules.families)} · ${rules.maxSizeMb} Mo au plus par fichier · ${rules.maxFiles} fichier${rules.maxFiles > 1 ? 's' : ''}`, `${acceptedLabel(rules.families)} · ${rules.maxSizeMb} MB at most per file · ${rules.maxFiles} file${rules.maxFiles > 1 ? 's' : ''}`);
  const id = `q-${q.id}`;

  return (
    <fieldset className="form-q form-file" data-question={q.id} aria-describedby={`${id}-limits${error ? ` ${id}-err` : ''}`}>
      <legend className="emb-field__label">
        {q.title || tr('Question sans titre', 'Untitled question')}
        {q.required && <span className="form-required" aria-hidden> *</span>}
      </legend>
      {q.help && <p className="emb-field__helper">{q.help}</p>}

      {entries.length > 0 && (
        <ul className="form-file__list">
          {entries.map((e) => (
            <li key={e.key} className={cx('form-file__row', `is-${e.state}`)}>
              <Icon name={e.state === 'refused' ? 'alert' : 'file'} size={18} />
              <div className="form-file__meta">
                <strong>{e.state === 'sent' ? e.file.name : e.name}</strong>
                {e.state === 'sending' && (
                  <>
                    <span>
                      {formatSize(e.size)} · {Math.round(e.progress * 100)} %
                    </span>
                    <ProgressBar aria-label={tr(`Envoi de ${e.name}`, `Sending ${e.name}`)} value={e.progress * 100} />
                  </>
                )}
                {e.state === 'sent' && <span>{formatSize(e.file.size)} · {tr('envoyé', 'sent')}</span>}
                {e.state === 'refused' && <span className="form-file__reason">{e.reason}</span>}
              </div>
              <Button variant="ghost" size="sm" onPress={() => remove(e)} aria-label={tr(`${e.state === 'sending' ? tr('Annuler', 'Cancel') : tr('Retirer', 'Remove')} ${e.state === 'sent' ? e.file.name : e.name}`, `${e.state === 'sending' ? 'Cancel' : 'Remove'} ${e.state === 'sent' ? e.file.name : e.name}`)}>
                {e.state === 'sending' ? tr('Annuler', 'Cancel') : tr('Retirer', 'Remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div
        className={cx('form-file__drop emb-well', over && 'is-over', error && 'is-invalid')}
        onDragOver={(e: DragEvent) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          setOver(false);
          add([...e.dataTransfer.files]);
        }}
      >
        <Icon name="upload" size={22} />
        <span>{tr('Glissez vos fichiers ici ou', 'Drag your files here or')}</span>
        <FileTrigger allowsMultiple={rules.maxFiles > 1} acceptedFileTypes={acceptAttribute(rules.families).split(',')} onSelect={(list) => list && add([...list])}>
          <Button size="sm">{tr('Parcourir…', 'Browse…')}</Button>
        </FileTrigger>
        <span id={`${id}-limits`} className="form-file__limits">
          {limits}
        </span>
      </div>
      {error && (
        <span id={`${id}-err`} className="emb-field__error">
          {error}
        </span>
      )}
      <p ref={live} className="emb-visually-hidden" aria-live="polite" />
    </fieldset>
  );
}
