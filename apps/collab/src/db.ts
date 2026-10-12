/** SQLite storage (node:sqlite, no native build step). One file, WAL mode. */
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';

export type Role = 'owner' | 'editor' | 'viewer';

export type DocKind = 'doc' | 'sheet' | 'slides';

export interface DocRow {
  id: string;
  title: string;
  kind: DocKind;
  created_at: number;
}

export interface LinkRow {
  id: string;
  doc_id: string;
  role: Role;
  revoked: number;
  created_at: number;
}

export interface VersionRow {
  id: string;
  doc_id: string;
  name: string | null;
  auto: number;
  author: string | null;
  created_at: number;
}

const SCHEMA = `
create table if not exists docs (id text primary key, title text not null default '', kind text not null default 'doc', created_at integer not null);
create table if not exists doc_state (doc_id text primary key references docs(id) on delete cascade, state blob not null, updated_at integer not null);
create table if not exists packages (doc_id text primary key references docs(id) on delete cascade, bytes blob not null);
create table if not exists media (id text primary key, doc_id text not null references docs(id) on delete cascade, path text not null, mime text not null, bytes blob not null, created_at integer not null);
create index if not exists media_doc on media(doc_id, path);
create table if not exists links (id text primary key, doc_id text not null references docs(id) on delete cascade, role text not null, revoked integer not null default 0, created_at integer not null);
create table if not exists versions (id text primary key, doc_id text not null references docs(id) on delete cascade, name text, auto integer not null default 0, author text, state blob not null, created_at integer not null);
create index if not exists versions_doc on versions(doc_id, created_at);
`;

export const newId = (bytes = 12) => randomBytes(bytes).toString('base64url');

export class Store {
  readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('pragma journal_mode = wal; pragma foreign_keys = on;');
    this.db.exec(SCHEMA);
    // Databases created before spreadsheets: add the kind column.
    const cols = this.db.prepare('pragma table_info(docs)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'kind')) this.db.exec("alter table docs add column kind text not null default 'doc'");
  }

  createDoc(title: string, pkg: Uint8Array | null, kind: DocKind = 'doc'): DocRow {
    const row: DocRow = { id: newId(), title, kind, created_at: Date.now() };
    this.db.prepare('insert into docs (id, title, kind, created_at) values (?, ?, ?, ?)').run(row.id, row.title, row.kind, row.created_at);
    if (pkg?.length) this.db.prepare('insert into packages (doc_id, bytes) values (?, ?)').run(row.id, pkg);
    return row;
  }

  doc(id: string): DocRow | undefined {
    return this.db.prepare('select id, title, kind, created_at from docs where id = ?').get(id) as DocRow | undefined;
  }

  loadState(id: string): Uint8Array | null {
    const r = this.db.prepare('select state from doc_state where doc_id = ?').get(id) as { state: Uint8Array } | undefined;
    return r?.state ?? null;
  }

  saveState(id: string, state: Uint8Array) {
    this.db
      .prepare('insert into doc_state (doc_id, state, updated_at) values (?, ?, ?) on conflict(doc_id) do update set state = excluded.state, updated_at = excluded.updated_at')
      .run(id, state, Date.now());
  }

  package(id: string): Uint8Array | null {
    const r = this.db.prepare('select bytes from packages where doc_id = ?').get(id) as { bytes: Uint8Array } | undefined;
    return r?.bytes ?? null;
  }

  addMedia(docId: string, path: string, mime: string, bytes: Uint8Array): string {
    const id = newId(16);
    this.db.prepare('insert into media (id, doc_id, path, mime, bytes, created_at) values (?, ?, ?, ?, ?, ?)').run(id, docId, path, mime, bytes, Date.now());
    return id;
  }

  media(id: string): { mime: string; bytes: Uint8Array } | undefined {
    return this.db.prepare('select mime, bytes from media where id = ?').get(id) as { mime: string; bytes: Uint8Array } | undefined;
  }

  /** Latest bytes for each media path of a document (export). */
  mediaByPath(docId: string): Map<string, Uint8Array> {
    const rows = this.db.prepare('select path, bytes from media where doc_id = ? order by created_at').all(docId) as Array<{ path: string; bytes: Uint8Array }>;
    return new Map(rows.map((r) => [r.path, r.bytes]));
  }

  createLink(docId: string, role: Role): LinkRow {
    const row: LinkRow = { id: newId(9), doc_id: docId, role, revoked: 0, created_at: Date.now() };
    this.db.prepare('insert into links (id, doc_id, role, revoked, created_at) values (?, ?, ?, 0, ?)').run(row.id, docId, role, row.created_at);
    return row;
  }

  link(id: string): LinkRow | undefined {
    return this.db.prepare('select * from links where id = ?').get(id) as LinkRow | undefined;
  }

  links(docId: string): LinkRow[] {
    return this.db.prepare("select * from links where doc_id = ? and role != 'owner' order by created_at desc").all(docId) as unknown as LinkRow[];
  }

  revokeLink(docId: string, id: string): boolean {
    const r = this.db.prepare("update links set revoked = 1 where id = ? and doc_id = ? and role != 'owner'").run(id, docId);
    return Number(r.changes) > 0;
  }

  addVersion(docId: string, state: Uint8Array, name: string | null, auto: boolean, author: string | null): VersionRow {
    const row: VersionRow = { id: newId(9), doc_id: docId, name, auto: auto ? 1 : 0, author, created_at: Date.now() };
    this.db
      .prepare('insert into versions (id, doc_id, name, auto, author, state, created_at) values (?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, docId, name, row.auto, author, state, row.created_at);
    return row;
  }

  versions(docId: string): VersionRow[] {
    return this.db.prepare('select id, doc_id, name, auto, author, created_at from versions where doc_id = ? order by created_at desc').all(docId) as unknown as VersionRow[];
  }

  versionState(docId: string, id: string): Uint8Array | null {
    const r = this.db.prepare('select state from versions where id = ? and doc_id = ?').get(id, docId) as { state: Uint8Array } | undefined;
    return r?.state ?? null;
  }

  lastVersionAt(docId: string): number {
    const r = this.db.prepare('select max(created_at) as t from versions where doc_id = ?').get(docId) as { t: number | null };
    return r.t ?? 0;
  }

  /** Keep the newest `keep` automatic versions; named ones stay forever. */
  pruneAutoVersions(docId: string, keep: number) {
    this.db
      .prepare('delete from versions where doc_id = ? and auto = 1 and id not in (select id from versions where doc_id = ? and auto = 1 order by created_at desc limit ?)')
      .run(docId, docId, keep);
  }
}
