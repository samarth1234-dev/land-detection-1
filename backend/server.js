import crypto from 'crypto';

import bcrypt from 'bcryptjs';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import jwt from 'jsonwebtoken';

import { initDatabase, pool, query, withTransaction } from './db.js';

dotenv.config();

const PORT = Number(process.env.API_PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || 'replace-me-with-a-strong-secret';
const TOKEN_EXPIRY = process.env.TOKEN_EXPIRY || '7d';
const CORS_ORIGINS = (process.env.CORS_ORIGIN || 'http://127.0.0.1:3000,http://localhost:3000')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || CORS_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);

const hashBlock = (block) =>
  crypto
    .createHash('sha256')
    .update(
      `${block.index}|${block.timestamp}|${block.eventType}|${JSON.stringify(block.payload)}|${block.previousHash}|${block.nonce}`
    )
    .digest('hex');

const createGenesisBlock = () => {
  const base = {
    index: 0,
    timestamp: '2026-01-01T00:00:00.000Z',
    eventType: 'GENESIS',
    payload: { note: 'ROOT auth chain initialized' },
    previousHash: '0',
    nonce: 0,
  };
  return {
    ...base,
    hash: hashBlock(base),
  };
};

const toIso = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const toPublicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  walletAddress: user.wallet_address,
  createdAt: toIso(user.created_at),
  lastLoginAt: toIso(user.last_login_at),
});

const toChainBlock = (row) => ({
  index: row.block_index,
  timestamp: row.block_timestamp,
  eventType: row.event_type,
  payload: row.payload,
  previousHash: row.previous_hash,
  nonce: row.nonce,
  hash: row.hash,
});

const createToken = (user) =>
  jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      walletAddress: user.wallet_address || null,
    },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );

const getChainBlocks = async () => {
  const result = await query('SELECT * FROM chain_blocks ORDER BY block_index ASC');
  return result.rows.map(toChainBlock);
};

const ensureGenesisBlock = async () => {
  const countResult = await query('SELECT COUNT(*)::int AS count FROM chain_blocks');
  const count = countResult.rows[0]?.count || 0;
  if (count > 0) return;

  const genesis = createGenesisBlock();
  await query(
    `
      INSERT INTO chain_blocks
      (block_index, block_timestamp, event_type, payload, previous_hash, nonce, hash)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
    `,
    [
      genesis.index,
      genesis.timestamp,
      genesis.eventType,
      JSON.stringify(genesis.payload),
      genesis.previousHash,
      genesis.nonce,
      genesis.hash,
    ]
  );
};

const appendChainBlock = async (eventType, payload) => {
  return withTransaction(async (client) => {
    const latestResult = await client.query(
      'SELECT block_index, hash FROM chain_blocks ORDER BY block_index DESC LIMIT 1 FOR UPDATE'
    );
    const latest = latestResult.rows[0];

    const blockBase = {
      index: latest ? Number(latest.block_index) + 1 : 0,
      timestamp: new Date().toISOString(),
      eventType,
      payload,
      previousHash: latest ? latest.hash : '0',
      nonce: 0,
    };
    const hash = hashBlock(blockBase);

    const insertResult = await client.query(
      `
        INSERT INTO chain_blocks
        (block_index, block_timestamp, event_type, payload, previous_hash, nonce, hash)
        VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
        RETURNING *
      `,
      [
        blockBase.index,
        blockBase.timestamp,
        blockBase.eventType,
        JSON.stringify(blockBase.payload),
        blockBase.previousHash,
        blockBase.nonce,
        hash,
      ]
    );

    return toChainBlock(insertResult.rows[0]);
  });
};

const verifyChainIntegrity = (chain) => {
  if (!Array.isArray(chain) || !chain.length) {
    return { valid: false, reason: 'Chain is empty' };
  }

  for (let i = 0; i < chain.length; i += 1) {
    const current = chain[i];
    const expectedHash = hashBlock({
      index: current.index,
      timestamp: current.timestamp,
      eventType: current.eventType,
      payload: current.payload,
      previousHash: current.previousHash,
      nonce: current.nonce,
    });

    if (current.hash !== expectedHash) {
      return { valid: false, reason: `Hash mismatch at block ${i}` };
    }

    if (i > 0 && current.previousHash !== chain[i - 1].hash) {
      return { valid: false, reason: `Broken previousHash link at block ${i}` };
    }
  }

  return { valid: true, reason: null };
};

