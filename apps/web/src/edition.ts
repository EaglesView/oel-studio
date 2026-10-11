/**
 * What this build of the front end ships (plan `docs/plans/2026-10-solo-mvp.md`, S-1).
 *
 * - `solo` (default): single user. Everything stays in this browser; no collab server is
 *   contacted, and sharing, presence, server versions, members and forms are hidden.
 * - `equipe`: the collaborative build (apps/collab, share links, forms, projects).
 *
 * Set with `PUBLIC_EDITION=equipe` at build/dev time. Packages never read this: the app passes
 * the flags down as props (`collab={features.collab}`). Every hook is found with
 * `rg -n "features\.(collab|forms|projects)" apps/web/src`.
 */
export type Edition = 'solo' | 'equipe';

export function editionFrom(value: string | undefined): Edition {
  return value === 'equipe' ? 'equipe' : 'solo';
}

export function featuresOf(edition: Edition) {
  const team = edition === 'equipe';
  return {
    /** Collab server sync, share links, presence, server version history, « Votre nom ». */
    collab: team,
    /** Form papers, « Formulaire » in « + », the /f and /connexion pages. */
    forms: team,
    /** Members, roles and invitations (project settings themselves stay). */
    projects: team,
  } as const;
}

export const EDITION: Edition = editionFrom(import.meta.env.PUBLIC_EDITION);
export const features = featuresOf(EDITION);
