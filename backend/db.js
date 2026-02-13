import { Pool } from 'pg';

const toBool = (value, fallback = false) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

const buildPoolConfig = () => {
  const connectionString = process.env.DATABASE_URL;
  const sslEnabled = toBool(process.env.DATABASE_SSL, false);
  const ssl = sslEnabled ? { rejectUnauthorized: false } : false;

  if (connectionString) {
    return { connectionString, ssl };
  }

  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'root_land',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl,
  };
};

export const pool = new Pool(buildPoolConfig());

export const query = (text, params = []) => pool.query(text, params);

export const withTransaction = async (handler) => {
  const client = await pool.connect();
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
      wallet_address TEXT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      last_login_at TIMESTAMPTZ NULL
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
};

export const initDatabase = async () => {
  await bootstrapSchema();
};
