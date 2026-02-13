import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import bcrypt from 'bcryptjs';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import jwt from 'jsonwebtoken';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.API_PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || 'replace-me-with-a-strong-secret';
const TOKEN_EXPIRY = process.env.TOKEN_EXPIRY || '7d';
const CORS_ORIGINS = (process.env.CORS_ORIGIN || 'http://127.0.0.1:3000,http://localhost:3000')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHAIN_FILE = path.join(DATA_DIR, 'auth-chain.json');

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

const safeReadJson = async (filePath, fallbackValue) => {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return fallbackValue;
  }
};

const writeJson = async (filePath, value) => {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
};

const ensureDataStore = async () => {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const users = await safeReadJson(USERS_FILE, null);
  if (!Array.isArray(users)) {
    await writeJson(USERS_FILE, []);
  }

  const chain = await safeReadJson(CHAIN_FILE, null);
  if (!Array.isArray(chain) || !chain.length) {
    await writeJson(CHAIN_FILE, [createGenesisBlock()]);
  }
};

const readUsers = () => safeReadJson(USERS_FILE, []);
const writeUsers = (users) => writeJson(USERS_FILE, users);

const readChain = () => safeReadJson(CHAIN_FILE, [createGenesisBlock()]);
const writeChain = (chain) => writeJson(CHAIN_FILE, chain);

const toPublicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  walletAddress: user.walletAddress,
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt,
});

const createToken = (user) =>
  jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      walletAddress: user.walletAddress || null,
    },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );

const appendAuthBlock = async (eventType, payload) => {
  const chain = await readChain();
  const previous = chain[chain.length - 1];

  const blockBase = {
    index: chain.length,
    timestamp: new Date().toISOString(),
    eventType,
    payload,
    previousHash: previous.hash,
    nonce: 0,
  };

  const block = { ...blockBase, hash: hashBlock(blockBase) };
  chain.push(block);
  await writeChain(chain);
  return block;
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
  } catch (error) {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};

app.get('/api/health', async (_req, res) => {
  const chain = await readChain();
  const integrity = verifyChainIntegrity(chain);
  res.json({
    status: 'ok',
    service: 'root-auth-api',
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

    const block = await appendAuthBlock('AGRI_INSIGHT_GENERATED', {
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
      ndviMean: Number(ndviMean.toFixed(4)),
      topCrop: insight.recommendedCrops[0]?.name || null,
    });

    res.json({
      generatedAt: new Date().toISOString(),
      weather: {
        rainfall7d: Number(rainfall7d.toFixed(2)),
        maxTempAvg: Number(maxTempAvg.toFixed(2)),
        minTempAvg: Number(minTempAvg.toFixed(2)),
      },
      ndvi: {
        mean: Number(ndviMean.toFixed(4)),
        min: Number.isFinite(Number(ndviStats.min)) ? Number(Number(ndviStats.min).toFixed(4)) : null,
        max: Number.isFinite(Number(ndviStats.max)) ? Number(Number(ndviStats.max).toFixed(4)) : null,
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

    const users = await readUsers();
    const alreadyExists = users.some((user) => user.email === email);
    if (alreadyExists) {
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

    users.push(newUser);
    await writeUsers(users);

    const block = await appendAuthBlock('USER_SIGNUP', {
      userId: newUser.id,
      email: newUser.email,
      walletAddress: newUser.walletAddress,
    });

    const token = createToken(newUser);
    res.status(201).json({
      message: 'Signup successful.',
      token,
      user: toPublicUser(newUser),
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

    const users = await readUsers();
    const user = users.find((item) => item.email === email);
    if (!user) {
      res.status(401).json({ message: 'Invalid email or password.' });
      return;
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ message: 'Invalid email or password.' });
      return;
    }

    user.lastLoginAt = new Date().toISOString();
    await writeUsers(users);

    const block = await appendAuthBlock('USER_LOGIN', {
      userId: user.id,
      email: user.email,
    });

    const token = createToken(user);
    res.json({
      message: 'Login successful.',
      token,
      user: toPublicUser(user),
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
  const users = await readUsers();
  const user = users.find((item) => item.id === req.auth.sub);

  if (!user) {
    res.status(404).json({ message: 'User not found.' });
    return;
  }

  res.json({ user: toPublicUser(user) });
});

app.get('/api/auth/chain/verify', async (_req, res) => {
  const chain = await readChain();
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

await ensureDataStore();

app.listen(PORT, () => {
  console.log(`Auth API running on http://127.0.0.1:${PORT}`);
  if (JWT_SECRET === 'replace-me-with-a-strong-secret') {
    console.warn('Using fallback JWT secret. Set JWT_SECRET in .env for production.');
  }
});