const clampNumber = (value, min, max) => Math.max(min, Math.min(max, value));

const average = (values = []) => {
  if (!Array.isArray(values) || !values.length) return 0;
  const total = values.reduce((sum, value) => sum + Number(value || 0), 0);
  return total / values.length;
};

const scoreWindow = (value, min, max, tolerance = 6) => {
  if (value >= min && value <= max) return 1;
  const distance = value < min ? min - value : value - max;
  const score = 1 - distance / tolerance;
  return clampNumber(score, 0, 1);
};

const deriveAgricultureInsights = ({ ndviMean, rainfall7d, maxTempAvg, minTempAvg }) => {
  const cropModels = [
    { name: 'Rice', ndvi: [0.35, 0.9], temp: [24, 34], rain: [25, 120] },
    { name: 'Wheat', ndvi: [0.2, 0.75], temp: [14, 28], rain: [5, 45] },
    { name: 'Maize', ndvi: [0.25, 0.85], temp: [18, 32], rain: [10, 70] },
    { name: 'Millet', ndvi: [0.1, 0.65], temp: [20, 36], rain: [0, 35] },
    { name: 'Pulses', ndvi: [0.18, 0.7], temp: [18, 32], rain: [5, 55] },
  ];

  const recommendedCrops = cropModels
    .map((crop) => {
      const ndviScore = scoreWindow(ndviMean, crop.ndvi[0], crop.ndvi[1], 0.3);
      const tempScore = scoreWindow(maxTempAvg, crop.temp[0], crop.temp[1], 8);
      const rainScore = scoreWindow(rainfall7d, crop.rain[0], crop.rain[1], 35);
      const totalScore = Math.round((ndviScore * 0.5 + tempScore * 0.3 + rainScore * 0.2) * 100);

      return {
        name: crop.name,
        suitability: totalScore,
      };
    })
    .sort((a, b) => b.suitability - a.suitability)
    .slice(0, 3);

  let irrigation = 'Low irrigation need (~5-10 mm/week).';
  if (rainfall7d < 15 && maxTempAvg >= 30) {
    irrigation = 'High irrigation need (~25-35 mm/week).';
  } else if (rainfall7d < 30) {
    irrigation = 'Moderate irrigation need (~15-25 mm/week).';
  }

  const risks = [];
  if (rainfall7d < 10) risks.push('Dry spell risk in next 7 days');
  if (maxTempAvg > 34) risks.push('Heat stress risk for sensitive crops');
  if (ndviMean < 0.18) risks.push('Low vegetation vigor; consider soil conditioning');
  if (minTempAvg < 10) risks.push('Night-time cold stress possible');
  if (!risks.length) risks.push('No major short-term agricultural risk detected');

  const vegetationCondition =
    ndviMean >= 0.45 ? 'Healthy dense vegetation' :
    ndviMean >= 0.25 ? 'Moderate active vegetation' :
    ndviMean >= 0.1 ? 'Sparse vegetation' :
    'Very low vegetation cover';

  return {
    summary: `${vegetationCondition}. Weekly rainfall ${rainfall7d.toFixed(1)} mm, avg max temp ${maxTempAvg.toFixed(1)} C.`,
    recommendedCrops,
    irrigation,
    risks,
  };
};

const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ message: 'Missing bearer token' });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.auth = payload;
    next();
  } catch (_error) {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};

const readOptionalUserId = (req) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload?.sub || null;
  } catch (_error) {
    return null;
  }
};

app.get('/api/health', async (_req, res) => {
  const chain = await getChainBlocks();
  const integrity = verifyChainIntegrity(chain);
  res.json({
    status: 'ok',
    service: 'root-auth-api',
    persistence: 'postgresql',
    blockchainIntegrity: integrity.valid,
    totalBlocks: chain.length,
  });
});

