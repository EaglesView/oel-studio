import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { createCollabServer } from './server';

const port = Number(process.env.PORT ?? 8787);
const dataDir = resolve(process.env.COLLAB_DATA_DIR ?? join(import.meta.dirname, '..', 'data'));
mkdirSync(dataDir, { recursive: true });

// Development convenience: a stable secret on disk. Set COLLAB_SECRET in production.
let secret = process.env.COLLAB_SECRET ?? '';
if (!secret) {
  const file = join(dataDir, 'dev-secret');
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('base64url'), { mode: 0o600 });
  secret = readFileSync(file, 'utf8').trim();
  console.warn('[collab] COLLAB_SECRET not set: using a development secret from', file);
}

const collab = createCollabServer({
  dbFile: join(dataDir, 'collab.sqlite'),
  secret,
  publicUrl: process.env.COLLAB_PUBLIC_URL ?? `http://localhost:${port}`,
});

await collab.listen(port);

const stop = async () => {
  await collab.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
