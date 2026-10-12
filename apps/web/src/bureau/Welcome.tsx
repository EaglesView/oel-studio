import { useState } from 'react';
import { Button, DialogOverlay, Radio, RadioGroup, SheetDialog } from '@oel/emboss';
import { lang as pageLang, type Lang } from '@oel/i18n';
import { SITE, docHref, href } from '../site/i18n';
import { cameFromSite, markWelcomed, saveLang } from '../lang';
import { features } from '../edition';

/**
 * The welcome on a first visit: the interface language (unless the person came from the site's
 * « Ouvrir le Bureau », whose language is already applied), where to read more, and what the
 * Bureau keeps on the device (the `oel-lang` cookie). Its copy is in both languages and follows
 * the choice as it is made; « Commencer » saves it and reloads if the page must change language.
 * On a first visit the demo desk was just laid out in French: `resetDemo` lays it out again in
 * the chosen language (it reloads too).
 */
const COPY = {
  fr: {
    title: 'Bienvenue dans le Bureau',
    lead: 'Tous vos fichiers d’études sur un seul bureau : documents, tableurs, présentations, images et notes, côte à côte, dans votre navigateur.',
    demo: 'Un bureau de démonstration vous attend : ouvrez-le, modifiez-le, il est à vous.',
    language: 'Langue de l’interface',
    // Shown in French on the English welcome: the offer is in the language it offers.
    switchAsk: 'Vous préférez le français ? Le Bureau peut s’afficher en français.',
    switchTo: 'Français',
    languageLater: 'Vous pourrez la changer dans le menu, « Paramètres ».',
    more: 'Pour aller plus loin',
    links: {
      start: 'Prise en main',
      keyboard: 'Raccourcis clavier et accessibilité',
      privacy: 'Formats et confidentialité',
      home: 'Présentation du Bureau',
      code: 'Code source',
      tools: 'Tous les outils OutilsEnLigne',
    },
    newTab: '(nouvel onglet)',
    storage: 'Témoins et stockage',
    cookie: 'Le Bureau dépose un seul témoin (cookie), « oel-lang », qui retient votre langue pendant un an. Aucun témoin publicitaire ni de mesure d’audience.',
    local: features.collab
      ? 'Vos fichiers sont gardés dans ce navigateur et synchronisés avec le serveur du projet. Le thème et cet accueil sont retenus dans le stockage local du navigateur.'
      : 'Vos fichiers restent dans ce navigateur : rien n’est envoyé à un serveur. Le thème et cet accueil sont retenus dans le stockage local du navigateur.',
    start: 'Commencer',
  },
  en: {
    title: 'Welcome to the Bureau',
    lead: 'All your school files on one desk: documents, spreadsheets, presentations, images and notes, side by side, in your browser.',
    demo: 'A demo desk is waiting for you: open it, change it, it’s yours.',
    language: 'Interface language',
    switchAsk: 'Prefer English? The Bureau can show in English.',
    switchTo: 'English',
    languageLater: 'You can change it later in the menu, under “Settings”.',
    more: 'Learn more',
    links: {
      start: 'Getting started',
      keyboard: 'Keyboard and accessibility',
      privacy: 'Formats and privacy',
      home: 'About the Bureau',
      code: 'Source code',
      tools: 'All OutilsEnLigne tools',
    },
    newTab: '(new tab)',
    storage: 'Cookies and storage',
    cookie: 'The Bureau sets a single cookie, “oel-lang”, which remembers your language for a year. No advertising or analytics cookies.',
    local: features.collab
      ? 'Your files are kept in this browser and synced with the project’s server. The theme and this welcome are remembered in the browser’s local storage.'
      : 'Your files stay in this browser: nothing is sent to a server. The theme and this welcome are remembered in the browser’s local storage.',
    start: 'Start',
  },
} satisfies Record<Lang, unknown>;

export function Welcome({ isOpen, onClose, resetDemo }: { isOpen: boolean; onClose: () => void; resetDemo?: () => void }) {
  const fromSite = cameFromSite();
  const [choice, setChoice] = useState<Lang>(pageLang());
  const c = COPY[choice];
  const other: Lang = choice === 'en' ? 'fr' : 'en';
  const finish = () => {
    markWelcomed();
    saveLang(choice);
    onClose();
    if (choice === pageLang()) return;
    if (resetDemo) resetDemo();
    else location.reload();
  };
  const links: Array<[string, string]> = [
    [c.links.start, docHref(choice, 'index')],
    [c.links.keyboard, docHref(choice, 'clavier')],
    [c.links.privacy, docHref(choice, 'formats')],
    [c.links.home, href(choice, '/')],
    ...(SITE.repo ? [[c.links.code, SITE.repo] as [string, string]] : []),
    [c.links.tools, SITE.tools],
  ];
  return (
    <DialogOverlay isOpen={isOpen} onOpenChange={(open) => !open && finish()}>
      <SheetDialog
        title={<span lang={choice === 'en' ? 'en-CA' : 'fr-CA'}>{c.title}</span>}
        width={560}
        actions={() => (
          <Button variant="primary" onPress={finish} autoFocus>
            {c.start}
          </Button>
        )}
      >
        <div className="welcome" lang={choice === 'en' ? 'en-CA' : 'fr-CA'}>
          <p>{c.lead}</p>
          <p>{c.demo}</p>
          {fromSite ? (
            // Came from the site in one language: offer the other one, in that language, as a toggle.
            <div className="welcome__switch" lang={choice === 'en' ? 'fr-CA' : 'en-CA'}>
              <p>{COPY[other].switchAsk}</p>
              <Button variant="secondary" size="sm" leadingIcon="translate" onPress={() => setChoice(other)}>
                {COPY[other].switchTo}
              </Button>
            </div>
          ) : (
            <RadioGroup label={`${COPY.fr.language} · ${COPY.en.language}`} description={c.languageLater} value={choice} onChange={(v) => setChoice(v as Lang)} orientation="horizontal">
              <Radio value="fr">
                <span lang="fr-CA">Français</span>
              </Radio>
              <Radio value="en">
                <span lang="en-CA">English</span>
              </Radio>
            </RadioGroup>
          )}
          <section aria-labelledby="welcome-more">
            <h3 id="welcome-more" className="welcome__h3">{c.more}</h3>
            <ul className="welcome__links">
              {links.map(([label, url]) => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noopener">
                    {label}
                  </a>{' '}
                  <span className="welcome__note">{c.newTab}</span>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="welcome-storage">
            <h3 id="welcome-storage" className="welcome__h3">{c.storage}</h3>
            <p className="welcome__note">{c.cookie}</p>
            <p className="welcome__note">{c.local}</p>
          </section>
        </div>
      </SheetDialog>
    </DialogOverlay>
  );
}