app.post('/api/agri/insights', async (req, res) => {
  try {
    const coords = Array.isArray(req.body?.coords) ? req.body.coords : [];
    const ndviStats = req.body?.ndviStats || {};

    const lat = Number(coords[0]);
    const lng = Number(coords[1]);
    const ndviMean = Number(ndviStats.mean);
    const ndviMin = Number(ndviStats.min);
    const ndviMax = Number(ndviStats.max);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ message: 'Valid coords [lat, lng] are required.' });
      return;
    }

    if (!Number.isFinite(ndviMean)) {
      res.status(400).json({ message: 'Valid ndviStats.mean is required.' });
      return;
    }

    const weatherUrl = new URL('https://api.open-meteo.com/v1/forecast');
    weatherUrl.searchParams.set('latitude', String(lat));
    weatherUrl.searchParams.set('longitude', String(lng));
    weatherUrl.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum');
    weatherUrl.searchParams.set('forecast_days', '7');
    weatherUrl.searchParams.set('timezone', 'auto');

    const weatherResponse = await fetch(weatherUrl);
    if (!weatherResponse.ok) {
      const message = await weatherResponse.text();
      throw new Error(`Weather API failed: ${message || weatherResponse.status}`);
    }

    const weatherPayload = await weatherResponse.json();
    const daily = weatherPayload?.daily || {};
    const maxTemps = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max : [];
    const minTemps = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min : [];
    const precipitation = Array.isArray(daily.precipitation_sum) ? daily.precipitation_sum : [];

    const maxTempAvg = average(maxTemps);
    const minTempAvg = average(minTemps);
    const rainfall7d = precipitation.reduce((sum, value) => sum + Number(value || 0), 0);

    const insight = deriveAgricultureInsights({
      ndviMean,
      rainfall7d,
      maxTempAvg,
      minTempAvg,
    });

    const userId = readOptionalUserId(req);
    const block = await appendChainBlock('AGRI_INSIGHT_GENERATED', {
      userId,
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
      ndviMean: Number(ndviMean.toFixed(4)),
      topCrop: insight.recommendedCrops[0]?.name || null,
    });

    const insightId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    await query(
      `
        INSERT INTO agri_insights (
          id, user_id, latitude, longitude, ndvi_mean, ndvi_min, ndvi_max,
          rainfall_7d, max_temp_avg, min_temp_avg,
          summary, recommended_crops, irrigation, risks, input_payload,
          created_at, ledger_block_index, ledger_block_hash
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10,
          $11, $12::jsonb, $13, $14::jsonb, $15::jsonb,
          $16, $17, $18
        )
      `,
      [
        insightId,
        userId,
        lat,
        lng,
        ndviMean,
        Number.isFinite(ndviMin) ? ndviMin : null,
        Number.isFinite(ndviMax) ? ndviMax : null,
        rainfall7d,
        maxTempAvg,
        minTempAvg,
        insight.summary,
        JSON.stringify(insight.recommendedCrops),
        insight.irrigation,
        JSON.stringify(insight.risks),
        JSON.stringify(req.body || {}),
        createdAt,
        block.index,
        block.hash,
      ]
    );

    res.json({
      id: insightId,
      generatedAt: createdAt,
      weather: {
        rainfall7d: Number(rainfall7d.toFixed(2)),
        maxTempAvg: Number(maxTempAvg.toFixed(2)),
        minTempAvg: Number(minTempAvg.toFixed(2)),
      },
      ndvi: {
        mean: Number(ndviMean.toFixed(4)),
        min: Number.isFinite(ndviMin) ? Number(ndviMin.toFixed(4)) : null,
        max: Number.isFinite(ndviMax) ? Number(ndviMax.toFixed(4)) : null,
      },
      ...insight,
      ledgerBlock: {
        index: block.index,
        hash: block.hash,
        eventType: block.eventType,
        timestamp: block.timestamp,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to generate agricultural insights.', error: error.message });
  }
});

app.get('/api/agri/insights/history', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      `
        SELECT
          id, latitude, longitude, ndvi_mean, ndvi_min, ndvi_max,
          rainfall_7d, max_temp_avg, min_temp_avg, summary,
          recommended_crops, irrigation, risks, created_at,
          ledger_block_index, ledger_block_hash
        FROM agri_insights
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 50
      `,
      [req.auth.sub]
    );

    const items = result.rows.map((row) => ({
      id: row.id,
      coords: [row.latitude, row.longitude],
      ndvi: {
        mean: row.ndvi_mean,
        min: row.ndvi_min,
        max: row.ndvi_max,
      },
      weather: {
        rainfall7d: row.rainfall_7d,
        maxTempAvg: row.max_temp_avg,
        minTempAvg: row.min_temp_avg,
      },
      summary: row.summary,
      recommendedCrops: row.recommended_crops,
      irrigation: row.irrigation,
      risks: row.risks,
      createdAt: toIso(row.created_at),
      ledgerBlock: {
        index: row.ledger_block_index,
        hash: row.ledger_block_hash,
      },
    }));

    res.json({ items });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch agricultural insights history.', error: error.message });
  }
});

