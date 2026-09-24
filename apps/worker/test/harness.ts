// In-memory D1/R2/Email stand-ins so the Hono app runs under plain Node vitest.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { signFeedbackUser } from '@kobecuppens/feedback-core/server';
import type { EmailMessage, Env } from '../src/env';
import { app } from '../src/index';
import { generateProjectKeys, sha256Hex } from '../src/util';

class Statement {
  constructor(
    private db: DatabaseSync,
    readonly sql: string,
    readonly params: SQLInputValue[] = [],
  ) {}
  bind(...params: unknown[]) {
    for (const p of params) if (p === undefined) throw new Error(`D1_TYPE_ERROR: undefined bound in ${this.sql}`);
    // Real D1 rejects more than 100 bound parameters per statement.
    if (params.length > 100) throw new Error(`D1_ERROR: too many SQL variables (${params.length})`);
    return new Statement(this.db, this.sql, params as SQLInputValue[]);
  }
  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[], success: true, meta: {} };
  }
  async run() {
    return this.exec();
  }
  exec() {
    const stmt = this.db.prepare(this.sql);
    // Like D1, batch results carry rows for queries and RETURNING statements.
    if (/^\s*(SELECT|WITH)\b/i.test(this.sql) || /\bRETURNING\b/i.test(this.sql)) {
      const rows = stmt.all(...this.params);
      return { results: rows, success: true, meta: { changes: rows.length } };
    }
    const r = stmt.run(...this.params);
    return { results: [], success: true, meta: { changes: Number(r.changes) } };
  }
}

export function createD1(): D1Database & { raw: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const dir = join(import.meta.dirname, '..', 'migrations');
  for (const file of readdirSync(dir).sort()) db.exec(readFileSync(join(dir, file), 'utf8'));
  return {
    raw: db,
    prepare: (sql: string) => new Statement(db, sql),
    batch: async (stmts: Statement[]) => {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => s.exec());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    exec: async (sql: string) => {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
  } as unknown as D1Database & { raw: DatabaseSync };
}

export function createR2() {
  const store = new Map<string, { body: ArrayBuffer | Blob; contentType?: string }>();
  return {
    store,
    put: async (key: string, body: ArrayBuffer | Blob, opts?: { httpMetadata?: { contentType?: string } }) => {
      store.set(key, { body, contentType: opts?.httpMetadata?.contentType });
    },
    get: async (key: string) => {
      const obj = store.get(key);
      return obj ? { body: new Blob([obj.body]).stream(), httpEtag: `"${key}"` } : null;
    },
    delete: async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
  };
}

export interface Harness {
  env: Env;
  db: DatabaseSync;
  files: ReturnType<typeof createR2>;
  emails: EmailMessage[];
  project: { id: string; publicKey: string; signingSecret: string; secretKey: string };
  request: (path: string, init?: RequestInit & { json?: unknown }) => Promise<Response>;
  userToken: (claims: { id: string; name?: string; email?: string; isAdmin?: boolean }) => Promise<string>;
  /** Headers for a public request as a signed user or an anonymous device. */
  as: (who: { user?: string; name?: string; email?: string; isAdmin?: boolean; anon?: string }) => Promise<Record<string, string>>;
  setSettings: (patch: Record<string, unknown>) => void;
  /** Insert another tenant; returns its keys and an `as` helper bound to it. */
  addProject: (id: string, slug: string) => Promise<{ id: string; publicKey: string; secretKey: string; as: Harness['as'] }>;
}

async function insertProject(db: DatabaseSync, id: string, slug: string) {
  const keys = generateProjectKeys();
  db.prepare(
    'INSERT INTO projects (id, slug, name, public_key, signing_secret, secret_key_hash, settings, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, slug, slug, keys.publicKey, keys.signingSecret, await sha256Hex(keys.secretKey), '{}', Date.now());
  return { id, ...keys };
}

function asHelper(keys: { publicKey: string; signingSecret: string }): Harness['as'] {
  return async (who) => {
    const headers: Record<string, string> = { 'X-Feedback-Key': keys.publicKey };
    if (who.user) {
      headers['X-Feedback-User'] = await signFeedbackUser(
        { id: who.user, name: who.name, email: who.email, isAdmin: who.isAdmin },
        keys.signingSecret,
      );
    }
    if (who.anon) headers['X-Feedback-Anon'] = who.anon;
    return headers;
  };
}

export async function createHarness(envOverrides: Partial<Env> = {}): Promise<Harness> {
  const DB = createD1();
  const files = createR2();
  const emails: EmailMessage[] = [];
  const env: Env = {
    DB,
    FILES: files as unknown as R2Bucket,
    EMAIL: { send: async (m) => void emails.push(m) },
    FEATURE_DASHBOARD: 'true',
    FEATURE_ADMIN_API: 'true',
    FEATURE_PUBLIC_BOARD: 'true',
    FEATURE_EMAIL: 'true',
    ADMIN_PASSWORD: 'correct horse battery staple',
    SESSION_SECRET: 'x'.repeat(40),
    ADMIN_EMAIL: 'owner@example.com',
    FROM_EMAIL: 'feedback@example.com',
    // Tests edit project rows directly; opt in to the cache where a test covers it.
    PROJECT_CACHE_SECONDS: '0',
    ...envOverrides,
  };

  const project = await insertProject(DB.raw, 'proj_1', 'demo');
  DB.raw.prepare("UPDATE projects SET name = 'Demo App' WHERE id = ?").run(project.id);
  const keys = project;

  const request = (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const headers = new Headers(init.headers);
    let body = init.body;
    if (init.json !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(init.json);
    }
    return Promise.resolve(app.request(`https://feedback.test${path}`, { ...init, headers, body }, env));
  };

  const userToken = (claims: { id: string; name?: string; email?: string; isAdmin?: boolean }) =>
    signFeedbackUser(claims, keys.signingSecret);

  return {
    env,
    db: DB.raw,
    files,
    emails,
    project,
    request,
    userToken,
    as: asHelper(keys),
    addProject: async (id, slug) => {
      const other = await insertProject(DB.raw, id, slug);
      return { ...other, as: asHelper(other) };
    },
    setSettings: (patch) => {
      const row = DB.raw.prepare('SELECT settings FROM projects WHERE id = ?').get(project.id) as { settings: string };
      DB.raw
        .prepare('UPDATE projects SET settings = ? WHERE id = ?')
        .run(JSON.stringify({ ...JSON.parse(row.settings), ...patch }), project.id);
    },
  };
}
