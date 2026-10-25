import { afterEach, describe, expect, it } from 'vitest';
import { installPlatform, onBeforeClose, platform, runBeforeClose, saveFile, webPlatform, type Platform } from '../src/index';

describe('@oel/platform', () => {
  afterEach(() => installPlatform(webPlatform));

  it('answers with the web platform until the app installs one', async () => {
    expect((await platform()).kind).toBe('web');
  });

  it('sends saves to the installed platform, as a Blob of the given type', async () => {
    const saved: { blob: Blob; name: string }[] = [];
    const fake: Platform = { kind: 'desktop', saveFile: async (blob, name) => (saved.push({ blob, name }), true) };
    installPlatform(Promise.resolve(fake));
    expect(await saveFile('a,b', 'table.csv', 'text/csv')).toBe(true);
    expect(saved[0]!.name).toBe('table.csv');
    expect(saved[0]!.blob.type).toBe('text/csv');
    expect(await saved[0]!.blob.text()).toBe('a,b');
  });

  it('falls back to the web platform when the installed one fails to load', async () => {
    installPlatform(Promise.reject(new Error('no Tauri')));
    expect((await platform()).kind).toBe('web');
  });

  it('runs the before-close handlers together and waits for all of them, failures included', async () => {
    const order: string[] = [];
    const offs = [
      onBeforeClose(() => void order.push('flush')),
      onBeforeClose(async () => {
        await new Promise((r) => setTimeout(r, 5));
        order.push('stored');
      }),
      onBeforeClose(() => {
        throw new Error('broken handler');
      }),
    ];
    const err = console.error;
    console.error = () => {};
    try {
      await runBeforeClose();
    } finally {
      console.error = err;
    }
    expect(order).toEqual(['flush', 'stored']);
    offs.forEach((off) => off());
    order.length = 0;
    await runBeforeClose();
    expect(order).toEqual([]);
  });
});
