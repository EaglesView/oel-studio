import { createLocalBackend, type FormsBackend } from '@oel/forms';

let backend: FormsBackend | null = null;

/**
 * The forms backend for this app (browser only).
 * TODO(backend): swap the local stub for `createHttpBackend(import.meta.env.PUBLIC_FORMS_URL)`
 * once the forms service exists; the UI only depends on the `FormsBackend` interface.
 */
export function formsBackend(): FormsBackend {
  backend ??= createLocalBackend({ origin: location.origin });
  return backend;
}
