/**
 * The desktop app's platform (apps/desktop, Tauri 2). Loaded only inside the app (the app checks
 * `isTauri()` and imports this module dynamically), so the web build never runs the Tauri API.
 */
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { tr } from '@oel/i18n';
import type { Platform } from './index';

/** The extension of `name`, without the dot, for the save dialog's filter. */
const extensionOf = (name: string) => /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1];

export const desktopPlatform: Platform = {
  kind: 'desktop',
  async saveFile(blob, name) {
    const ext = extensionOf(name);
    // The dialog adds the chosen path to the app's file system scope, so `writeFile` may write it.
    const path = await save({ defaultPath: name, filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined });
    if (!path) return false;
    try {
      await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
      return true;
    } catch (e) {
      // Plugin errors are plain strings; callers show this message as is.
      throw new Error(tr(`« ${name} » n’a pas pu être enregistré : ${String(e)}`, `“${name}” could not be saved: ${String(e)}`));
    }
  },
};
