import crypto from 'crypto';

import bcrypt from 'bcryptjs';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import jwt from 'jsonwebtoken';

import { closeDatabase, getPersistenceMode, initDatabase, query, withTransaction } from './db.js';

dotenv.config();

const PORT = Number(process.env.API_PORT || process.env.PORT || 4000);
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

let databaseReady = false;
const USER_ROLES = new Set(['USER', 'EMPLOYEE']);
const EMPLOYEE_SIGNUP_CODE = String(process.env.EMPLOYEE_SIGNUP_CODE || '').trim();
const EMPLOYEE_ID_REGEX = /^1947\d{4,}$/;
const CLAIM_STATUSES = new Set(['PENDING', 'FLAGGED', 'APPROVED', 'REJECTED']);

const normalizeRole = (value) => {
  const role = String(value || '').trim().toUpperCase();
  return USER_ROLES.has(role) ? role : 'USER';
};

const isEmployeeAuth = (auth) => normalizeRole(auth?.role) === 'EMPLOYEE';
const isValidGovernmentEmail = (email) => {
  const normalized = String(email || '').trim().toLowerCase();
  return normalized.endsWith('.in') || normalized.endsWith('gov.in');
};
const httpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

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
  role: normalizeRole(user.role),
  employeeId: user.employee_id || null,
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
      role: normalizeRole(user.role),
      employeeId: user.employee_id || null,
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

const insertChainBlock = async (client, eventType, payload) => {
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
};

const appendChainBlock = async (eventType, payload) =>
  withTransaction((client) => insertChainBlock(client, eventType, payload));

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

const DISPUTE_STATUSES = new Set(['OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED']);
const DISPUTE_TYPES = new Set([
  'BOUNDARY',
  'OWNERSHIP',
  'ENCROACHMENT',
  'LAND_USE_VIOLATION',
  'DOCUMENT_FRAUD',
  'ACCESS_RIGHT',
]);
const DISPUTE_PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

const normalizeToken = (value) => String(value || '').trim().toUpperCase().replaceAll(' ', '_');

const sanitizeEvidenceUrls = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter((item) => item.length > 0)
    .slice(0, 8);
};

