import { useEffect, useRef, useState } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { Button, Checkbox } from '@oel/emboss';
import { tr } from '@oel/i18n';

/** Ctrl+F / Ctrl+H: find and replace, floating over the page. */
export function FindBar({ editor, replace: showReplace, editable, onClose }: { editor: Editor; replace: boolean; editable: boolean; onClose: () => void }) {
  const [query, setQuery] = useState(editor.storage.find.query || editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' ').slice(0, 200));
  const [replacement, setReplacement] = useState('');
  const [opts, setOpts] = useState({ caseSensitive: false, wholeWord: false, regex: false });
  const [withReplace, setWithReplace] = useState(showReplace);
  const input = useRef<HTMLInputElement>(null);
  const info = useEditorState({ editor, selector: ({ editor: e }) => ({ count: e.storage.find.results.length, index: e.storage.find.index, error: e.storage.find.error }) });

  useEffect(() => setWithReplace(showReplace), [showReplace]);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  useEffect(() => {
    editor.commands.setSearch({ query, ...opts });
  }, [editor, query, opts]);
  useEffect(() => () => void editor.commands.clearSearch(), [editor]);

  const close = () => {
    editor.commands.clearSearch();
    onClose();
    editor.commands.focus();
  };

  return (
    <div className="oel-findbar" role="search" aria-label={tr('Rechercher et remplacer', 'Find and replace')} onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}>
      <div className="oel-findbar__row">
        <input
          ref={input}
          className="oel-findbar__input"
          aria-label={tr('Rechercher', 'Find')}
          placeholder={tr('Rechercher dans le document', 'Find in the document')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (e.shiftKey) editor.commands.findPrev();
              else editor.commands.findNext();
            }
          }}
        />
        <span className="oel-findbar__count" aria-live="polite">
          {info.error ? tr('Expression invalide', 'Invalid expression') : query ? (info.count ? tr(`${info.index + 1} sur ${info.count}`, `${info.index + 1} of ${info.count}`) : tr('Aucun résultat', 'No results')) : ''}
        </span>
        <Button size="icon-sm" variant="ghost" leadingIcon="chevron-up" aria-label={tr('Résultat précédent', 'Previous result')} onPress={() => editor.commands.findPrev()} />
        <Button size="icon-sm" variant="ghost" leadingIcon="chevron-down" aria-label={tr('Résultat suivant', 'Next result')} onPress={() => editor.commands.findNext()} />
        <Button size="icon-sm" variant="ghost" leadingIcon="more" aria-label={tr('Remplacer', 'Replace')} aria-pressed={withReplace} onPress={() => setWithReplace((v) => !v)} />
        <Button size="icon-sm" variant="ghost" leadingIcon="close" aria-label={tr('Fermer la recherche', 'Close the search')} onPress={close} />
      </div>
      {withReplace && (
        <div className="oel-findbar__row">
          <input className="oel-findbar__input" aria-label={tr('Remplacer par', 'Replace with')} placeholder={tr('Remplacer par', 'Replace with')} value={replacement} onChange={(e) => setReplacement(e.target.value)} disabled={!editable} />
          <Button size="sm" variant="secondary" isDisabled={!editable || !info.count} onPress={() => (editor.commands.replaceCurrent(replacement), editor.commands.findNext())}>
            {tr('Remplacer', 'Replace')}
          </Button>
          <Button size="sm" variant="secondary" isDisabled={!editable || !info.count} onPress={() => editor.commands.replaceAll(replacement)}>
            {tr('Tout remplacer', 'Replace all')}
          </Button>
        </div>
      )}
      <div className="oel-findbar__opts">
        <Checkbox isSelected={opts.caseSensitive} onChange={(v) => setOpts({ ...opts, caseSensitive: v })}>{tr('Respecter la casse', 'Match case')}</Checkbox>
        <Checkbox isSelected={opts.wholeWord} onChange={(v) => setOpts({ ...opts, wholeWord: v })}>{tr('Mots entiers', 'Whole words')}</Checkbox>
        <Checkbox isSelected={opts.regex} onChange={(v) => setOpts({ ...opts, regex: v })}>{tr('Expression régulière', 'Regular expression')}</Checkbox>
      </div>
    </div>
  );
}