app.post('/api/auth/signup', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const walletAddress = String(req.body?.walletAddress || '').trim();

    if (!name || !email || !password) {
      res.status(400).json({ message: 'Name, email, and password are required.' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ message: 'Password must be at least 6 characters.' });
      return;
    }

    const existingResult = await query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
    if (existingResult.rows.length > 0) {
      res.status(409).json({ message: 'Email already registered.' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const newUser = {
      id: crypto.randomUUID(),
      name,
      email,
      walletAddress: walletAddress || null,
      passwordHash,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    };

    await query(
      `
        INSERT INTO users
        (id, name, email, wallet_address, password_hash, created_at, last_login_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        newUser.id,
        newUser.name,
        newUser.email,
        newUser.walletAddress,
        newUser.passwordHash,
        newUser.createdAt,
        newUser.lastLoginAt,
      ]
    );

    const block = await appendChainBlock('USER_SIGNUP', {
      userId: newUser.id,
      email: newUser.email,
      walletAddress: newUser.walletAddress,
      name: newUser.name,
    });

    const token = createToken({
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      wallet_address: newUser.walletAddress,
    });

    res.status(201).json({
      message: 'Signup successful.',
      token,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        walletAddress: newUser.walletAddress,
        createdAt: newUser.createdAt,
        lastLoginAt: newUser.lastLoginAt,
      },
      ledgerBlock: {
        index: block.index,
        hash: block.hash,
        eventType: block.eventType,
        timestamp: block.timestamp,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Signup failed.', error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      res.status(400).json({ message: 'Email and password are required.' });
      return;
    }

    const userResult = await query('SELECT * FROM users WHERE email = $1 LIMIT 1', [email]);
    const user = userResult.rows[0];
    if (!user) {
      await appendChainBlock('USER_LOGIN_FAILED', { email, reason: 'invalid_credentials' });
      res.status(401).json({ message: 'Invalid email or password.' });
      return;
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      await appendChainBlock('USER_LOGIN_FAILED', { email, reason: 'invalid_credentials' });
      res.status(401).json({ message: 'Invalid email or password.' });
      return;
    }

    const lastLoginAt = new Date().toISOString();
    await query('UPDATE users SET last_login_at = $1 WHERE id = $2', [lastLoginAt, user.id]);
    const updatedUser = { ...user, last_login_at: lastLoginAt };

    const block = await appendChainBlock('USER_LOGIN', {
      userId: user.id,
      email: user.email,
    });

    const token = createToken(updatedUser);
    res.json({
      message: 'Login successful.',
      token,
      user: toPublicUser(updatedUser),
      ledgerBlock: {
        index: block.index,
        hash: block.hash,
        eventType: block.eventType,
        timestamp: block.timestamp,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Login failed.', error: error.message });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const result = await query('SELECT * FROM users WHERE id = $1 LIMIT 1', [req.auth.sub]);
  const user = result.rows[0];

  if (!user) {
    res.status(404).json({ message: 'User not found.' });
    return;
  }

  res.json({ user: toPublicUser(user) });
});

app.get('/api/auth/chain/verify', async (_req, res) => {
  const chain = await getChainBlocks();
  const integrity = verifyChainIntegrity(chain);
  const lastBlock = chain[chain.length - 1];

  res.json({
    valid: integrity.valid,
    reason: integrity.reason,
    totalBlocks: chain.length,
    lastHash: lastBlock?.hash || null,
  });
});

app.use((error, _req, res, _next) => {
  const status = error.message?.startsWith('CORS blocked') ? 403 : 500;
  res.status(status).json({ message: error.message || 'Internal server error.' });
});

await initDatabase();
await ensureGenesisBlock();

app.listen(PORT, () => {
  console.log(`Auth API running on http://127.0.0.1:${PORT}`);
  console.log('Persistence: PostgreSQL');
  if (JWT_SECRET === 'replace-me-with-a-strong-secret') {
    console.warn('Using fallback JWT secret. Set JWT_SECRET in .env for production.');
  }
});

process.on('SIGINT', async () => {
  await pool.end();
  process.exit(0);
});