const stableStringify = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `"${key}":${stableStringify(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
};

const sha256Hex = (value) =>
  crypto
    .createHash('sha256')
    .update(typeof value === 'string' ? value : stableStringify(value))
    .digest('hex');

const toCoordPair = (value) => {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lat = Number(value[0]);
  const lng = Number(value[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
};

const sanitizeSelectionBounds = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const northWest = toCoordPair(value.northWest);
  const northEast = toCoordPair(value.northEast);
  const southWest = toCoordPair(value.southWest);
  const southEast = toCoordPair(value.southEast);
  const center = toCoordPair(value.center);

  if (!northWest || !northEast || !southWest || !southEast) return null;

  const derivedCenter = center || [
    Number(((northWest[0] + southEast[0]) / 2).toFixed(6)),
    Number(((northWest[1] + southEast[1]) / 2).toFixed(6)),
  ];

  return {
    northWest,
    northEast,
    southWest,
    southEast,
    center: derivedCenter,
  };
};

const sanitizePolygon = (value) => {
  if (!Array.isArray(value) || value.length < 3) return null;
  const points = value
    .map((point) => toCoordPair(point))
    .filter(Boolean)
    .slice(0, 80);

  if (points.length < 3) return null;
  const deduped = [];
  for (const point of points) {
    const prev = deduped[deduped.length - 1];
    if (!prev || prev[0] !== point[0] || prev[1] !== point[1]) {
      deduped.push(point);
    }
  }
  if (deduped.length < 3) return null;

  const first = deduped[0];
  const last = deduped[deduped.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) {
    deduped.pop();
  }
  return deduped.length >= 3 ? deduped : null;
};

const polygonToLocalMeters = (polygon) => {
  const lat0 = polygon.reduce((sum, point) => sum + point[0], 0) / polygon.length;
  const cosLat = Math.cos((lat0 * Math.PI) / 180);
  return polygon.map(([lat, lng]) => ({
    x: lng * 111320 * cosLat,
    y: lat * 110540,
  }));
};

const polygonAreaSqM = (polygon) => {
  if (!Array.isArray(polygon) || polygon.length < 3) return 0;
  const local = polygonToLocalMeters(polygon);
  let area2 = 0;
  for (let i = 0; i < local.length; i += 1) {
    const a = local[i];
    const b = local[(i + 1) % local.length];
    area2 += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area2) / 2;
};

const polygonCentroid = (polygon) => {
  if (!Array.isArray(polygon) || polygon.length < 3) return null;
  const local = polygonToLocalMeters(polygon);
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < local.length; i += 1) {
    const a = local[i];
    const b = local[(i + 1) % local.length];
    const cross = a.x * b.y - b.x * a.y;
    area2 += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(area2) < 1e-8) {
    const lat = polygon.reduce((sum, point) => sum + point[0], 0) / polygon.length;
    const lng = polygon.reduce((sum, point) => sum + point[1], 0) / polygon.length;
    return [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
  }

  const factor = 1 / (3 * area2);
  const centroidX = cx * factor;
  const centroidY = cy * factor;
  const lat0 = polygon.reduce((sum, point) => sum + point[0], 0) / polygon.length;
  const cosLat = Math.cos((lat0 * Math.PI) / 180) || 1e-6;
  const lng = centroidX / (111320 * cosLat);
  const lat = centroidY / 110540;
  return [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
};

const polygonBounds = (polygon) => {
  const lats = polygon.map((point) => point[0]);
  const lngs = polygon.map((point) => point[1]);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };
};

const boxesOverlap = (a, b) =>
  !(a.maxLat < b.minLat || a.minLat > b.maxLat || a.maxLng < b.minLng || a.minLng > b.maxLng);

const orientation = (a, b, c) => {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(value) < 1e-10) return 0;
  return value > 0 ? 1 : 2;
};

const onSegment = (a, b, c) =>
  Math.min(a[0], c[0]) <= b[0] &&
  b[0] <= Math.max(a[0], c[0]) &&
  Math.min(a[1], c[1]) <= b[1] &&
  b[1] <= Math.max(a[1], c[1]);

const segmentsIntersect = (p1, q1, p2, q2) => {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
};

const pointInPolygon = (point, polygon) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][1];
    const yi = polygon[i][0];
    const xj = polygon[j][1];
    const yj = polygon[j][0];
    const intersects =
      yi > point[0] !== yj > point[0] &&
      point[1] < ((xj - xi) * (point[0] - yi)) / ((yj - yi) || 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
};

const polygonsOverlap = (polygonA, polygonB) => {
  if (!Array.isArray(polygonA) || !Array.isArray(polygonB) || polygonA.length < 3 || polygonB.length < 3) {
    return false;
  }
  if (!boxesOverlap(polygonBounds(polygonA), polygonBounds(polygonB))) return false;

  for (let i = 0; i < polygonA.length; i += 1) {
    const a1 = polygonA[i];
    const a2 = polygonA[(i + 1) % polygonA.length];
    for (let j = 0; j < polygonB.length; j += 1) {
      const b1 = polygonB[j];
      const b2 = polygonB[(j + 1) % polygonB.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }

  if (pointInPolygon(polygonA[0], polygonB)) return true;
  if (pointInPolygon(polygonB[0], polygonA)) return true;
  return false;
};

const buildDisputeSnapshot = ({
  parcelRef,
  disputeType,
  description,
  coords,
  selectionBounds,
  status,
  priority,
  evidenceUrls,
  resolutionNote,
}) => ({
  parcelRef: String(parcelRef || '').trim(),
  disputeType: normalizeToken(disputeType),
  description: String(description || '').trim(),
  coords: toCoordPair(coords) || null,
  selectionBounds: sanitizeSelectionBounds(selectionBounds),
  status: normalizeToken(status || 'OPEN'),
  priority: normalizeToken(priority || 'MEDIUM'),
  evidenceUrls: sanitizeEvidenceUrls(evidenceUrls),
  resolutionNote: String(resolutionNote || '').trim() || null,
});

const disputeSnapshotHash = (snapshot) => sha256Hex(snapshot);

const disputeRowToSnapshot = (row) =>
  buildDisputeSnapshot({
    parcelRef: row.parcel_ref,
    disputeType: row.dispute_type,
    description: row.description,
    coords: [row.latitude, row.longitude],
    selectionBounds: row.selection_bounds,
    status: row.status,
    priority: row.priority,
    evidenceUrls: row.evidence_urls,
    resolutionNote: row.resolution_note,
  });

const toDisputeRecord = (row) => {
  const hasCoords = Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude));
  const snapshotHash = disputeSnapshotHash(disputeRowToSnapshot(row));
  return {
    id: row.id,
    parcelRef: row.parcel_ref,
    disputeType: row.dispute_type,
    description: row.description,
    coords: hasCoords ? [Number(row.latitude), Number(row.longitude)] : null,
    selectionBounds:
      row.selection_bounds && typeof row.selection_bounds === 'object' && !Array.isArray(row.selection_bounds)
        ? row.selection_bounds
        : null,
    status: row.status,
    priority: row.priority,
    evidenceUrls: Array.isArray(row.evidence_urls) ? row.evidence_urls : [],
    resolutionNote: row.resolution_note || null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    resolvedAt: toIso(row.resolved_at),
    snapshotHash,
    reporter: row.user_id
      ? {
          id: row.user_id,
          name: row.user_name || 'Unknown user',
          email: row.user_email || null,
          role: normalizeRole(row.user_role),
        }
      : null,
    ledgerBlock: {
      index: row.ledger_block_index,
      hash: row.ledger_block_hash,
    },
  };
};

const toOwnedParcelRecord = (row) => ({
  id: row.id,
  pid: row.pid,
  polygon: Array.isArray(row.polygon) ? row.polygon : [],
  centroid: [Number(row.centroid_lat), Number(row.centroid_lng)],
  areaSqM: Number(row.area_sq_m || 0),
  status: row.status || 'ACTIVE',
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
  owner: row.owner_user_id
    ? {
        id: row.owner_user_id,
        name: row.owner_name || 'Unknown owner',
        email: row.owner_email || null,
      }
    : null,
  assignedClaimId: row.assigned_claim_id || null,
  ledgerBlock: {
    index: row.ledger_block_index,
    hash: row.ledger_block_hash,
  },
});

const toLandClaimRecord = (row) => ({
  id: row.id,
  pid: row.pid,
  claimNote: row.claim_note || '',
  polygon: Array.isArray(row.polygon) ? row.polygon : [],
  centroid: [Number(row.centroid_lat), Number(row.centroid_lng)],
  areaSqM: Number(row.area_sq_m || 0),
  status: row.status || 'PENDING',
  overlapFlags: Array.isArray(row.overlap_flags) ? row.overlap_flags : [],
  reviewNote: row.review_note || null,
  verifiedPid: row.verified_pid || null,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
  reviewedAt: toIso(row.reviewed_at),
  claimant: row.user_id
    ? {
        id: row.user_id,
        name: row.user_name || 'Unknown user',
        email: row.user_email || null,
      }
    : null,
  reviewedBy: row.reviewed_by
    ? {
        id: row.reviewed_by,
        name: row.reviewer_name || 'Unknown reviewer',
        email: row.reviewer_email || null,
      }
    : null,
  ledgerBlock: {
    index: row.ledger_block_index,
    hash: row.ledger_block_hash,
  },
});

const detectClaimOverlaps = async ({ polygon, pid, requesterUserId }) => {
  const overlapFlags = [];

  const existingParcelsResult = await query(
    `
      SELECT op.id, op.pid, op.owner_user_id, op.polygon, u.name AS owner_name, u.email AS owner_email
      FROM owned_parcels op
      LEFT JOIN users u ON u.id = op.owner_user_id
      WHERE op.status = 'ACTIVE'
    `
  );

  for (const parcel of existingParcelsResult.rows) {
    if (String(parcel.pid || '').trim() === String(pid || '').trim()) {
      continue;
    }
    if (polygonsOverlap(polygon, Array.isArray(parcel.polygon) ? parcel.polygon : [])) {
      overlapFlags.push({
        type: 'ACTIVE_PARCEL_OVERLAP',
        targetId: parcel.id,
        pid: parcel.pid,
        ownerUserId: parcel.owner_user_id,
        ownerName: parcel.owner_name || null,
        ownerEmail: parcel.owner_email || null,
      });
    }
  }

  const pendingClaimsResult = await query(
    `
      SELECT lc.id, lc.pid, lc.user_id, lc.polygon, u.name AS user_name, u.email AS user_email
      FROM land_claims lc
      LEFT JOIN users u ON u.id = lc.user_id
      WHERE lc.status IN ('PENDING', 'FLAGGED')
        AND lc.user_id <> $1
    `,
    [requesterUserId]
  );

  for (const claim of pendingClaimsResult.rows) {
    if (String(claim.pid || '').trim() === String(pid || '').trim()) {
      continue;
    }
    if (polygonsOverlap(polygon, Array.isArray(claim.polygon) ? claim.polygon : [])) {
      overlapFlags.push({
        type: 'PENDING_CLAIM_OVERLAP',
        targetId: claim.id,
        pid: claim.pid,
        claimantUserId: claim.user_id,
        claimantName: claim.user_name || null,
        claimantEmail: claim.user_email || null,
      });
    }
  }

  return overlapFlags;
};

const loadParcels = async ({ includeAll, userId }) => {
  const params = [];
  const where = [];
  if (!includeAll) {
    params.push(userId);
    where.push(`op.owner_user_id = $${params.length}`);
  }
  where.push(`op.status = 'ACTIVE'`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const result = await query(
    `
      SELECT
        op.*,
        u.name AS owner_name,
        u.email AS owner_email
      FROM owned_parcels op
      LEFT JOIN users u ON u.id = op.owner_user_id
      ${whereSql}
      ORDER BY op.created_at DESC
      LIMIT 400
    `,
    params
  );
  return result.rows.map(toOwnedParcelRecord);
};

const loadClaims = async ({ includeAll, userId, statuses = [] }) => {
  const params = [];
  const where = [];

  if (!includeAll) {
    params.push(userId);
    where.push(`lc.user_id = $${params.length}`);
  }

  const normalizedStatuses = Array.isArray(statuses)
    ? statuses.map((status) => normalizeToken(status)).filter((status) => CLAIM_STATUSES.has(status))
    : [];

  if (normalizedStatuses.length) {
    params.push(normalizedStatuses);
    where.push(`lc.status = ANY($${params.length}::text[])`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const result = await query(
    `
      SELECT
        lc.*,
        claimant.name AS user_name,
        claimant.email AS user_email,
        reviewer.name AS reviewer_name,
        reviewer.email AS reviewer_email
      FROM land_claims lc
      LEFT JOIN users claimant ON claimant.id = lc.user_id
      LEFT JOIN users reviewer ON reviewer.id = lc.reviewed_by
      ${whereSql}
      ORDER BY lc.updated_at DESC
      LIMIT 500
    `,
    params
  );
  return result.rows.map(toLandClaimRecord);
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
    req.auth = {
      ...payload,
      role: normalizeRole(payload?.role),
      employeeId: payload?.employeeId || null,
    };
    next();
  } catch (_error) {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};

const requireEmployee = (req, res, next) => {
  if (!isEmployeeAuth(req.auth)) {
    res.status(403).json({ message: 'Government employee access required.' });
    return;
  }
  next();
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

const SETTINGS_MAP_LAYERS = new Set(['OSM', 'SAT']);

const toUserSettings = (row) => ({
  organization: row.organization || '',
  roleTitle: row.role_title || '',
  phone: row.phone || '',
  preferredLanguage: row.preferred_language || 'en',
  defaultMapLayer: row.default_map_layer || 'SAT',
  mapDefaultCenter: [Number(row.map_default_lat), Number(row.map_default_lng)],
  mapDefaultZoom: Number(row.map_default_zoom || 12),
  notifications: {
    disputeUpdates: Boolean(row.notify_dispute_updates),
    ndviReady: Boolean(row.notify_ndvi_ready),
    weeklyDigest: Boolean(row.notify_weekly_digest),
  },
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const ensureUserSettings = async (executor, userId) => {
  const runQuery = typeof executor === 'function'
    ? (text, params) => executor(text, params)
    : (text, params) => executor.query(text, params);

  const existing = await runQuery(
    'SELECT * FROM user_settings WHERE user_id = $1 LIMIT 1',
    [userId]
  );
  if (existing.rows[0]) return existing.rows[0];

  const now = new Date().toISOString();
  const inserted = await runQuery(
    `
      INSERT INTO user_settings (
        user_id, organization, role_title, phone, preferred_language, default_map_layer,
        map_default_lat, map_default_lng, map_default_zoom,
        notify_dispute_updates, notify_ndvi_ready, notify_weekly_digest,
        created_at, updated_at
      )
      VALUES (
        $1, '', '', '', 'en', 'SAT',
        28.6139, 77.2090, 12,
        true, true, false,
        $2, $2
      )
      RETURNING *
    `,
    [userId, now]
  );
  return inserted.rows[0];
};

const normalizeText = (value, maxLength = 140) =>
  String(value || '')
    .trim()
    .slice(0, maxLength);

const sanitizePreferredLanguage = (value) => {
  const normalized = normalizeText(value, 12).toLowerCase();
  return normalized || 'en';
};

const sanitizeMapCenter = (value) => {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lat = Number(value[0]);
  const lng = Number(value[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
};

app.use((req, res, next) => {
  if (databaseReady || req.path === '/api/health') {
    next();
    return;
  }

  res.status(503).json({
    message: 'Database is initializing. Please retry in a few seconds.',
    status: 'starting',
  });
});

app.get('/api/health', async (_req, res) => {
  const persistence = getPersistenceMode();
  if (!databaseReady) {
    res.json({
      status: 'starting',
      service: 'root-auth-api',
      persistence,
      blockchainIntegrity: false,
      totalBlocks: 0,
      totalDisputes: 0,
      totalClaims: 0,
      totalParcels: 0,
    });
    return;
  }

  const chain = await getChainBlocks();
  const [disputeCountResult, claimCountResult, parcelCountResult] = await Promise.all([
    query('SELECT COUNT(*)::int AS count FROM land_disputes'),
    query('SELECT COUNT(*)::int AS count FROM land_claims'),
    query('SELECT COUNT(*)::int AS count FROM owned_parcels'),
  ]);
  const integrity = verifyChainIntegrity(chain);
  res.json({
    status: 'ok',
    service: 'root-auth-api',
    persistence,
    blockchainIntegrity: integrity.valid,
    totalBlocks: chain.length,
    totalDisputes: disputeCountResult.rows[0]?.count || 0,
    totalClaims: claimCountResult.rows[0]?.count || 0,
    totalParcels: parcelCountResult.rows[0]?.count || 0,
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
    const includeAll = isEmployeeAuth(req.auth);
    const params = [];
    const whereClause = includeAll ? '' : 'WHERE ai.user_id = $1';
    if (!includeAll) params.push(req.auth.sub);

    const result = await query(
      `
        SELECT
          ai.id,
          ai.latitude, ai.longitude, ai.ndvi_mean, ai.ndvi_min, ai.ndvi_max,
          ai.rainfall_7d, ai.max_temp_avg, ai.min_temp_avg, ai.summary,
          ai.recommended_crops, ai.irrigation, ai.risks, ai.created_at,
          ai.ledger_block_index, ai.ledger_block_hash,
          ai.user_id,
          u.name AS user_name,
          u.email AS user_email
        FROM agri_insights ai
        LEFT JOIN users u ON u.id = ai.user_id
        ${whereClause}
        ORDER BY ai.created_at DESC
        LIMIT ${includeAll ? 200 : 50}
      `,
      params
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
      user: row.user_id
        ? {
            id: row.user_id,
            name: row.user_name || 'Unknown user',
            email: row.user_email || null,
          }
        : null,
    }));

    res.json({
      scope: includeAll ? 'GLOBAL' : 'USER',
      items,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch agricultural insights history.', error: error.message });
  }
});

app.get('/api/disputes/summary', authMiddleware, async (req, res) => {
  try {
    const includeAll = isEmployeeAuth(req.auth);
    const params = [];
    const whereClause = includeAll ? '' : 'WHERE user_id = $1';
    if (!includeAll) params.push(req.auth.sub);

    const result = await query(
      `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'OPEN')::int AS open,
          COUNT(*) FILTER (WHERE status = 'IN_REVIEW')::int AS in_review,
          COUNT(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved,
          COUNT(*) FILTER (WHERE status = 'REJECTED')::int AS rejected,
          COUNT(*) FILTER (WHERE priority IN ('HIGH', 'CRITICAL') AND status IN ('OPEN', 'IN_REVIEW'))::int AS urgent_open
        FROM land_disputes
        ${whereClause}
      `,
      params
    );

    res.json({
      scope: includeAll ? 'GLOBAL' : 'USER',
      ...(result.rows[0] || {
        total: 0,
        open: 0,
        in_review: 0,
        resolved: 0,
        rejected: 0,
        urgent_open: 0,
      }),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load dispute summary.', error: error.message });
  }
});

app.get('/api/disputes', authMiddleware, async (req, res) => {
  try {
    const statusFilter = req.query?.status ? normalizeToken(req.query.status) : '';
    const scope = String(req.query?.scope || '').trim().toLowerCase();
    const includeAll = isEmployeeAuth(req.auth) && scope !== 'mine';
    if (statusFilter && !DISPUTE_STATUSES.has(statusFilter)) {
      res.status(400).json({ message: `Invalid status filter. Allowed: ${Array.from(DISPUTE_STATUSES).join(', ')}` });
      return;
    }

    const params = [];
    const whereParts = [];
    if (!includeAll) {
      params.push(req.auth.sub);
      whereParts.push(`ld.user_id = $${params.length}`);
    }
    if (statusFilter) {
      params.push(statusFilter);
      whereParts.push(`ld.status = $${params.length}`);
    }
    const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const result = await query(
      `
        SELECT
          ld.id, ld.user_id, ld.parcel_ref, ld.dispute_type, ld.description, ld.latitude, ld.longitude, ld.selection_bounds,
          ld.status, ld.priority, ld.evidence_urls, ld.resolution_note,
          ld.created_at, ld.updated_at, ld.resolved_at,
          ld.ledger_block_index, ld.ledger_block_hash,
          u.name AS user_name,
          u.email AS user_email,
          u.role AS user_role
        FROM land_disputes ld
        LEFT JOIN users u ON u.id = ld.user_id
        ${whereClause}
        ORDER BY ld.updated_at DESC
        LIMIT 100
      `,
      params
    );

    res.json({
      scope: includeAll ? 'GLOBAL' : 'USER',
      items: result.rows.map(toDisputeRecord),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch land disputes.', error: error.message });
  }
});

app.post('/api/disputes', authMiddleware, async (req, res) => {
  try {
    const parcelRef = String(req.body?.parcelRef || '').trim();
    const disputeType = normalizeToken(req.body?.disputeType);
    const description = String(req.body?.description || '').trim();
    const priority = req.body?.priority ? normalizeToken(req.body?.priority) : 'MEDIUM';
    const coords = Array.isArray(req.body?.coords) ? req.body.coords : null;
    const selectionBounds = sanitizeSelectionBounds(req.body?.selectionBounds);
    const evidenceUrls = sanitizeEvidenceUrls(req.body?.evidenceUrls);

    if (!parcelRef) {
      res.status(400).json({ message: 'parcelRef is required.' });
      return;
    }
    if (!DISPUTE_TYPES.has(disputeType)) {
      res.status(400).json({ message: `Invalid disputeType. Allowed: ${Array.from(DISPUTE_TYPES).join(', ')}` });
      return;
    }
    if (description.length < 15) {
      res.status(400).json({ message: 'description must be at least 15 characters.' });
      return;
    }
    if (!DISPUTE_PRIORITIES.has(priority)) {
      res.status(400).json({ message: `Invalid priority. Allowed: ${Array.from(DISPUTE_PRIORITIES).join(', ')}` });
      return;
    }
    if (req.body?.selectionBounds && !selectionBounds) {
      res.status(400).json({ message: 'selectionBounds is invalid. Use northWest/northEast/southWest/southEast/center coordinate pairs.' });
      return;
    }

    let lat = null;
    let lng = null;
    if (coords) {
      lat = Number(coords[0]);
      lng = Number(coords[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        res.status(400).json({ message: 'coords must be [lat, lng] when provided.' });
        return;
      }
    } else if (selectionBounds?.center) {
      lat = selectionBounds.center[0];
      lng = selectionBounds.center[1];
    }

    const disputeSnapshot = buildDisputeSnapshot({
      parcelRef,
      disputeType,
      description,
      coords: [lat, lng],
      selectionBounds,
      status: 'OPEN',
      priority,
      evidenceUrls,
      resolutionNote: null,
    });
    const snapshotHash = disputeSnapshotHash(disputeSnapshot);

    const payload = await withTransaction(async (client) => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const status = 'OPEN';

      const block = await insertChainBlock(client, 'LAND_DISPUTE_CREATED', {
        userId: req.auth.sub,
        actorRole: normalizeRole(req.auth.role),
        disputeId: id,
        parcelRef,
        disputeType,
        priority,
        hasSelectionBounds: Boolean(selectionBounds),
        snapshotHash,
        status,
      });

      const disputeResult = await client.query(
        `
          INSERT INTO land_disputes (
            id, user_id, parcel_ref, dispute_type, description, latitude, longitude, selection_bounds,
            status, priority, evidence_urls, resolution_note,
            created_at, updated_at, resolved_at,
            ledger_block_index, ledger_block_hash
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8::jsonb,
            $9, $10, $11::jsonb, $12,
            $13, $14, $15,
            $16, $17
          )
          RETURNING *
        `,
        [
          id,
          req.auth.sub,
          parcelRef,
          disputeType,
          description,
          lat,
          lng,
          selectionBounds ? JSON.stringify(selectionBounds) : null,
          status,
          priority,
          JSON.stringify(evidenceUrls),
          null,
          now,
          now,
          null,
          block.index,
          block.hash,
        ]
      );

      await client.query(
        `
          INSERT INTO dispute_events (
            id, dispute_id, actor_user_id, event_type, from_status, to_status, note,
            created_at, ledger_block_index, ledger_block_hash
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          crypto.randomUUID(),
          id,
          req.auth.sub,
          'CREATED',
          null,
          status,
          description.slice(0, 300),
          now,
          block.index,
          block.hash,
        ]
      );

      return {
        item: toDisputeRecord(disputeResult.rows[0]),
        ledgerBlock: {
          index: block.index,
          hash: block.hash,
          eventType: block.eventType,
          timestamp: block.timestamp,
        },
        snapshotHash,
      };
    });

    res.status(201).json(payload);
  } catch (error) {
    res.status(500).json({ message: 'Failed to create land dispute.', error: error.message });
  }
});

