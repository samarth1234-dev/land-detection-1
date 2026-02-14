import os from 'os';
import { Pool } from 'pg';
import { newDb } from 'pg-mem';

const toBool = (value, fallback = false) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

const normalizePersistenceMode = (value) => {
  const mode = String(value || 'auto').trim().toLowerCase();
  if (mode === 'postgresql' || mode === 'memory' || mode === 'auto') {
    return mode;
  }
  return 'auto';
};

const inferSslFromConnectionString = (connectionString) => {
  if (!connectionString) return false;
  try {
    const parsed = new URL(connectionString);
    const sslMode = String(parsed.searchParams.get('sslmode') || '').toLowerCase();
    if (sslMode === 'require' || sslMode === 'verify-ca' || sslMode === 'verify-full') {
      return true;
    }
    return parsed.hostname.includes('supabase.co');
  } catch {
    return false;
  }
};

const buildEnvPoolConfig = () => {
  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  const hasExplicitSslFlag = typeof process.env.DATABASE_SSL === 'string' && process.env.DATABASE_SSL.trim() !== '';
  const sslEnabled = hasExplicitSslFlag
    ? toBool(process.env.DATABASE_SSL, false)
    : inferSslFromConnectionString(connectionString);
  const ssl = sslEnabled ? { rejectUnauthorized: false } : false;

  if (connectionString) {
    return sslEnabled ? { connectionString, ssl } : { connectionString };
  }

  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'root_land',
    user: process.env.DB_USER || os.userInfo().username,
    password: process.env.DB_PASSWORD || '',
    ssl,
  };
};

