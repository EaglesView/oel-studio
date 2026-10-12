import { useMemo, useState } from 'react';
import { FileTrigger } from 'react-aria-components';
import { Badge, Button, Select, SelectItem, Switch, TextField, ToolbarToggle, Toolbar, cx } from '@oel/emboss';
import { contrastGuard, formatRatio } from '../model/contrast';
import { DEFAULT_ACCENT } from '../model/create';
import type { Appearance, FormDef, TitleFont } from '../model/types';
import type { PublishedForm } from '../api/backend';
import { FormFiller } from './FormFiller';
import { tr } from '@oel/i18n';

const SWATCHES = [DEFAULT_ACCENT, '#127A6E', '#1F5FAD', '#B4372F', '#C25E00', '#F5C518', '#2A2733'];

function readImage(file: File, max: number): Promise<string> {
  // TODO(backend): upload logo/cover to the forms file storage and keep the URL; data URLs
  // only work locally and make the published copy heavy.
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/**
 * E2 · 4 Personnaliser (onglet Paramètres): accent, logo, cover, title font
 * among two, rhythm, texts. Contrast is checked live (E5 garde-fou); fields,
 * paper, sizes and error colours stay OEL. Preview on desktop or mobile.
 */
export function SettingsTab({ form, setForm }: { form: FormDef; setForm: (patch: Partial<FormDef>) => void }) {
  const a = form.appearance;
  const set = (patch: Partial<Appearance>) => setForm({ appearance: { ...a, ...patch } });
  const guard = contrastGuard(a.accent);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const preview: PublishedForm = useMemo(() => ({ form, acceptedCount: 0, taken: {}, ranges: {} }), [form]);

  return (
    <div className="fb-settings">
      <div className="fb-settings__panel">
        <section className="forms-fieldset" aria-labelledby="fb-appearance">
          <h3 id="fb-appearance" className="emb-t-overline">
            {tr('Apparence', 'Appearance')}
          </h3>
          <div role="radiogroup" aria-label={tr('Couleur d’accent', 'Accent colour')} className="fb-swatches">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={a.accent.toUpperCase() === c.toUpperCase()}
                aria-label={c}
                className="fb-swatch"
                style={{ background: c }}
                onClick={() => set({ accent: c })}
              />
            ))}
            <label className="fb-swatch fb-swatch--custom" title={tr('Personnalisée', 'Custom')}>
              <input type="color" aria-label={tr('Couleur personnalisée', 'Custom colour')} value={a.accent} onChange={(e) => set({ accent: e.target.value })} />
            </label>
          </div>
          <div className={cx('fb-contrast', guard.adjusted && 'is-adjusted')} role="status">
            {guard.adjusted ? (
              <>
                <span>
                  <i style={{ background: guard.picked }} /> {guard.picked} · {tr('choisie — contraste', 'chosen — contrast')} {formatRatio(guard.pickedRatio)} · {tr('refusé', 'refused')}
                </span>
                <span>
                  <i style={{ background: guard.applied }} /> {guard.applied} · {tr('appliquée — contraste', 'applied — contrast')} {formatRatio(guard.appliedRatio)} · AA
                </span>
              </>
            ) : (
              <Badge tone="success">Contraste AA · {formatRatio(guard.appliedRatio)}</Badge>
            )}
            <span className="emb-field__helper">{tr('Ajustée automatiquement si le contraste est insuffisant.', 'Adjusted automatically if the contrast is too low.')}</span>
          </div>

          <ImagePicker label="Logo" value={a.logoUrl} max={256} onChange={(v) => set({ logoUrl: v })} />
          <ImagePicker label={tr('Image de couverture', 'Cover image')} hint={tr('Recadrée en 5:1 ; remplace le bandeau uni.', 'Cropped to 5:1; replaces the plain banner.')} value={a.coverUrl} max={1600} onChange={(v) => set({ coverUrl: v })} />
          <Select label={tr('Police des titres', 'Heading font')} selectedKey={a.titleFont} onSelectionChange={(k) => set({ titleFont: k as TitleFont })} description={tr('Le texte courant reste en Montserrat.', 'Body text stays in Montserrat.')}>
            <SelectItem id="montserrat">Montserrat (OEL)</SelectItem>
            <SelectItem id="noto-serif">Noto Serif</SelectItem>
          </Select>
        </section>

        <section className="forms-fieldset" aria-labelledby="fb-rhythm">
          <h3 id="fb-rhythm" className="emb-t-overline">
            {tr('Rythme', 'Pacing')}
          </h3>
          <Switch isSelected={a.showProgress} onChange={(v) => set({ showProgress: v })}>
            {tr('Barre de progression', 'Progress bar')}
          </Switch>
          <Switch isSelected={a.onePerScreen} onChange={(v) => set({ onePerScreen: v })}>
            {tr('Une question par écran', 'One question per screen')}
          </Switch>
          <p className="emb-field__helper">{tr('Par défaut, les sections découpent le formulaire en étapes.', 'By default, sections split the form into steps.')}</p>
        </section>

        <section className="forms-fieldset" aria-labelledby="fb-texts">
          <h3 id="fb-texts" className="emb-t-overline">
            {tr('Textes', 'Texts')}
          </h3>
          <TextField label={tr('Organisateur', 'Organizer')} description={tr('« Vos réponses sont envoyées à … »', '“Your answers are sent to …”')} value={form.organiser} onChange={(v) => setForm({ organiser: v })} />
          <TextField label={tr('Message d’accueil', 'Welcome message')} multiline rows={3} value={a.welcome} onChange={(v) => set({ welcome: v })} />
          <TextField label={tr('Message de remerciement', 'Thank-you message')} multiline rows={3} value={a.thanks} onChange={(v) => set({ thanks: v })} />
          <TextField label={tr('Signature', 'Signature')} value={a.signature} onChange={(v) => set({ signature: v })} />
          <TextField
            label={tr('Redirection après l’envoi (facultatif)', 'Redirect after sending (optional)')}
            type="url"
            placeholder="https://"
            value={a.redirectUrl ?? ''}
            onChange={(v) => set({ redirectUrl: v.trim() || null })}
            isInvalid={!!a.redirectUrl && !/^https:\/\//.test(a.redirectUrl)}
            errorMessage={tr('L’adresse doit commencer par https://', 'The address must start with https://')}
          />
        </section>

        <section className="forms-fieldset fb-always-oel" aria-labelledby="fb-oel">
          <h3 id="fb-oel" className="emb-t-overline">
            Toujours OEL
          </h3>
          <p className="emb-field__helper">{tr('Papier, relief, champs, tailles, couleurs d’erreur et de succès, accessibilité et pied de page ne se personnalisent pas : un répondant reconnaît un formulaire OEL partout. Mode sombre et langue suivent l’appareil du répondant.', 'Paper, emboss, fields, sizes, error and success colours, accessibility and footer can’t be customized: a respondent recognizes an OEL form anywhere. Dark mode and language follow the respondent’s device.')}</p>
        </section>
      </div>

      <div className="fb-settings__preview">
        <div className="fb-settings__devices">
          <Toolbar appearance="pill" aria-label={tr('Appareil de l’aperçu', 'Preview device')}>
            <ToolbarToggle icon="laptop" label={tr('Ordinateur', 'Computer')} isSelected={device === 'desktop'} onChange={() => setDevice('desktop')} />
            <ToolbarToggle icon="phone" label={tr('Mobile', 'Mobile')} isSelected={device === 'mobile'} onChange={() => setDevice('mobile')} />
          </Toolbar>
        </div>
        <div className={cx('fb-device', `fb-device--${device}`)} aria-label={tr('Aperçu du formulaire', 'Form preview')} role="region">
          <FormFiller key={`${device}-${form.appearance.onePerScreen}`} backend={null} slug="apercu" published={preview} preview compact />
        </div>
      </div>
    </div>
  );
}

function ImagePicker({ label, hint, value, max, onChange }: { label: string; hint?: string; value: string | null; max: number; onChange: (v: string | null) => void }) {
  return (
    <div className="fb-image-picker">
      <span className="emb-field__label">{label}</span>
      <div className="forms-dialog__row">
        {value && <img src={value} alt="" className="fb-image-picker__thumb" />}
        <FileTrigger acceptedFileTypes={['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']} onSelect={(l) => l?.[0] && void readImage(l[0], max).then(onChange)}>
          <Button size="sm" leadingIcon="upload">
            {value ? tr('Remplacer', 'Replace') : tr('Choisir une image', 'Choose an image')}
          </Button>
        </FileTrigger>
        {value && (
          <Button variant="ghost" size="sm" onPress={() => onChange(null)}>
            {tr('Retirer', 'Remove')}
          </Button>
        )}
      </div>
      {hint && <span className="emb-field__helper">{hint}</span>}
    </div>
  );
}
