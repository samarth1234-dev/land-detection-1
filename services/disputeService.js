import { loadSession } from './authService.js';
import { buildApiUrl, parseJsonResponse } from './apiClient.js';

const authHeaders = () => {
  const session = loadSession();
  if (!session?.token) {
    throw new Error('Authentication required.');
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.token}`,
  };
};

export const fetchDisputeSummary = async () => {
  const response = await fetch(buildApiUrl('/api/disputes/summary'), {
    method: 'GET',
    headers: authHeaders(),
  });
  return parseJsonResponse(response, 'Failed to load dispute summary.');
};

export const fetchDisputes = async (status = '') => {
  const endpoint = status ? `/api/disputes?status=${encodeURIComponent(status)}` : '/api/disputes';
  const response = await fetch(buildApiUrl(endpoint), {
    method: 'GET',
    headers: authHeaders(),
  });
  return parseJsonResponse(response, 'Failed to load disputes.');
};

export const createDispute = async ({ parcelRef, disputeType, description, coords, selectionBounds, priority, evidenceUrls }) => {
  const response = await fetch(buildApiUrl('/api/disputes'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      parcelRef,
      disputeType,
      description,
      coords,
      selectionBounds,
      priority,
      evidenceUrls,
    }),
  });
  return parseJsonResponse(response, 'Failed to create dispute.');
};

export const updateDisputeStatus = async ({ disputeId, status, note }) => {
  const response = await fetch(buildApiUrl(`/api/disputes/${encodeURIComponent(disputeId)}/status`), {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ status, note }),
  });
  return parseJsonResponse(response, 'Failed to update dispute status.');
};

export const verifyDisputeLedger = async (disputeId) => {
  const response = await fetch(buildApiUrl(`/api/disputes/${encodeURIComponent(disputeId)}/ledger/verify`), {
    method: 'GET',
    headers: authHeaders(),
  });
  return parseJsonResponse(response, 'Failed to verify dispute ledger.');
};
