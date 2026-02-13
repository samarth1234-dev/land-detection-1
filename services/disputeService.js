import { loadSession } from './authService.js';

const parseResponse = async (response) => {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(payload?.message || 'Dispute request failed.');
    error.status = response.status;
    throw error;
  }

  return payload;
};

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
  const response = await fetch('/api/disputes/summary', {
    method: 'GET',
    headers: authHeaders(),
  });
  return parseResponse(response);
};

export const fetchDisputes = async (status = '') => {
  const endpoint = status ? `/api/disputes?status=${encodeURIComponent(status)}` : '/api/disputes';
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: authHeaders(),
  });
  return parseResponse(response);
};

export const createDispute = async ({ parcelRef, disputeType, description, coords, priority, evidenceUrls }) => {
  const response = await fetch('/api/disputes', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      parcelRef,
      disputeType,
      description,
      coords,
      priority,
      evidenceUrls,
    }),
  });
  return parseResponse(response);
};

export const updateDisputeStatus = async ({ disputeId, status, note }) => {
  const response = await fetch(`/api/disputes/${encodeURIComponent(disputeId)}/status`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ status, note }),
  });
  return parseResponse(response);
};

export const verifyDisputeLedger = async (disputeId) => {
  const response = await fetch(`/api/disputes/${encodeURIComponent(disputeId)}/ledger/verify`, {
    method: 'GET',
    headers: authHeaders(),
  });
  return parseResponse(response);
};
