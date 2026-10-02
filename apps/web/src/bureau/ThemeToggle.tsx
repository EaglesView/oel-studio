import { useEffect, useState } from 'react';
import { Button } from '@oel/emboss';

type Theme = 'light' | 'dark';

function currentTheme(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
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
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem('oel-theme', next);
        } catch {
          /* private mode: theme just won't persist */
        }
        setTheme(next);
      }}
    />
  );
}
