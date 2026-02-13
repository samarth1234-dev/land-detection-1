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
    payload: { note: 'TerraTrust auth chain initialized' },
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
    service: 'terratrust-auth-api',
    blockchainIntegrity: integrity.valid,
    totalBlocks: chain.length,
  });
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