app.patch('/api/disputes/:id/status', authMiddleware, async (req, res) => {
  try {
    const disputeId = String(req.params.id || '').trim();
    const nextStatus = normalizeToken(req.body?.status);
    const note = String(req.body?.note || '').trim();
    const includeAll = isEmployeeAuth(req.auth);

    if (!disputeId) {
      res.status(400).json({ message: 'Dispute id is required.' });
      return;
    }
    if (!DISPUTE_STATUSES.has(nextStatus)) {
      res.status(400).json({ message: `Invalid status. Allowed: ${Array.from(DISPUTE_STATUSES).join(', ')}` });
      return;
    }

    const payload = await withTransaction(async (client) => {
      const currentResult = includeAll
        ? await client.query(
            'SELECT * FROM land_disputes WHERE id = $1 LIMIT 1 FOR UPDATE',
            [disputeId]
          )
        : await client.query(
            'SELECT * FROM land_disputes WHERE id = $1 AND user_id = $2 LIMIT 1 FOR UPDATE',
            [disputeId, req.auth.sub]
          );
      const current = currentResult.rows[0];
      if (!current) return null;
      if (current.status === nextStatus) {
        return { unchanged: true, current: toDisputeRecord(current) };
      }

      const now = new Date().toISOString();
      const resolvedAt = nextStatus === 'RESOLVED' ? now : null;
      const resolutionNote = nextStatus === 'RESOLVED' ? (note || current.resolution_note || null) : null;
      const nextSnapshot = buildDisputeSnapshot({
        parcelRef: current.parcel_ref,
        disputeType: current.dispute_type,
        description: current.description,
        coords: [current.latitude, current.longitude],
        selectionBounds: current.selection_bounds,
        status: nextStatus,
        priority: current.priority,
        evidenceUrls: current.evidence_urls,
        resolutionNote,
      });
      const snapshotHash = disputeSnapshotHash(nextSnapshot);

      const block = await insertChainBlock(client, 'LAND_DISPUTE_STATUS_UPDATED', {
        userId: req.auth.sub,
        actorRole: normalizeRole(req.auth.role),
        disputeOwnerId: current.user_id || null,
        disputeId,
        fromStatus: current.status,
        toStatus: nextStatus,
        snapshotHash,
        note: note || null,
      });

      const updateResult = await client.query(
        `
          UPDATE land_disputes
          SET
            status = $1,
            resolution_note = $2,
            updated_at = $3,
            resolved_at = $4,
            ledger_block_index = $5,
            ledger_block_hash = $6
          WHERE id = $7
          RETURNING *
        `,
        [nextStatus, resolutionNote, now, resolvedAt, block.index, block.hash, disputeId]
      );

      await client.query(
        `
          INSERT INTO dispute_events (
            id, dispute_id, actor_user_id, event_type, from_status, to_status, note,
            created_at, ledger_block_index, ledger_block_hash
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          crypto.randomUUID(),
          disputeId,
          req.auth.sub,
          'STATUS_UPDATED',
          current.status,
          nextStatus,
          note || null,
          now,
          block.index,
          block.hash,
        ]
      );

      return {
        unchanged: false,
        item: toDisputeRecord(updateResult.rows[0]),
        ledgerBlock: {
          index: block.index,
          hash: block.hash,
          eventType: block.eventType,
          timestamp: block.timestamp,
        },
        snapshotHash,
      };
    });

    if (!payload) {
      res.status(404).json({ message: 'Dispute not found.' });
      return;
    }
    if (payload.unchanged) {
      res.status(409).json({ message: 'Dispute already in requested status.', item: payload.current });
      return;
    }

    res.json(payload);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update dispute status.', error: error.message });
  }
});

app.get('/api/disputes/:id/ledger/verify', authMiddleware, async (req, res) => {
  try {
    const disputeId = String(req.params.id || '').trim();
    const includeAll = isEmployeeAuth(req.auth);
    if (!disputeId) {
      res.status(400).json({ message: 'Dispute id is required.' });
      return;
    }

    const disputeResult = includeAll
      ? await query(
          'SELECT * FROM land_disputes WHERE id = $1 LIMIT 1',
          [disputeId]
        )
      : await query(
          'SELECT * FROM land_disputes WHERE id = $1 AND user_id = $2 LIMIT 1',
          [disputeId, req.auth.sub]
        );
    const dispute = disputeResult.rows[0];
    if (!dispute) {
      res.status(404).json({ message: 'Dispute not found.' });
      return;
    }

    const eventResult = await query(
      `
        SELECT
          de.id AS event_id,
          de.event_type AS dispute_event_type,
          de.from_status,
          de.to_status,
          de.note,
          de.created_at AS event_created_at,
          cb.block_index,
          cb.block_timestamp,
          cb.event_type,
          cb.payload,
          cb.previous_hash,
          cb.nonce,
          cb.hash
        FROM dispute_events de
        JOIN chain_blocks cb
          ON cb.block_index = de.ledger_block_index
         AND cb.hash = de.ledger_block_hash
        WHERE de.dispute_id = $1
        ORDER BY de.created_at ASC
      `,
      [disputeId]
    );

    const events = eventResult.rows;
    const blockIntegrityValid = events.every((row) => {
      const expected = hashBlock({
        index: row.block_index,
        timestamp: row.block_timestamp,
        eventType: row.event_type,
        payload: row.payload,
        previousHash: row.previous_hash,
        nonce: row.nonce,
      });
      return expected === row.hash;
    });

    const currentSnapshotHash = disputeSnapshotHash(disputeRowToSnapshot(dispute));
    const latestEvent = events[events.length - 1];
    const latestSnapshotHash = latestEvent?.payload?.snapshotHash || null;
    const snapshotMatch = Boolean(latestSnapshotHash) && latestSnapshotHash === currentSnapshotHash;

    const missingSnapshotHashEvents = events.filter(
      (row) => !row?.payload || !row.payload.snapshotHash
    ).length;

    res.json({
      disputeId,
      valid: blockIntegrityValid && snapshotMatch,
      blockIntegrityValid,
      snapshotMatch,
      currentSnapshotHash,
      latestSnapshotHash,
      eventCount: events.length,
      missingSnapshotHashEvents,
      events: events.map((row) => ({
        eventId: row.event_id,
        disputeEventType: row.dispute_event_type,
        blockIndex: row.block_index,
        blockHash: row.hash,
        chainEventType: row.event_type,
        snapshotHash: row?.payload?.snapshotHash || null,
        createdAt: toIso(row.event_created_at),
      })),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to verify dispute ledger.', error: error.message });
  }
});

app.get('/api/land/parcels', authMiddleware, async (req, res) => {
  try {
    const scope = String(req.query?.scope || '').trim().toLowerCase();
    const includeAll = isEmployeeAuth(req.auth) && scope !== 'mine';
    const items = await loadParcels({ includeAll, userId: req.auth.sub });
    res.json({
      scope: includeAll ? 'GLOBAL' : 'USER',
      totalAreaSqM: items.reduce((sum, item) => sum + Number(item.areaSqM || 0), 0),
      items,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load parcel registry.', error: error.message });
  }
});

app.get('/api/land/claims', authMiddleware, async (req, res) => {
  try {
    const scope = String(req.query?.scope || '').trim().toLowerCase();
    const includeAll = isEmployeeAuth(req.auth) && scope !== 'mine';
    const statusParam = String(req.query?.status || '').trim();
    const statuses = statusParam ? statusParam.split(',').map((item) => item.trim()) : [];
    const items = await loadClaims({ includeAll, userId: req.auth.sub, statuses });
    res.json({
      scope: includeAll ? 'GLOBAL' : 'USER',
      flaggedCount: items.filter((item) => item.status === 'FLAGGED').length,
      items,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load land claims.', error: error.message });
  }
});

app.post('/api/land/claims', authMiddleware, async (req, res) => {
  try {
    if (isEmployeeAuth(req.auth)) {
      res.status(403).json({ message: 'Government employees cannot submit citizen land claims.' });
      return;
    }

    const pid = String(req.body?.pid || '').trim();
    const claimNote = String(req.body?.claimNote || '').trim();
    const polygon = sanitizePolygon(req.body?.polygon);

    if (!pid || pid.length < 3) {
      res.status(400).json({ message: 'Valid PID is required.' });
      return;
    }
    if (!claimNote || claimNote.length < 12) {
      res.status(400).json({ message: 'claimNote must be at least 12 characters.' });
      return;
    }
    if (!polygon) {
      res.status(400).json({ message: 'polygon is required with at least 3 valid coordinate pairs.' });
      return;
    }

    const areaSqM = Number(polygonAreaSqM(polygon).toFixed(3));
    if (!Number.isFinite(areaSqM) || areaSqM < 20) {
      res.status(400).json({ message: 'Polygon area is too small. Select a valid land parcel.' });
      return;
    }
    const centroid = polygonCentroid(polygon);
    if (!centroid) {
      res.status(400).json({ message: 'Unable to compute polygon centroid.' });
      return;
    }

    const overlapFlags = await detectClaimOverlaps({
      polygon,
      pid,
      requesterUserId: req.auth.sub,
    });
    const status = overlapFlags.length ? 'FLAGGED' : 'PENDING';

    const payload = await withTransaction(async (client) => {
      const claimId = crypto.randomUUID();
      const now = new Date().toISOString();

      const block = await insertChainBlock(client, 'LAND_CLAIM_SUBMITTED', {
        claimId,
        userId: req.auth.sub,
        pid,
        status,
        areaSqM,
        overlapCount: overlapFlags.length,
      });

      const insertResult = await client.query(
        `
          INSERT INTO land_claims (
            id, user_id, pid, claim_note, polygon,
            centroid_lat, centroid_lng, area_sq_m,
            status, overlap_flags, review_note, verified_pid, reviewed_by,
            created_at, updated_at, reviewed_at,
            ledger_block_index, ledger_block_hash
          )
          VALUES (
            $1, $2, $3, $4, $5::jsonb,
            $6, $7, $8,
            $9, $10::jsonb, NULL, NULL, NULL,
            $11, $11, NULL,
            $12, $13
          )
          RETURNING *
        `,
        [
          claimId,
          req.auth.sub,
          pid,
          claimNote,
          JSON.stringify(polygon),
          centroid[0],
          centroid[1],
          areaSqM,
          status,
          JSON.stringify(overlapFlags),
          now,
          block.index,
          block.hash,
        ]
      );

      const overlapClaimIds = overlapFlags
        .filter((item) => item.type === 'PENDING_CLAIM_OVERLAP')
        .map((item) => item.targetId)
        .filter(Boolean);
      if (overlapClaimIds.length) {
        await client.query(
          `
            UPDATE land_claims
            SET status = 'FLAGGED', updated_at = $1
            WHERE id = ANY($2::uuid[])
              AND status = 'PENDING'
          `,
          [now, overlapClaimIds]
        );
      }

      return {
        item: toLandClaimRecord(insertResult.rows[0]),
        ledgerBlock: {
          index: block.index,
          hash: block.hash,
          eventType: block.eventType,
          timestamp: block.timestamp,
        },
      };
    });

    res.status(201).json(payload);
  } catch (error) {
    res.status(500).json({ message: 'Failed to submit land claim.', error: error.message });
  }
});

app.patch('/api/land/claims/:id/review', authMiddleware, requireEmployee, async (req, res) => {
  try {
    const claimId = String(req.params.id || '').trim();
    const action = normalizeToken(req.body?.action);
    const verifiedPid = String(req.body?.verifiedPid || '').trim();
    const reviewNote = String(req.body?.reviewNote || '').trim();

    if (!claimId) {
      res.status(400).json({ message: 'claim id is required.' });
      return;
    }
    if (!['APPROVE', 'REJECT'].includes(action)) {
      res.status(400).json({ message: 'action must be APPROVE or REJECT.' });
      return;
    }

    const payload = await withTransaction(async (client) => {
      const currentResult = await client.query(
        'SELECT * FROM land_claims WHERE id = $1 LIMIT 1 FOR UPDATE',
        [claimId]
      );
      const current = currentResult.rows[0];
      if (!current) return null;
      if (['APPROVED', 'REJECTED'].includes(current.status)) {
        return { alreadyFinal: true, item: toLandClaimRecord(current) };
      }

      const now = new Date().toISOString();
      const normalizedPid = String(current.pid || '').trim();
      const decisionStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const finalReviewNote = reviewNote || null;

      if (action === 'APPROVE') {
        if (!verifiedPid) {
          throw httpError(400, 'verifiedPid is required for approval.');
        }
        if (verifiedPid !== normalizedPid) {
          throw httpError(400, 'PID mismatch. Approval requires exact PID match.');
        }

        const pidConflict = await client.query(
          `
            SELECT id, owner_user_id
            FROM owned_parcels
            WHERE pid = $1
              AND status = 'ACTIVE'
            LIMIT 1
          `,
          [normalizedPid]
        );
        if (pidConflict.rows[0]) {
          throw httpError(409, 'PID already assigned to another active parcel.');
        }

        const activeParcels = await client.query(
          `
            SELECT id, pid, owner_user_id, polygon
            FROM owned_parcels
            WHERE status = 'ACTIVE'
          `
        );
        const conflict = activeParcels.rows.find((parcel) =>
          polygonsOverlap(current.polygon, Array.isArray(parcel.polygon) ? parcel.polygon : [])
        );
        if (conflict) {
          throw httpError(409, 'Claim area overlaps an active registered parcel. Resolve dispute before approval.');
        }
      }

      const reviewBlock = await insertChainBlock(client, 'LAND_CLAIM_REVIEWED', {
        claimId,
        action,
        reviewerUserId: req.auth.sub,
        claimantUserId: current.user_id,
        pid: normalizedPid,
      });

      const updatedClaimResult = await client.query(
        `
          UPDATE land_claims
          SET
            status = $1,
            review_note = $2,
            verified_pid = $3,
            reviewed_by = $4,
            reviewed_at = $5,
            updated_at = $5,
            ledger_block_index = $6,
            ledger_block_hash = $7
          WHERE id = $8
          RETURNING *
        `,
        [
          decisionStatus,
          finalReviewNote,
          action === 'APPROVE' ? verifiedPid : null,
          req.auth.sub,
          now,
          reviewBlock.index,
          reviewBlock.hash,
          claimId,
        ]
      );

      let parcel = null;
      if (action === 'APPROVE') {
        const parcelBlock = await insertChainBlock(client, 'LAND_PARCEL_ASSIGNED', {
          claimId,
          pid: normalizedPid,
          ownerUserId: current.user_id,
          reviewerUserId: req.auth.sub,
          areaSqM: Number(current.area_sq_m || 0),
        });

        const parcelResult = await client.query(
          `
            INSERT INTO owned_parcels (
              id, owner_user_id, pid, polygon,
              centroid_lat, centroid_lng, area_sq_m,
              assigned_claim_id, status,
              created_at, updated_at,
              ledger_block_index, ledger_block_hash
            )
            VALUES (
              $1, $2, $3, $4::jsonb,
              $5, $6, $7,
              $8, 'ACTIVE',
              $9, $9,
              $10, $11
            )
            RETURNING *
          `,
          [
            crypto.randomUUID(),
            current.user_id,
            normalizedPid,
            JSON.stringify(current.polygon),
            Number(current.centroid_lat),
            Number(current.centroid_lng),
            Number(current.area_sq_m || 0),
            claimId,
            now,
            parcelBlock.index,
            parcelBlock.hash,
          ]
        );
        parcel = toOwnedParcelRecord(parcelResult.rows[0]);
      }

      return {
        alreadyFinal: false,
        item: toLandClaimRecord(updatedClaimResult.rows[0]),
        parcel,
      };
    });

    if (!payload) {
      res.status(404).json({ message: 'Claim not found.' });
      return;
    }
    if (payload.alreadyFinal) {
      res.status(409).json({ message: 'Claim already reviewed.', item: payload.item });
      return;
    }
    res.json(payload);
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || 'Failed to review land claim.' });
  }
});

app.get('/api/land/summary', authMiddleware, requireEmployee, async (_req, res) => {
  try {
    const [parcelSummaryResult, claimSummaryResult, ownershipRows, claimsRows] = await Promise.all([
      query(
        `
          SELECT
            COUNT(*)::int AS total_parcels,
            COALESCE(SUM(area_sq_m), 0)::double precision AS total_area_sq_m
          FROM owned_parcels
          WHERE status = 'ACTIVE'
        `
      ),
      query(
        `
          SELECT
            COUNT(*)::int AS total_claims,
            COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending_claims,
            COUNT(*) FILTER (WHERE status = 'FLAGGED')::int AS flagged_claims,
            COUNT(*) FILTER (WHERE status = 'APPROVED')::int AS approved_claims,
            COUNT(*) FILTER (WHERE status = 'REJECTED')::int AS rejected_claims
          FROM land_claims
        `
      ),
      query(
        `
          SELECT
            op.owner_user_id,
            u.name AS owner_name,
            u.email AS owner_email,
            COUNT(*)::int AS parcel_count,
            COALESCE(SUM(op.area_sq_m), 0)::double precision AS area_sq_m
          FROM owned_parcels op
          JOIN users u ON u.id = op.owner_user_id
          WHERE op.status = 'ACTIVE'
          GROUP BY op.owner_user_id, u.name, u.email
          ORDER BY area_sq_m DESC
          LIMIT 200
        `
      ),
      query(
        `
          SELECT
            lc.id,
            lc.pid,
            lc.status,
            lc.overlap_flags,
            lc.user_id,
            u.name AS user_name,
            u.email AS user_email,
            lc.updated_at
          FROM land_claims lc
          LEFT JOIN users u ON u.id = lc.user_id
          WHERE lc.status IN ('PENDING', 'FLAGGED')
          ORDER BY lc.updated_at DESC
          LIMIT 200
        `
      ),
    ]);

    const parcelSummary = parcelSummaryResult.rows[0] || {};
    const claimSummary = claimSummaryResult.rows[0] || {};
    const pendingClaims = claimsRows.rows.map((row) => ({
      id: row.id,
      pid: row.pid,
      status: row.status,
      overlapFlags: Array.isArray(row.overlap_flags) ? row.overlap_flags : [],
      claimant: {
        id: row.user_id,
        name: row.user_name || 'Unknown user',
        email: row.user_email || null,
      },
      updatedAt: toIso(row.updated_at),
    }));

    res.json({
      parcels: {
        total: Number(parcelSummary.total_parcels || 0),
        totalAreaSqM: Number(parcelSummary.total_area_sq_m || 0),
      },
      claims: {
        total: Number(claimSummary.total_claims || 0),
        pending: Number(claimSummary.pending_claims || 0),
        flagged: Number(claimSummary.flagged_claims || 0),
        approved: Number(claimSummary.approved_claims || 0),
        rejected: Number(claimSummary.rejected_claims || 0),
      },
      ownership: ownershipRows.rows.map((row) => ({
        owner: {
          id: row.owner_user_id,
          name: row.owner_name || 'Unknown owner',
          email: row.owner_email || null,
        },
        parcelCount: Number(row.parcel_count || 0),
        areaSqM: Number(row.area_sq_m || 0),
      })),
      pendingClaims,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load land governance summary.', error: error.message });
  }
});

app.get('/api/analytics/overview', authMiddleware, requireEmployee, async (_req, res) => {
  try {
    const [usersResult, insightsResult, disputesResult, cropsResult, vigorResult] = await Promise.all([
      query(`
        SELECT
          COUNT(*)::int AS total_users,
          COUNT(*) FILTER (WHERE role = 'EMPLOYEE')::int AS employee_users,
          COUNT(*) FILTER (WHERE role = 'USER')::int AS citizen_users
        FROM users
      `),
      query(`
        SELECT
          COUNT(*)::int AS total_insights,
          COALESCE(AVG(ndvi_mean), 0)::double precision AS avg_ndvi,
          COALESCE(AVG(rainfall_7d), 0)::double precision AS avg_rainfall_7d,
          COALESCE(AVG(max_temp_avg), 0)::double precision AS avg_max_temp,
          COALESCE(AVG(min_temp_avg), 0)::double precision AS avg_min_temp
        FROM agri_insights
      `),
      query(`
        SELECT
          COUNT(*)::int AS total_disputes,
          COUNT(*) FILTER (WHERE status = 'OPEN')::int AS open_disputes,
          COUNT(*) FILTER (WHERE status = 'IN_REVIEW')::int AS in_review_disputes,
          COUNT(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved_disputes,
          COUNT(*) FILTER (WHERE status = 'REJECTED')::int AS rejected_disputes,
          COALESCE(
            AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600)
              FILTER (WHERE resolved_at IS NOT NULL),
            0
          )::double precision AS avg_resolution_hours
        FROM land_disputes
      `),
      query(`
        SELECT
          recommended_crops->0->>'name' AS crop_name,
          COUNT(*)::int AS count
        FROM agri_insights
        WHERE recommended_crops->0->>'name' IS NOT NULL
        GROUP BY recommended_crops->0->>'name'
        ORDER BY count DESC
        LIMIT 5
      `),
      query(`
        SELECT
          COUNT(*) FILTER (WHERE ndvi_mean >= 0.45)::int AS dense_vegetation,
          COUNT(*) FILTER (WHERE ndvi_mean >= 0.25 AND ndvi_mean < 0.45)::int AS active_cropland,
          COUNT(*) FILTER (WHERE ndvi_mean >= 0.1 AND ndvi_mean < 0.25)::int AS sparse_vegetation,
          COUNT(*) FILTER (WHERE ndvi_mean < 0.1)::int AS barren_or_water
        FROM agri_insights
      `),
    ]);

    const users = usersResult.rows[0] || {};
    const insights = insightsResult.rows[0] || {};
    const disputes = disputesResult.rows[0] || {};
    const vigor = vigorResult.rows[0] || {};

    res.json({
      users: {
        total: Number(users.total_users || 0),
        citizens: Number(users.citizen_users || 0),
        employees: Number(users.employee_users || 0),
      },
      insights: {
        total: Number(insights.total_insights || 0),
        avgNdvi: Number(insights.avg_ndvi || 0),
        avgRainfall7d: Number(insights.avg_rainfall_7d || 0),
        avgMaxTemp: Number(insights.avg_max_temp || 0),
        avgMinTemp: Number(insights.avg_min_temp || 0),
        vegetationMix: {
          denseVegetation: Number(vigor.dense_vegetation || 0),
          activeCropland: Number(vigor.active_cropland || 0),
          sparseVegetation: Number(vigor.sparse_vegetation || 0),
          barrenOrWater: Number(vigor.barren_or_water || 0),
        },
      },
      disputes: {
        total: Number(disputes.total_disputes || 0),
        open: Number(disputes.open_disputes || 0),
        inReview: Number(disputes.in_review_disputes || 0),
        resolved: Number(disputes.resolved_disputes || 0),
        rejected: Number(disputes.rejected_disputes || 0),
        avgResolutionHours: Number(disputes.avg_resolution_hours || 0),
      },
      topCrops: cropsResult.rows.map((row) => ({
        name: row.crop_name,
        count: Number(row.count || 0),
      })),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load governance analytics.', error: error.message });
  }
});

app.post('/api/auth/signup', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const walletAddress = String(req.body?.walletAddress || '').trim();
    const requestedRole = normalizeRole(req.body?.role);
    const employeeAccessCode = String(req.body?.employeeAccessCode || '').trim();
    const employeeIdRaw = String(req.body?.employeeId || '').trim();
    const role = requestedRole === 'EMPLOYEE' ? 'EMPLOYEE' : 'USER';
    const employeeId = role === 'EMPLOYEE' ? employeeIdRaw : null;

    if (!name || !email || !password) {
      res.status(400).json({ message: 'Name, email, and password are required.' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ message: 'Password must be at least 6 characters.' });
      return;
    }

    if (role === 'EMPLOYEE' && EMPLOYEE_SIGNUP_CODE && employeeAccessCode !== EMPLOYEE_SIGNUP_CODE) {
      res.status(403).json({ message: 'Invalid government employee access code.' });
      return;
    }

    if (role === 'EMPLOYEE' && !isValidGovernmentEmail(email)) {
      res.status(400).json({ message: 'Government employee email must end with .in or gov.in.' });
      return;
    }

    if (role === 'EMPLOYEE' && !EMPLOYEE_ID_REGEX.test(employeeId || '')) {
      res.status(400).json({ message: 'Government employee ID must start with 1947 and contain digits only.' });
      return;
    }

    const existingResult = await query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
    if (existingResult.rows.length > 0) {
      res.status(409).json({ message: 'Email already registered.' });
      return;
    }

    if (employeeId) {
      const existingEmployeeId = await query(
        'SELECT id FROM users WHERE employee_id = $1 LIMIT 1',
        [employeeId]
      );
      if (existingEmployeeId.rows.length > 0) {
        res.status(409).json({ message: 'Employee ID already registered.' });
        return;
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const newUser = {
      id: crypto.randomUUID(),
      name,
      email,
      role,
      employeeId,
      walletAddress: walletAddress || null,
      passwordHash,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    };

    await query(
      `
        INSERT INTO users
        (id, name, email, role, employee_id, wallet_address, password_hash, created_at, last_login_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        newUser.id,
        newUser.name,
        newUser.email,
        newUser.role,
        newUser.employeeId,
        newUser.walletAddress,
        newUser.passwordHash,
        newUser.createdAt,
        newUser.lastLoginAt,
      ]
    );

    await ensureUserSettings(query, newUser.id);

    const block = await appendChainBlock('USER_SIGNUP', {
      userId: newUser.id,
      email: newUser.email,
      role: newUser.role,
      employeeId: newUser.employeeId,
      walletAddress: newUser.walletAddress,
      name: newUser.name,
    });

    const token = createToken({
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role,
      employee_id: newUser.employeeId,
      wallet_address: newUser.walletAddress,
    });

    res.status(201).json({
      message: 'Signup successful.',
      token,
      user: toPublicUser({
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        employee_id: newUser.employeeId,
        wallet_address: newUser.walletAddress,
        created_at: newUser.createdAt,
        last_login_at: newUser.lastLoginAt,
      }),
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
      role: normalizeRole(user.role),
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

app.get('/api/settings/profile', authMiddleware, async (req, res) => {
  try {
    const userResult = await query('SELECT * FROM users WHERE id = $1 LIMIT 1', [req.auth.sub]);
    const user = userResult.rows[0];
    if (!user) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    const settings = await ensureUserSettings(query, req.auth.sub);
    res.json({
      user: toPublicUser(user),
      settings: toUserSettings(settings),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load settings profile.', error: error.message });
  }
});

app.put('/api/settings/profile', authMiddleware, async (req, res) => {
  try {
    const name = normalizeText(req.body?.name, 80);
    const walletAddressRaw = normalizeText(req.body?.walletAddress, 128);
    const organization = normalizeText(req.body?.organization, 120);
    const roleTitle = normalizeText(req.body?.roleTitle, 120);
    const phone = normalizeText(req.body?.phone, 40);
    const preferredLanguage = sanitizePreferredLanguage(req.body?.preferredLanguage);

    if (!name) {
      res.status(400).json({ message: 'Name is required.' });
      return;
    }

    const payload = await withTransaction(async (client) => {
      const userResult = await client.query(
        'SELECT * FROM users WHERE id = $1 LIMIT 1 FOR UPDATE',
        [req.auth.sub]
      );
      const currentUser = userResult.rows[0];
      if (!currentUser) return null;

      const walletAddress = walletAddressRaw || null;
      const settings = await ensureUserSettings(client, req.auth.sub);
      const now = new Date().toISOString();

      const updatedUserResult = await client.query(
        `
          UPDATE users
          SET name = $1, wallet_address = $2
          WHERE id = $3
          RETURNING *
        `,
        [name, walletAddress, req.auth.sub]
      );

      const updatedSettingsResult = await client.query(
        `
          UPDATE user_settings
          SET
            organization = $1,
            role_title = $2,
            phone = $3,
            preferred_language = $4,
            updated_at = $5
          WHERE user_id = $6
          RETURNING *
        `,
        [organization, roleTitle, phone, preferredLanguage, now, req.auth.sub]
      );

      const profileSnapshot = {
        userId: req.auth.sub,
        name,
        walletAddress,
        organization,
        roleTitle,
        phone,
        preferredLanguage,
      };
      const profileHash = sha256Hex(profileSnapshot);

      const block = await insertChainBlock(client, 'SETTINGS_PROFILE_UPDATED', {
        userId: req.auth.sub,
        profileHash,
      });

      return {
        user: toPublicUser(updatedUserResult.rows[0]),
        settings: toUserSettings(updatedSettingsResult.rows[0] || settings),
        ledgerBlock: {
          index: block.index,
          hash: block.hash,
          eventType: block.eventType,
          timestamp: block.timestamp,
        },
      };
    });

    if (!payload) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    res.json(payload);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update profile settings.', error: error.message });
  }
});

app.put('/api/settings/preferences', authMiddleware, async (req, res) => {
  try {
    const defaultMapLayer = normalizeToken(req.body?.defaultMapLayer || 'SAT');
    if (!SETTINGS_MAP_LAYERS.has(defaultMapLayer)) {
      res.status(400).json({ message: `Invalid defaultMapLayer. Allowed: ${Array.from(SETTINGS_MAP_LAYERS).join(', ')}` });
      return;
    }

    const mapCenter = sanitizeMapCenter(req.body?.mapDefaultCenter);
    if (req.body?.mapDefaultCenter && !mapCenter) {
      res.status(400).json({ message: 'mapDefaultCenter must be [lat, lng].' });
      return;
    }

    const rawZoom = Number(req.body?.mapDefaultZoom);
    const mapDefaultZoom = Number.isFinite(rawZoom) ? Math.round(clampNumber(rawZoom, 3, 18)) : 12;

    const notifications = req.body?.notifications || {};
    const notifyDisputeUpdates = notifications.disputeUpdates !== false;
    const notifyNdviReady = notifications.ndviReady !== false;
    const notifyWeeklyDigest = notifications.weeklyDigest === true;

    const payload = await withTransaction(async (client) => {
      const currentSettings = await ensureUserSettings(client, req.auth.sub);
      const now = new Date().toISOString();

      const nextCenter = mapCenter || [
        Number(currentSettings.map_default_lat),
        Number(currentSettings.map_default_lng),
      ];

      const updatedSettingsResult = await client.query(
        `
          UPDATE user_settings
          SET
            default_map_layer = $1,
            map_default_lat = $2,
            map_default_lng = $3,
            map_default_zoom = $4,
            notify_dispute_updates = $5,
            notify_ndvi_ready = $6,
            notify_weekly_digest = $7,
            updated_at = $8
          WHERE user_id = $9
          RETURNING *
        `,
        [
          defaultMapLayer,
          nextCenter[0],
          nextCenter[1],
          mapDefaultZoom,
          notifyDisputeUpdates,
          notifyNdviReady,
          notifyWeeklyDigest,
          now,
          req.auth.sub,
        ]
      );

      const prefSnapshot = {
        userId: req.auth.sub,
        defaultMapLayer,
        mapDefaultCenter: nextCenter,
        mapDefaultZoom,
        notifications: {
          disputeUpdates: notifyDisputeUpdates,
          ndviReady: notifyNdviReady,
          weeklyDigest: notifyWeeklyDigest,
        },
      };
      const preferencesHash = sha256Hex(prefSnapshot);

      const block = await insertChainBlock(client, 'SETTINGS_PREFERENCES_UPDATED', {
        userId: req.auth.sub,
        preferencesHash,
      });

      return {
        settings: toUserSettings(updatedSettingsResult.rows[0]),
        ledgerBlock: {
          index: block.index,
          hash: block.hash,
          eventType: block.eventType,
          timestamp: block.timestamp,
        },
      };
    });

    res.json(payload);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update preference settings.', error: error.message });
  }
});

app.post('/api/settings/password', authMiddleware, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const nextPassword = String(req.body?.nextPassword || '');

    if (!currentPassword || !nextPassword) {
      res.status(400).json({ message: 'currentPassword and nextPassword are required.' });
      return;
    }

    if (nextPassword.length < 8) {
      res.status(400).json({ message: 'nextPassword must be at least 8 characters.' });
      return;
    }

    const payload = await withTransaction(async (client) => {
      const userResult = await client.query(
        'SELECT * FROM users WHERE id = $1 LIMIT 1 FOR UPDATE',
        [req.auth.sub]
      );
      const user = userResult.rows[0];
      if (!user) return null;

      const isValid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!isValid) return { invalidPassword: true };

      const nextHash = await bcrypt.hash(nextPassword, 12);
      await client.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [nextHash, req.auth.sub]
      );

      const block = await insertChainBlock(client, 'USER_PASSWORD_CHANGED', {
        userId: req.auth.sub,
        changedAt: new Date().toISOString(),
      });

      return {
        invalidPassword: false,
        ledgerBlock: {
          index: block.index,
          hash: block.hash,
          eventType: block.eventType,
          timestamp: block.timestamp,
        },
      };
    });

    if (!payload) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }
    if (payload.invalidPassword) {
      res.status(401).json({ message: 'Current password is incorrect.' });
      return;
    }

    res.json({
      message: 'Password updated successfully.',
      ledgerBlock: payload.ledgerBlock,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update password.', error: error.message });
  }
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const startDatabaseWithRetry = async () => {
  while (!databaseReady) {
    try {
      await initDatabase();
      await ensureGenesisBlock();
      databaseReady = true;
      console.log(`Database initialization complete (${getPersistenceMode()}).`);
    } catch (error) {
      databaseReady = false;
      console.error(`Database init failed: ${error.message}`);
      console.error('Retrying in 5 seconds...');
      await sleep(5000);
    }
  }
};

void startDatabaseWithRetry();

app.listen(PORT, () => {
  console.log(`Auth API running on http://127.0.0.1:${PORT}`);
  console.log(`Persistence preference: ${String(process.env.PERSISTENCE_MODE || 'auto').trim() || 'auto'}`);
  if (JWT_SECRET === 'replace-me-with-a-strong-secret') {
    console.warn('Using fallback JWT secret. Set JWT_SECRET in .env for production.');
  }
});

process.on('SIGINT', async () => {
  await closeDatabase();
  process.exit(0);
});
