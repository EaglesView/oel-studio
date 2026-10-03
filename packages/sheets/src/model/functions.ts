/**
 * Function catalog for autocomplete and signature help while typing a
 * formula. Names are English (the formula language), descriptions French
 * (the interface). The engine (IronCalc) knows more functions; any name it
 * knows works when typed in full.
 */

export interface FunctionInfo {
  name: string;
  args: string;
  desc: string;
  cat: 'Math' | 'Statistiques' | 'Logique' | 'Texte' | 'Date' | 'Recherche' | 'Finances' | 'Information';
}

const F = (cat: FunctionInfo['cat'], list: Array<[string, string, string]>): FunctionInfo[] => list.map(([name, args, desc]) => ({ name, args, desc, cat }));

export const FUNCTIONS: FunctionInfo[] = [
  ...F('Math', [
    ['SUM', 'nombre1, [nombre2], …', 'Additionne les nombres.'],
    ['SUMIF', 'plage, critère, [plage_somme]', 'Additionne les cellules qui remplissent un critère.'],
    ['SUMIFS', 'plage_somme, plage1, critère1, …', 'Additionne selon plusieurs critères.'],
    ['SUMPRODUCT', 'tableau1, [tableau2], …', 'Somme des produits des éléments correspondants.'],
    ['ROUND', 'nombre, nb_chiffres', 'Arrondit au nombre de décimales indiqué.'],
    ['ROUNDUP', 'nombre, nb_chiffres', 'Arrondit vers le haut (loin de zéro).'],
    ['ROUNDDOWN', 'nombre, nb_chiffres', 'Arrondit vers le bas (vers zéro).'],
    ['INT', 'nombre', 'Partie entière (arrondi vers le bas).'],
    ['TRUNC', 'nombre, [nb_chiffres]', 'Tronque les décimales.'],
    ['ABS', 'nombre', 'Valeur absolue.'],
    ['MOD', 'nombre, diviseur', 'Reste de la division.'],
    ['POWER', 'nombre, puissance', 'Élève à une puissance.'],
    ['SQRT', 'nombre', 'Racine carrée.'],
    ['PRODUCT', 'nombre1, [nombre2], …', 'Multiplie les nombres.'],
    ['CEILING', 'nombre, précision', 'Arrondit au multiple supérieur.'],
    ['FLOOR', 'nombre, précision', 'Arrondit au multiple inférieur.'],
    ['MROUND', 'nombre, multiple', 'Arrondit au multiple le plus proche.'],
    ['RAND', '', 'Nombre aléatoire entre 0 et 1.'],
    ['RANDBETWEEN', 'min, max', 'Entier aléatoire entre deux bornes.'],
    ['PI', '', 'La valeur de π.'],
    ['EXP', 'nombre', 'e à la puissance donnée.'],
    ['LN', 'nombre', 'Logarithme népérien.'],
    ['LOG', 'nombre, [base]', 'Logarithme (base 10 par défaut).'],
    ['LOG10', 'nombre', 'Logarithme en base 10.'],
    ['SIGN', 'nombre', 'Signe d’un nombre (1, 0 ou -1).'],
    ['SUBTOTAL', 'no_fonction, réf1, …', 'Sous-total qui ignore les autres sous-totaux.'],
    ['AGGREGATE', 'no_fonction, options, réf1, …', 'Agrégat qui peut ignorer erreurs et lignes masquées.'],
  ]),
  ...F('Statistiques', [
    ['AVERAGE', 'nombre1, [nombre2], …', 'Moyenne des nombres.'],
    ['AVERAGEIF', 'plage, critère, [plage_moyenne]', 'Moyenne des cellules qui remplissent un critère.'],
    ['AVERAGEIFS', 'plage_moyenne, plage1, critère1, …', 'Moyenne selon plusieurs critères.'],
    ['COUNT', 'valeur1, [valeur2], …', 'Compte les cellules qui contiennent des nombres.'],
    ['COUNTA', 'valeur1, [valeur2], …', 'Compte les cellules non vides.'],
    ['COUNTBLANK', 'plage', 'Compte les cellules vides.'],
    ['COUNTIF', 'plage, critère', 'Compte les cellules qui remplissent un critère.'],
    ['COUNTIFS', 'plage1, critère1, …', 'Compte selon plusieurs critères.'],
    ['MAX', 'nombre1, [nombre2], …', 'Plus grande valeur.'],
    ['MIN', 'nombre1, [nombre2], …', 'Plus petite valeur.'],
    ['MAXIFS', 'plage_max, plage1, critère1, …', 'Maximum selon des critères.'],
    ['MINIFS', 'plage_min, plage1, critère1, …', 'Minimum selon des critères.'],
    ['MEDIAN', 'nombre1, [nombre2], …', 'Valeur médiane.'],
    ['MODE', 'nombre1, [nombre2], …', 'Valeur la plus fréquente.'],
    ['LARGE', 'tableau, k', 'k-ième plus grande valeur.'],
    ['SMALL', 'tableau, k', 'k-ième plus petite valeur.'],
    ['RANK', 'nombre, réf, [ordre]', 'Rang d’un nombre dans une liste.'],
    ['STDEV', 'nombre1, [nombre2], …', 'Écart type d’un échantillon.'],
    ['STDEV.P', 'nombre1, [nombre2], …', 'Écart type d’une population.'],
    ['VAR', 'nombre1, [nombre2], …', 'Variance d’un échantillon.'],
    ['PERCENTILE', 'tableau, k', 'k-ième centile.'],
    ['QUARTILE', 'tableau, quart', 'Quartile d’un ensemble.'],
    ['CORREL', 'tableau1, tableau2', 'Coefficient de corrélation.'],
  ]),
  ...F('Logique', [
    ['IF', 'test, valeur_si_vrai, [valeur_si_faux]', 'Renvoie une valeur selon une condition.'],
    ['IFS', 'test1, valeur1, …', 'Première valeur dont la condition est vraie.'],
    ['IFERROR', 'valeur, valeur_si_erreur', 'Remplace une erreur par une autre valeur.'],
    ['IFNA', 'valeur, valeur_si_na', 'Remplace #N/A par une autre valeur.'],
    ['AND', 'logique1, [logique2], …', 'VRAI si tous les arguments sont vrais.'],
    ['OR', 'logique1, [logique2], …', 'VRAI si au moins un argument est vrai.'],
    ['NOT', 'logique', 'Inverse la valeur logique.'],
    ['XOR', 'logique1, [logique2], …', 'OU exclusif.'],
    ['SWITCH', 'expression, valeur1, résultat1, …, [défaut]', 'Compare une valeur à une liste de cas.'],
    ['TRUE', '', 'La valeur VRAI.'],
    ['FALSE', '', 'La valeur FAUX.'],
  ]),
  ...F('Texte', [
    ['CONCAT', 'texte1, [texte2], …', 'Assemble des textes.'],
    ['CONCATENATE', 'texte1, [texte2], …', 'Assemble des textes (ancienne forme).'],
    ['TEXTJOIN', 'séparateur, ignorer_vides, texte1, …', 'Assemble des textes avec un séparateur.'],
    ['LEFT', 'texte, [nb_car]', 'Premiers caractères.'],
    ['RIGHT', 'texte, [nb_car]', 'Derniers caractères.'],
    ['MID', 'texte, début, nb_car', 'Caractères au milieu d’un texte.'],
    ['LEN', 'texte', 'Nombre de caractères.'],
    ['TRIM', 'texte', 'Supprime les espaces en trop.'],
    ['UPPER', 'texte', 'Met en majuscules.'],
    ['LOWER', 'texte', 'Met en minuscules.'],
    ['PROPER', 'texte', 'Majuscule à chaque mot.'],
    ['TEXT', 'valeur, format', 'Met en forme un nombre comme du texte.'],
    ['VALUE', 'texte', 'Convertit un texte en nombre.'],
    ['FIND', 'texte_cherché, texte, [début]', 'Position d’un texte (respecte la casse).'],
    ['SEARCH', 'texte_cherché, texte, [début]', 'Position d’un texte (sans la casse).'],
    ['SUBSTITUTE', 'texte, ancien, nouveau, [occurrence]', 'Remplace un texte par un autre.'],
    ['REPLACE', 'texte, début, nb_car, nouveau', 'Remplace des caractères par position.'],
    ['REPT', 'texte, nombre', 'Répète un texte.'],
    ['EXACT', 'texte1, texte2', 'VRAI si deux textes sont identiques.'],
    ['CHAR', 'nombre', 'Caractère d’un code.'],
    ['CODE', 'texte', 'Code du premier caractère.'],
    ['CLEAN', 'texte', 'Supprime les caractères non imprimables.'],
    ['TEXTBEFORE', 'texte, délimiteur, …', 'Texte avant un délimiteur.'],
    ['TEXTAFTER', 'texte, délimiteur, …', 'Texte après un délimiteur.'],
  ]),
  ...F('Date', [
    ['TODAY', '', 'Date du jour.'],
    ['NOW', '', 'Date et heure actuelles.'],
    ['DATE', 'année, mois, jour', 'Construit une date.'],
    ['TIME', 'heure, minute, seconde', 'Construit une heure.'],
    ['YEAR', 'date', 'Année d’une date.'],
    ['MONTH', 'date', 'Mois d’une date.'],
    ['DAY', 'date', 'Jour d’une date.'],
    ['HOUR', 'heure', 'Heure.'],
    ['MINUTE', 'heure', 'Minutes.'],
    ['SECOND', 'heure', 'Secondes.'],
    ['WEEKDAY', 'date, [type]', 'Jour de la semaine.'],
    ['WEEKNUM', 'date, [type]', 'Numéro de semaine.'],
    ['ISOWEEKNUM', 'date', 'Numéro de semaine ISO.'],
    ['EDATE', 'date, mois', 'Date décalée d’un nombre de mois.'],
    ['EOMONTH', 'date, mois', 'Dernier jour du mois.'],
    ['DATEDIF', 'début, fin, unité', 'Écart entre deux dates.'],
    ['DAYS', 'fin, début', 'Nombre de jours entre deux dates.'],
    ['NETWORKDAYS', 'début, fin, [fériés]', 'Jours ouvrables entre deux dates.'],
    ['WORKDAY', 'début, jours, [fériés]', 'Date après des jours ouvrables.'],
    ['DATEVALUE', 'texte', 'Convertit un texte en date.'],
  ]),
  ...F('Recherche', [
    ['VLOOKUP', 'valeur, table, no_col, [approché]', 'Cherche dans la première colonne et renvoie une colonne.'],
    ['HLOOKUP', 'valeur, table, no_lig, [approché]', 'Cherche dans la première ligne.'],
    ['XLOOKUP', 'valeur, plage_cherchée, plage_renvoyée, …', 'Recherche moderne dans une plage.'],
    ['INDEX', 'tableau, ligne, [colonne]', 'Valeur à une position.'],
    ['MATCH', 'valeur, plage, [type]', 'Position d’une valeur.'],
    ['XMATCH', 'valeur, plage, …', 'Position d’une valeur (moderne).'],
    ['CHOOSE', 'index, valeur1, …', 'Choisit une valeur dans une liste.'],
    ['OFFSET', 'réf, lignes, colonnes, [hauteur], [largeur]', 'Référence décalée.'],
    ['INDIRECT', 'texte_réf', 'Référence écrite sous forme de texte.'],
    ['ROW', '[réf]', 'Numéro de ligne.'],
    ['COLUMN', '[réf]', 'Numéro de colonne.'],
    ['ROWS', 'tableau', 'Nombre de lignes.'],
    ['COLUMNS', 'tableau', 'Nombre de colonnes.'],
    ['TRANSPOSE', 'tableau', 'Transpose lignes et colonnes.'],
    ['UNIQUE', 'tableau, …', 'Valeurs uniques.'],
    ['SORT', 'tableau, …', 'Trie un tableau.'],
    ['FILTER', 'tableau, inclure, [si_vide]', 'Filtre un tableau.'],
    ['SEQUENCE', 'lignes, [colonnes], [début], [pas]', 'Suite de nombres.'],
    ['HYPERLINK', 'adresse, [texte]', 'Lien cliquable.'],
  ]),
  ...F('Finances', [
    ['PMT', 'taux, nper, va, [vc], [type]', 'Paiement d’un emprunt.'],
    ['FV', 'taux, nper, vpm, [va], [type]', 'Valeur future.'],
    ['PV', 'taux, nper, vpm, [vc], [type]', 'Valeur actuelle.'],
    ['NPV', 'taux, valeur1, …', 'Valeur actuelle nette.'],
    ['IRR', 'valeurs, [estimation]', 'Taux de rendement interne.'],
    ['RATE', 'nper, vpm, va, …', 'Taux d’intérêt par période.'],
    ['NPER', 'taux, vpm, va, …', 'Nombre de périodes.'],
  ]),
  ...F('Information', [
    ['ISBLANK', 'valeur', 'VRAI si la cellule est vide.'],
    ['ISNUMBER', 'valeur', 'VRAI si c’est un nombre.'],
    ['ISTEXT', 'valeur', 'VRAI si c’est du texte.'],
    ['ISERROR', 'valeur', 'VRAI pour toute erreur.'],
    ['ISNA', 'valeur', 'VRAI pour #N/A.'],
    ['ISEVEN', 'nombre', 'VRAI si pair.'],
    ['ISODD', 'nombre', 'VRAI si impair.'],
    ['NA', '', 'La valeur d’erreur #N/A.'],
    ['TYPE', 'valeur', 'Type de la valeur.'],
  ]),
];

