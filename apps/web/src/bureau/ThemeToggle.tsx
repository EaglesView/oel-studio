import { useEffect, useState } from 'react';
import { Button } from '@oel/emboss';

type Theme = 'light' | 'dark';
/** What the person picked: a theme, or follow the system (Affichage, menu M-5). */
export type ThemeChoice = Theme | 'system';

function currentTheme(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function currentChoice(): ThemeChoice {
  const set = document.documentElement.dataset.theme;
  return set === 'light' || set === 'dark' ? set : 'system';
}

/** Applies and remembers a choice (Base.astro re-applies it before first paint). */
export function applyTheme(choice: ThemeChoice) {
  if (choice === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  try {
    if (choice === 'system') localStorage.removeItem('oel-theme');
    else localStorage.setItem('oel-theme', choice);
  } catch {
    /* private mode: theme just won't persist */
  }
}

export function useThemeChoice(): [ThemeChoice, (c: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>('system');
  useEffect(() => setChoice(currentChoice()), []);
  return [
    choice,
    (c) => {
      applyTheme(c);
      setChoice(c);
    },
  ];
}

/** Light/Dark mode switch (Figma Color collection modes). */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => setTheme(currentTheme()), []);
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      leadingIcon={theme === 'dark' ? 'sun' : 'moon'}
      aria-label={next === 'dark' ? 'Passer au thème sombre' : 'Passer au thème clair'}
      onPress={() => {
        applyTheme(next);
        setTheme(next);
      }}
    />
  );
}
