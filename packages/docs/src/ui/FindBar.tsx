import { useEffect, useRef, useState } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { Button, Checkbox } from '@oel/emboss';

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
    <div className="oel-findbar" role="search" aria-label="Rechercher et remplacer" onKeyDown={(e) => {
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
          aria-label="Rechercher"
          placeholder="Rechercher dans le document"
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
          {info.error ? 'Expression invalide' : query ? (info.count ? `${info.index + 1} sur ${info.count}` : 'Aucun résultat') : ''}
        </span>
        <Button size="icon-sm" variant="ghost" leadingIcon="chevron-up" aria-label="Résultat précédent" onPress={() => editor.commands.findPrev()} />
        <Button size="icon-sm" variant="ghost" leadingIcon="chevron-down" aria-label="Résultat suivant" onPress={() => editor.commands.findNext()} />
        <Button size="icon-sm" variant="ghost" leadingIcon="more" aria-label="Remplacer" aria-pressed={withReplace} onPress={() => setWithReplace((v) => !v)} />
        <Button size="icon-sm" variant="ghost" leadingIcon="close" aria-label="Fermer la recherche" onPress={close} />
      </div>
      {withReplace && (
        <div className="oel-findbar__row">
          <input className="oel-findbar__input" aria-label="Remplacer par" placeholder="Remplacer par" value={replacement} onChange={(e) => setReplacement(e.target.value)} disabled={!editable} />
          <Button size="sm" variant="secondary" isDisabled={!editable || !info.count} onPress={() => (editor.commands.replaceCurrent(replacement), editor.commands.findNext())}>
            Remplacer
          </Button>
          <Button size="sm" variant="secondary" isDisabled={!editable || !info.count} onPress={() => editor.commands.replaceAll(replacement)}>
            Tout remplacer
          </Button>
        </div>
      )}
      <div className="oel-findbar__opts">
        <Checkbox isSelected={opts.caseSensitive} onChange={(v) => setOpts({ ...opts, caseSensitive: v })}>Respecter la casse</Checkbox>
        <Checkbox isSelected={opts.wholeWord} onChange={(v) => setOpts({ ...opts, wholeWord: v })}>Mots entiers</Checkbox>
        <Checkbox isSelected={opts.regex} onChange={(v) => setOpts({ ...opts, regex: v })}>Expression régulière</Checkbox>
      </div>
    </div>
  );
}