const buildFallbackCandidates = () => {
  const envConfig = buildEnvPoolConfig();
  const currentUser = os.userInfo().username;
  const targetDb = process.env.DB_NAME || 'root_land';
  const ssl = envConfig.ssl || false;

  const candidates = [{ label: 'env', config: envConfig }];

  if (envConfig.connectionString) {
    candidates.push({
      label: 'local-socket-current-user',
      config: {
        host: '/tmp',
        port: 5432,
        database: targetDb,
        user: currentUser,
        password: process.env.DB_PASSWORD || '',
        ssl: false,
      },
    });

    candidates.push({
      label: 'localhost-current-user',
      config: {
        host: '127.0.0.1',
        port: Number(process.env.DB_PORT || 5432),
        database: targetDb,
        user: currentUser,
        password: process.env.DB_PASSWORD || '',
        ssl,
      },
    });
  } else if (envConfig.user !== currentUser) {
    candidates.push({
      label: 'env-with-current-user',
      config: {
        ...envConfig,
        user: currentUser,
      },
    });
  }

  const seen = new Set();
  return candidates.filter((entry) => {
    const key = JSON.stringify(entry.config);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const quoteIdentifier = (value) => `"${String(value || '').replaceAll('"', '""')}"`;

const formatConfigHint = (config) => {
  if (config.connectionString) return 'connectionString';
  return `${config.user || 'unknown'}@${config.host || '127.0.0.1'}:${config.port || 5432}/${config.database || 'postgres'}`;
};

const tryCreateDatabase = async (config) => {
  if (config.connectionString || !config.database) return false;

  const adminDatabases = ['postgres', 'template1'];
  for (const adminDb of adminDatabases) {
    const adminPool = new Pool({
      ...config,
      database: adminDb,
    });

    try {
      await adminPool.query(`CREATE DATABASE ${quoteIdentifier(config.database)}`);
      return true;
    } catch (error) {
      if (error.code === '42P04') {
        return true;
      }
      if (error.code === '3D000' && adminDb !== 'template1') {
        continue;
      }
      if (error.code !== '42501') {
        throw error;
      }
    } finally {
      await adminPool.end().catch(() => {});
    }
  }

  return false;
};

const connectPool = async (config) => {
  const candidatePool = new Pool(config);
  try {
    await candidatePool.query('SELECT 1');
    return candidatePool;
  } catch (error) {
    await candidatePool.end().catch(() => {});

    if (error.code === '3D000') {
      const created = await tryCreateDatabase(config);
      if (created) {
        const retryPool = new Pool(config);
        try {
          await retryPool.query('SELECT 1');
          return retryPool;
        } catch (retryError) {
          await retryPool.end().catch(() => {});
          throw retryError;
        }
      }
    }

    throw error;
  }
};

const connectMemoryPool = async () => {
  const memoryDb = newDb({
    autoCreateForeignKeyIndices: true,
  });
  const adapter = memoryDb.adapters.createPg();
  const memoryPool = new adapter.Pool();
  await memoryPool.query('SELECT 1');
  return memoryPool;
};

export let pool = null;
let persistenceMode = 'postgresql';

const ensurePool = () => {
  if (!pool) {
    throw new Error('Database is not initialized yet.');
  }
  return pool;
};

export const query = (text, params = []) => ensurePool().query(text, params);
export const getPersistenceMode = () => persistenceMode;

export const withTransaction = async (handler) => {
  const client = await ensurePool().connect();
  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const bootstrapSchema = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'USER',
      employee_id TEXT NULL,
      wallet_address TEXT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      last_login_at TIMESTAMPTZ NULL
    );
  `);

  await query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'USER';
  `);

  await query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS employee_id TEXT NULL;
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_employee_id_unique_idx
    ON users (employee_id)
    WHERE employee_id IS NOT NULL AND employee_id <> '';
  `);

  await query(`
    UPDATE users
    SET role = 'USER'
    WHERE role IS NULL OR role = '';
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      organization TEXT NOT NULL DEFAULT '',
      role_title TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      preferred_language TEXT NOT NULL DEFAULT 'en',
      default_map_layer TEXT NOT NULL DEFAULT 'SAT',
      map_default_lat DOUBLE PRECISION NOT NULL DEFAULT 28.6139,
      map_default_lng DOUBLE PRECISION NOT NULL DEFAULT 77.2090,
      map_default_zoom INTEGER NOT NULL DEFAULT 12,
      notify_dispute_updates BOOLEAN NOT NULL DEFAULT true,
      notify_ndvi_ready BOOLEAN NOT NULL DEFAULT true,
      notify_weekly_digest BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS chain_blocks (
      block_index INTEGER PRIMARY KEY,
      block_timestamp TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      previous_hash TEXT NOT NULL,
      nonce INTEGER NOT NULL DEFAULT 0,
      hash TEXT NOT NULL UNIQUE
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS agri_insights (
      id UUID PRIMARY KEY,
      user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      ndvi_mean DOUBLE PRECISION NOT NULL,
      ndvi_min DOUBLE PRECISION NULL,
      ndvi_max DOUBLE PRECISION NULL,
      rainfall_7d DOUBLE PRECISION NOT NULL,
      max_temp_avg DOUBLE PRECISION NOT NULL,
      min_temp_avg DOUBLE PRECISION NOT NULL,
      summary TEXT NOT NULL,
      recommended_crops JSONB NOT NULL,
      irrigation TEXT NOT NULL,
      risks JSONB NOT NULL,
      input_payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      ledger_block_index INTEGER NOT NULL REFERENCES chain_blocks(block_index),
      ledger_block_hash TEXT NOT NULL
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS land_disputes (
      id UUID PRIMARY KEY,
      user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
      parcel_ref TEXT NOT NULL,
      dispute_type TEXT NOT NULL,
      description TEXT NOT NULL,
      latitude DOUBLE PRECISION NULL,
      longitude DOUBLE PRECISION NULL,
      selection_bounds JSONB NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      priority TEXT NOT NULL DEFAULT 'MEDIUM',
      evidence_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
      resolution_note TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      resolved_at TIMESTAMPTZ NULL,
      ledger_block_index INTEGER NOT NULL REFERENCES chain_blocks(block_index),
      ledger_block_hash TEXT NOT NULL
    );
  `);

  await query(`
    ALTER TABLE land_disputes
    ADD COLUMN IF NOT EXISTS selection_bounds JSONB NULL;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS land_claims (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pid TEXT NOT NULL,
      claim_note TEXT NOT NULL,
      polygon JSONB NOT NULL,
      centroid_lat DOUBLE PRECISION NOT NULL,
      centroid_lng DOUBLE PRECISION NOT NULL,
      area_sq_m DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      overlap_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
      review_note TEXT NULL,
      verified_pid TEXT NULL,
      reviewed_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      reviewed_at TIMESTAMPTZ NULL,
      ledger_block_index INTEGER NOT NULL REFERENCES chain_blocks(block_index),
      ledger_block_hash TEXT NOT NULL
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS land_claims_user_created_idx
    ON land_claims (user_id, created_at DESC);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS land_claims_status_idx
    ON land_claims (status);
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS owned_parcels (
      id UUID PRIMARY KEY,
      owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pid TEXT NOT NULL UNIQUE,
      polygon JSONB NOT NULL,
      centroid_lat DOUBLE PRECISION NOT NULL,
      centroid_lng DOUBLE PRECISION NOT NULL,
      area_sq_m DOUBLE PRECISION NOT NULL,
      assigned_claim_id UUID NULL REFERENCES land_claims(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      ledger_block_index INTEGER NOT NULL REFERENCES chain_blocks(block_index),
      ledger_block_hash TEXT NOT NULL
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS owned_parcels_owner_idx
    ON owned_parcels (owner_user_id, created_at DESC);
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS gov_boundaries (
      id UUID PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      location TEXT NOT NULL,
      polygon JSONB NOT NULL,
      centroid_lat DOUBLE PRECISION NOT NULL,
      centroid_lng DOUBLE PRECISION NOT NULL,
      area_sq_m DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      is_preset BOOLEAN NOT NULL DEFAULT false,
      created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      ledger_block_index INTEGER NOT NULL REFERENCES chain_blocks(block_index),
      ledger_block_hash TEXT NOT NULL
    );
  `);

  await query(`
    ALTER TABLE gov_boundaries
    ADD COLUMN IF NOT EXISTS code TEXT;
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS gov_boundaries_code_unique_idx
    ON gov_boundaries (code);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS gov_boundaries_status_idx
    ON gov_boundaries (status);
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS dispute_events (
      id UUID PRIMARY KEY,
      dispute_id UUID NOT NULL REFERENCES land_disputes(id) ON DELETE CASCADE,
      actor_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      from_status TEXT NULL,
      to_status TEXT NULL,
      note TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      ledger_block_index INTEGER NOT NULL REFERENCES chain_blocks(block_index),
      ledger_block_hash TEXT NOT NULL
    );
  `);
};

export const initDatabase = async () => {
  if (pool) return;

  const persistencePreference = normalizePersistenceMode(process.env.PERSISTENCE_MODE || 'auto');
  const allowMemoryFallback = toBool(process.env.ALLOW_MEMORY_FALLBACK, true);

  if (persistencePreference === 'memory') {
    pool = await connectMemoryPool();
    persistenceMode = 'memory';
    await bootstrapSchema();
    console.log('Memory database initialized (PERSISTENCE_MODE=memory).');
    return;
  }

  const candidates = buildFallbackCandidates();
  const errors = [];

  for (const candidate of candidates) {
    try {
      pool = await connectPool(candidate.config);
      persistenceMode = 'postgresql';
      console.log(`PostgreSQL connected (${candidate.label}: ${formatConfigHint(candidate.config)})`);
      await bootstrapSchema();
      return;
    } catch (error) {
      errors.push(
        `${candidate.label} (${formatConfigHint(candidate.config)}): ${error.code || 'UNKNOWN'} ${error.message}`
      );
    }
  }

  const summary = errors.join(' | ');

  if (persistencePreference === 'auto' && allowMemoryFallback) {
    pool = await connectMemoryPool();
    persistenceMode = 'memory';
    await bootstrapSchema();
    console.warn(`PostgreSQL unavailable. Falling back to in-memory mode. ${summary}`);
    return;
  }

  throw new Error(
    `Unable to connect to PostgreSQL. Tried fallbacks. ${summary}.` +
      ` Set PERSISTENCE_MODE=memory for demo runs or fix DB credentials in .env.`
  );
};

export const closeDatabase = async () => {
  if (!pool) return;
  await pool.end();
  pool = null;
  persistenceMode = 'postgresql';
};
