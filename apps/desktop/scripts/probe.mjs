#!/usr/bin/env node
/**
 * Webview probe (plan 2026-10-desktop, D-0): starts the built app under tauri-driver (WebDriver), waits for the
 * demo desk, and prints what the webview supports that the Bureau relies on, as JSON. Run it twice: the second
 * run reports whether the cookie, local storage and IndexedDB written by the first survived the restart.
 *
 *   node apps/desktop/scripts/probe.mjs [path/to/app] [--shot out.png]
 *
 * Needs `tauri-driver` (cargo install tauri-driver) and the platform's driver: WebKitWebDriver on Linux,
 * msedgedriver on Windows. tauri-driver has no macOS support; there, check the same items by hand.
 */
import { spawn } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const shotAt = args.indexOf('--shot');
const shot = shotAt >= 0 ? args.splice(shotAt, 2)[1] : null;
const exe = process.platform === 'win32' ? 'oel-desktop.exe' : 'oel-desktop';
const app = args[0] ?? fileURLToPath(new URL(`../src-tauri/target/release/${exe}`, import.meta.url));
const port = 4444;
const base = `http://127.0.0.1:${port}`;

const driver = spawn('tauri-driver', ['--port', String(port)], { stdio: ['ignore', 'ignore', 'inherit'] });
const stop = () => driver.kill();
process.on('exit', stop);

async function wd(method, path, body) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const json = await r.json();
  if (!r.ok) throw new Error(`${method} ${path}: ${JSON.stringify(json.value)}`);
  return json.value;
}

for (let i = 0; ; i++) {
  try {
    await fetch(`${base}/status`);
    break;
  } catch {
    if (i > 50) throw new Error('tauri-driver did not start');
    await sleep(200);
  }
}

const { sessionId } = await wd('POST', '/session', {
  capabilities: { alwaysMatch: { 'tauri:options': { application: app } } },
});
const s = `/session/${sessionId}`;
// Engines load their WASM inside workers, which the page's resource timing doesn't list: ask for one by name.
const wasmFile = readdirSync(fileURLToPath(new URL('../../web/dist/_astro', import.meta.url))).find((f) => f.endsWith('.wasm'));
const run = (script) => wd('POST', `${s}/execute/async`, { script, args: [] });

try {
  // The demo desk is seeded on a first start (four files imported through the engine worker).
  let papers = 0;
  for (let i = 0; i < 120 && papers < 4; i++) {
    await sleep(500);
    papers = await wd('POST', `${s}/execute/sync`, { script: 'return document.querySelectorAll(".paper-tab").length', args: [] });
  }
  await sleep(3000); // let thumbnails and the debounced desk save settle

  const report = await run(`
    const done = arguments[arguments.length - 1];
    (async () => {
      const r = {};
      const safe = async (k, f) => { try { r[k] = await f(); } catch (e) { r[k] = 'error: ' + (e && e.message || e); } };
      r.href = location.href;
      r.userAgent = navigator.userAgent;
      r.lang = document.documentElement.lang;
      r.secureContext = window.isSecureContext;
      await safe('csp', async () => (await fetch(location.href)).headers.get('content-security-policy'));
      await safe('evalBlocked', () => { try { return (0, eval)('false'); } catch { return true; } });
      await safe('papers', () => [...document.querySelectorAll('.paper-tab')].map((t) => t.dataset.kind));
      await safe('paperStates', () => [...document.querySelectorAll('[data-state]')].map((p) => p.dataset.state));
      await safe('wasm', async () => {
        const res = await fetch('/_astro/${wasmFile}');
        const streaming = await WebAssembly.compileStreaming(fetch('/_astro/${wasmFile}')).then(() => true, (e) => String(e));
        return { status: res.status, type: res.headers.get('content-type'), compileStreaming: streaming };
      });
      await safe('routes', async () => {
        const out = {};
        for (const p of ['/bureau', '/bureau/', '/docs/bureau', '/en/docs']) out[p] = (await fetch(p)).status;
        return out;
      });
      await safe('worker', () => new Promise((resolve) => {
        const src = 'self.onmessage = async () => { const o = {}; o.offscreen = typeof OffscreenCanvas;'
          + ' try { o.webgl2 = !!new OffscreenCanvas(4, 4).getContext("webgl2"); } catch (e) { o.webgl2 = String(e); }'
          + ' o.gpu = typeof navigator.gpu; try { o.adapter = navigator.gpu ? !!(await navigator.gpu.requestAdapter()) : false; } catch (e) { o.adapter = String(e); }'
          + ' o.wasm = typeof WebAssembly; postMessage(o); };';
        const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        w.onmessage = (e) => resolve(e.data);
        w.onerror = (e) => resolve('worker error: ' + e.message);
        w.postMessage(0);
        setTimeout(() => resolve('worker timeout'), 5000);
      }));
      await safe('webgl2Main', () => !!document.createElement('canvas').getContext('webgl2'));
      await safe('webgl2Offscreen', () => !!new OffscreenCanvas(4, 4).getContext('webgl2'));
      await safe('gpuMain', async () => navigator.gpu ? !!(await navigator.gpu.requestAdapter()) : 'no navigator.gpu');
      await safe('storage', async () => ({ ...(await navigator.storage.estimate()), persisted: await navigator.storage.persisted() }));
      await safe('databases', async () => (await indexedDB.databases()).map((d) => d.name));
      await safe('clipboard', () => ({ api: typeof navigator.clipboard, write: typeof navigator.clipboard?.write, read: typeof navigator.clipboard?.read }));
      await safe('fileSystemAccess', () => typeof window.showSaveFilePicker);
      // Persistence across restarts: report what the previous run left, then leave a fresh marker.
      const stamp = String(Date.now());
      r.previous = {
        cookie: (document.cookie.match(/(?:^|;\\s*)oel-probe=(\\d+)/) || [])[1] ?? null,
        localStorage: localStorage.getItem('oel-probe'),
      };
      await safe('previousIdb', () => new Promise((resolve, reject) => {
        const q = indexedDB.open('oel-probe', 1);
        q.onupgradeneeded = () => q.result.createObjectStore('kv');
        q.onerror = () => reject(q.error);
        q.onsuccess = () => {
          const tx = q.result.transaction('kv', 'readwrite');
          const get = tx.objectStore('kv').get('stamp');
          get.onsuccess = () => { tx.objectStore('kv').put(stamp, 'stamp'); resolve(get.result ?? null); };
          tx.onerror = () => reject(tx.error);
        };
      }));
      document.cookie = 'oel-probe=' + stamp + '; Max-Age=31536000; Path=/; SameSite=Lax';
      localStorage.setItem('oel-probe', stamp);
      r.cookieReadBack = document.cookie.includes('oel-probe=' + stamp);
      return r;
    })().then(done, (e) => done('probe failed: ' + e));
  `);
  console.log(JSON.stringify(report, null, 2));
  if (shot) {
    writeFileSync(shot, Buffer.from(await wd('GET', `${s}/screenshot`), 'base64'));
    console.error(`screenshot: ${shot}`);
  }
} finally {
  await wd('DELETE', s).catch(() => {});
  stop();
}
