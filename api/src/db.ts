import pg from 'pg';
export type Q = <T = any>(sql: string, params?: any[]) => Promise<T[]>;
export interface Db { query: Q; tx<T>(fn: (q: Q) => Promise<T>): Promise<T>; close(): Promise<void> }

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, name TEXT NOT NULL,
  phone TEXT, phone_verified_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS bouquets (id TEXT PRIMARY KEY, organizer_id TEXT NOT NULL REFERENCES users(id), recipient_name TEXT NOT NULL,
  recipient_email TEXT, occasion TEXT NOT NULL, note TEXT, buy_by_at TIMESTAMPTZ NOT NULL, ship_buffer_days INT NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'collecting' CHECK (status IN ('draft','collecting','fusing','funding','locked','purchased','revealed','expired')),
  invite_token TEXT UNIQUE NOT NULL, reveal_token TEXT UNIQUE NOT NULL, chosen_candidate_id TEXT, captured_tier_id TEXT,
  captured_cents INT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, bouquet_id TEXT NOT NULL REFERENCES bouquets(id), user_id TEXT NOT NULL REFERENCES users(id),
  display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'friend', phone TEXT, network_verified BOOLEAN NOT NULL DEFAULT false,
  budget_min_cents INT NOT NULL DEFAULT 0, budget_max_cents INT NOT NULL DEFAULT 5000, flower_back JSONB NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (bouquet_id, user_id));
CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('shared','random')), prompt TEXT NOT NULL, options JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, bouquet_id TEXT NOT NULL REFERENCES bouquets(id), member_id TEXT UNIQUE NOT NULL REFERENCES members(id),
  answers JSONB NOT NULL, story TEXT, traits JSONB NOT NULL, title TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS traits (id TEXT PRIMARY KEY, bouquet_id TEXT NOT NULL REFERENCES bouquets(id), label TEXT NOT NULL,
  source_card_ids JSONB NOT NULL, consensus INT NOT NULL, UNIQUE (bouquet_id, label));
CREATE TABLE IF NOT EXISTS candidates (id TEXT PRIMARY KEY, bouquet_id TEXT NOT NULL REFERENCES bouquets(id), title TEXT NOT NULL, description TEXT NOT NULL,
  rare BOOLEAN NOT NULL, trait_labels JSONB NOT NULL, member_ids JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS votes (bouquet_id TEXT NOT NULL, member_id TEXT NOT NULL REFERENCES members(id), candidate_id TEXT NOT NULL REFERENCES candidates(id),
  PRIMARY KEY (bouquet_id, member_id));
CREATE TABLE IF NOT EXISTS trait_picks (bouquet_id TEXT NOT NULL, member_id TEXT NOT NULL REFERENCES members(id), trait_id TEXT NOT NULL REFERENCES traits(id),
  kept BOOLEAN NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (member_id, trait_id));
CREATE TABLE IF NOT EXISTS gift_tiers (id TEXT PRIMARY KEY, bouquet_id TEXT NOT NULL REFERENCES bouquets(id), candidate_id TEXT NOT NULL REFERENCES candidates(id),
  level INT NOT NULL, title TEXT NOT NULL, threshold_cents INT NOT NULL);
CREATE TABLE IF NOT EXISTS contributions (id TEXT PRIMARY KEY, bouquet_id TEXT NOT NULL REFERENCES bouquets(id), member_id TEXT NOT NULL REFERENCES members(id),
  amount_cents INT NOT NULL CHECK (amount_cents > 0), hold_id TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('held','captured','released')),
  captured_cents INT NOT NULL DEFAULT 0, card_last4 TEXT NOT NULL, idempotency_key TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS ledger_events (id BIGSERIAL PRIMARY KEY, bouquet_id TEXT NOT NULL, contribution_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('hold','capture','release')), amount_cents INT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS reveal_events (id BIGSERIAL PRIMARY KEY, bouquet_id TEXT NOT NULL, card_index INT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now());
`;

export const MIGRATIONS = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS stats JSONB;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS avoids JSONB;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS art_key TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'match';
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS cover_level INT;
`;
export async function makeDb(url = process.env.DATABASE_URL): Promise<Db> {
  let db: Db;
  if (url && url.startsWith('postgres')) {
    const pool = new pg.Pool({ connectionString: url });
    const q: Q = async (s, p) => (await pool.query(s, p)).rows;
    db = { query: q, close: () => pool.end(), async tx(fn) {
      const c = await pool.connect();
      try { await c.query('BEGIN'); const r = await fn(async (s, p) => (await c.query(s, p)).rows); await c.query('COMMIT'); return r; }
      catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } } };
    for (let i = 0; ; i++) { try { await pool.query('SELECT 1'); break; } catch (e) { if (i > 30) throw e; await new Promise(r => setTimeout(r, 1000)); } }
  } else {
    // Embedded Postgres (PGlite, WASM) for tests / no-docker dev. Same SQL dialect.
    const { PGlite } = await import('@electric-sql/pglite');
    const lite = new PGlite(url && url !== 'memory' ? url : undefined);
    let chain: Promise<any> = Promise.resolve(); // serialize transactions
    const q: Q = async (s, p) => (await lite.query(s, p)).rows as any;
    db = { query: q, close: () => lite.close(), tx(fn) {
      const run = chain.then(() => lite.transaction(async t => fn(async (s, p) => (await t.query(s, p)).rows as any)));
      chain = run.catch(() => {}); return run as any; } };
  }
  for (const stmt of (SCHEMA + MIGRATIONS).split(';').map(s => s.trim()).filter(Boolean)) await db.query(stmt);
  return db;
}