const BY_NAME = new Map(FUNCTIONS.map((f) => [f.name, f]));

export const functionInfo = (name: string) => BY_NAME.get(name.toUpperCase());

/** Functions whose name starts with what is typed. */
export const matchFunctions = (prefix: string, limit = 8) => {
  const p = prefix.toUpperCase();
  return p ? FUNCTIONS.filter((f) => f.name.startsWith(p)).slice(0, limit) : [];
};

/** What the caret is in while typing a formula: a name being typed, and/or the call it sits in. */
export function formulaContext(text: string, cursor: number): { typing: string | null; call: { name: string; arg: number } | null } {
  const before = text.slice(0, cursor);
  if (!before.startsWith('=')) return { typing: null, call: null };
  // Strip string literals so commas and parentheses inside them don't count.
  const plain = before.replace(/"(?:[^"]|"")*"?/g, (m) => '_'.repeat(m.length));
  const typing = /(?:^=|[=(,;+\-*/^&<>:\s])([A-Za-z][A-Za-z0-9.]*)$/.exec(plain)?.[1] ?? null;
  let depth = 0;
  let arg = 0;
  for (let i = plain.length - 1; i >= 0; i--) {
    const ch = plain[i];
    if (ch === ')') depth++;
    else if (ch === '(') {
      if (depth === 0) {
        const name = /([A-Za-z][A-Za-z0-9._]*)$/.exec(plain.slice(0, i))?.[1];
        return { typing, call: name ? { name: name.replace(/^_xlfn\./i, ''), arg } : null };
      }
      depth--;
    } else if (ch === ',' && depth === 0) arg++;
  }
  return { typing, call: null };
}

/** Excel error codes, explained in French (tooltips on error cells). */
export const ERROR_HELP: Record<string, string> = {
  '#DIV/0!': 'Division par zéro.',
  '#N/A': 'Valeur introuvable ou non disponible.',
  '#NAME?': 'Nom de fonction ou de plage inconnu.',
  '#NULL!': 'Les plages indiquées ne se croisent pas.',
  '#NUM!': 'Nombre invalide pour ce calcul.',
  '#REF!': 'La référence n’existe plus (ligne, colonne ou feuille supprimée).',
  '#VALUE!': 'Type de valeur incorrect dans un argument.',
  '#SPILL!': 'Le résultat ne peut pas s’étendre : des cellules sont occupées.',
  '#CALC!': 'Le calcul a échoué.',
  '#CIRC!': 'Référence circulaire : la formule dépend d’elle-même.',
};
